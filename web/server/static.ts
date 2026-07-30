import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { injectTrackingOGTags } from "./ogTags";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (req, res) => {
    const url = req.originalUrl;
    const indexPath = path.resolve(distPath, "index.html");

    if (/^\/track\/[a-zA-Z0-9_-]+/.test(url)) {
      let html = fs.readFileSync(indexPath, "utf-8");
      html = injectTrackingOGTags(html, url);
      res.status(200).set("Content-Type", "text/html").send(html);
    } else {
      res.sendFile(indexPath);
    }
  });
}
