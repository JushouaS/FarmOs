import { T } from "@/lib/i18n";

/**
 * The Privacy Policy text, in plain language, as sections of paragraphs and bullet lists.
 * Each sentence goes through T() so it can be translated.
 *
 * Keep it true to what the system really does. When it changes in a way that matters, bump
 * PRIVACY_VERSION in packages/api/src/routes/auth.ts so everyone is asked to agree again,
 * and update POLICY_UPDATED in privacy-version.ts.
 */

export { POLICY_UPDATED } from "./privacy-version";

export interface PolicySection {
  id: string;
  title: string;
  /** Paragraphs shown before the list, if any. */
  intro?: string;
  items?: string[];
  /** Paragraph shown after the list, if any. */
  outro?: string;
}

export const POLICY_SECTIONS: PolicySection[] = [
  {
    id: "covers",
    title: T("What this notice covers"),
    intro: T(
      "Cerebroil is a system for watching over a broiler flock: cameras, sensors and this web app. This notice explains what personal information the system handles, why, and what you can do about it. It is written with the Philippine Data Privacy Act of 2012 (Republic Act 10173) in mind.",
    ),
  },
  {
    id: "collect",
    title: T("What we collect"),
    items: [
      T("Your account: your name, your email or username, your role, and your password. The password is stored only as a one-way scramble (a hash), never as plain text."),
      T("Your photo, if you add one to your account."),
      T("Sign-in records: when you sign in or out, the device and browser you used, and the network address (IP address)."),
      T("Your settings: your language, and how you want to hear about alerts (email address, quiet hours, browser notifications)."),
      T("Browser notifications: if you turn them on, an address your browser gives the system so it can send you alerts."),
      T("Feedback: a problem report or a usability survey you send is saved with the name or code you type. It does not need your email."),
    ],
  },
  {
    id: "cameras",
    title: T("Cameras and sensors"),
    intro: T(
      "The cameras look at the birds in the poultry house. The system counts and follows the birds and estimates their weight and behaviour. It does not try to recognise people, but a person who walks in front of a camera can still appear in the picture.",
    ),
    items: [
      T("The video is analysed on the camera computer. The system keeps the results (counts, weights, alerts), not a recording of the video as part of its normal work."),
      T("Sensor readings such as temperature, humidity and ammonia describe the house, not people."),
    ],
  },
  {
    id: "why",
    title: T("Why we use it"),
    items: [
      T("To let you sign in and see only what your role allows."),
      T("To raise alerts about the flock and the house, and to tell you about them the way you chose."),
      T("To keep a record of sign-ins, so that unusual activity can be checked."),
      T("To improve the system from the feedback you send."),
    ],
    outro: T("We do not sell your information and we do not use it for advertising."),
  },
  {
    id: "share",
    title: T("Who can see it"),
    items: [
      T("People who have an account on this farm's system, depending on their role. An administrator can see the list of accounts."),
      T("Outside services, only to do what you asked: an email service to send alert emails, and your browser's push service to deliver browser notifications."),
      T("Feedback you send may also be copied to the owner's Google Drive."),
    ],
  },
  {
    id: "keep",
    title: T("How long we keep it"),
    intro: T(
      "Your account details are kept while your account exists. A sign-in lasts until you sign out or it expires. Sign-in records are kept so that unusual activity can be checked. When you no longer need access, ask an administrator to close your account and remove your details.",
    ),
  },
  {
    id: "protect",
    title: T("How we protect it"),
    items: [
      T("Passwords are stored as hashes, and you can add a second step to sign in."),
      T("Your sign-in is kept in a secure cookie that scripts on the page cannot read."),
      T("What you can open depends on your role."),
    ],
    outro: T("Please keep your password private, and sign out on a shared device."),
  },
  {
    id: "rights",
    title: T("Your rights"),
    intro: T(
      "Under the Data Privacy Act you can ask to see the information held about you, to correct it, to object to how it is used, and to have it deleted or blocked where the law allows. You can take back this agreement at any time by asking an administrator to close your account. If you feel your rights were not respected, you may complain to the National Privacy Commission.",
    ),
  },
  {
    id: "contact",
    title: T("Questions"),
    intro: T("For any question about this notice or your information, use the Contact page."),
  },
  {
    id: "changes",
    title: T("If this notice changes"),
    intro: T("If it changes in a way that matters, you will be asked to read it and agree again the next time you sign in."),
  },
];

/** The short version shown on the agreement screen, before the link to the full notice. */
export const POLICY_SUMMARY: string[] = [
  T("We keep your name, your email or username, your role, and a record of when and where you sign in."),
  T("The cameras watch the birds, not people. The system keeps results (counts, weights, alerts), not video recordings."),
  T("We do not sell your information. It is shared only to send the alerts you asked for."),
  T("You can ask to see, correct or delete your information at any time."),
];
