import type { Messages } from "./types";

/** Flock Tracking: the actual weight a person enters for each bird. */
export const part14: Messages = {
  "Actual Weight": ["Aktwal na Timbang", "Aktuwal nga Gibug-aton"],
  Saved: ["Na-save", "Natipigan"],
  Gain: ["Dagdag", "Dugang"],
  "since Day {day}": ["mula Araw {day}", "gikan sa Adlaw {day}"],
  "Far from the estimate. Check it.": ["Malayo sa tantiya. Suriin ito.", "Layo sa banabana. Susiha kini."],
  "est.": ["tantiya", "banabana"],
  actual: ["aktwal", "aktuwal"],
  Difference: ["Pagkakaiba", "Kalainan"],
  "Weighed Today": ["Natimbang Ngayon", "Natimbang Karon"],
  "Avg Difference": ["Karaniwang Pagkakaiba", "Kasagarang Kalainan"],
  "Weighed ({n})": ["Natimbang ({n})", "Natimbang ({n})"],
  "Not weighed ({n})": ["Hindi pa natimbang ({n})", "Wala pa natimbang ({n})"],
  "Actual weight of {id} in kg": ["Aktwal na timbang ng {id} sa kg", "Aktuwal nga gibug-aton sa {id} sa kg"],
  "Enter the weight in kg with up to 3 decimals, between {min} and {max}.": [
    "Ilagay ang timbang sa kg na hanggang 3 decimal, sa pagitan ng {min} at {max}.",
    "Ibutang ang gibug-aton sa kg nga hangtod 3 ka decimal, tali sa {min} ug {max}.",
  ],
  "Could not load the weights you entered. Refresh the page to try again.": [
    "Hindi ma-load ang mga timbang na inilagay mo. I-refresh ang pahina at subukan ulit.",
    "Dili ma-load ang mga gibug-aton nga imong gibutang. I-refresh ang panid ug sulayi pag-usab.",
  ],
  "Could not save the weight for {id}. Try again.": [
    "Hindi na-save ang timbang ng {id}. Subukan ulit.",
    "Wala ma-save ang gibug-aton sa {id}. Sulayi pag-usab.",
  ],
  "The actual weights you enter are saved.": [
    "Naka-save ang mga aktwal na timbang na inilalagay mo.",
    "Gitipigan ang mga aktuwal nga gibug-aton nga imong gibutang.",
  ],
  "Type each bird's weight in kg (up to 3 decimals, like 0.946) and press Enter or click away. It saves by itself for Day {day}; there is no submit button. It is compared with the estimate (within {close}% green, within {fair}% amber, more red), and the vs Standard figure then uses your actual weight. Each new day starts with empty boxes; the earlier days stay saved, and each bird's Gain compares it with its last weighing.": [
    "I-type ang timbang ng bawat manok sa kg (hanggang 3 decimal, tulad ng 0.946) at pindutin ang Enter o mag-click sa labas. Kusa itong nase-save para sa Araw {day}; walang submit button. Ikinukumpara ito sa tantiya (berde kung nasa loob ng {close}%, kahel kung nasa loob ng {fair}%, pula kung higit pa), at ang vs Standard ay gagamit na ng aktwal mong timbang. Bawat bagong araw ay nagsisimula sa mga walang laman na kahon; nananatiling naka-save ang mga nakaraang araw, at ikinukumpara ng Dagdag ng bawat manok ito sa huli nitong pagtimbang.",
    "I-type ang gibug-aton sa matag manok sa kg (hangtod 3 ka decimal, sama sa 0.946) ug pislita ang Enter o i-click sa gawas. Kinaugalingon kining matipigan alang sa Adlaw {day}; walay submit button. Gitandi kini sa banabana (lunhaw kon sulod sa {close}%, amber kon sulod sa {fair}%, pula kon labaw pa), ug ang vs Standard mogamit na sa imong aktuwal nga gibug-aton. Ang matag bag-ong adlaw magsugod nga walay sulod ang mga kahon; magpabilin nga natipigan ang miaging mga adlaw, ug gitandi sa Dugang sa matag manok kini sa kataposan niyang pagtimbang.",
  ],
  "Only an administrator, farm manager or operator can enter weights.": [
    "Administrator, tagapamahala ng bukid o operator lang ang makakapaglagay ng timbang.",
    "Administrator, manedyer sa uma o operator ra ang makabutang og gibug-aton.",
  ],
};
