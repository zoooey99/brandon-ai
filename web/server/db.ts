import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import dns from "dns";

// Force IPv4 resolution - Render doesn't support IPv6
dns.setDefaultResultOrder('ipv4first');

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is not set");
}

// Configure postgres client with SSL for external database connections
// Using Transaction Pooler (port 6543) for serverless/scaling workloads
const client = postgres(databaseUrl, {
  ssl: 'require',      // Use simpler SSL config
  max: 10,             // Increased from 5 for burst handling
  idle_timeout: 20,    // Increased from 10 - keep connections longer
  connect_timeout: 60, // Increase timeout for cold starts
  prepare: true,       // Session Pooler supports prepared statements
  connection: {
    application_name: 'brandon-fitness',
  },
});

export const db = drizzle(client);

// Retry logic for transient database errors
const RETRYABLE_ERRORS = ['CONNECT_TIMEOUT', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', '53300'];
const MAX_RETRIES = 5;          // Increased from 3 for better cold start resilience
const INITIAL_DELAY_MS = 1000;  // Increased from 500 for more recovery time

export async function withDbRetry<T>(
  operation: () => Promise<T>,
  context: string = 'DB operation'
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      const errorCode = error?.code || error?.errno || '';
      const isRetryable = RETRYABLE_ERRORS.some(code =>
        errorCode.includes(code) || error?.message?.includes(code)
      );

      if (!isRetryable || attempt === MAX_RETRIES) {
        break;
      }

      const delay = INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`${context} attempt ${attempt} failed (${errorCode}), retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

// Connection pool warming and keep-alive for cold start resilience
export async function warmConnectionPool(): Promise<void> {
  try {
    await db.execute(sql`SELECT 1`);
    console.log('Database connection pool warmed');
  } catch (error) {
    console.error('Failed to warm connection pool:', error);
    // Don't throw - server can still start
  }
}

let keepAliveInterval: NodeJS.Timeout | null = null;

export function startConnectionKeepAlive(intervalMs = 30000): void {
  if (keepAliveInterval) return;

  keepAliveInterval = setInterval(async () => {
    try {
      await db.execute(sql`SELECT 1`);
    } catch (error) {
      console.error('Keep-alive ping failed:', error);
    }
  }, intervalMs);

  console.log(`Database keep-alive started (every ${intervalMs / 1000}s)`);
}

export function stopConnectionKeepAlive(): void {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}
