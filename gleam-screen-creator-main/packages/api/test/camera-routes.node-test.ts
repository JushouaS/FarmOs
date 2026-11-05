/**
 * What the Live Camera page needs from the API, checked without a camera.
 *
 *   npm run test:node            (from packages/api; needs the local database running)
 *
 * These each broke once when a merge replaced a file: the camera picture is refused by the browser unless the API
 * sends `Cross-Origin-Resource-Policy: same-site`, and the page asks for routes that return 404 if they are missing.
 * Signed-out requests are enough to tell a missing route (404) from a protected one (401). Runs on Node because
 * Bun's test runner mishandles error replies from `app.inject`.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

let app: Awaited<ReturnType<(typeof import("../src/app.js"))["buildApp"]>>;

before(async () => {
  process.env.SENSOR_MONITOR = "off";
  process.env.BEHAVIOR_MONITOR = "off";
  process.env.BEHAVIOR_INTERVAL_MINUTES = "0";
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
});

after(async () => {
  await app?.close();
});

test("the API lets this site's own pages show its camera pictures", async () => {
  const res = await app.inject({ method: "GET", url: "/health" });
  assert.equal(res.headers["cross-origin-resource-policy"], "same-site");
});

const routes = [
  ["GET", "/visual/behavior?night=0"],
  ["GET", "/visual/behavior/CAM-01"],
  ["GET", "/visual/kinect-ticket"],
  ["GET", "/visual/kinect-ws-check"],
  ["GET", "/visual/kinect-chickens"],
  ["GET", "/visual/stream/CAM-01"],
  ["POST", "/visual/capture/CAM-01"],
  ["POST", "/visual/analyze/CAM-01"],
  ["POST", "/visual/demo-detect"],
  ["POST", "/visual/video/abc/bird-weights?t=1&mean_g=1100"],
] as const;

for (const [method, url] of routes) {
  test(`${method} ${url} exists and needs a signed-in user`, async () => {
    const res = await app.inject({ method, url });
    assert.equal(res.statusCode, 401);
  });
}
