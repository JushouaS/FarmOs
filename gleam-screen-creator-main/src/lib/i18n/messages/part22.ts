import type { Messages } from "./types";

/** The weight estimate on the Kinect picture. */
export const part22: Messages = {
  "1 chicken found · about {g} g": ["1 manok ang nakita · mga {g} g", "1 ka manok ang nakit-an · mga {g} g"],
  "{n} chickens found · average about {g} g": ["{n} manok ang nakita · average na mga {g} g", "{n} ka manok ang nakit-an · average nga mga {g} g"],
  "Rough estimate: one bird can be off by about {pct}%": [
    "Magaspang na tantiya: ang isang manok ay maaaring mali ng mga {pct}%",
    "Ruda nga banabana: ang usa ka manok mahimong sayop og mga {pct}%",
  ],
  "Experimental estimate; verify against a scale.": [
    "Pang-eksperimentong tantiya; tiyakin gamit ang timbangan.",
    "Eksperimental nga banabana; kumpirmaha gamit ang timbangan.",
  ],
  "Connecting to camera…": ["Kumokonekta sa kamera…", "Nagkonektar sa kamera…"],
  "Camera stream interrupted; reconnecting…": [
    "Naputol ang video; muling kumokonekta…",
    "Naputol ang video; nagkonektar pag-usab…",
  ],
  "Detecting chickens…": ["Hinahanap ang mga manok…", "Nangita og mga manok…"],
  "Detector unavailable": ["Hindi maabot ang detector", "Dili maabot ang detector"],
  "No chickens detected": ["Walang nakitang manok", "Walay nakitang manok"],
  "{n} chickens detected": ["{n} manok ang nakita", "{n} ka manok ang nakit-an"],
};
