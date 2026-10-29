import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ApiError, changePassword } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { AVATAR_ACCEPT, AVATAR_RULES, AvatarError, removeAvatar, saveAvatar, useAvatar } from "@/lib/avatar";
import { LANGUAGES, type Lang } from "@/lib/analysis-insights";
import { UserAvatar } from "./UserAvatar";
import { Block, Hint, NoteLine, SaveRow, Section, useSaver, type SaveNote } from "./SettingsParts";

/* Your own account: name, photo, the language the camera analysis speaks, and
 * your password. Each part saves on its own. */

/** "FARM_MANAGER" -> "Farm Manager" */
const roleName = (role: string) => role.toLowerCase().split("_").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");

/** The same rules the server applies (auth.ts validatePassword), so a weak one is caught before it is sent. */
function weaknesses(pw: string): string[] {
  const out: string[] = [];
  if (pw.length < 12) out.push("at least 12 characters");
  if (!/[A-Z]/.test(pw)) out.push("an uppercase letter");
  if (!/[a-z]/.test(pw)) out.push("a lowercase letter");
  if (!/[0-9]/.test(pw)) out.push("a number");
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pw)) out.push("a symbol");
  return out;
}

const Label = ({ htmlFor, children }: { htmlFor?: string; children: string }) => (
  <label htmlFor={htmlFor} className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
    {children}
  </label>
);

function NameBlock() {
  const { user, updateProfile } = useAuth();
  const saver = useSaver();
  const current = user?.fullName ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? current;
  const trimmed = value.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 160;
  const dirty = trimmed !== current;

  const save = async () => {
    if (!valid || !dirty) return;
    const ok = await saver.run(() => updateProfile({ fullName: trimmed }), "Saved.");
    if (ok) setDraft(null);
  };

  return (
    <Block>
      <Label htmlFor="account-name">Name</Label>
      <input
        id="account-name"
        value={value}
        onChange={(e) => {
          saver.setNote(null);
          setDraft(e.target.value);
        }}
        onKeyDown={(e) => e.key === "Enter" && save()}
        maxLength={160}
        autoComplete="name"
        aria-invalid={!valid}
        className="cb-input mt-1.5 block w-full text-sm"
      />
      <p className="mt-1.5 text-xs" style={{ color: "var(--text-tertiary)" }}>
        {user?.email}
        {user?.roles?.length ? ` · ${user.roles.map(roleName).join(", ")}` : ""}
      </p>
      {!valid && <Hint tone="error">Enter your name.</Hint>}
      <SaveRow onSave={save} busy={saver.busy} disabled={!valid || !dirty} note={saver.note} />
    </Block>
  );
}

