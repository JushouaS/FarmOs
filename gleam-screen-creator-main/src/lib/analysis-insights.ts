/**
 * Turns a camera scan into plain-language tips for a broiler farmer, in
 * English, Filipino (Tagalog) or Cebuano.
 *
 * What the scan actually measures: the camera service compares consecutive
 * pictures and reports how much of the picture moved, how many separate areas
 * moved, and whether many of those areas sit together. It is motion analysis,
 * not a trained detector, so every finding is worded as a hint to check, never
 * a diagnosis, and "moving areas" are never called birds.
 *
 * Findings are language-independent (keys and numbers); text is looked up per
 * language, so switching language does not need a new scan.
 */

import type { CameraScan } from "@/lib/api-client";
import { T, tr } from "@/lib/i18n";

export type Lang = "en" | "tl" | "ceb";
export type Severity = "ok" | "info" | "warn" | "alert";

export const LANGUAGES: ReadonlyArray<{ code: Lang; name: string }> = [
  { code: "en", name: "English" },
  { code: "tl", name: "Tagalog" },
  { code: "ceb", name: "Cebuano" },
];

/** What /visual/scan returns: an analysis plus how the passes varied. */
export type ScanResult = CameraScan;

export interface Finding {
  id: string;
  severity: Severity;
  /** Message key; the title, detail and tips are `${key}.title` and so on. */
  key: string;
  params?: Record<string, string | number>;
}

/** Movement (share of the picture that changed) above this counts as unusually high. */
const HIGH_MOVEMENT = 0.08;
/** The camera service calls anything at or below this "inactive". */
const LOW_MOVEMENT = 0.02;

export function buildFindings(result: ScanResult, night: boolean): Finding[] {
  const out: Finding[] = [];
  const movement = result.behaviour?.movement_index ?? 0;

  if (movement > HIGH_MOVEMENT) {
    out.push({ id: "activity", severity: "warn", key: "activity_high" });
  } else if (movement > LOW_MOVEMENT) {
    out.push({ id: "activity", severity: "ok", key: "activity_normal" });
  } else if (night) {
    out.push({ id: "activity", severity: "ok", key: "activity_rest_night" });
  } else {
    out.push({ id: "activity", severity: "warn", key: "activity_low_day" });
  }

  // Many small moving areas with almost no movement overall is picture noise
  // (night-vision grain, compression), not a crowd, so it says nothing either way.
  if (result.cluster_count > 0) {
    if (movement > LOW_MOVEMENT) {
      out.push({
        id: "crowding",
        severity: "warn",
        key: "crowding",
        params: { count: result.detection_count },
      });
    }
  } else {
    out.push({ id: "crowding", severity: "ok", key: "crowding_none" });
  }

  const fights = result.behaviour?.aggression_events ?? 0;
  if (fights > 0) {
    out.push({ id: "aggression", severity: "alert", key: "aggression", params: { n: fights } });
  }

  out.push({ id: "general", severity: "info", key: night ? "general_night" : "general_day" });
  return out;
}

/** The worst severity among the findings that report a state (not reminders). */
export function overallSeverity(findings: Finding[]): "ok" | "warn" | "alert" {
  if (findings.some((f) => f.severity === "alert")) return "alert";
  if (findings.some((f) => f.severity === "warn")) return "warn";
  return "ok";
}

export interface FindingText {
  title: string;
  detail: string;
  tips: string[];
}

type Entry = { title: string; detail: string; tips: string[] };

interface Messages {
  ui: {
    scannedAt: string;
    tips: string;
    basis: string;
    movement: string;
    areas: string;
    status_ok: string;
    status_warn: string;
    status_alert: string;
  };
  findings: Record<string, Entry>;
}

/**
 * The panel's own labels, marked with T() so they join the system dictionary
 * (src/lib/i18n); the panel shows them with tr(). The analysis itself (the
 * status, figures, findings and tips below) has its own tables per language.
 */
export const CHROME = {
  title: T("Analysis"),
  intro: T("Analyze the latest camera data and get tips for your flock."),
  scan: T("Analyze data"),
  scanning: T("Analyzing…"),
  again: T("Analyze again"),
  translate: T("Translate the analysis"),
  err_unavailable: T("The camera service is not reachable. Start cerebroil-stream and try again."),
  err_noFrame: T("The camera has no picture right now. Check the camera connection and try again."),
  err_session: T("Your session ended. Sign in again."),
  err_generic: T("The analysis could not finish. Try again."),
} as const;

