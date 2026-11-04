#!/usr/bin/env node
/**
 * public-gateway.mjs: puts the whole Cerebroil site behind ONE address, so one tunnel can make it public.
 *
 * The site is three servers that browsers normally reach on three ports: the website, the API and the
 * Kinect bridge. A public https address has one door, and the sign-in cookie only works within one site, so this
 * small program is that door. It listens on this computer only (127.0.0.1) and the tunnel (cloudflared) points
 * at it:
 *
 *     https://random-words.trycloudflare.com/            -> the website        (WEB_URL)
 *     https://random-words.trycloudflare.com/api/...     -> the API            (API_URL), without the /api
 *     wss://random-words.trycloudflare.com/kinect/...    -> the Kinect bridge  (KINECT_URL), as a secure websocket
 *
 * See start-public.ps1 for how everything is started, and HOW_TO_RUN.md, "Sharing the site on a public link".
 *
 * What it does for safety:
 *   - It forgets any X-Forwarded-* header a visitor sent and sets X-Forwarded-For from Cloudflare's own
 *     CF-Connecting-IP, so the API's login limits and audit log see the real visitor, not "this computer" and not
 *     a made-up address. (The API must run with TRUST_PROXY=127.0.0.1.)
 *   - The API's cookies are limited to a path ("/auth/mfa"); on the way out that path gets the /api prefix.
 *   - The Kinect bridge only accepts pages from this computer or the local network, so the Origin it sees is
 *     replaced. What protects the stream is the ticket, so it refuses to pass anything on when the ticket is
 *     missing. Run the bridge with KINECT_BRIDGE_KEY.
 *   - It adds basic security headers to the website's answers and logs paths without query strings (a Kinect
 *     ticket travels in one).
 */
import http from "node:http";
import net from "node:net";

const PORT = Number(process.env.GATEWAY_PORT ?? 9000);
const WEB = new URL(process.env.WEB_URL ?? "http://127.0.0.1:8180");
const API = new URL(process.env.API_URL ?? "http://127.0.0.1:4100");
const KINECT = new URL(process.env.KINECT_URL ?? "http://127.0.0.1:8181");
const QUIET = process.env.GATEWAY_QUIET === "1";

const log = (...parts) => {
  if (!QUIET) console.log(new Date().toISOString().slice(11, 19), ...parts);
};

/** The visitor's address. Behind the tunnel it is Cloudflare's CF-Connecting-IP; a direct local caller is itself. */
function visitorAddress(req) {
  const cf = req.headers["cf-connecting-ip"];
  return typeof cf === "string" && cf ? cf : req.socket.remoteAddress ?? "";
}

function forwardedHeaders(req, target) {
  const headers = { ...req.headers };
  for (const name of ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "forwarded"]) delete headers[name];
  headers["x-forwarded-for"] = visitorAddress(req);
  const proto = req.headers["x-forwarded-proto"] ?? (req.headers["cf-visitor"] ? "https" : "http");
  headers["x-forwarded-proto"] = Array.isArray(proto) ? proto[0] : String(proto).split(",")[0].trim();
  headers["x-forwarded-host"] = req.headers.host ?? "";
  headers.host = req.headers.host ?? target.host;
  return headers;
}

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

/** "Path=/auth/mfa" -> "Path=/api/auth/mfa", so a path-limited cookie still matches under /api. */
function rewriteCookies(values) {
  return values.map((c) => c.replace(/;\s*Path=(\/[^;]*)/i, (whole, p) => (p === "/" ? whole : `; Path=/api${p}`)));
}

function proxy(req, res, target, { stripPrefix = "", isApi = false } = {}) {
  const started = Date.now();
  const path = stripPrefix ? req.url.slice(stripPrefix.length) || "/" : req.url;
  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: path.startsWith("/") ? path : `/${path}`,
      headers: forwardedHeaders(req, target),
    },
    (up) => {
      const headers = { ...up.headers };
      if (isApi) {
        const cookies = up.headers["set-cookie"];
        if (cookies) headers["set-cookie"] = rewriteCookies(cookies);
      } else {
        Object.assign(headers, SECURITY_HEADERS);
      }
      res.writeHead(up.statusCode ?? 502, headers);
      up.pipe(res);
      up.on("end", () => log(req.method, (isApi ? "/api" : "") + path.split("?")[0], up.statusCode, `${Date.now() - started}ms`));
    },
  );
  upstream.on("error", (err) => {
    log(req.method, req.url.split("?")[0], "502", err.code ?? err.message);
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "bad_gateway", message: "The site is starting up or one of its parts is not running." }));
  });
  res.on("close", () => upstream.destroy());
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  if (url === "/_gateway/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return void res.end('{"ok":true}');
  }
  if (url === "/api" || url.startsWith("/api/") || url.startsWith("/api?")) return proxy(req, res, API, { stripPrefix: "/api", isApi: true });
  if (url === "/kinect" || url.startsWith("/kinect/") || url.startsWith("/kinect?")) {
    res.writeHead(426, { "content-type": "text/plain", upgrade: "websocket" });
    return void res.end("Use a websocket connection.");
  }
  return proxy(req, res, WEB);
});

// The Kinect picture is a websocket: pass the upgrade on to the bridge, only when a ticket came with it.
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://gateway");
  const isKinect = url.pathname === "/kinect" || url.pathname.startsWith("/kinect/");
  const ticket = url.searchParams.get("t");
  if (!isKinect || !ticket) {
    socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    return;
  }
  const upstream = net.connect(Number(KINECT.port), KINECT.hostname, () => {
    const headers = { ...req.headers, host: `${KINECT.hostname}:${KINECT.port}`, origin: `http://${KINECT.hostname}:${KINECT.port}` };
    for (const name of ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "forwarded", "cf-connecting-ip"]) delete headers[name];
    const lines = Object.entries(headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
    upstream.write(`GET /${url.search} HTTP/1.1\r\n${lines.join("\r\n")}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
    log("WS /kinect", "connected");
  });
  const end = () => {
    socket.destroy();
    upstream.destroy();
  };
  upstream.on("error", end);
  socket.on("error", end);
  socket.on("close", end);
  upstream.on("close", end);
});

// A long upload (the Test video) or a camera stream must not be cut off by a default timeout.
server.requestTimeout = 0;
server.headersTimeout = 30_000;
server.listen(PORT, "127.0.0.1", () => {
  console.log(`public gateway on http://127.0.0.1:${PORT}  (website ${WEB.origin}, API ${API.origin}, Kinect bridge ${KINECT.origin})`);
});
