import type { Messages } from "./types";

/** The weight pages and the AI briefing, now written from the weights typed in on Flock Tracking. */
export const part26: Messages = {
  "No bird weights have been typed in yet. Weigh a few birds, type their weights on Flock Tracking, and the growth report appears here.": [
    "Wala pang naitalang timbang ng manok. Timbangin ang ilang manok, ilagay ang timbang sa Flock Tracking, at lalabas dito ang ulat ng paglaki.",
    "Wala pay nabutang nga gibug-aton sa manok. Timbanga ang pipila ka manok, ibutang ang gibug-aton sa Flock Tracking, ug mugawas dinhi ang taho sa pagtubo.",
  ],
  "Open Flock Tracking →": ["Buksan ang Flock Tracking →", "Ablihi ang Flock Tracking →"],
  "Check the {total} birds that were weighed against the Ross 308 standard for Day {day}: how far ahead or behind the flock is, how even the weights are, and where the flock is heading for Day {endDay}.": [
    "Suriin ang {total} manok na natimbang laban sa pamantayang Ross 308 para sa Day {day}: gaano kaaga o kahuli ang kawan, gaano kapantay ang mga timbang, at saan papunta ang kawan sa Day {endDay}.",
    "Susiha ang {total} ka manok nga natimbang batok sa sukdanan sa Ross 308 alang sa Day {day}: unsa ka daan o ulahi ang panon, unsa ka patas ang mga gibug-aton, ug asa padulong ang panon sa Day {endDay}.",
  ],
  "{total} birds weighed": ["{total} manok ang natimbang", "{total} ka manok ang natimbang"],
  "Day {day} weights": ["Mga timbang sa Day {day}", "Mga gibug-aton sa Day {day}"],
  "Reading the {total} weights typed in for Day {day}...": ["Binabasa ang {total} timbang na inilagay para sa Day {day}...", "Gibasa ang {total} ka gibug-aton nga gibutang alang sa Day {day}..."],
  "Checking how even the weights are...": ["Sinusuri kung gaano kapantay ang mga timbang...", "Gisusi kung unsa ka patas ang mga gibug-aton..."],
  "Working out where the flock is heading for harvest...": ["Kinukuwenta kung saan papunta ang kawan sa anihan...", "Gikuwenta kung asa padulong ang panon sa ani..."],
  "Only {total} birds were weighed": ["{total} manok lang ang natimbang", "{total} ka manok lang ang natimbang"],
  "A report from fewer than 10 birds can be far from the real flock. Weigh more birds and type them in for a more reliable picture.": [
    "Ang ulat mula sa wala pang 10 manok ay maaaring malayo sa totoong kawan. Magtimbang pa ng mas maraming manok at ilagay ang mga ito para mas maaasahan.",
    "Ang taho gikan sa ubos sa 10 ka manok mahimong layo sa tinuod nga panon. Timbanga pa ang daghan nga manok ug ibutang kini aron mas kasaligan.",
  ],
  "The flock is growing faster than the standard.": ["Mas mabilis ang paglaki ng kawan kaysa sa pamantayan.", "Mas paspas ang pagtubo sa panon kay sa sukdanan."],
  "{Optimal} of {total} birds are in the target growth bracket for Day {day}.": [
    "{Optimal} sa {total} manok ay nasa target na saklaw ng paglaki para sa Day {day}.",
    "{Optimal} sa {total} ka manok naa sa target nga sakup sa pagtubo alang sa Day {day}.",
  ],
  "Bird {id} ({value} g) is {value2} g below the flock average. Check that the lightest birds can reach the feeders and drinkers, and look at them for signs of illness.": [
    "Ang manok na {id} ({value} g) ay {value2} g na mas mababa sa average ng kawan. Tiyaking naaabot ng pinakamagagaan na manok ang pakainan at inuman, at tingnan kung may sakit sila.",
    "Ang manok nga {id} ({value} g) {value2} g nga ubos sa average sa panon. Siguroha nga maabot sa labing gaan nga mga manok ang kan-anan ug inuman, ug tan-awa kon sila nasakit.",
  ],
  "No weights typed in yet": ["Wala pang naitalang timbang", "Wala pay nabutang nga gibug-aton"],
  "Needs a weighed bird": ["Kailangan ng natimbang na manok", "Kinahanglan og natimbang nga manok"],
  "Birds Weighed": ["Mga Natimbang na Manok", "Mga Natimbang nga Manok"],
  "Typed in on Flock Tracking": ["Inilagay sa Flock Tracking", "Gibutang sa Flock Tracking"],
  "Spread": ["Lawak ng Pagkakaiba", "Gilay-on sa Kalainan"],
  "Standard deviation of the weights": ["Standard deviation ng mga timbang", "Standard deviation sa mga gibug-aton"],
  "Needs two weighed birds": ["Kailangan ng dalawang natimbang na manok", "Kinahanglan og duha ka natimbang nga manok"],
  "Weighed (average)": ["Natimbang (average)", "Natimbang (average)"],
  "Birds sorted into brackets of the Ross 308 standard for Day {day}, from the {total} birds weighed": [
    "Mga manok na hinati sa mga saklaw ng pamantayang Ross 308 para sa Day {day}, mula sa {total} manok na natimbang",
    "Mga manok nga gibahin sa mga sakup sa sukdanan sa Ross 308 alang sa Day {day}, gikan sa {total} ka manok nga natimbang",
  ],
  "Lightest weighed": ["Pinakamagaan na natimbang", "Labing gaan nga natimbang"],
  "Heaviest weighed": ["Pinakamabigat na natimbang", "Labing bug-at nga natimbang"],
  "Avg vs Standard": ["Avg vs Pamantayan", "Avg batok sa Sukdanan"],
  "Weigh birds on a scale and type each weight in kg (up to 3 decimals, like 0.946), then press Enter or click away. It saves by itself for Day {day}; there is no submit button. The average of the weights you type in for a day is the weight the Dashboard shows for the flock. Each new day starts with empty boxes; the earlier days stay saved, and each bird's Gain compares it with its last weighing.": [
    "Timbangin ang mga manok sa timbangan at ilagay ang bawat timbang sa kg (hanggang 3 decimal, tulad ng 0.946), tapos pindutin ang Enter o mag-click sa iba. Kusa itong sine-save para sa Day {day}; walang submit button. Ang average ng mga timbang na inilagay mo sa isang araw ang timbang na ipinapakita ng Dashboard para sa kawan. Bawat bagong araw ay nagsisimula sa walang laman na mga kahon; nananatiling naka-save ang mga nakaraang araw, at ang Gain ng bawat manok ay ikinukumpara sa huli nitong pagtimbang.",
    "Timbanga ang mga manok sa timbangan ug ibutang ang matag gibug-aton sa kg (hangtod 3 ka decimal, sama sa 0.946), unya pindota ang Enter o i-click sa lain. Kusa kini nga ma-save alang sa Day {day}; walay submit button. Ang average sa mga gibug-aton nga imong gibutang sa usa ka adlaw mao ang gibug-aton nga gipakita sa Dashboard alang sa panon. Ang matag bag-ong adlaw magsugod nga walay sulod ang mga kahon; ang miaging mga adlaw nagpabilin nga naka-save, ug ang Gain sa matag manok gitandi sa katapusang pagtimbang niini.",
  ],
  "The flock size of this pen is not set, so there are no birds to list. An administrator can set it in Settings.": [
    "Hindi pa nakatakda ang laki ng kawan ng kulungang ito, kaya walang manok na ililista. Maaaring itakda ito ng administrator sa Settings.",
    "Wala pa gitakda ang gidaghanon sa panon niini nga kulungan, busa walay ililista nga manok. Ang administrator makatakda niini sa Settings.",
  ],
  "Day {day} of {endDay}: no bird weights typed in yet": ["Day {day} ng {endDay}: wala pang naitalang timbang ng manok", "Day {day} sa {endDay}: wala pay nabutang nga gibug-aton sa manok"],
  "Needs 5 birds": ["Kailangan ng 5 manok", "Kinahanglan og 5 ka manok"],
  "Weigh at least 5 birds to see how even they are": ["Magtimbang ng hindi bababa sa 5 manok para makita kung gaano sila kapantay", "Timbanga ang labing menos 5 ka manok aron makita kung unsa sila ka patas"],
  "Camera computer not answering": ["Hindi sumasagot ang computer ng camera", "Wala motubag ang kompyuter sa camera"],
  "Pen 1 not connected": ["Hindi nakakonekta ang Pen 1", "Wala konektado ang Pen 1"],
  "Checking the camera computer": ["Sinusuri ang computer ng camera", "Gisusi ang kompyuter sa camera"],
};
