import type { Messages } from "./types";

/** Words that are slotted into longer sentences ({value}); each is translated so the sentence reads right in every language. */
export const part6: Messages = {
  heavier: ["mas mabigat", "mas bug-at"],
  lighter: ["mas magaan", "mas gaan"],
  exceeds: ["lampas", "labaw"],
  "is under": ["kulang", "kulang"],
  low: ["mababa", "ubos"],
  moderate: ["katamtaman", "kasarangan"],
  "showing good flock uniformity": ["na nagpapakitang maganda ang pagkakapareho ng kawan", "nga nagpakita nga maayo ang pagkaparehas sa panon"],
  "so keep an eye on the lighter birds": ["kaya bantayan ang mas magagaan na manok", "busa bantayi ang mas gaan nga mga manok"],
  improving: ["gumagandang", "nag-uswag nga"],
  slipping: ["bumababang", "nagkaubos nga"],
  night: ["gabi", "gabii"],
  day: ["araw", "adlaw"],
  "Growth acceleration reflects optimal feed conversion and house environmental controls.": [
    "Ang mabilis na paglaki ay sumasalamin sa mahusay na konbersyon ng pakain at maayos na kontrol sa kapaligiran ng kulungan.",
    "Ang paspas nga pagdako nagpakita sa maayo nga konbersyon sa pakaon ug maayong kontrol sa kalikopan sa kulungan.",
  ],
  "Check feed access, water flow and house temperature.": [
    "Suriin kung nakakakain, ang daloy ng tubig at ang temperatura ng kulungan.",
    "Susiha kung nakakaon, ang agos sa tubig ug ang temperatura sa kulungan.",
  ],
  " for day {day}": [" para sa araw {day}", " alang sa adlaw {day}"],
};
