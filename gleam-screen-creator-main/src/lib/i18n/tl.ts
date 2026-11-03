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
import { part12 } from "./messages/part12";
import { part13 } from "./messages/part13";
import { part14 } from "./messages/part14";
import { part15 } from "./messages/part15";
import { part16 } from "./messages/part16";
import { part17 } from "./messages/part17";
import { part18 } from "./messages/part18";
import { part19 } from "./messages/part19";
import { part20 } from "./messages/part20";
import { part21 } from "./messages/part21";
import { part22 } from "./messages/part22";
import { part23 } from "./messages/part23";
import { part24 } from "./messages/part24";

/** Tagalog (Filipino). English sentence -> Tagalog. Anything missing shows in English. */
export const tl: Record<string, string> = Object.fromEntries(
  Object.entries({ ...part1, ...part2, ...part3, ...part4, ...part5, ...part6, ...part7, ...part8, ...part9, ...part10, ...part11, ...part12, ...part13, ...part14, ...part15, ...part16, ...part17, ...part18, ...part19, ...part20, ...part21, ...part22, ...part23, ...part24 }).map(([english, pair]) => [english, pair[0]]),
);
