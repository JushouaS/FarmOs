/**
 * Headers the dashboard's own server sets on everything it hands out.
 *
 * The API has helmet; the page server had nothing, so a document served from
 * here could be framed by any site and sniffed into another content type. The
 * policy is deliberately narrow: it forbids the dangerous behaviours (framing,
 * plugins, base-tag rewriting) without a default-src, which would break the
 * inline styles and the data: URLs the camera frames arrive as.
 *
 * Kept in its own module because two places need it and they must not drift:
 * vite.config.ts applies it to every route through Nitro's route rules (which
 * is what covers files under public/), and src/server.ts applies it to the
 * responses Nitro's own handler never sees, such as the error pages.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy": "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
};

/**
 * The same headers, plus HSTS when the page was fetched over TLS.
 *
 * HSTS is deliberately not in SECURITY_HEADERS: sent on a plain-http
 * development session a browser remembers the upgrade for half a year, and
 * http://localhost stops answering.
 */
export function securityHeadersFor(url: string): Record<string, string> {
  const headers = { ...SECURITY_HEADERS };
  if (url.startsWith("https:")) {
    headers["strict-transport-security"] = "max-age=15552000; includeSubDomains";
  }
  return headers;
}