const en: Messages = {
  ui: {
    scannedAt: "Scanned at {time}",
    tips: "What to do",
    basis: "Based on movement in the camera picture over about 3 seconds. Treat it as a hint, not a diagnosis.",
    movement: "Movement",
    areas: "Moving areas",
    status_ok: "Looks normal",
    status_warn: "Needs a check",
    status_alert: "Check now",
  },
  findings: {
    activity_high: {
      title: "Unusually high movement",
      detail:
        "The birds, or the picture, moved a lot during the scan. The flock may have been startled, or something moved in front of the camera.",
      tips: [
        "Walk the house quietly and look for the cause: noise, a predator, rats or a stranger.",
        "Check for fighting or pecking, and for sudden changes in light.",
        "Make sure the camera is steady and the lens is clean.",
      ],
    },
    activity_normal: {
      title: "Normal movement",
      detail: "The flock is moving about as expected.",
      tips: ["Keep to the routine: check feed, water and litter on every round."],
    },
    activity_rest_night: {
      title: "Resting, which is normal at night",
      detail: "Little movement is expected at this hour while the birds rest.",
      tips: [
        "Check that the house is not too hot or too cold. Birds resting evenly are comfortable.",
        "Keep lights and noise steady so they are not disturbed.",
      ],
    },
    activity_low_day: {
      title: "Low movement during the day",
      detail: "Few birds were moving. In the daytime they should be eating, drinking and walking.",
      tips: [
        "Check the temperature and ventilation. Heat makes birds sit still and pant.",
        "Check that every drinker works and the feed is fresh.",
        "Walk the house and gently move the birds. Look for limping or sick birds and separate them.",
        "Check that the lights are on and bright enough.",
      ],
    },
    crowding: {
      title: "Many moving areas seen",
      detail: "The scan found {count} separate areas of movement, which can mean birds crowding together.",
      tips: [
        "If birds bunch up and look cold, add heat or close drafts.",
        "If they spread out, pant or hold their wings out, it is too hot. Improve the ventilation.",
        "Check for crowding around feeders and drinkers. Add space or more feeders and drinkers if needed.",
        "Review how many birds are in the house for its size.",
      ],
    },
    crowding_none: {
      title: "No crowding spotted",
      detail: "No unusual group of movement was found.",
      tips: [],
    },
    aggression: {
      title: "Possible fighting or pecking",
      detail: "The scan flagged {n} possible aggressive event(s).",
      tips: [
        "Look for injured birds and separate them.",
        "Lower the light a little and review how many birds are in the house.",
        "Make sure there is enough feeder and drinker space.",
      ],
    },
    general_day: {
      title: "Reminders for the daytime",
      detail: "",
      tips: [
        "Check the drinker lines and the feed on every round.",
        "Check the litter. It should be dry and loose.",
        "Record the temperature and walk the house at least twice.",
      ],
    },
    general_night: {
      title: "Reminders for the night",
      detail: "",
      tips: [
        "Check the ventilation and temperature before you rest.",
        "Keep the lights and noise steady.",
        "Do an early morning round for sick or dead birds.",
      ],
    },
  },
};

