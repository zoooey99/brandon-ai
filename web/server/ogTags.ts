const BASE_URL = "https://textbrandon.now";

export function injectTrackingOGTags(html: string, _url: string): string {
  const title = "Track Workout";
  const image = `${BASE_URL}/og-track.png`;

  // Replace <title>
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);

  // Replace og: tags
  html = html.replace(
    /<meta property="og:title" content="[^"]*" \/>/,
    `<meta property="og:title" content="${title}" />`,
  );
  html = html.replace(
    /<meta property="og:image" content="[^"]*" \/>/,
    `<meta property="og:image" content="${image}" />\n    <meta property="og:image:width" content="1200" />\n    <meta property="og:image:height" content="630" />`,
  );
  // Replace twitter: tags
  html = html.replace(
    /<meta name="twitter:title" content="[^"]*" \/>/,
    `<meta name="twitter:title" content="${title}" />`,
  );
  html = html.replace(
    /<meta name="twitter:image" content="[^"]*" \/>/,
    `<meta name="twitter:image" content="${image}" />`,
  );

  return html;
}
