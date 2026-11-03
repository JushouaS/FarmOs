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
};
