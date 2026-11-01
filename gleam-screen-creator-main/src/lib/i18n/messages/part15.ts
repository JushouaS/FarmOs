import type { Messages } from "./types";

/** Analytics > Flock Conditions: the merged Feed & Water and Behavior cards. */
export const part15: Messages = {
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
  "The share of the birds packed into a huddle: a group of 5 or more touching birds that stays together. A bird in a clump that forms and breaks up again does not count.": [
    "Ang bahagi ng mga manok na nagsisiksikan sa isang pangkat: 5 o higit pang magkakadikit na manok na nananatiling magkasama. Hindi binibilang ang pagkumpol na nabubuo at agad ding naghihiwalay.",
    "Ang bahin sa mga manok nga nagpundok sa usa ka grupo: 5 o labaw pa nga nagdikit nga manok nga magpabilin nga magkauban. Dili ihapon ang pagpundok nga mabuo ug dayon mabungkag.",
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
