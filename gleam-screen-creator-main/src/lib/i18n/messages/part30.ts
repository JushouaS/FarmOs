import type { Messages } from "./types";

/** Visuals > Behavior Breakdown and Insights: the live monitor's early warnings (birds still 5 and 15 minutes). */
export const part30: Messages = {
  "Still for a while": ["Matagal nang hindi gumagalaw", "Dugay nang wala molihok"],
  "Still {n}+ min": ["Hindi gumagalaw nang {n}+ minuto", "Wala molihok sulod sa {n}+ ka minuto"],
  "{place} of the picture, {m} min": ["{place} ng larawan, {m} minuto", "{place} sa litrato, {m} ka minuto"],
  "and {n} more": ["at {n} pa", "ug {n} pa"],
  "Not an alert yet. A bird still for 30 minutes raises an Inactivity Alert.": [
    "Hindi pa ito alerto. Ang manok na hindi gumalaw nang 30 minuto ay magbibigay ng Alerto sa Kawalan ng Kilos.",
    "Dili pa kini alerto. Ang manok nga wala molihok sulod sa 30 ka minuto mohatag og Alerto sa Kawalay Lihok.",
  ],
  "Night: still birds are resting, so none is on this list.": [
    "Gabi: nagpapahinga ang mga manok na hindi gumagalaw, kaya walang nasa listahang ito.",
    "Gabii: nagpahulay ang mga manok nga wala molihok, mao nga walay naa niining listahan.",
  ],
  "1 bird has been still for {m}+ minutes. Keep an eye on it.": [
    "1 manok ang hindi gumagalaw nang {m}+ minuto. Bantayan ito.",
    "1 ka manok ang wala molihok sulod sa {m}+ ka minuto. Bantayi kini.",
  ],
  "{n} birds have been still for {m}+ minutes. Keep an eye on them.": [
    "{n} manok ang hindi gumagalaw nang {m}+ minuto. Bantayan sila.",
    "{n} ka manok ang wala molihok sulod sa {m}+ ka minuto. Bantayi sila.",
  ],
  // pictureArea() in lib/farm/stillness.ts
  "Top left": ["Itaas na kaliwa", "Ibabaw nga wala"],
  Top: ["Itaas", "Ibabaw"],
  "Top right": ["Itaas na kanan", "Ibabaw nga tuo"],
  Left: ["Kaliwa", "Wala"],
  Centre: ["Gitna", "Tunga"],
  Right: ["Kanan", "Tuo"],
  "Bottom left": ["Ibaba na kaliwa", "Ubos nga wala"],
  Bottom: ["Ibaba", "Ubos"],
  "Bottom right": ["Ibaba na kanan", "Ubos nga tuo"],
};
