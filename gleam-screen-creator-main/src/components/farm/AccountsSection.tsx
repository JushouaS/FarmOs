import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ApiError,
  createAccount,
  listAccounts,
  resetAccountPassword,
  setAccountActive,
  type AccountMail,
  type AccountRow,
} from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { Block, Hint, NoteLine, Section, type SaveNote } from "./SettingsParts";
import { weaknesses } from "./AccountSection";
import { T, localeTag, tr } from "@/lib/i18n";

/* Administrator only: add an account with an email and a temporary password, which is emailed to the new
 * person and stops working after a while; switch accounts off and on; set a new temporary password. */

const ROLES = [
  { code: "VIEWER", label: T("Viewer"), sub: T("Can watch and read.") },
  { code: "OPERATOR", label: T("Operator"), sub: T("Also enters weights, handles alerts and runs camera checks.") },
  { code: "FARM_MANAGER", label: T("Farm Manager"), sub: T("Also changes farm settings, closes incidents and makes reports.") },
  { code: "ADMIN", label: T("Admin"), sub: T("Everything, including accounts.") },
] as const;

const roleLabel = (code: string) => {
  const r = ROLES.find((x) => x.code === code);
  return r ? tr(r.label) : code;
};

const when = (iso: string) => new Date(iso).toLocaleString(localeTag(), { dateStyle: "medium", timeStyle: "short" });

/** What to tell the administrator after an account was made or its password reset. */
function mailNote(mail: AccountMail, email: string, created: boolean): SaveNote {
  const until = when(mail.expiresAt);
  if (mail.email_sent) {
    return {
      ok: true,
      text: created
        ? tr("Account created. The sign-in details were emailed to {email}. The password works until {until}.", { email, until })
        : tr("New password set and emailed to {email}. It works until {until}.", { email, until }),
    };
  }
  const why = mail.email_problem === "email_not_configured" ? tr("email is not set up on the server") : (mail.email_problem ?? tr("it could not be sent"));
  return {
    ok: false,
    text: created
      ? tr("Account created, but the email was not sent ({why}). Give {email} the password yourself; it works until {until}.", { why, email, until })
      : tr("New password set, but the email was not sent ({why}). Give {email} the password yourself; it works until {until}.", { why, email, until }),
  };
}

function problemText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.message === "email_taken") return tr("That email already has an account.");
    if (err.status === 403) return tr("Only an administrator can do this.");
    return err.detail ?? tr("Could not do that. Try again.");
  }
  return tr("Could not do that. Check the connection and try again.");
}

const Label = ({ htmlFor, children }: { htmlFor?: string; children: string }) => (
  <label htmlFor={htmlFor} className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
    {children}
  </label>
);

function AddAccount({ onCreated }: { onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("VIEWER");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<SaveNote>(null);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const missing = weaknesses(password);
  const ready = emailOk && password !== "" && missing.length === 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const mail = await createAccount(email.trim(), password, role);
      setNote(mailNote(mail, email.trim(), true));
      setEmail("");
      setPassword("");
      setRole("VIEWER");
      onCreated();
    } catch (err) {
      setNote({ ok: false, text: problemText(err) });
    } finally {
      setBusy(false);
    }
  };

  const roleSub = ROLES.find((r) => r.code === role)?.sub;

  return (
    <Block>
      <form onSubmit={submit} className="max-w-lg space-y-3">
        <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{tr("Add an account")}</h3>
        <div>
          <Label htmlFor="new-email">{tr("Email")}</Label>
          <input id="new-email" type="email" value={email} autoComplete="off" onChange={(e) => { setNote(null); setEmail(e.target.value); }}
            className="cb-input mt-1.5 block w-full text-sm" placeholder="name@example.com" />
        </div>
        <div>
          <Label htmlFor="new-role">{tr("Role")}</Label>
          <select id="new-role" value={role} onChange={(e) => setRole(e.target.value)} className="cb-input mt-1.5 block w-full text-sm">
            {ROLES.map((r) => <option key={r.code} value={r.code}>{tr(r.label)}</option>)}
          </select>
          {roleSub && <Hint>{tr(roleSub)}</Hint>}
        </div>
        <div>
          <Label htmlFor="new-password">{tr("Temporary password")}</Label>
          {/* Shown as typed: the administrator needs to know what was sent */}
          <input id="new-password" type="text" value={password} autoComplete="off" spellCheck={false}
            onChange={(e) => { setNote(null); setPassword(e.target.value); }} className="cb-input mt-1.5 block w-full font-mono text-sm" />
          {password !== "" && missing.length > 0 && <Hint tone="error">{tr("The password needs {missing}.", { missing: missing.join(", ") })}</Hint>}
          <Hint>{tr("It is emailed to the new person, works for a limited time, and must be replaced at their first sign-in.")}</Hint>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!ready || busy} className="btn-primary tap disabled:opacity-50">
            {busy ? tr("Creating…") : tr("Create account and send email")}
          </button>
          <NoteLine note={note} />
        </div>
      </form>
    </Block>
  );
}

