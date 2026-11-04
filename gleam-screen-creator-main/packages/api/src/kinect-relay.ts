import { createHmac } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { FastifyInstance } from "fastify";
import { WebSocket, WebSocketServer } from "ws";
import { env } from "./config.js";

/**
 * Lets another device on the network watch the Kinect depth stream.
 *
 * The Kinect bridge listens on this PC only: Windows refuses it a network address unless an administrator
 * reserves one for it. The page used to open the bridge directly, so it worked on this PC and nowhere else.
 * This relay is the same stream behind the API, which every device already reaches and which already knows who
 * is signed in. The page opens `ws://<host>:4000/visual/kinect-ws`; the API checks the session, opens the bridge
 * on this PC with a ticket of its own, and passes the messages both ways without reading them.
 */

export const KINECT_RELAY_PATH = "/visual/kinect-ws";
/** Where the page asks, and the API answers 200 for a signed-in user. Run on the upgrade request so the relay uses the same sign-in checks as every route. */
export const KINECT_RELAY_AUTH_PATH = "/visual/kinect-ws-check";

/** A depth frame is about 100 KB at 15 per second. A viewer that falls behind by more than this skips frames instead of piling them up. */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

const ticket = () => {
  const key = env.KINECT_BRIDGE_KEY;
  if (!key) return "";
  const expiry = String(Math.floor(Date.now() / 1000) + 120);
  return `?t=${expiry}.${createHmac("sha256", key).update(expiry).digest("hex")}`;
};

export function attachKinectRelay(app: FastifyInstance, originAllowed: (origin: string | undefined) => boolean): void {
  const server = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  const refuse = (socket: Duplex, status: string) => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  };

  const relay = (viewer: WebSocket) => {
    const bridge = new WebSocket(env.KINECT_BRIDGE_URL + ticket(), { headers: { Origin: "http://localhost" } });
    // What the viewer sends before the bridge has answered (the first message asks for depth or the picture).
    const waiting: { data: Buffer; binary: boolean }[] = [];

    const close = () => {
      viewer.terminate();
      bridge.terminate();
    };
    viewer.on("message", (data, binary) => {
      const copy = Buffer.isBuffer(data) ? data : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data)]);
      if (bridge.readyState === WebSocket.OPEN) bridge.send(copy, { binary });
      else if (waiting.length < 16) waiting.push({ data: copy, binary });
    });
    bridge.on("open", () => {
      for (const m of waiting.splice(0)) bridge.send(m.data, { binary: m.binary });
    });
    bridge.on("message", (data, binary) => {
      if (viewer.readyState !== WebSocket.OPEN || viewer.bufferedAmount > MAX_BUFFERED_BYTES) return;
      viewer.send(data, { binary });
    });
    viewer.on("close", close);
    bridge.on("close", close);
    viewer.on("error", close);
    bridge.on("error", close);
  };

  app.server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if ((request.url ?? "").split("?")[0] !== KINECT_RELAY_PATH) return;
    void (async () => {
      if (!originAllowed(request.headers.origin)) return refuse(socket, "403 Forbidden");
      const headers: Record<string, string> = {};
      if (request.headers.cookie) headers.cookie = request.headers.cookie;
      if (request.headers.authorization) headers.authorization = request.headers.authorization;
      const check = await app.inject({ method: "GET", url: KINECT_RELAY_AUTH_PATH, headers });
      if (check.statusCode !== 200) return refuse(socket, "401 Unauthorized");
      server.handleUpgrade(request, socket, head, relay);
    })().catch(() => socket.destroy());
  });
}
