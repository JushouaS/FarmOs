import type { Messages } from "./types";

/** The Live Camera cards that now show real data, or say that there is none. */
export const part25: Messages = {
  "No reading": ["Walang nabasa", "Walay mabasa"],
  "No weights yet. They appear when the Kinect picture is open and chickens are in view.": [
    "Wala pang timbang. Lalabas ito kapag bukas ang larawan ng Kinect at may nakikitang manok.",
    "Wala pay gibug-aton. Mugawas kini kon bukas ang hulagway sa Kinect ug adunay makitang manok.",
  ],
  "{n} birds weighed from the Kinect picture. Average {avg} g.": [
    "{n} manok ang natimbang mula sa larawan ng Kinect. Average na {avg} g.",
    "{n} ka manok ang natimbang gikan sa hulagway sa Kinect. Average nga {avg} g.",
  ],
  "Behavior monitoring is off. Turn it on at the camera computer (LIVE_BEHAVIOR=1) to see this.": [
    "Naka-off ang pagsubaybay sa kilos. I-on ito sa computer ng camera (LIVE_BEHAVIOR=1) para makita ito.",
    "Gipalong ang pagsubay sa lihok. I-on kini sa kompyuter sa camera (LIVE_BEHAVIOR=1) aron makita kini.",
  ],
  "{n} birds followed by the live monitor.": ["{n} manok ang sinusubaybayan ng live monitor.", "{n} ka manok ang gisubay sa live monitor."],
  "The average of the readings the house sensor stored on each day. The shaded band on the line is the acceptable range ({min}–{max}{unit}); the line shows the days that have readings.": [
    "Ang average ng mga nabasa ng sensor ng bahay sa bawat araw. Ang may kulay na banda sa linya ay ang katanggap-tanggap na saklaw ({min}–{max}{unit}); ang linya ay nagpapakita ng mga araw na may nabasa.",
    "Ang average sa mga nabasa sa sensor sa balay matag adlaw. Ang may kolor nga banda sa linya mao ang madawat nga sakup ({min}–{max}{unit}); ang linya nagpakita sa mga adlaw nga adunay nabasa.",
  ],
  "Average on {date} · lowest {lo}{unit}, highest {hi}{unit}": [
    "Average noong {date} · pinakamababa {lo}{unit}, pinakamataas {hi}{unit}",
    "Average niadtong {date} · labing ubos {lo}{unit}, labing taas {hi}{unit}",
  ],
  "No readings yet. The sensor on the camera computer saves one every minute once it is connected.": [
    "Wala pang nabasa. Nagse-save ang sensor sa computer ng camera ng isa bawat minuto kapag nakakonekta na ito.",
    "Wala pay nabasa. Ang sensor sa kompyuter sa camera nag-save og usa matag minuto kon konektado na kini.",
  ],
  "Check birds that stay still for a long time": ["Tingnan ang mga manok na matagal na hindi gumagalaw", "Tan-awa ang mga manok nga dugay na wala molihok"],
  "Average weight is behind the target": ["Mas mababa ang average na timbang kaysa sa target", "Mas ubos ang average nga gibug-aton kay sa target"],
  "{n} birds have stayed still. Check on them.": ["{n} manok ang hindi gumagalaw. Tingnan sila.", "{n} ka manok ang wala molihok. Tan-awa sila."],
  "{n} birds are huddled together.": ["{n} manok ang magkakadikit.", "{n} ka manok ang nagdinaganan."],
  "No insight yet. Press Refresh to write one from the flock's current data.": [
    "Wala pang insight. Pindutin ang Refresh para gumawa nito mula sa kasalukuyang datos ng kawan.",
    "Wala pay insight. Pindota ang Refresh aron makahimo niini gikan sa karon nga datos sa panon.",
  ],
  "Grow-out Status": ["Katayuan ng Grow-out", "Kahimtang sa Grow-out"],
  "Weighed on Day {day}, {n} birds on the scale.": ["Natimbang noong Day {day}, {n} manok sa timbangan.", "Natimbang niadtong Day {day}, {n} ka manok sa timbangan."],
  "Weighed on Day {day}.": ["Natimbang noong Day {day}.", "Natimbang niadtong Day {day}."],
  " Enter today's weights on Flock Tracking to update it.": [" Ilagay ang mga timbang ngayon sa Flock Tracking para ma-update ito.", " Ibutang ang mga gibug-aton karon sa Flock Tracking aron ma-update kini."],
  "No weight measured yet. Type in the weights of a few birds on Flock Tracking and the average shows here.": [
    "Wala pang nasusukat na timbang. Ilagay ang timbang ng ilang manok sa Flock Tracking at lalabas dito ang average.",
    "Wala pay nasukod nga gibug-aton. Ibutang ang gibug-aton sa pipila ka manok sa Flock Tracking ug mugawas dinhi ang average.",
  ],
  "Kinect is not connected": ["Hindi nakakonekta ang Kinect", "Wala konektado ang Kinect"],
  "The Kinect picture and the bird weights appear when the Kinect bridge is running on the computer it is plugged into. This page keeps trying.": [
    "Lalabas ang larawan ng Kinect at ang timbang ng mga manok kapag tumatakbo ang Kinect bridge sa computer na nakasaksak ito. Patuloy na sumusubok ang pahinang ito.",
    "Mugawas ang hulagway sa Kinect ug ang gibug-aton sa mga manok kon nagdagan ang Kinect bridge sa kompyuter diin kini gisaksak. Padayon nga misulay kini nga panid.",
  ],
  "{n} min": ["{n} min", "{n} min"],
  "{n} h": ["{n} oras", "{n} ka oras"],
  "{n} days": ["{n} araw", "{n} ka adlaw"],
  "Sensor offline · last reading {ago} ago": ["Offline ang sensor · huling basa {ago} ang nakalipas", "Offline ang sensor · katapusang basa {ago} ang milabay"],
  "Pi CSV History": ["Kasaysayan ng Pi CSV", "Kasaysayan sa Pi CSV"],
  "Raw historical readings from Pi CSVs; these are not welfare classifications.": [
    "Mga raw na dating sukat mula sa Pi CSV; hindi ito mga klasipikasyon ng kalagayan ng mga manok.",
    "Mga raw nga kanhing sukod gikan sa Pi CSV; dili kini klasipikasyon sa kahimtang sa mga manok.",
  ],
  "Daily sensor records": [
    "Pang-araw-araw na tala ng sensor",
    "Adlaw-adlaw nga mga rekord sa sensor",
  ],
  "Daily average, range, and number of readings. Days without readings are omitted.": [
    "Pang-araw-araw na average, saklaw, at bilang ng mga sukat. Hindi ipinapakita ang mga araw na walang sukat.",
    "Adlaw-adlaw nga average, sakup, ug gidaghanon sa mga sukod. Dili ipakita ang mga adlaw nga walay sukod.",
  ],
  Period: ["Panahon", "Panahon"],
  "History period": ["Panahon ng kasaysayan", "Panahon sa kasaysayan"],
  "Could not load daily sensor records: {reason}": [
    "Hindi ma-load ang pang-araw-araw na tala ng sensor: {reason}",
    "Dili ma-load ang adlaw-adlaw nga mga rekord sa sensor: {reason}",
  ],
  "Loading daily records…": [
    "Nilo-load ang pang-araw-araw na tala…",
    "Nag-load sa adlaw-adlaw nga mga rekord…",
  ],
  "No daily readings in this period.": [
    "Walang pang-araw-araw na sukat sa panahong ito.",
    "Walay adlaw-adlaw nga mga sukod niining panahona.",
  ],
  Date: ["Petsa", "Petsa"],
  Temperature: ["Temperatura", "Temperatura"],
  Humidity: ["Halumigmig", "Humidity"],
  "Average: {avg}{unit}": ["Average: {avg}{unit}", "Average: {avg}{unit}"],
  "Range: {min}–{max}{unit} · {count} readings": [
    "Saklaw: {min}–{max}{unit} · {count} sukat",
    "Sakup: {min}–{max}{unit} · {count} ka sukod",
  ],
  "Could not load Pi CSV history": ["Hindi ma-load ang kasaysayan ng Pi CSV", "Dili ma-load ang kasaysayan sa Pi CSV"],
  "Loading history…": ["Naglo-load ng kasaysayan…", "Nag-load sa kasaysayan…"],
  "Ammonia (ppm)": ["Ammonia (ppm)", "Ammonia (ppm)"],
  "No ammonia CSV rows in the last 30 days.": [
    "Walang ammonia CSV record sa nakaraang 30 araw.",
    "Walay ammonia CSV record sa milabay nga 30 ka adlaw.",
  ],
  "Behavior tracker": ["Tagasubaybay ng kilos", "Tig-subay sa lihok"],
  "No behavior CSV rows in the last 30 days.": [
    "Walang behavior CSV record sa nakaraang 30 araw.",
    "Walay behavior CSV record sa milabay nga 30 ka adlaw.",
  ],
  "{birds} birds · {still} still · {huddled} huddled": [
    "{birds} manok · {still} hindi gumagalaw · {huddled} magkakadikit",
    "{birds} ka manok · {still} wala molihok · {huddled} nagdinaganan",
  ],
  "Moving {moving} · huddle share {huddle}": [
    "Gumagalaw {moving} · bahagi ng huddle {huddle}",
    "Naglihok {moving} · bahin sa huddle {huddle}",
  ],
};
