import { part1 } from "./messages/part1";
import { part2 } from "./messages/part2";
import { part3 } from "./messages/part3";
import { part4 } from "./messages/part4";
import { part5 } from "./messages/part5";
import { part6 } from "./messages/part6";
import { part7 } from "./messages/part7";
import { part8 } from "./messages/part8";
import { part9 } from "./messages/part9";
import { part10 } from "./messages/part10";
import { part11 } from "./messages/part11";

/** Tagalog (Filipino). English sentence -> Tagalog. Anything missing shows in English. */
export const tl: Record<string, string> = Object.fromEntries(
  Object.entries({ ...part1, ...part2, ...part3, ...part4, ...part5, ...part6, ...part7, ...part8, ...part9, ...part10, ...part11 }).map(([english, pair]) => [english, pair[0]]),
);
