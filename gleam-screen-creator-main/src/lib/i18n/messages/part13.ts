import type { Messages } from "./types";

/** Notifications: the Settings card, the new alert kinds and their messages. */
export const part13: Messages = {
  // Settings > Notifications
  "Send a test": ["Magpadala ng pagsubok", "Magpadala og pagsulay"],
  "Sending…": ["Nagpapadala…", "Nagpadala…"],
  "Save your changes first.": ["I-save muna ang iyong mga pagbabago.", "I-save una ang imong mga kausaban."],
  "Your choices are saved to your account. Every alert is also listed on the Notifications page.": [
    "Naka-save sa iyong account ang iyong mga pinili. Nakalista rin sa pahina ng Mga Abiso ang bawat alerto.",
    "Gitipigan sa imong account ang imong mga pili. Naka-lista usab sa panid sa mga Pahibalo ang matag alerto.",
  ],
  "Email is not set up on this server yet. Ask whoever runs the server to add the mail settings.": [
    "Hindi pa naka-set up ang email sa server na ito. Hilingin sa nagpapatakbo ng server na idagdag ang mga setting ng mail.",
    "Wala pa na-set up ang email sa kini nga server. Pangayo sa nagdagan sa server nga idugang ang mga setting sa mail.",
  ],
  "Push is not set up on this server yet. Ask whoever runs the server to add the push keys.": [
    "Hindi pa naka-set up ang push sa server na ito. Hilingin sa nagpapatakbo ng server na idagdag ang mga push key.",
    "Wala pa na-set up ang push sa kini nga server. Pangayo sa nagdagan sa server nga idugang ang mga push key.",
  ],
  "Push is not set up on this server yet.": ["Hindi pa naka-set up ang push sa server na ito.", "Wala pa na-set up ang push sa kini nga server."],
  "This browser cannot receive push notifications.": [
    "Hindi makakatanggap ng push notification ang browser na ito.",
    "Dili makadawat og push notification kini nga browser.",
  ],
  "Push was not allowed. Allow notifications for this site in the browser, then save again.": [
    "Hindi pinayagan ang push. Payagan ang mga abiso para sa site na ito sa browser, saka i-save ulit.",
    "Wala gitugotan ang push. Tugoti ang mga pahibalo alang sa kini nga site sa browser, unya i-save pag-usab.",
  ],
  "Could not turn push on in this browser.": ["Hindi mabuksan ang push sa browser na ito.", "Dili mabuksan ang push niini nga browser."],
  "Could not send the test. Check the connection and try again.": [
    "Hindi naipadala ang pagsubok. Tingnan ang koneksyon at subukan ulit.",
    "Wala maipadala ang pagsulay. Susiha ang koneksyon ug sulayi pag-usab.",
  ],
  "In the app: sent.": ["Sa app: naipadala.", "Sa app: nadala."],
  "{name}: sent.": ["{name}: naipadala.", "{name}: nadala."],
  "{name}: turned off.": ["{name}: naka-off.", "{name}: gipalong."],
  "{name}: not set up on this server.": ["{name}: hindi pa naka-set up sa server na ito.", "{name}: wala pa na-set up sa kini nga server."],
  "{name}: no browser has allowed it yet. Turn it on and save.": [
    "{name}: wala pang browser na pumayag. I-on ito at i-save.",
    "{name}: wala pay browser nga mitugot. I-on kini ug i-save.",
  ],
  "{name}: could not be sent ({reason}).": ["{name}: hindi naipadala ({reason}).", "{name}: wala maipadala ({reason})."],
  Push: ["Push", "Push"],

  // Alert kinds and why/what to do
  "Flock Inactivity": ["Kawalan ng Galaw ng Kawan", "Walay Lihok sa Panon"],
  "Mortality Spike": ["Biglang Pagdami ng Namatay", "Kalit nga Pagdaghan sa Namatay"],
  "Most of the flock has been still for a long time during the day. Heat, cold, poor light or illness can cause this.": [
    "Matagal nang hindi gumagalaw ang karamihan sa kawan ngayong araw. Maaaring dahil ito sa init, lamig, mahinang ilaw o sakit.",
    "Dugay na nga wala molihok ang kasagaran sa panon karong adlawa. Mahimong tungod kini sa kainit, katugnaw, huyang nga suga o sakit.",
  ],
  "Check the temperature, the lights, and that every drinker and feeder works. Walk the house.": [
    "Suriin ang temperatura, ang mga ilaw, at kung gumagana ang bawat inuman at kainan. Maglakad sa bahay.",
    "Susiha ang temperatura, ang mga suga, ug kon naglihok ang matag imnanan ug kan-anan. Lakaw sa balay.",
  ],
  "A large share of the birds are packed together. Cold, drafts or a fright make birds huddle, and the ones underneath can be hurt.": [
    "Maraming manok ang nagsisiksikan. Ang lamig, hangin o takot ay nagpapasiksik sa mga manok, at maaaring masaktan ang nasa ilalim.",
    "Daghang manok ang nagpundok. Ang katugnaw, hangin o kahadlok maoy hinungdan nga magpundok ang mga manok, ug mahimong masakitan ang naa sa ilalom.",
  ],
  "Check the temperature and look for drafts. Walk the house gently to spread the birds.": [
    "Suriin ang temperatura at hanapin ang pasukan ng hangin. Dahan-dahang maglakad sa bahay para kumalat ang mga manok.",
    "Susiha ang temperatura ug pangita og agianan sa hangin. Hinay-hinay nga lakaw sa balay aron mokatag ang mga manok.",
  ],
  "More birds died today than the day before.": ["Mas maraming manok ang namatay ngayon kaysa kahapon.", "Mas daghang manok ang namatay karon kaysa kagahapon."],
  "Check for sick birds, the temperature, the ventilation and the water. Ask your veterinarian if it continues.": [
    "Tingnan kung may maysakit na manok, ang temperatura, bentilasyon at tubig. Magtanong sa beterinaryo kung magpapatuloy ito.",
    "Tan-awa kon aduna bay masakiting manok, ang temperatura, bentilasyon ug tubig. Pangutana sa beterinaryo kon magpadayon kini.",
  ],

  // Alert messages the system writes (see alertMessage in alert-text.ts)
  "Inactive birds: {n}. They have not moved for {m} minutes while the rest of the flock is active.": [
    "Mga manok na hindi aktibo: {n}. Hindi sila gumalaw nang {m} minuto habang aktibo ang iba sa kawan.",
    "Mga manok nga dili aktibo: {n}. Wala sila molihok sulod sa {m} ka minuto samtang aktibo ang uban sa panon.",
  ],
  "Most of the flock has been still for {m} minutes during the day. Check the temperature, lights and water.": [
    "Halos hindi gumagalaw ang karamihan sa kawan nang {m} minuto ngayong araw. Suriin ang temperatura, ilaw at tubig.",
    "Kasagaran sa panon wala molihok sulod sa {m} ka minuto karong adlawa. Susiha ang temperatura, suga ug tubig.",
  ],
  "Huddling: {p}% of the birds ({n}) have stayed together for {m} minutes. Check the temperature.": [
    "Pagsisiksikan: {p}% ng mga manok ({n}) ang magkakasama nang {m} minuto. Suriin ang temperatura.",
    "Pagpundok: {p}% sa mga manok ({n}) ang magkauban sulod sa {m} ka minuto. Susiha ang temperatura.",
  ],
  "Mortality spike in {house}: {n} deaths today (previous: {p}).": [
    "Biglang pagdami ng namatay sa {house}: {n} ang namatay ngayon (dati: {p}).",
    "Kalit nga pagdaghan sa namatay sa {house}: {n} ang namatay karon (kaniadto: {p}).",
  ],
};
