import { useRef, useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Camera, ClipboardList, ImagePlus, LogOut, MessageSquareWarning, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserAvatar } from "./UserAvatar";
import { ReportDialog } from "./ReportDialog";
import { SusDialog } from "./SusDialog";
import { useAuth } from "@/lib/auth-context";
import { AVATAR_ACCEPT, AVATAR_RULES, AvatarError, removeAvatar, saveAvatar, useAvatar } from "@/lib/avatar";

/* Account menu: opens from the top bar's avatar, in the shape of Google's
 * account card. A tinted sheet holds the person (email, photo with a camera
 * badge, greeting, role); one pill goes to settings; a second, lighter group
 * holds the actions. The photo is the person's own upload (see lib/avatar.ts).
 * Popover behaviour (Escape, outside click, staying on screen, focus) comes
 * from the Radix popover the project already wraps. */

const rowClass =
  "tap flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium " +
  "text-[color:var(--text-primary)] transition-colors hover:bg-[color:var(--surface-raised)] " +
  "focus-visible:bg-[color:var(--surface-raised)] focus-visible:outline-2 focus-visible:-outline-offset-2 " +
  "focus-visible:outline-[color:var(--brand)] disabled:opacity-50";

/** "FARM_MANAGER" -> "Farm Manager" */
function roleLabel(role: string | undefined): string {
  if (!role) return "Member";
  return role
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function AccountMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const userKey = user?.id ?? user?.email ?? null;
  const photo = useAvatar(userKey);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // Report a problem and the usability survey (SUS) are separate forms; a sent
  // report offers the survey and hands over the name and role it collected.
  const [reportOpen, setReportOpen] = useState(false);
  const [surveyOpen, setSurveyOpen] = useState(false);
  const [surveyWho, setSurveyWho] = useState({ respondent: "", role: "" });
  const fileRef = useRef<HTMLInputElement>(null);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const avatarBtnRef = useRef<HTMLButtonElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const name = user?.fullName ?? user?.email ?? "Farm Manager";
  const firstName = user?.fullName?.trim().split(/\s+/)[0] ?? user?.email?.split("@")[0] ?? "there";

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setMessage(null);
      setChoiceOpen(false);
    }
  };

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // so choosing the same file again still fires
    if (!file || !userKey) return;
    setBusy(true);
    setMessage(null);
    try {
      await saveAvatar(userKey, file);
      setMessage({ kind: "ok", text: "Profile photo updated." });
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof AvatarError ? err.message : "Something went wrong saving that photo.",
      });
    } finally {
      setBusy(false);
    }
  };

  const onAvatarPress = () => {
    if (!photo) {
      fileRef.current?.click();
      return;
    }
    const next = !choiceOpen;
    setChoiceOpen(next);
    if (next) requestAnimationFrame(() => changeRef.current?.focus());
  };

  const onChange = () => {
    setChoiceOpen(false);
    fileRef.current?.click();
  };

  const onRemove = () => {
    if (!userKey) return;
    removeAvatar(userKey);
    setChoiceOpen(false);
    setMessage({ kind: "ok", text: "Profile photo removed." });
    // The choice buttons are about to unmount; keep keyboard focus in the menu.
    requestAnimationFrame(() => avatarBtnRef.current?.focus());
  };

  const onReport = () => {
    setOpen(false);
    setReportOpen(true);
  };

  const onSurvey = () => {
    setOpen(false);
    setSurveyWho({ respondent: "", role: "" });
    setSurveyOpen(true);
  };

  const onAnswerSurvey = (who: { respondent: string; role: string }) => {
    setReportOpen(false);
    setSurveyWho(who);
    setSurveyOpen(true);
  };

  const onSignOut = async () => {
    setOpen(false);
    await logout();
    navigate({ to: "/login" });
  };

  return (
    <>
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className="relative h-8 w-8 shrink-0 rounded-full shadow-xs transition-transform active:scale-95 pointer-coarse:h-11 pointer-coarse:w-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--brand)]"
          aria-label={`Account menu for ${name}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={name}
        >
          <UserAvatar user={user} className="text-xs pointer-coarse:text-sm" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={10}
        collisionPadding={12}
        aria-label="Account"
        className="w-[min(22rem,calc(100vw-1.5rem))] rounded-[28px] border border-[color:var(--border-default)] bg-[color:var(--surface-raised)] p-2 text-[color:var(--text-primary)] shadow-[var(--shadow-elev-3)]"
      >
        {/* The person */}
        <div className="flex flex-col items-center px-4 pb-5 pt-4 text-center">
          <p className="max-w-full truncate text-sm" style={{ color: "var(--text-secondary)" }}>
            {user?.email ?? name}
          </p>

          {/* One target for the whole photo: no photo yet opens the file picker,
              a saved photo asks whether to change or delete it. */}
          <button
            ref={avatarBtnRef}
            type="button"
            onClick={onAvatarPress}
            disabled={busy}
            className="relative mt-4 h-20 w-20 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--brand)] disabled:opacity-60"
            aria-label={photo ? "Profile photo options" : "Add profile photo"}
            aria-expanded={photo ? choiceOpen : undefined}
            title={photo ? "Change or delete your photo" : "Add a profile photo"}
          >
            <UserAvatar user={user} className="text-3xl" />
            <span
              aria-hidden="true"
              className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--border-default)] bg-[color:var(--surface-card)] text-[color:var(--text-secondary)] shadow-sm"
            >
              <Camera className="h-4 w-4" />
            </span>
          </button>

          {photo && choiceOpen && (
            <div role="group" aria-label="Profile photo" className="mt-3 grid w-full grid-cols-2 gap-2">
              <button
                ref={changeRef}
                type="button"
                onClick={onChange}
                className="tap inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-[color:var(--border-strong)] bg-[color:var(--surface-card)] px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[color:var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--brand)]"
              >
                <ImagePlus className="h-4 w-4" aria-hidden="true" />
                Change photo
              </button>
              <button
                type="button"
                onClick={onRemove}
                className="tap inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-[color:var(--border-strong)] bg-[color:var(--surface-card)] px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[color:var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--brand)]"
                style={{ color: "var(--status-red-text)" }}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Delete photo
              </button>
            </div>
          )}

          <h2 className="mt-4 font-display text-2xl font-semibold tracking-tight">Hi, {firstName}!</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-tertiary)" }}>
            {roleLabel(user?.roles?.[0])}
          </p>

          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className="tap mt-4 inline-flex items-center justify-center rounded-full border border-[color:var(--border-strong)] px-5 py-2 text-sm font-medium transition-colors hover:bg-[color:var(--surface-card)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--brand)]"
          >
            Account settings
          </Link>
        </div>

        {/* Actions */}
        <div className="rounded-3xl bg-[color:var(--surface-card)] p-1.5">
          <input
            ref={fileRef}
            type="file"
            accept={AVATAR_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={onPick}
          />
          <button type="button" className={rowClass} onClick={onReport}>
            <MessageSquareWarning className="h-4 w-4 shrink-0" style={{ color: "var(--text-secondary)" }} />
            Report a problem
          </button>
          <button type="button" className={rowClass} onClick={onSurvey}>
            <ClipboardList className="h-4 w-4 shrink-0" style={{ color: "var(--text-secondary)" }} />
            Usability survey
          </button>
          <button type="button" className={rowClass} onClick={onSignOut}>
            <LogOut className="h-4 w-4 shrink-0" style={{ color: "var(--text-secondary)" }} />
            Sign out
          </button>
        </div>

        {/* Upload feedback: errors interrupt (alert), successes are polite (status) */}
        {message && (
          <p
            role={message.kind === "error" ? "alert" : "status"}
            className="px-4 pb-2 pt-3 text-center text-xs"
            style={{ color: message.kind === "error" ? "var(--status-red-text)" : "var(--status-green-text)" }}
          >
            {message.text}
          </p>
        )}
        <p className="px-4 pb-2 pt-3 text-center text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          {AVATAR_RULES} Saved in this browser only.
        </p>
      </PopoverContent>
    </Popover>

    {/* Outside the popover so it can close while the forms stay open. */}
    <ReportDialog
      open={reportOpen}
      onOpenChange={setReportOpen}
      onAnswerSurvey={onAnswerSurvey}
      returnFocusRef={triggerRef}
    />
    <SusDialog
      open={surveyOpen}
      onOpenChange={setSurveyOpen}
      returnFocusRef={triggerRef}
      initialRespondent={surveyWho.respondent}
      initialRole={surveyWho.role}
    />
    </>
  );
}
