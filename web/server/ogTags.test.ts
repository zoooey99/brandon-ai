import { describe, it, expect } from "vitest";
import { injectTrackingOGTags } from "./ogTags";

const sampleHtml = `<!DOCTYPE html>
<html>
  <head>
    <title>Brandon</title>
    <meta property="og:title" content="Brandon - AI Fitness Coach" />
    <meta property="og:image" content="https://textbrandon.now/og-default.png" />
    <meta name="twitter:title" content="Brandon - AI Fitness Coach" />
    <meta name="twitter:image" content="https://textbrandon.now/og-default.png" />
  </head>
  <body></body>
</html>`;

describe("injectTrackingOGTags", () => {
  const result = injectTrackingOGTags(sampleHtml, "/track/abc123");

  it("replaces the page title", () => {
    expect(result).toContain("<title>Track Workout</title>");
    expect(result).not.toContain("<title>Brandon</title>");
  });

  it("replaces og:title and og:image with tracking values", () => {
    expect(result).toContain('<meta property="og:title" content="Track Workout" />');
    expect(result).toContain(
      '<meta property="og:image" content="https://textbrandon.now/og-track.png" />',
    );
    expect(result).not.toContain("og-default.png");
  });

  it("adds og:image dimensions", () => {
    expect(result).toContain('<meta property="og:image:width" content="1200" />');
    expect(result).toContain('<meta property="og:image:height" content="630" />');
  });

  it("replaces twitter card tags", () => {
    expect(result).toContain('<meta name="twitter:title" content="Track Workout" />');
    expect(result).toContain(
      '<meta name="twitter:image" content="https://textbrandon.now/og-track.png" />',
    );
  });

  it("leaves HTML without matching tags unchanged", () => {
    const bare = "<html><head></head><body></body></html>";
    expect(injectTrackingOGTags(bare, "/track/abc123")).toBe(bare);
  });
});
