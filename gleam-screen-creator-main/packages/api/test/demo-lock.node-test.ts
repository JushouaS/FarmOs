/**
 * A Test video upload whose browser goes away must not keep the "one video at a time" lock.
 *
 *   npm run test:node            (from packages/api; needs the local database running)
 *
 * This one runs on Node, as the API does (the Bun test runner does not report a closed connection the way Node does,
 * so `bun test` cannot check it). The camera service is replaced by a small server that never answers, so no
 * Raspberry Pi is needed.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

let app: Awaited<ReturnType<(typeof import("../src/app.js"))["buildApp"]>>;
let fake: Server;
let base = "";
let cookie = "";
let sessionId = "";
let received = 0;

before(async () => {
  fake = createServer((_req, res) => {
    received++;
    setTimeout(() => res.end("{}"), 30_000).unref(); // a camera service that is still busy
  });
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  process.env.VISION_SERVICE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  process.env.SENSOR_MONITOR = "off";
  process.env.BEHAVIOR_MONITOR = "off";
  const { buildApp } = await import("../src/app.js");
  const { signAccessToken, hashAccessToken } = await import("../src/auth/auth.js");
  app = await buildApp();
  base = await app.listen({ host: "127.0.0.1", port: 0 });

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
  fake?.closeAllConnections();
  fake?.close();
});

const upload = (signal: AbortSignal) =>
  fetch(`${base}/visual/demo-detect`, {
    method: "POST",
    headers: { cookie, "content-type": "application/octet-stream" },
    body: new Uint8Array(1024),
    signal,
  });

const waitFor = async (check: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 50));
  return check();
};

test("a second upload is refused while the first is running, and allowed once its browser has gone", async () => {
  const first = new AbortController();
  const firstDone = upload(first.signal).then(() => "answered", () => "aborted");
  assert.equal(await waitFor(() => received === 1), true);

  // While the first is still being checked, a second one is told to wait.
  assert.equal((await upload(AbortSignal.timeout(5000))).status, 429);

  // The first browser goes away (tab closed, upload cancelled): the lock must be released.
  first.abort();
  assert.equal(await firstDone, "aborted");
  await new Promise((resolve) => setTimeout(resolve, 300));

  const third = new AbortController();
  const thirdDone = upload(third.signal).then((r) => r.status, () => "aborted");
  const reached = await waitFor(() => received === 2);
  third.abort();
  // It got through to the camera service (received === 2); a refused upload would have come back as 429.
  assert.deepEqual({ reached, answered: reached ? "aborted" : await thirdDone }, { reached: true, answered: "aborted" });
});
