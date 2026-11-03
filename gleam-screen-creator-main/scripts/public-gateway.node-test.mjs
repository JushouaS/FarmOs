/**
 * Tests for scripts/public-gateway.mjs:   npm run test:gateway
 *
 * The gateway is started on its own ports in front of three small stand-ins (website, API, Kinect bridge), so nothing
 * else needs to be running.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const PORTS = { gateway: 39100, web: 39101, api: 39102, kinect: 39103 };
const seen = { web: [], api: [], kinectRaw: "" };
let gateway;
const servers = [];

const listen = (server, port) => new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

before(async () => {
  const web = http.createServer((req, res) => {
    seen.web.push({ url: req.url, headers: req.headers });
    res.writeHead(200, { "content-type": "text/html" }).end("<p>site</p>");
  });
  const api = http.createServer((req, res) => {
    seen.api.push({ url: req.url, headers: req.headers });
    res.writeHead(200, {
      "content-type": "application/json",
      "set-cookie": ["session=a; Path=/auth/mfa; HttpOnly", "token=b; Path=/; HttpOnly"],
    }).end("{}");
  });
  // A Kinect bridge stand-in: records the first bytes it receives and then closes.
  const kinect = net.createServer((socket) => {
    socket.once("data", (d) => {
      seen.kinectRaw = d.toString();
      socket.end("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
    });
  });
  for (const [s, p] of [[web, PORTS.web], [api, PORTS.api], [kinect, PORTS.kinect]]) {
    servers.push(s);
    await listen(s, p);
  }
  gateway = spawn(process.execPath, [fileURLToPath(new URL("./public-gateway.mjs", import.meta.url))], {
    env: {
      ...process.env,
      GATEWAY_PORT: String(PORTS.gateway),
      WEB_URL: `http://127.0.0.1:${PORTS.web}`,
      API_URL: `http://127.0.0.1:${PORTS.api}`,
      KINECT_URL: `http://127.0.0.1:${PORTS.kinect}`,
      GATEWAY_QUIET: "1",
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORTS.gateway}/_gateway/health`)).ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("the gateway did not start");
});

after(() => {
  gateway?.kill();
  for (const s of servers) s.close();
});

const base = `http://127.0.0.1:${PORTS.gateway}`;

test("the website is served at / with security headers, and the API prefix is removed", async () => {
  const site = await fetch(`${base}/`);
  assert.equal(site.status, 200);
  assert.equal(site.headers.get("x-frame-options"), "DENY");
  assert.equal(site.headers.get("x-content-type-options"), "nosniff");

  seen.api.length = 0;
  const api = await fetch(`${base}/api/auth/me?x=1`);
  assert.equal(api.status, 200);
  assert.equal(seen.api[0].url, "/auth/me?x=1");
  assert.equal(api.headers.get("x-frame-options"), null); // the API sets its own headers
});

test("a visitor cannot choose their own address: forwarded-for is replaced with Cloudflare's", async () => {
  seen.api.length = 0;
  await fetch(`${base}/api/x`, { headers: { "x-forwarded-for": "6.6.6.6", "x-real-ip": "6.6.6.6", "cf-connecting-ip": "203.0.113.9" } });
  assert.equal(seen.api[0].headers["x-forwarded-for"], "203.0.113.9");
  assert.equal(seen.api[0].headers["x-real-ip"], undefined);

  seen.api.length = 0;
  await fetch(`${base}/api/x`, { headers: { "x-forwarded-for": "6.6.6.6" } });
  assert.notEqual(seen.api[0].headers["x-forwarded-for"], "6.6.6.6"); // no Cloudflare header: the caller's own address
});

test("cookies limited to a path still match under /api", async () => {
  const res = await fetch(`${base}/api/login`);
  const cookies = res.headers.getSetCookie();
  assert.ok(cookies.includes("session=a; Path=/api/auth/mfa; HttpOnly"), cookies.join(" | "));
  assert.ok(cookies.includes("token=b; Path=/; HttpOnly"), cookies.join(" | "));
});

test("the Kinect picture is refused without a ticket and passed on with one, without the visitor's address", async () => {
  assert.equal((await fetch(`${base}/kinect/`)).status, 426); // plain http is not the picture

  const upgrade = (path, extra = "") =>
    new Promise((resolve) => {
      const socket = net.connect(PORTS.gateway, "127.0.0.1", () =>
        socket.write(`GET ${path} HTTP/1.1\r\nHost: example.test\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: abc\r\nOrigin: https://evil.test\r\n${extra}\r\n`),
      );
      let data = "";
      socket.on("data", (d) => (data += d));
      socket.on("close", () => resolve(data));
      setTimeout(() => socket.destroy(), 1500);
    });

  assert.match(await upgrade("/kinect/"), /^HTTP\/1.1 401/);
  assert.match(await upgrade("/api/"), /^HTTP\/1.1 401/); // only /kinect is a socket

  seen.kinectRaw = "";
  await upgrade("/kinect/?t=ticket123", "X-Forwarded-For: 6.6.6.6\r\nCF-Connecting-IP: 203.0.113.9\r\n");
  assert.match(seen.kinectRaw, /^GET \/\?t=ticket123 HTTP\/1.1/);
  assert.match(seen.kinectRaw, /origin: http:\/\/127\.0\.0\.1:39103/i);
  assert.doesNotMatch(seen.kinectRaw, /x-forwarded-for|cf-connecting-ip|evil\.test/i);
});

test("a part that is not running gives a clear 502, not a hang", async () => {
  servers[1].close(); // the API stand-in
  await new Promise((r) => setTimeout(r, 100));
  const res = await fetch(`${base}/api/anything`);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, "bad_gateway");
});
