/**
 * Entry-point re-export.
 *
 * `package.json` points `main` and the `dev`/`start` scripts at this file so
 * that `tsx src/index.ts` boots the server. The actual bootstrap logic lives
 * in `server.ts` to keep concerns separated — this file just pulls it in.
 */
export {};
import "./server.js";