function StatusChip({ row }: { row: AccountRow }) {
  let text: string;
  let color = "var(--status-green-text)";
  if (!row.isActive) {
    text = tr("Off");
    color = "var(--status-red-text)";
  } else if (row.mustChangePassword && row.passwordExpiresAt) {
    const expired = new Date(row.passwordExpiresAt).getTime() < Date.now();
    text = expired ? tr("Temporary password expired") : tr("Waiting for first sign-in, until {until}", { until: when(row.passwordExpiresAt) });
    color = expired ? "var(--status-amber-text)" : "var(--status-blue-text)";
  } else {
    text = tr("Active");
  }
  return <span className="text-xs font-semibold" style={{ color }}>{text}</span>;
}

function AccountItem({ row, isSelf, onChanged }: { row: AccountRow; isSelf: boolean; onChanged: () => void }) {
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<SaveNote>(null);
  const missing = weaknesses(password);

  const toggle = async () => {
    setBusy(true);
    setNote(null);
    try {
      await setAccountActive(row.id, !row.isActive);
      onChanged();
    } catch (err) {
      setNote({ ok: false, text: problemText(err) });
    } finally {
      setBusy(false);
    }
  };

  const reset = async (e: FormEvent) => {
    e.preventDefault();
    if (missing.length > 0 || password === "" || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const mail = await resetAccountPassword(row.id, password);
      setNote(mailNote(mail, row.email, false));
      setPassword("");
      setResetting(false);
      onChanged();
    } catch (err) {
      setNote({ ok: false, text: problemText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {row.email}{isSelf && <span className="ml-2 text-xs font-normal" style={{ color: "var(--text-tertiary)" }}>{tr("(you)")}</span>}
          </p>
          <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
            {row.roles.map(roleLabel).join(", ") || roleLabel(row.role)}
            {" · "}
            {row.lastLoginAt ? tr("Last sign-in {when}", { when: when(row.lastLoginAt) }) : tr("Never signed in")}
          </p>
          <div className="mt-1"><StatusChip row={row} /></div>
        </div>
        {!isSelf && (
          <div className="flex flex-wrap items-center gap-3 text-sm font-semibold">
            <button type="button" onClick={() => setResetting((v) => !v)} disabled={busy} className="tap hover:underline" style={{ color: "var(--brand)" }}>
              {tr("Set new password")}
            </button>
            <button type="button" onClick={toggle} disabled={busy} className="tap hover:underline"
              style={{ color: row.isActive ? "var(--status-red-text)" : "var(--brand)" }}>
              {row.isActive ? tr("Switch off") : tr("Switch on")}
            </button>
          </div>
        )}
      </div>

      {resetting && (
        <form onSubmit={reset} className="mt-3 max-w-lg space-y-2 rounded-xl p-3" style={{ background: "var(--surface-raised)" }}>
          <Label htmlFor={`reset-${row.id}`}>{tr("New temporary password")}</Label>
          <input id={`reset-${row.id}`} type="text" value={password} autoComplete="off" spellCheck={false}
            onChange={(e) => setPassword(e.target.value)} className="cb-input block w-full font-mono text-sm" />
          {password !== "" && missing.length > 0 && <Hint tone="error">{tr("The password needs {missing}.", { missing: missing.join(", ") })}</Hint>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy || password === "" || missing.length > 0} className="btn-primary tap disabled:opacity-50">
              {busy ? tr("Setting…") : tr("Set and send email")}
            </button>
            <button type="button" onClick={() => { setResetting(false); setPassword(""); }} className="tap text-sm font-semibold hover:underline"
              style={{ color: "var(--text-secondary)" }}>
              {tr("Cancel")}
            </button>
          </div>
        </form>
      )}
      {note && <div className="mt-2"><NoteLine note={note} /></div>}
    </li>
  );
}

export function AccountsSection() {
  const { user } = useAuth();
  const [rows, setRows] = useState<AccountRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await listAccounts());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Section title={tr("Accounts")}>
      <AddAccount onCreated={load} />
      {failed && (
        <Block>
          <p className="text-sm" style={{ color: "var(--status-red-text)" }}>{tr("The list of accounts could not be loaded.")}</p>
        </Block>
      )}
      {rows && (
        <ul className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
          {rows.map((row) => (
            <AccountItem key={row.id} row={row} isSelf={row.id === user?.id} onChanged={load} />
          ))}
        </ul>
      )}
    </Section>
  );
}
