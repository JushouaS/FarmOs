/**
 * The Dashboard's weight comes from measurements only.
 *
 *   bun test            (from packages/api; needs the local database running)
 *
 * The first block is plain logic. The second writes two test birds' weights into the active cycle through
 * the real routes and removes them again, so run it against a development database, never a live farm's.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  measuredSeries,
  standardAtDay,
  standardCurve,
  weightAtDay,
  type StandardPoint,
  type WeightPoint,
} from "../src/cycle-day.js";

const standards: StandardPoint[] = [
  { day: 14, standardG: 460 },
  { day: 21, standardG: 900 },
  { day: 28, standardG: 1400 },
  { day: 35, standardG: 1950 },
];
const weighIns: WeightPoint[] = [
  { day: 35, actualG: 1990, standardG: 1950 },
  { day: 21, actualG: 880, standardG: 900 },
];

describe("weights on the stored curve", () => {
  test("the standard is read between stored days", () => {
    expect(standardAtDay(standards, 21)).toBe(900);
    expect(standardAtDay(standards, 24)).toBe(Math.round(900 + ((1400 - 900) * 3) / 7));
    expect(standardAtDay([], 21)).toBeNull();
  });

  test("a day nobody weighed is never filled in", () => {
    expect(measuredSeries(weighIns, 14, 30)).toEqual([{ day: 21, actualG: 880, standardG: 900 }]);
    expect(measuredSeries(weighIns, 14, 40).map((p) => p.day)).toEqual([21, 35]);
    expect(measuredSeries(weighIns, 22, 34)).toEqual([]);
  });

  test("a weight read for a day between weigh-ins stays on the line between them", () => {
    expect(weightAtDay(weighIns, 21)).toEqual({ actualG: 880, standardG: 900 });
    expect(weightAtDay([], 21)).toBeNull();
  });

  test("the standard curve covers every day of the window", () => {
    const curve = standardCurve(standards, 16, 20);
    expect(curve.map((p) => p.day)).toEqual([16, 17, 18, 19, 20]);
  });
});

const live = process.env.NODE_ENV !== "production";

describe.skipIf(!live)("typed-in weights reach the Dashboard", () => {
  let app: Awaited<ReturnType<(typeof import("../src/app.js"))["buildApp"]>>;
  let cookie = "";
  let sessionId = "";
  let day = 0;

  const overview = async () => {
    const res = await app.inject({ method: "GET", url: "/operations/overview", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    return res.json();
  };
  const put = (birdId: string, actualG: number) =>
    app.inject({ method: "PUT", url: "/growth/actual-weights", headers: { cookie }, payload: { birdId, day, actualG } });
  const remove = (birdId: string) =>
    app.inject({ method: "DELETE", url: `/growth/actual-weights?birdId=${birdId}&day=${day}`, headers: { cookie } });

  beforeAll(async () => {
    process.env.SENSOR_MONITOR = "off";
    process.env.BEHAVIOR_MONITOR = "off";
    process.env.BEHAVIOR_INTERVAL_MINUTES = "0"; // the sampler would call the camera service on start-up
    const { buildApp } = await import("../src/app.js");
    const { signAccessToken, hashAccessToken } = await import("../src/auth/auth.js");
    app = await buildApp();

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
    day = Number((await overview()).cycle.day);
    await remove("B-9001");
    await remove("B-9002");
  }, 60_000);

  afterAll(async () => {
    if (!app) return;
    await remove("B-9001");
    await remove("B-9002");
    if (sessionId) await app.sqlWrite`DELETE FROM sessions WHERE id = ${sessionId}`;
    await app.close();
  }, 60_000);

  test("with no weights the Dashboard has no measured weight", async () => {
    const w = (await overview()).weight;
    expect(w.actualAvgG).toBeNull();
    expect(w.variancePercent).toBe(0);
    expect(w.curve.filter((p: { day: number }) => p.day === day)).toEqual([]);
    expect(w.standardCurve.length).toBeGreaterThan(0);
  });

  test("the day's weight is the mean of the weights typed in, with how many", async () => {
    expect((await put("B-9001", 1000)).statusCode).toBe(200);
    expect((await put("B-9002", 1201)).statusCode).toBe(200);
    const w = (await overview()).weight;
    expect(w.actualAvgG).toBe(1101); // round((1000 + 1201) / 2)
    expect(w.sampleSize).toBe(2);
    expect(w.measuredDay).toBe(day);
    expect(w.curve.find((p: { day: number }) => p.day === day)?.actualG).toBe(1101);
    expect(typeof w.variancePercent).toBe("number");
  });

  test("the weight spread lists the birds weighed on the newest day, with the standard for it", async () => {
    const res = await app.inject({ method: "GET", url: "/growth/weight-spread", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const spread = res.json();
    expect(spread.day).toBe(day);
    expect(spread.n).toBe(2);
    expect(spread.birds.map((b: { id: string }) => b.id)).toEqual(["B-9001", "B-9002"]);
    expect(spread.birds.map((b: { weightG: number }) => b.weightG)).toEqual([1000, 1201]);
    expect(spread.standardG).toBeGreaterThan(0);
  });

  test("correcting one weight changes the mean, and removing them all removes the point", async () => {
    await put("B-9002", 1001);
    expect((await overview()).weight.actualAvgG).toBe(1001); // round((1000 + 1001) / 2) = 1001 (half rounds up)
    await remove("B-9001");
    expect((await overview()).weight.sampleSize).toBe(1);
    await remove("B-9002");
    const w = (await overview()).weight;
    expect(w.actualAvgG).toBeNull();
    expect(w.curve.filter((p: { day: number }) => p.day === day)).toEqual([]);
    const spread = (await app.inject({ method: "GET", url: "/growth/weight-spread", headers: { cookie } })).json();
    expect(spread).toEqual({ day: null, n: 0, standardG: null, birds: [] });
  });
});
