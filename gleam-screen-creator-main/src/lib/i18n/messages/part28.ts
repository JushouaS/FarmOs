import type { Messages } from "./types";

/** Settings > Test clip: "Follow every bird", the tracked scan of a whole clip (TrackedScanPanel.tsx). */
export const part28: Messages = {
  "2 minutes (quick test)": ["2 minuto (mabilis na pagsubok)", "2 ka minuto (paspas nga pagsulay)"],
  "5 minutes": ["5 minuto", "5 ka minuto"],
  "10 minutes": ["10 minuto", "10 ka minuto"],
  "30 minutes (thesis rule)": ["30 minuto (patakaran ng thesis)", "30 ka minuto (lagda sa thesis)"],
  "the picture froze": ["tumigil ang larawan", "mihunong ang hulagway"],
  "time was skipped": ["may nalaktawang oras", "adunay nalaktawan nga oras"],
  "a frame could not be read": ["may frame na hindi mabasa", "adunay frame nga dili mabasa"],
  "marked as bad": ["minarkahang sira", "gimarkahan nga daot"],
  "no birds were tracked": ["walang nasundang manok", "walay nasubay nga manok"],
  "settling after a gap": ["umaayos pa matapos ang puwang", "nag-andam pa human sa gintang"],
  "{n} s": ["{n} seg", "{n} seg"],
  "Another clip is being followed right now. Wait for it to finish, then try again.": [
    "May ibang clip na sinusundan ngayon. Hintaying matapos ito, saka subukan muli.",
    "Adunay laing clip nga gisubay karon. Hulata nga mahuman kini, unya sulayi pag-usab.",
  ],
  "The detector has no model loaded, so no bird can be followed. Add the model, then try again.": [
    "Walang model na naka-load ang detector, kaya walang manok na masusundan. Idagdag ang model, saka subukan muli.",
    "Walay model nga na-load ang detector, mao nga walay manok nga masubay. Idugang ang model, unya sulayi pag-usab.",
  ],
  "The scan settings were refused.": [
    "Hindi tinanggap ang mga setting ng scan.",
    "Wala gidawat ang mga setting sa scan.",
  ],
  "The scan could not be run. Try again.": [
    "Hindi mapatakbo ang scan. Subukan muli.",
    "Dili mapadagan ang scan. Sulayi pag-usab.",
  ],
  Footage: ["Rekording", "Rekording"],
  "No frame of this clip could be trusted, so nothing was judged.": [
    "Walang frame ng clip na ito ang mapagkakatiwalaan, kaya walang hinusgahan.",
    "Walay frame niini nga clip nga kasaligan, mao nga walay gihukman.",
  ],
  "Huddling on {n} of {total} trusted frames ({pct}%).": [
    "May nagsisiksikan sa {n} ng {total} na mapagkakatiwalaang frame ({pct}%).",
    "Adunay nagpundok sa {n} sa {total} ka kasaligan nga frame ({pct}%).",
  ],
  "No huddling on any of the {total} trusted frames.": [
    "Walang nagsisiksikan sa alinman sa {total} na mapagkakatiwalaang frame.",
    "Walay nagpundok sa bisan unsa sa {total} ka kasaligan nga frame.",
  ],
  "No stretch of trusted footage lasted {window}, so inactivity could not be judged.": [
    "Walang tuloy-tuloy na mapagkakatiwalaang rekording na tumagal nang {window}, kaya hindi mahusgahan ang kawalang-galaw.",
    "Walay padayon nga kasaligan nga rekording nga milungtad og {window}, mao nga dili mahukman ang pagkawalay lihok.",
  ],
  "{n} birds stayed put for {window} or longer.": [
    "{n} manok ang hindi gumalaw nang {window} o higit pa.",
    "{n} ka manok ang wala molihok sulod sa {window} o labaw pa.",
  ],
  "No bird stayed put for {window}.": [
    "Walang manok na hindi gumalaw nang {window}.",
    "Walay manok nga wala molihok sulod sa {window}.",
  ],
  "Follow every bird": ["Sundan ang bawat manok", "Subaya ang matag manok"],
  "Reads the whole clip one frame every 2 seconds, keeps each bird's number from start to end, and judges huddling and inactivity on the frames it can trust. Frozen or skipped stretches are marked as gaps. Nothing is saved.":
    [
      "Binabasa ang buong clip, isang frame bawat 2 segundo, pinananatili ang numero ng bawat manok mula simula hanggang dulo, at hinuhusgahan ang pagsisiksikan at kawalang-galaw sa mga frame na mapagkakatiwalaan. Minamarkahang puwang ang mga bahaging tumigil o nalaktawan. Walang sine-save.",
      "Basahon ang tibuok clip, usa ka frame matag 2 segundo, gitipigan ang numero sa matag manok gikan sa sinugdanan hangtod sa katapusan, ug gihukman ang pagpundok ug pagkawalay lihok sa mga frame nga kasaligan. Gimarkahan nga gintang ang mga bahin nga mihunong o nalaktawan. Walay gitipigan.",
    ],
  "Inactive when a bird stays put for": [
    "Hindi aktibo kapag hindi gumalaw ang manok nang",
    "Dili aktibo kung ang manok wala molihok sulod sa",
  ],
  "Starting…": ["Sinisimulan…", "Gisugdan…"],
  "Follow the birds again": ["Sundan muli ang mga manok", "Subaya pag-usab ang mga manok"],
  "Frames read": ["Mga frame na nabasa", "Mga frame nga nabasa"],
  "{done} of {total} frames read ({at} of {length} of video).": [
    "{done} ng {total} frame ang nabasa ({at} ng {length} ng video).",
    "{done} sa {total} ka frame ang nabasa ({at} sa {length} sa video).",
  ],
  "About {time} left.": ["Mga {time} pa ang natitira.", "Mga {time} pa ang nahabilin."],
  "Stopping…": ["Itinitigil…", "Gipahunong…"],
  Stop: ["Itigil", "Hunonga"],
  "The scan stopped with an error: {error}": [
    "Huminto ang scan dahil sa error: {error}",
    "Mihunong ang scan tungod sa error: {error}",
  ],
  unknown: ["hindi alam", "wala mahibal-an"],
  "Stopped early: only the first {at} of the clip was read.": [
    "Maagang itinigil: ang unang {at} lang ng clip ang nabasa.",
    "Sayo nga gipahunong: ang unang {at} ra sa clip ang nabasa.",
  ],
  "No feeder or drinker zones were used, so birds crowding at a feeder count as huddling. Draw the zones under Feeder and Drinker Zones, then follow the birds again.":
    [
      "Walang ginamit na zone ng pakainan o inuman, kaya itinuturing na nagsisiksikan ang mga manok na nagkukumpulan sa pakainan. Iguhit ang mga zone sa Feeder and Drinker Zones, saka sundan muli ang mga manok.",
      "Walay gigamit nga zone sa pakaonan o imnanan, mao nga giisip nga nagpundok ang mga manok nga nagdugok sa pakaonan. Idrowing ang mga zone sa Feeder and Drinker Zones, unya subaya pag-usab ang mga manok.",
    ],
  "Loading the frames…": ["Nilo-load ang mga frame…", "Gi-load ang mga frame…"],
  Frame: ["Frame", "Frame"],
  "Previous event": ["Naunang pangyayari", "Miaging hitabo"],
  "Next event": ["Susunod na pangyayari", "Sunod nga hitabo"],
  "Frame with each tracked bird's number": [
    "Frame na may numero ng bawat nasundang manok",
    "Frame nga adunay numero sa matag nasubay nga manok",
  ],
  "Reading the frame…": ["Binabasa ang frame…", "Gibasa ang frame…"],
  "No picture for this frame.": [
    "Walang larawan para sa frame na ito.",
    "Walay hulagway alang niini nga frame.",
  ],
  "{birds} birds tracked, {huddles} huddle groups, {inactive} inactive, {feeding} at a feeder.": [
    "{birds} manok ang nasundan, {huddles} grupong nagsisiksikan, {inactive} hindi aktibo, {feeding} nasa pakainan.",
    "{birds} ka manok ang nasubay, {huddles} ka grupo nga nagpundok, {inactive} dili aktibo, {feeding} anaa sa pakaonan.",
  ],
  "Not judged: {why}.": ["Hindi hinusgahan: {why}.", "Wala gihukman: {why}."],
  "Green boxes are tracked birds, amber ones were given back after a missed frame, violet ones are inactive, grey ones marked + were seen but not tracked and count for huddling only, and red frames are huddles.":
    [
      "Ang berdeng kahon ay mga nasundang manok, ang dilaw-kahel ay ibinalik matapos ang isang nalaktawang frame, ang lila ay hindi aktibo, ang abong may + ay nakita pero hindi nasundan at binibilang lang sa pagsisiksikan, at ang pulang balangkas ay mga nagsisiksikan.",
      "Ang berde nga kahon mga nasubay nga manok, ang dalag-kahel gibalik human sa usa ka nalaktawan nga frame, ang biyoleta dili aktibo, ang abuhon nga adunay + nakita apan wala masubay ug giihap ra sa pagpundok, ug ang pula nga kuwadro mga nagpundok.",
    ],
  "Trusted frames": ["Mapagkakatiwalaang frame", "Kasaligan nga frame"],
  "Gap frames": ["Frame na puwang", "Frame nga gintang"],
  "Birds in view (average)": ["Manok na nakikita (karaniwan)", "Manok nga makita (kasagaran)"],
  "Numbers handed out per bird": [
    "Numerong naibigay bawat manok",
    "Numero nga gihatag matag manok",
  ],
  "Longest trusted stretch": [
    "Pinakamahabang mapagkakatiwalaang bahagi",
    "Pinakataas nga kasaligan nga bahin",
  ],
  "Gaps: {list}.": ["Mga puwang: {list}.", "Mga gintang: {list}."],
  "Birds that stayed put": ["Mga manok na hindi gumalaw", "Mga manok nga wala molihok"],
  "Show the first frame where bird {bird} was inactive": [
    "Ipakita ang unang frame kung saan hindi aktibo ang manok {bird}",
    "Ipakita ang unang frame diin dili aktibo ang manok {bird}",
  ],
  "Bird {bird}: {from} to {to}": [
    "Manok {bird}: {from} hanggang {to}",
    "Manok {bird}: {from} hangtod {to}",
  ],
  "and {n} more in the CSV.": ["at {n} pa sa CSV.", "ug {n} pa sa CSV."],
  "Preparing…": ["Inihahanda…", "Giandam…"],
  "Download frames (CSV)": ["I-download ang mga frame (CSV)", "I-download ang mga frame (CSV)"],
  "Download tracks for scoring (MOT)": [
    "I-download ang mga track para sa pagmamarka (MOT)",
    "I-download ang mga track alang sa pagmarka (MOT)",
  ],
  "Rules from the klydel branch of BehaviorMonitoring (commit {commit}). Inactive means a bird stayed within half a body length; it is a reason to go and look, not a diagnosis.":
    [
      "Mga patakaran mula sa klydel branch ng BehaviorMonitoring (commit {commit}). Ang hindi aktibo ay nangangahulugang hindi lumayo ang manok nang higit sa kalahati ng haba ng katawan nito; dahilan ito para puntahan at tingnan, hindi diagnosis.",
      "Mga lagda gikan sa klydel branch sa BehaviorMonitoring (commit {commit}). Ang dili aktibo nagpasabot nga ang manok wala milayo labaw sa katunga sa gitas-on sa lawas niini; rason kini aron adtoon ug tan-awon, dili diagnosis.",
    ],
};
