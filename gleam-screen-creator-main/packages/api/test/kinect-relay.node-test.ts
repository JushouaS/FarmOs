/**
 * The Kinect depth stream reaches devices that are not on the Kinect's PC.
 *
 *   npm run test:node            (from packages/api; needs the local database running)
 *
 * The bridge only listens on its own PC, so the API relays it. The bridge is replaced by a small server that
 * answers like the real one: a "hello" text message on connect, then whatever binary frame the viewer asks for.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { WebSocket, WebSocketServer } from "ws";

let app: Awaited<ReturnType<(typeof import("../src/app.js"))["buildApp"]>>;
let bridge: WebSocketServer;
let base = "";
let cookie = "";
let sessionId = "";
let bridgeSaw: { url: string; origin: string | undefined } | null = null;

before(async () => {
  bridge = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => bridge.on("listening", resolve));
  bridge.on("connection", (socket, request) => {
    bridgeSaw = { url: request.url ?? "", origin: request.headers.origin };
    socket.send(JSON.stringify({ type: "hello", width: 2 }));
    socket.on("message", (data, binary) => {
      if (!binary) socket.send(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), { binary: true });
      else socket.send(data, { binary: true });
    });
  });
  process.env.KINECT_BRIDGE_URL = `ws://127.0.0.1:${(bridge.address() as AddressInfo).port}/`;
  process.env.SENSOR_MONITOR = "off";
  process.env.BEHAVIOR_MONITOR = "off";
  process.env.BEHAVIOR_INTERVAL_MINUTES = "0";
  const { buildApp } = await import("../src/app.js");
  const { signAccessToken, hashAccessToken } = await import("../src/auth/auth.js");
  app = await buildApp();
  base = (await app.listen({ host: "127.0.0.1", port: 0 })).replace("http", "ws");

  const users = await app.sqlWrite`
    SELECT u.id, u.email FROM users u
    JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
    WHERE r.code = 'ADMIN' AND u.is_active LIMIT 1`;
  if (users.count === 0) throw new Error("the test needs one active administrator in the database");
  const token = await signAccessToken({ sub: String(users[0]!.id), email: String(users[0]!.email), roles: ["ADMIN"], permissions: [] });
  const made = await app.sqlWrite`
    INSERT INTO sessions (user_id, access_token, refresh_token, refresh_expires_at)
    VALUES (${users[0]!.id}, ${hashAccessToken(token)}, ${"test-" + token.slice(-24)}, now() + interval '1 hour') RETURNING id`;
  sessionId = String(made[0]!.id);
  cookie = `farm_access_token=${token}`;
});

after(async () => {
  if (app) {
    if (sessionId) await app.sqlWrite`DELETE FROM sessions WHERE id = ${sessionId}`;
    await app.close();
  }
  for (const client of bridge?.clients ?? []) client.terminate();
  bridge?.close();
});

const open = (headers: Record<string, string>) =>
  new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(`${base}/visual/kinect-ws`, { headers });
    socket.once("open", () => resolve(socket));
    socket.once("unexpected-response", (_req, res) => reject(new Error(String(res.statusCode))));
    socket.once("error", reject);
  });

test("a signed-in viewer on the network gets the bridge's messages, and the bridge hears the viewer's", async () => {
  const viewer = await open({ cookie, origin: "http://192.168.1.50:8080" });
  const messages: { binary: boolean; size: number; text?: string }[] = [];
  viewer.on("message", (data, binary) => messages.push({ binary, size: (data as Buffer).length, text: binary ? undefined : String(data) }));
  viewer.send(JSON.stringify({ mode: "depth" }));
  const end = Date.now() + 4000;
  while (messages.length < 2 && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 25));
  viewer.close();
  assert.equal(messages[0]?.text?.includes('"hello"'), true);
  assert.deepEqual({ binary: messages[1]?.binary, size: messages[1]?.size }, { binary: true, size: 10 });
  assert.equal(bridgeSaw?.origin, "http://localhost"); // what the real bridge accepts from this PC
});

test("someone who is not signed in is refused", async () => {
  await assert.rejects(open({ origin: "http://192.168.1.50:8080" }), /401/);
});

test("a page from another site is refused even with a valid session", async () => {
  await assert.rejects(open({ cookie, origin: "https://example.com" }), /403/);
});
