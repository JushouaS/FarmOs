import type { Messages } from "./types";

/** Words and sentences that come from the data (statuses, alert kinds and the alert texts the database holds). */
export const part7: Messages = {
  Inactivity: ["Kawalan ng Kilos", "Kawalay Lihok"],
  Sleeping: ["Natutulog", "Natulog"],
  "Feed cycle": ["Siklo ng pakain", "Siklo sa pakaon"],
  "Env report": ["Ulat sa kapaligiran", "Report sa kalikopan"],
  "Deviation log": ["Talaan ng paglihis", "Rekord sa paglihis"],
  "Critical event": ["Kritikal na pangyayari", "Kritikal nga panghitabo"],
  "Inactive Bird": ["Manok na Hindi Aktibo", "Manok nga Dili Aktibo"],
  "High Temperature": ["Mataas na Temperatura", "Taas nga Temperatura"],
  "Low Weight Flag": ["Marka ng Mababang Timbang", "Marka sa Ubos nga Gibug-aton"],
  "System Sync": ["Pag-sync ng Sistema", "Pag-sync sa Sistema"],
  "Huddling Detected": ["Natukoy ang Pagsisiksikan", "Nakita ang Pagpundok"],
  "Feed cycle 04 completed. Consumed 1,420 kg.": ["Natapos ang siklo ng pakain 04. Nakonsumo: 1,420 kg.", "Nahuman ang siklo sa pakaon 04. Nakonsumo: 1,420 kg."],
  "Humidity sensor SN-242-H4 recalibrated automatically.": [
    "Awtomatikong na-recalibrate ang sensor ng halumigmig na SN-242-H4.",
    "Awtomatikong na-recalibrate ang sensor sa kaumog nga SN-242-H4.",
  ],
  "Weight deviation (-1.3% vs standard) in SEC_B cohort. Sampling rate adjusted.": [
    "Paglihis ng timbang (-1.3% kumpara sa standard) sa pangkat na SEC_B. Inayos ang bilis ng pagkuha ng sample.",
    "Paglihis sa gibug-aton (-1.3% kon itandi sa standard) sa grupo nga SEC_B. Giusab ang gikusgon sa pagkuha og sample.",
  ],
  "Activity drop 15.4% detected in House 02. Sensor redundancy verified.": [
    "Natukoy ang pagbaba ng kilos nang 15.4% sa House 02. Napatunayan ang redundancy ng sensor.",
    "Nakita ang pagkunhod sa lihok nga 15.4% sa House 02. Napamatud-an ang redundancy sa sensor.",
  ],
};
