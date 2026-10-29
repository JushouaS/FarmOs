/** The inbox that account requests and support messages go to. */
export const ADMIN_EMAIL = "santos.jushouaoswald22@gmail.com";

/**
 * A link that opens a new message in Gmail's compose window, addressed to the
 * admin, with the subject and text already filled in. Unlike a mailto: link it
 * goes straight to Gmail instead of whatever mail app the computer has set.
 */
export function gmailComposeUrl({ subject, body }: { subject: string; body?: string }): string {
  const params = new URLSearchParams({ view: "cm", fs: "1", to: ADMIN_EMAIL, su: subject });
  if (body) params.set("body", body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}