function PhotoBlock() {
  const { user } = useAuth();
  const userKey = user?.id ?? user?.email ?? null;
  const photo = useAvatar(userKey);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<SaveNote>(null);

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // so choosing the same file again still fires
    if (!file || !userKey) return;
    setBusy(true);
    setNote(null);
    try {
      await saveAvatar(userKey, file);
      setNote({ ok: true, text: "Photo updated." });
    } catch (err) {
      setNote({ ok: false, text: err instanceof AvatarError ? err.message : "Something went wrong saving that photo." });
    } finally {
      setBusy(false);
    }
  };

  const onRemove = () => {
    if (!userKey) return;
    removeAvatar(userKey);
    setNote({ ok: true, text: "Photo removed." });
  };

  return (
    <Block>
      <Label>Photo</Label>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <div className="h-16 w-16 shrink-0">
          <UserAvatar user={user} className="text-xl" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="btn-primary tap disabled:opacity-50">
            {photo ? "Change photo" : "Add photo"}
          </button>
          {photo && (
            <button type="button" onClick={onRemove} className="tap text-sm font-semibold hover:underline" style={{ color: "var(--status-red-text)" }}>
              Remove
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept={AVATAR_ACCEPT} className="hidden" onChange={onPick} />
      </div>
      <p className="mt-2 text-xs" style={{ color: "var(--text-tertiary)" }}>
        {AVATAR_RULES} The photo is kept in this browser, so it does not follow you to another device.
      </p>
      {note && (
        <div className="mt-2">
          <NoteLine note={note} />
        </div>
      )}
    </Block>
  );
}

function LanguageBlock() {
  const { user, updateProfile } = useAuth();
  const saver = useSaver();
  const current: Lang = user?.analysisLanguage ?? "en";

  return (
    <Block>
      <Label>Camera analysis language</Label>
      <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
        The language the Live Camera analysis shows its results in. It follows your account to any device.
      </p>
      <div role="group" aria-label="Camera analysis language" className="mt-3 flex flex-wrap gap-2">
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            type="button"
            aria-pressed={current === l.code}
            disabled={saver.busy}
            onClick={() => {
              if (l.code !== current) saver.run(() => updateProfile({ analysisLanguage: l.code }), "Saved.");
            }}
            className={`tap rounded-full border px-3.5 py-1.5 text-sm font-medium disabled:opacity-60 ${
              current === l.code
                ? "border-[var(--brand)] bg-[var(--brand-muted)] text-[var(--brand)]"
                : "border-[var(--border-default)] bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {l.name}
          </button>
        ))}
      </div>
      {saver.note && (
        <div className="mt-2">
          <NoteLine note={saver.note} />
        </div>
      )}
    </Block>
  );
}

function PasswordBlock() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<SaveNote>(null);

  const missing = weaknesses(next);
  const mismatch = again !== "" && again !== next;
  const ready = current !== "" && next !== "" && missing.length === 0 && again === next;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setNote(null);
    try {
      await changePassword(current, next);
      // The API has signed every session out, this one included.
      setNote({ ok: true, text: "Password changed. Signing you out, then sign in with the new one." });
      window.setTimeout(async () => {
        await logout();
        navigate({ to: "/login" });
      }, 1600);
    } catch (err) {
      setBusy(false);
      setNote({
        ok: false,
        text:
          err instanceof ApiError
            ? err.status === 401
              ? "Your current password is not right."
              : (err.detail ?? "Could not change the password. Try again.")
            : "Could not change the password. Check the connection and try again.",
      });
    }
  };

  if (!open) {
    return (
      <Block>
        <Label>Password</Label>
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>Changing it signs you out everywhere.</p>
        <button type="button" onClick={() => setOpen(true)} className="tap mt-3 text-sm font-semibold hover:underline" style={{ color: "var(--brand)" }}>
          Change password
        </button>
      </Block>
    );
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void, autoComplete: string) => (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        type="password"
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => {
          setNote(null);
          set(e.target.value);
        }}
        className="cb-input mt-1.5 block w-full text-sm"
      />
    </div>
  );

  return (
    <Block>
      <form onSubmit={submit} className="space-y-3">
        <Label>Change password</Label>
        {field("pw-current", "Current password", current, setCurrent, "current-password")}
        {field("pw-new", "New password", next, setNext, "new-password")}
        {next !== "" && missing.length > 0 && <Hint tone="error">The new password needs {missing.join(", ")}.</Hint>}
        {field("pw-again", "New password again", again, setAgain, "new-password")}
        {mismatch && <Hint tone="error">The two new passwords are different.</Hint>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!ready || busy} className="btn-primary tap disabled:opacity-50">
            {busy ? "Changing…" : "Change password"}
          </button>
          <button type="button" onClick={() => { setOpen(false); setCurrent(""); setNext(""); setAgain(""); setNote(null); }}
            disabled={busy} className="tap text-sm font-semibold hover:underline" style={{ color: "var(--text-secondary)" }}>
            Cancel
          </button>
          <NoteLine note={note} />
        </div>
        <Hint>At least 12 characters, with an uppercase letter, a lowercase letter, a number and a symbol.</Hint>
      </form>
    </Block>
  );
}

export function AccountSection() {
  return (
    <Section title="Account">
      <NameBlock />
      <PhotoBlock />
      <LanguageBlock />
      <PasswordBlock />
    </Section>
  );
}
