import type { Messages } from "./types";

/** The two clip tests on Settings: behaviour, and the 3D weight estimation. */
export const part15: Messages = {
  "Test clip — Behaviour": ["Clip na pang-subok — Ugali", "Clip nga pagsulay — Kinaiya"],
  "Test clip — 3D Weight": ["Clip na pang-subok — 3D Timbang", "Clip nga pagsulay — 3D Gibug-aton"],
  "Upload a Kinect depth recording to check the 3D weight estimation without the weighing station. The frames are measured with the same depth-to-mass line a live reading uses, and nothing is saved to the flock's history.": [
    "Mag-upload ng Kinect depth recording para suriin ang 3D weight estimation nang hindi ginagamit ang weighing station. Sinusukat ang mga frame gamit ang kaparehong depth-to-mass na linya ng isang live na pagbasa, at walang sine-save sa kasaysayan ng kawan.",
    "Mag-upload ug Kinect depth recording aron susihon ang 3D weight estimation nga wala gigamit ang weighing station. Gisukod ang mga frame gamit ang samang depth-to-mass nga linya sa usa ka live nga pagbasa, ug walay gitipigan sa kasaysayan sa panon.",
  ],
  "Depth recording": ["Depth recording", "Depth recording"],
  "A recording of the depth view, not the colour camera. Up to {n} MB and 10 minutes.": [
    "Recording ng depth view, hindi ng colour camera. Hanggang {n} MB at 10 minuto.",
    "Recording sa depth view, dili sa colour camera. Hangtod {n} MB ug 10 minuto.",
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
};
