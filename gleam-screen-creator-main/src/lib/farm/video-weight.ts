/**
 * A rough weight for each bird in a Test video, from the size of its box.
 *
 * A video has no depth, so this cannot be the Kinect weight model. It spreads an average weight (the standard for the
 * grow-out day set in Settings, so nobody has to type anything) over the birds in proportion to how big each one
 * looks: a bird whose
 * box covers 20 % more of the picture than the typical bird is given 20 % more than the average. The data behind
 * the Kinect model says that is about as good as size alone gets: with the right average, one bird is typically
 * about 17 % off (27 % if everyone is given the average).
 *
 * It is rougher than that in a video, for two reasons: a bird nearer the camera looks bigger than the same bird
 * farther away, and a box around a bird that is turned diagonally is bigger than the bird. The box of a bird that
 * touches the edge of the picture is left out, because it is cut off and looks smaller than the bird is.
 */

/** How far one bird's estimate is typically off, in per cent, to show next to the numbers. */
export const VIDEO_WEIGHT_ERROR_PERCENT = 20;

const MIN_FRAMES = 3;      // a bird must be followed in at least this many frames
const MIN_BIRDS = 5;       // fewer birds say little about the flock
const EDGE_PX = 3;         // a box this close to the edge is cut off
const LOWEST = 0.5;        // no bird is given less than this share of the average ...
const HIGHEST = 1.6;       // ... or more than this share (a false or merged box)

export interface VideoWeights {
  /** Estimated grams for each followed bird, by its number in the check. */
  byId: Map<number, number>;
  n: number;
  averageG: number;
  minG: number;
  maxG: number;
}

const median = (values: number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * frames: the check's frames; each box is [x, y, w, h, confidence, class, bird number, state] in video pixels.
 * averageG: the average weight of these birds. Returns null when it cannot be estimated.
 */
export function estimateVideoWeights(
  frames: { boxes: number[][] }[],
  width: number,
  height: number,
  averageG: number,
): VideoWeights | null {
  if (!(averageG > 0) || !(width > 0) || !(height > 0)) return null;
  const areas = new Map<number, number[]>();
  for (const frame of frames) {
    for (const b of frame.boxes) {
      const [x, y, w, h] = b;
      const id = b[6];
      if (id == null || !(w > 0) || !(h > 0)) continue;
      if (x < EDGE_PX || y < EDGE_PX || x + w > width - EDGE_PX || y + h > height - EDGE_PX) continue;
      const list = areas.get(id);
      if (list) list.push(w * h);
      else areas.set(id, [w * h]);
    }
  }
  const sized = [...areas].filter(([, list]) => list.length >= MIN_FRAMES).map(([id, list]) => ({ id, size: median(list) }));
  if (sized.length < MIN_BIRDS) return null;

  // The typical bird is the middle one, so one false or merged box cannot pull everyone else's share around.
  const typical = median(sized.map((s) => s.size));
  let rel = sized.map((s) => Math.min(HIGHEST, Math.max(LOWEST, s.size / typical)));
  const meanRel = rel.reduce((n, r) => n + r, 0) / rel.length;
  rel = rel.map((r) => r / meanRel);          // so the average of the estimates is the one that was given

  const byId = new Map<number, number>();
  let min = Infinity;
  let max = 0;
  sized.forEach((s, i) => {
    const grams = Math.round((averageG * rel[i]) / 10) * 10;
    byId.set(s.id, grams);
    min = Math.min(min, grams);
    max = Math.max(max, grams);
  });
  return { byId, n: sized.length, averageG: Math.round(averageG), minG: min, maxG: max };
}
