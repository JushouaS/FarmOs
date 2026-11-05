import type { Messages } from "./types";

/** The two clip tests on Settings, plus the strings the Flock Conditions cards asked for by name. */
export const part15: Messages = {
  "Test clip — Behaviour": ["Clip na pang-subok — Ugali", "Clip nga pagsulay — Kinaiya"],
  "Test clip — 3D Weight": ["Clip na pang-subok — 3D Timbang", "Clip nga pagsulay — 3D Gibug-aton"],
  "Upload a Kinect depth recording to check the 3D weight estimation without the weighing station. The frames are measured with the same depth-to-mass line a live reading uses, and nothing is saved to the flock's history.": [
    "Mag-upload ng Kinect depth recording para suriin ang 3D weight estimation nang hindi ginagamit ang weighing station. Sinusukat ang mga frame gamit ang kaparehong depth-to-mass na linya ng isang live na pagbasa, at walang sine-save sa kasaysayan ng kawan.",
    "Mag-upload ug Kinect depth recording aron susihon ang 3D weight estimation nga wala gigamit ang weighing station. Gisukod ang mga frame gamit ang samang depth-to-mass nga linya sa usa ka live nga pagbasa, ug walay gitipigan sa kasaysayan sa panon.",
  ],
  "Depth recording": ["Depth recording", "Depth recording"],
  "A recording of the depth view, not the colour camera. Up to {n} MB and 1 hour.": [
    "Recording ng depth view, hindi ng colour camera. Hanggang {n} MB at 1 oras.",
    "Recording sa depth view, dili sa colour camera. Hangtod {n} MB ug 1 ka oras.",
  ],
  "Check weights": ["Suriin ang timbang", "Susiha ang gibug-aton"],
  "Weighing the clip…": ["Tinatimbang ang clip…", "Gitimbang ang clip…"],
  "No frames could be read from this clip.": [
    "Walang mabasang frame mula sa clip na ito.",
    "Walay mabasa nga frame gikan niini nga clip.",
  ],
  "Estimated weight: {median} (±{sd} g)": [
    "Tinantiyang timbang: {median} (±{sd} g)",
    "Gitantiya nga gibug-aton: {median} (±{sd} g)",
  ],
  "{used} of {taken} sampled frames could be measured.": [
    "{used} sa {taken} na sample na frame ang nasukatan.",
    "{used} sa {taken} ka sample nga frame ang nasukod.",
  ],
  "The clip was long, so the weighing stopped early.": [
    "Mahaba ang clip, kaya huminto nang maaga ang pagtimbang.",
    "Taas ang clip, busa mihunong sayo ang pagtimbang.",
  ],
  Median: ["Median", "Median"],
  Spread: ["Kalat", "Kalat"],
  Lightest: ["Pinakamagaan", "Pinakagaan"],
  Heaviest: ["Pinakamabigat", "Pinakabug-aton"],
  "Frames used": ["Frame na ginamit", "Frame nga gigamit"],
  Confidence: ["Kumpiyansa", "Pagsalig"],
  Weight: ["Timbang", "Gibug-aton"],
  At: ["Sa", "Sa"],
  Unreadable: ["Hindi mabasa", "Dili mabasa"],
  "A test clip writes nothing. The growth chart only ever sees weights from the live station or a person's scale.": [
    "Walang sinusulat ang test clip. Ang growth chart ay nakakakita lang ng timbang mula sa live na station o sa timbangan ng tao.",
    "Walay gisulat ang test clip. Ang growth chart makakita ra sa gibug-aton gikan sa live nga station o sa timbangan sa tawo.",
  ],
  "Your session ended. Sign in again, then try the clip.": [
    "Natapos na ang iyong session. Mag-sign in ulit, saka subukan ang clip.",
    "Natapos na ang imong session. Mag-sign in pag-usab, unya sulayi ang clip.",
  ],
  "Too many uploads or checks just now. Please wait a minute.": [
    "Masyadong maraming upload o pagsusuri kanina lang. Maghintay muna ng isang minuto.",
    "Daghan kaayo ang upload o pagsusi nga bag-o lang. Palihog hulat una og usa ka minuto.",
  ],
  "The clip is larger than the {n} MB limit.": [
    "Lampas sa {n} MB na limitasyon ang clip.",
    "Labaw sa {n} MB nga limitasyon ang clip.",
  ],
  "The clip is longer than the limit. Cut it down and try again.": [
    "Mas mahaba ang clip kaysa limitasyon. Pupulin ito at subukan ulit.",
    "Mas taas ang clip kay sa limitasyon. Pupula kini ug sulayi pag-usab.",
  ],
  "That file could not be read as a video. Export it as H.264 MP4 and try again.": [
    "Hindi mabasa ang file bilang video. I-export ito bilang H.264 MP4 at subukan ulit.",
    "Dili mabasa ang file isip video. I-export kini isip H.264 MP4 ug sulayi pag-usab.",
  ],
  "The file was empty.": ["Walang laman ang file.", "Walay sulod ang file."],
  "That clip is no longer stored. Upload it again.": [
    "Hindi na nakaimbak ang clip. I-upload ito ulit.",
    "Wala na gitipigan ang clip. I-upload kini pag-usab.",
  ],
  "The check could not be run. Try again.": [
    "Hindi mapatakbo ang pagsusuri. Subukan ulit.",
    "Dili mapadagan ang pagsusi. Sulayi pag-usab.",
  ],
  "Could not reach the camera service. Check the connection and try again.": [
    "Hindi maabot ang camera service. Suriin ang koneksyon at subukan ulit.",
    "Dili maabot ang camera service. Susiha ang koneksyon ug sulayi pag-usab.",
  ],
  "Uploading and reading the clip… a long clip takes a while.": [
    "Ina-upload at binabasa ang clip… ang mahabang clip ay tumatagal nang medyo bago.",
    "Gi-upload ug gibasa ang clip… ang taas nga clip molungtad og gamay.",
  ],
  "Removing…": ["Inaalis…", "Gitangtang…"],
  "Remove clip": ["Alisin ang clip", "Tangtanga ang clip"],

  "{from} → {to} over the last {n} measurements. Lower is better.": [
    "{from} → {to} sa nakaraang {n} sukat. Mas mababa ay mas mabuti.",
    "{from} → {to} sa miaging {n} ka sukod. Mas ubos mas maayo.",
  ],
  "How {title} is worked out": ["Paano kinukuwenta ang {title}", "Unsaon pagkuwenta ang {title}"],
  "The share of the birds that moved during the scan. Each bird is followed from picture to picture, and it counts as moving when it strays more than about a third of its own body length.": [
    "Ang bahagi ng mga manok na gumalaw sa panahon ng pag-scan. Sinusundan ang bawat manok mula larawan hanggang larawan, at ituturing na gumalaw ito kapag lumayo ito nang higit sa mga isang ikatlo ng haba ng sarili nitong katawan.",
    "Ang bahin sa mga manok nga naglihok sa panahon sa scan. Gisubay ang matag manok gikan sa hulagway ngadto sa hulagway, ug ihapon kini nga naglihok kon mibiya kini og labaw sa mga usa ka tersiya sa gitas-on sa iyang lawas.",
  ],
  "91 of every 100 birds moved means an index of 91%. The 88% baseline is a reference level set in the sample data; it should become this flock's own usual level once real readings are collected.": [
    "Kung 91 sa bawat 100 manok ang gumalaw, ang index ay 91%. Ang 88% na baseline ay antas ng sanggunian na itinakda sa sample data; dapat itong maging karaniwang antas ng kawan na ito kapag may tunay nang mga sukat.",
    "Kon 91 sa matag 100 ka manok ang naglihok, ang index kay 91%. Ang 88% nga baseline kay lebel nga gigamit nga reperensiya sa sample data; kinahanglan kining mahimong kasagarang lebel sa kini nga panon kon aduna nay tinuod nga mga sukod.",
  ],
  "The number on this page is built-in sample data. It is not connected to the live camera yet.": [
    "Built-in na sample data ang numero sa pahinang ito. Hindi pa ito konektado sa live camera.",
    "Built-in nga sample data ang numero niini nga panid. Wala pa kini konektado sa live camera.",
  ],
  "The share of the birds packed into a huddle: a group of 3 or more touching birds that stays together. A bird in a clump that forms and breaks up again does not count.": [
    "Ang bahagi ng mga manok na nagsisiksikan sa isang pangkat: 3 o higit pang magkakadikit na manok na nananatiling magkasama. Hindi binibilang ang pagkumpol na nabubuo at agad ding naghihiwalay.",
    "Ang bahin sa mga manok nga nagpundok sa usa ka grupo: 3 o labaw pa nga nagdikit nga manok nga magpabilin nga magkauban. Dili ihapon ang pagpundok nga mabuo ug dayon mabungkag.",
  ],
  "8 of every 100 birds in a huddle means a risk of 8%. From 35% it raises a Huddling alert.": [
    "Kung 8 sa bawat 100 manok ang nagsisiksikan, 8% ang panganib. Mula 35%, magpapataas ito ng alerto sa Pagsisiksikan.",
    "Kon 8 sa matag 100 ka manok ang nagpundok, 8% ang risgo. Gikan sa 35%, mohatag kini og pasidaan sa Pagpundok.",
  ],
  "The latest reading from the house sensor. The shaded band on the line is the acceptable range ({min}–{max}{unit}); the line shows the last 7 days.": [
    "Ang pinakabagong sukat mula sa sensor ng bahay. Ang may kulay na bahagi sa linya ay ang katanggap-tanggap na saklaw ({min}–{max}{unit}); ipinapakita ng linya ang huling 7 araw.",
    "Ang pinakabag-o nga sukod gikan sa sensor sa balay. Ang gikolor nga bahin sa linya mao ang madawat nga sakup ({min}–{max}{unit}); ang linya nagpakita sa miaging 7 ka adlaw.",
  ],
  "The reading is inside the range.": ["Nasa loob ng saklaw ang sukat.", "Naa sulod sa sakup ang sukod."],
  "The reading is outside the range.": ["Nasa labas ng saklaw ang sukat.", "Naa sa gawas sa sakup ang sukod."],
  "The readings on this page are built-in sample data until the house sensors are connected.": [
    "Built-in na sample data ang mga sukat sa pahinang ito hanggang makonekta ang mga sensor ng bahay.",
    "Built-in nga sample data ang mga sukod niini nga panid hangtod makonekta ang mga sensor sa balay.",
  ],
  "Analyze Growth": ["Suriin ang Paglaki", "Susiha ang Pagdako"],
  "The weight spread, bird counts and feed figures in this report are built-in sample data, as on the Analytics page.": [
    "Built-in na sample data ang pagkakalat ng timbang, bilang ng manok at mga sukat ng pakain sa ulat na ito, tulad sa pahina ng Analytics.",
    "Built-in nga sample data ang pagkaylap sa gibug-aton, ihap sa manok ug mga sukod sa pagkaon niini nga report, sama sa panid sa Analytics.",
  ],
  "Lower is better.": ["Mas mababa ay mas mabuti.", "Mas ubos mas maayo."],
  "Target {fcrTarget}": ["Target {fcrTarget}", "Target {fcrTarget}"],
};
