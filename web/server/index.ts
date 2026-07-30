// MUST be first import - configures DNS to prefer IPv4 before any network modules load
import "./dns-config";
import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { WebhookHandlers } from "./webhookHandlers";
import { registerAuthRoutes } from "./auth";
import { warmConnectionPool, startConnectionKeepAlive } from "./db";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

(async () => {

  // Register Stripe webhook route BEFORE express.json()
  app.post(
    '/api/stripe/webhook',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      const signature = req.headers['stripe-signature'];

      if (!signature) {
        return res.status(400).json({ error: 'Missing stripe-signature' });
      }

      try {
        const sig = Array.isArray(signature) ? signature[0] : signature;

        if (!Buffer.isBuffer(req.body)) {
          console.error('STRIPE WEBHOOK ERROR: req.body is not a Buffer');
          return res.status(500).json({ error: 'Webhook processing error' });
        }

        await WebhookHandlers.processWebhook(req.body as Buffer, sig);
        res.status(200).json({ received: true });
      } catch (error: any) {
        console.error('Webhook error:', error.message);
        res.status(400).json({ error: 'Webhook processing error' });
      }
    }
  );

  // PostHog reverse proxy - bypasses ad blockers
  app.use('/ingest', express.raw({ type: '*/*', limit: '5mb' }), async (req, res) => {
    const posthogUrl = 'https://us.i.posthog.com' + req.originalUrl.replace('/ingest', '');

    try {
      const headers: Record<string, string> = {};
      if (req.headers['content-type']) {
        headers['content-type'] = req.headers['content-type'] as string;
      }

      const response = await fetch(posthogUrl, {
        method: req.method,
        headers,
        body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
      });

      res.status(response.status);
      const data = await response.text();
      res.send(data);
    } catch (error) {
      console.error('PostHog proxy error:', error);
      res.status(500).json({ error: 'Proxy error' });
    }
  });

  // Now apply JSON middleware for all other routes
  app.use(
    express.json({
      limit: '15mb', // Increased for image uploads (base64 encoded)
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false }));

  // Register auth routes
  registerAuthRoutes(app);

  // Register test-only routes (never loaded in production)
  if (process.env.NODE_ENV === "test") {
    const { registerTestRoutes } = await import("./test-routes");
    registerTestRoutes(app);
    log("Test routes registered (NODE_ENV=test)");
  }

  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
      }
    });

    next();
  });

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    // Only send response if headers haven't been sent already
    if (!res.headersSent) {
      res.status(status).json({ message });
    }
    
    // Log the error but don't re-throw (causes unhandled promise rejection)
    console.error('Unhandled error:', err);
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // Warm database connection pool before accepting requests
  await warmConnectionPool();
  startConnectionKeepAlive(30000); // Ping every 30 seconds to prevent idle drops

  const port = parseInt(process.env.PORT || "5000", 10);
  const host = "0.0.0.0"; // Bind to all interfaces for mobile testing
  httpServer.listen(port, host, () => {
    log(`serving on http://${host}:${port}`);
  });
})();
