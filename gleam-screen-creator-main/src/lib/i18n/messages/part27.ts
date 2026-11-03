import type { Messages } from "./types";

/** The Test video box: what is chosen, and the question before checking a file that is not ideal. */
export const part27: Messages = {
  "Best: an MP4 or WebM clip under {mb} MB and {seconds} seconds or shorter. Other files still work, but take longer.": [
    "Pinakamainam: MP4 o WebM na wala pang {mb} MB at {seconds} segundo o mas maikli. Gumagana pa rin ang ibang file, pero mas matagal.",
    "Labing maayo: MP4 o WebM nga ubos sa {mb} MB ug {seconds} segundo o mas mubo. Mogana gihapon ang ubang file, apan mas dugay.",
  ],
  "What was chosen": ["Ang napili", "Ang gipili"],
  "Format: {ext}": ["Format: {ext}", "Format: {ext}"],
  "Format: {ext}. It is converted first, which adds time on the camera computer.": [
    "Format: {ext}. Kino-convert muna ito, na nagdadagdag ng oras sa computer ng camera.",
    "Format: {ext}. I-convert una kini, nga nagdugang og oras sa kompyuter sa camera.",
  ],
  "Size: {size} MB": ["Laki: {size} MB", "Gidak-on: {size} MB"],
  "Size: {size} MB. Only the first {mb} MB are used, and an MP4 whose index is at the end cannot be cut that way and will fail.": [
    "Laki: {size} MB. Ang unang {mb} MB lang ang gagamitin, at ang MP4 na nasa dulo ang index ay hindi maaaring putulin nang ganito at mabibigo.",
    "Gidak-on: {size} MB. Ang unang {mb} MB ra ang gamiton, ug ang MP4 nga anaa sa tumoy ang index dili ma-utlan niini ug mapakyas.",
  ],
  "Length: reading it…": ["Haba: binabasa…", "Gitas-on: gibasa…"],
  "Length: not known until it is converted": ["Haba: hindi pa alam hangga't hindi ito na-convert", "Gitas-on: dili pa mahibaloan hangtod ma-convert kini"],
  "Length: {n} seconds. Only the first {seconds} seconds are checked.": [
    "Haba: {n} segundo. Ang unang {seconds} segundo lang ang susuriin.",
    "Gitas-on: {n} ka segundo. Ang unang {seconds} ka segundo ra ang susihon.",
  ],
  "Length: {n} seconds": ["Haba: {n} segundo", "Gitas-on: {n} ka segundo"],
  "This video is not ideal": ["Hindi ito ang pinakamainam na video", "Dili kini ang labing maayo nga video"],
  "It can still be checked, but:": ["Maaari pa rin itong suriin, pero:", "Masusi pa gihapon kini, apan:"],
  "This can take a few minutes on the camera computer. For a quick check, use an MP4 or WebM clip under {mb} MB and {seconds} seconds or shorter.": [
    "Maaaring abutin ito ng ilang minuto sa computer ng camera. Para sa mabilis na pagsusuri, gumamit ng MP4 o WebM na wala pang {mb} MB at {seconds} segundo o mas maikli.",
    "Mahimong molungtad kini og pipila ka minuto sa kompyuter sa camera. Alang sa paspas nga pagsusi, gamita ang MP4 o WebM nga ubos sa {mb} MB ug {seconds} segundo o mas mubo.",
  ],
  "Use it anyway": ["Gamitin pa rin", "Gamita gihapon"],
  "Length: could not be read from the file": ["Haba: hindi mabasa mula sa file", "Gitas-on: dili mabasa gikan sa file"],
};