const tl: Messages = {
  ui: {
    scannedAt: "Sinuri noong {time}",
    tips: "Mga gagawin",
    basis: "Batay sa galaw na nakita sa larawan ng camera sa loob ng mga 3 segundo. Gawing gabay ito, hindi diagnosis.",
    movement: "Galaw",
    areas: "Mga lugar na gumagalaw",
    status_ok: "Mukhang normal",
    status_warn: "Kailangang tingnan",
    status_alert: "Tingnan agad",
  },
  findings: {
    activity_high: {
      title: "Hindi karaniwang taas ng galaw",
      detail:
        "Malaki ang galaw ng mga manok, o ng larawan, habang sinusuri. Maaaring nagulat ang mga manok, o may gumalaw sa harap ng camera.",
      tips: [
        "Maglakad nang tahimik sa kulungan at hanapin ang sanhi: ingay, mandaragit na hayop, daga, o estranghero.",
        "Tingnan kung may nag-aaway o nagtutuka, at kung may biglaang pagbabago ng ilaw.",
        "Siguraduhing hindi gumagalaw ang camera at malinis ang lente.",
      ],
    },
    activity_normal: {
      title: "Normal ang galaw",
      detail: "Gumagalaw ang mga manok gaya ng inaasahan.",
      tips: ["Ituloy ang nakagawian: tingnan ang pakain, tubig, at kama (litter) sa bawat ikot."],
    },
    activity_rest_night: {
      title: "Nagpapahinga, normal ito sa gabi",
      detail: "Inaasahang kaunti ang galaw sa oras na ito dahil nagpapahinga ang mga manok.",
      tips: [
        "Tiyaking hindi masyadong mainit o malamig ang kulungan. Komportable ang mga manok na pantay ang pahinga.",
        "Panatilihing tuloy-tuloy ang ilaw at tahimik para hindi sila magambala.",
      ],
    },
    activity_low_day: {
      title: "Mahina ang galaw ngayong araw",
      detail: "Kaunti lang ang gumagalaw. Sa araw, dapat kumakain, umiinom, at naglalakad ang mga manok.",
      tips: [
        "Tingnan ang temperatura at bentilasyon. Ang init ay nagpapatamad at nagpapahingal sa mga manok.",
        "Siguraduhing gumagana ang lahat ng inuman at sariwa ang pakain.",
        "Maglakad sa kulungan at marahang pakilusin ang mga manok. Hanapin ang pilay o may sakit at ihiwalay ang mga ito.",
        "Tiyaking bukas at sapat ang liwanag ng ilaw.",
      ],
    },
    crowding: {
      title: "Maraming lugar na may galaw",
      detail:
        "May nakitang {count} magkakahiwalay na lugar na may galaw, na maaaring ibig sabihing nagsisiksikan ang mga manok.",
      tips: [
        "Kung nagsisiksikan at mukhang giniginaw, dagdagan ang init o takpan ang mga butas na pinapasukan ng hangin.",
        "Kung kalat-kalat, humihingal, o nakabuka ang pakpak, masyadong mainit. Paganahin nang husto ang bentilasyon.",
        "Tingnan kung siksikan sa paligid ng pakainan at inuman. Dagdagan ang espasyo o ang bilang ng pakainan at inuman.",
        "Suriin kung ilan ang manok sa kulungan kumpara sa laki nito.",
      ],
    },
    crowding_none: {
      title: "Walang nakitang siksikan",
      detail: "Walang hindi karaniwang grupo ng galaw na nakita.",
      tips: [],
    },
    aggression: {
      title: "Posibleng pag-aaway o pagtutuka",
      detail: "May {n} na posibleng agresibong pangyayari na natukoy.",
      tips: [
        "Hanapin ang mga nasugatang manok at ihiwalay ang mga ito.",
        "Bahagyang bawasan ang liwanag at suriin kung ilan ang manok sa kulungan.",
        "Siguraduhing sapat ang espasyo sa pakainan at inuman.",
      ],
    },
    general_day: {
      title: "Paalala para sa araw",
      detail: "",
      tips: [
        "Tingnan ang linya ng tubig at ang pakain sa bawat ikot.",
        "Tingnan ang kama (litter). Dapat tuyo at maluwag.",
        "Itala ang temperatura at maglakad sa kulungan nang hindi bababa sa dalawang beses.",
      ],
    },
    general_night: {
      title: "Paalala para sa gabi",
      detail: "",
      tips: [
        "Tingnan ang bentilasyon at temperatura bago magpahinga.",
        "Panatilihing tuloy-tuloy ang ilaw at tahimik.",
        "Mag-ikot nang maaga sa umaga para hanapin ang may sakit o patay na manok.",
      ],
    },
  },
};

