import type { Messages } from "./types";

/** The "Test video" button on Live Camera. */
export const part12: Messages = {
  "Test video": ["Subukan ang video", "Sulayi ang video"],
  "Test the detector on a video": ["Subukan ang detector sa isang video", "Sulayi ang detector sa usa ka video"],
  "Choose a short video clip. The trained model checks it and marks what it finds. Nothing is saved.": [
    "Pumili ng maikling video. Susuriin ito ng na-train na model at mamarkahan ang mga nakita nito. Walang sine-save.",
    "Pili og mubo nga video. Susihon kini sa na-train nga model ug markahan ang mga nakita niini. Walay gitipigan.",
  ],
  "Choose video": ["Pumili ng video", "Pili og video"],
  "Choose another video": ["Pumili ng ibang video", "Pili og lain nga video"],
  "Check video": ["Suriin ang video", "Susiha ang video"],
  "That video is over {mb} MB.": ["Lampas sa {mb} MB ang video na iyon.", "Labaw sa {mb} MB ang maong video."],
  "Larger files are cut to {mb} MB. Only the first {seconds} seconds are checked.": [
    "Ang mas malalaking file ay puputulin sa {mb} MB. Ang unang {seconds} segundo lang ang susuriin.",
    "Ang mas dagkong file putlon hangtod {mb} MB. Ang unang {seconds} segundo ra ang susihon.",
  ],
  "This file is {size} MB. Only the first {mb} MB are used.": [
    "{size} MB ang file na ito. Ang unang {mb} MB lang ang gagamitin.",
    "{size} MB kini nga file. Ang unang {mb} MB ra ang gamiton.",
  ],
  "This video is converted first so it can play here.": [
    "Kokonbertihin muna ang video na ito para ma-play dito.",
    "I-convert una kini nga video aron ma-play dinhi.",
  ],
  "Converting the video so it can play here. This can take a minute or two.": [
    "Kinokonberti ang video para ma-play dito. Maaaring abutin ito ng isa o dalawang minuto.",
    "Gi-convert ang video aron ma-play dinhi. Mahimong molungtad kini og usa o duha ka minuto.",
  ],
  "The camera computer needs an update before it can do this. Update it, then try again.": [
    "Kailangan munang i-update ang computer ng camera bago ito magawa. I-update ito, saka subukan ulit.",
    "Kinahanglan una i-update ang kompyuter sa camera sa dili pa kini mahimo. I-update kini, unya sulayi pag-usab.",
  ],
  "The video converter is not installed on the camera computer yet.": [
    "Hindi pa naka-install ang video converter sa computer ng camera.",
    "Wala pa na-install ang video converter sa kompyuter sa camera.",
  ],
  "This video cannot be cut at {mb} MB because its index is at the end of the file. Use an MKV or WebM file, or a smaller clip.": [
    "Hindi mapuputol ang video na ito sa {mb} MB dahil nasa dulo ng file ang index nito. Gumamit ng MKV o WebM na file, o mas maliit na clip.",
    "Dili mapunit ang kini nga video sa {mb} MB tungod kay naa sa katapusan sa file ang index niini. Gamita ang MKV o WebM nga file, o mas gamay nga clip.",
  ],
  Moving: ["Gumagalaw", "Naglihok"],
  Inactivity: ["Kawalan ng galaw", "Walay lihok"],
  Colors: ["Mga kulay", "Mga kolor"],
  "In this frame: {n} birds, {i} inactive, {h} huddling": [
    "Sa frame na ito: {n} manok, {i} hindi aktibo, {h} nagsisiksikan",
    "Niini nga frame: {n} ka manok, {i} dili aktibo, {h} nagpundok",
  ],
  "Inactive: {n} birds stayed still for {s} seconds or more while the rest of the flock moved.": [
    "Hindi aktibo: {n} manok ang hindi gumalaw nang {s} segundo o higit pa habang gumagalaw ang iba sa kawan.",
    "Dili aktibo: {n} ka manok ang wala molihok sulod sa {s} segundo o labaw pa samtang naglihok ang uban sa panon.",
  ],
  "The clip is shorter than {s} seconds, too short to call a bird inactive.": [
    "Mas maikli ang clip kaysa {s} segundo, kaya masyadong maikli para tawaging hindi aktibo ang isang manok.",
    "Mas mubo ang clip kaysa {s} segundo, busa mubo ra kaayo aron tawgon nga dili aktibo ang usa ka manok.",
  ],
  "Most of the flock was still, so no single bird is called inactive.": [
    "Halos hindi gumagalaw ang karamihan sa kawan, kaya walang isang manok na tinatawag na hindi aktibo.",
    "Kasagaran sa panon wala molihok, busa walay usa ka manok nga gitawag nga dili aktibo.",
  ],
  "No inactive birds found.": ["Walang nakitang hindi aktibong manok.", "Walay nakitang dili aktibo nga manok."],
  "Huddles: {n}. Up to {p}% of the birds were in a huddle.": [
    "Mga pagsisiksikan: {n}. Hanggang {p}% ng mga manok ang nagsisiksikan.",
    "Mga pagpundok: {n}. Hangtod {p}% sa mga manok ang nagpundok.",
  ],
  "That is above the {p}% warning level.": ["Mas mataas ito sa {p}% na antas ng babala.", "Mas taas kini sa {p}% nga lebel sa pasidaan."],
  "The clip is shorter than {s} seconds, too short to call a huddle.": [
    "Mas maikli ang clip kaysa {s} segundo, kaya masyadong maikli para tawaging pagsisiksikan.",
    "Mas mubo ang clip kaysa {s} segundo, busa mubo ra kaayo aron tawgon nga pagpundok.",
  ],
  "No huddles found.": ["Walang nakitang pagsisiksikan.", "Walay nakitang pagpundok."],
  "Test settings: a bird is inactive after {a} seconds without moving, and a huddle is {m} or more touching birds that stay together for {h} seconds. In a real house these times are much longer.": [
    "Mga setting sa pagsubok: hindi aktibo ang manok kapag {a} segundo itong hindi gumagalaw, at ang pagsisiksikan ay {m} o higit pang magkakadikit na manok na magkasama nang {h} segundo. Sa tunay na bahay, mas mahaba ang mga oras na ito.",
    "Mga setting sa pagsulay: dili aktibo ang manok kon {a} segundo kini nga wala molihok, ug ang pagpundok kay {m} o labaw pa nga nagdikit nga manok nga magkauban sulod sa {h} segundo. Sa tinuod nga balay, mas taas kini nga mga oras.",
  ],
  "Checking the video. This can take a minute or two.": [
    "Sinusuri ang video. Maaaring abutin ito ng isa o dalawang minuto.",
    "Gisusi ang video. Mahimong molungtad kini og usa o duha ka minuto.",
  ],
  "The detector is not installed on the camera computer yet.": [
    "Hindi pa naka-install ang detector sa computer ng camera.",
    "Wala pa na-install ang detector sa kompyuter sa camera.",
  ],
  "The video could not be read. Try an MP4 or WebM file.": [
    "Hindi mabasa ang video. Subukan ang MP4 o WebM na file.",
    "Dili mabasa ang video. Sulayi ang MP4 o WebM nga file.",
  ],
  "The camera computer is not reachable.": ["Hindi maabot ang computer ng camera.", "Dili maabot ang kompyuter sa camera."],
  "Your session ended. Sign in again.": ["Natapos na ang iyong session. Mag-sign in ulit.", "Natapos na ang imong session. Mag-sign in pag-usab."],
  "Could not check the video. Try again.": ["Hindi nasuri ang video. Subukan ulit.", "Wala masusi ang video. Sulayi pag-usab."],
  "{frames} frames checked. Most in one frame: {max}. Average: {mean}.": [
    "{frames} frame ang nasuri. Pinakamarami sa isang frame: {max}. Karaniwan: {mean}.",
    "{frames} ka frame ang nasusi. Labing daghan sa usa ka frame: {max}. Kasagaran: {mean}.",
  ],
  "Only the first {seconds} seconds were checked.": [
    "Ang unang {seconds} segundo lang ang nasuri.",
    "Ang unang {seconds} segundo ra ang nasusi.",
  ],
  "The model marks the objects it was trained on ({name}). Other scenes can give false boxes.": [
    "Minamarkahan ng model ang mga bagay na na-train ito ({name}). Ang ibang eksena ay maaaring magbigay ng maling kahon.",
    "Gimarkahan sa model ang mga butang nga gi-train kini ({name}). Ang ubang talan-awon mahimong makahatag og sayop nga kahon.",
  ],
};
