import { env } from "./config.js";
import { emailConfigured, sendMessage } from "./notify.js";

/**
 * The message a new person gets when an administrator makes (or resets) their account: the address
 * to sign in with, the temporary password, and when it stops working. The password is only in this
 * email; the database keeps a hash of it.
 */
export async function sendTemporaryPassword(opts: {
  email: string;
  password: string;
  expiresAt: Date;
  /** "new" for a new account, "reset" when an administrator set a new password. */
  reason: "new" | "reset";
}): Promise<{ sent: boolean; reason?: string }> {
  if (!emailConfigured()) return { sent: false, reason: "email_not_configured" };
  // Anything that goes wrong here is reported, never thrown: the account already exists by the time this runs.
  try {
    return await send(opts);
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message.slice(0, 200) : "send_failed" };
  }
}

async function send(opts: { email: string; password: string; expiresAt: Date; reason: "new" | "reset" }): Promise<{ sent: boolean; reason?: string }> {
  // timeStyle "long" includes the time zone, so the person reads the deadline in the right clock.
  const until = opts.expiresAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "long" });
  const intro =
    opts.reason === "new"
      ? "An administrator made an account for you on Cerebroil."
      : "An administrator set a new password for your Cerebroil account.";
  const text = [
    "Hello,",
    "",
    intro,
    "",
    `Sign in at: ${env.APP_URL}/login`,
    `Email: ${opts.email}`,
    `Temporary password: ${opts.password}`,
    "",
    `This password works until ${until} (${env.TEMP_PASSWORD_HOURS} hours from now). The first time you sign in you will be asked to choose your own password.`,
    "If it runs out first, ask your administrator for a new one.",
    "",
    "If you were not expecting this message, you can ignore it.",
    "",
  ].join("\n");
  const result = await sendMessage(opts.email, "Your Cerebroil sign-in", text);
  return result.ok ? { sent: true } : { sent: false, reason: result.reason ?? "send_failed" };
}