const ceb: Messages = {
  ui: {
    scannedAt: "Gisusi sa {time}",
    tips: "Unsay buhaton",
    basis: "Gibase sa lihok nga nakita sa hulagway sa camera sulod sa mga 3 segundo. Gamita kini isip giya, dili diagnosis.",
    movement: "Lihok",
    areas: "Mga lugar nga naglihok",
    status_ok: "Murag normal",
    status_warn: "Kinahanglan susihon",
    status_alert: "Susiha dayon",
  },
  findings: {
    activity_high: {
      title: "Dili kasagaran ang taas nga lihok",
      detail:
        "Daghan ang lihok sa mga manok, o sa hulagway, samtang gisusi. Mahimong nakurat ang mga manok, o adunay mikalit sa atubangan sa camera.",
      tips: [
        "Lakaw nga hilom sulod sa balay-manukan ug pangitaa ang hinungdan: kasaba, ihalas nga mananap, ilaga, o dili kaila.",
        "Tan-awa kung naay nag-away o nagtuka, ug kung naay kalit nga pagbag-o sa suga.",
        "Siguroha nga dili mouyog ang camera ug limpyo ang lente.",
      ],
    },
    activity_normal: {
      title: "Normal ang lihok",
      detail: "Naglihok ang mga manok sama sa gipaabot.",
      tips: ["Ipadayon ang naandan: susiha ang pagkaon, tubig, ug lantay (litter) sa matag libot."],
    },
    activity_rest_night: {
      title: "Nagpahulay, normal kini sa gabii",
      detail: "Gipaabot nga gamay ra ang lihok niining orasa tungod kay nagpahulay ang mga manok.",
      tips: [
        "Siguroha nga dili init kaayo o bugnaw ang balay. Komportable ang mga manok nga patas ang pahulay.",
        "Ipadayon nga dili magbalhin-balhin ang suga ug hilom aron dili sila maabala.",
      ],
    },
    activity_low_day: {
      title: "Hinay ang lihok karong adlawa",
      detail: "Gamay ra ang naglihok. Kung adlaw, angay nga nangaon, nag-inom, ug naglakaw ang mga manok.",
      tips: [
        "Susiha ang temperatura ug bentilasyon. Ang kainit makapahuyang ug makapahangos sa mga manok.",
        "Siguroha nga molihok ang tanang inumanan ug presko ang pagkaon.",
        "Lakaw sa balay-manukan ug hinay-hinay nga paglihokon ang mga manok. Pangitaa ang mga bakol o masakiton ug ilain sila.",
        "Siguroha nga naka-on ug igo ang suga.",
      ],
    },
    crowding: {
      title: "Daghang lugar nga naay lihok",
      detail:
        "Nakakita og {count} ka managlahing lugar nga naay lihok, nga mahimong timailhan nga nagsiksik ang mga manok.",
      tips: [
        "Kung nagsiksik ug murag gitugnaw, dugangi ang kainit o tabuni ang mga lungag nga mosulod ang hangin.",
        "Kung nagkalayo, naghangos, o gibuka ang pako, init kaayo. Papaganaha pag-ayo ang bentilasyon.",
        "Tan-awa kung siksik sa palibot sa kaonan ug inumanan. Dugangi ang luna o ang gidaghanon sa kaonan ug inumanan.",
        "Susiha kung pila ang manok sa balay kumpara sa gidak-on niini.",
      ],
    },
    crowding_none: {
      title: "Walay nakitang siksik",
      detail: "Walay dili kasagarang grupo sa lihok nga nakita.",
      tips: [],
    },
    aggression: {
      title: "Posibleng pag-away o pagtuka",
      detail: "Adunay {n} ka posibleng agresibo nga panghitabo nga nakit-an.",
      tips: [
        "Pangitaa ang mga nasamdan nga manok ug ilain sila.",
        "Gamayi og kadiyot ang suga ug susiha kung pila ang manok sa balay.",
        "Siguroha nga igo ang luna sa kaonan ug inumanan.",
      ],
    },
    general_day: {
      title: "Mga pahinumdom para sa adlaw",
      detail: "",
      tips: [
        "Susiha ang linya sa tubig ug ang pagkaon sa matag libot.",
        "Tan-awa ang lantay (litter). Kinahanglan uga ug maluag.",
        "Isulat ang temperatura ug lakaw sa balay-manukan labing menos kaduha.",
      ],
    },
    general_night: {
      title: "Mga pahinumdom para sa gabii",
      detail: "",
      tips: [
        "Susiha ang bentilasyon ug temperatura sa dili pa magpahulay.",
        "Ipadayon nga dili magbalhin-balhin ang suga ug hilom.",
        "Libot sayo sa buntag aron pangitaon ang masakiton o patay nga manok.",
      ],
    },
  },
};

const MESSAGES: Record<Lang, Messages> = { en, tl, ceb };

type UiKey = keyof Messages["ui"];

function fill(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/** A line of interface text in the chosen language. */
export function ui(lang: Lang, key: UiKey, params?: Record<string, string | number>): string {
  return fill(MESSAGES[lang].ui[key], params);
}

/** The words for one finding in the chosen language. */
export function findingText(lang: Lang, finding: Finding): FindingText {
  const entry = MESSAGES[lang].findings[finding.key] ?? MESSAGES.en.findings[finding.key];
  return {
    title: fill(entry.title, finding.params),
    detail: fill(entry.detail, finding.params),
    tips: entry.tips.map((t) => fill(t, finding.params)),
  };
}
