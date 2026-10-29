import { useEffect, useState, type FormEvent, type RefObject } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, submitReport } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";

/* "Report a problem": a short note about what went wrong. Once it is sent, the
 * same dialog turns into a pop up asking whether the person also wants to
 * answer the usability survey (SUS), which is its own form (SusDialog). */

const inputClass =
  "w-full rounded-xl border border-[color:var(--border-default)] bg-[color:var(--surface-raised)] px-3 py-2.5 text-sm " +
  "text-[color:var(--text-primary)] placeholder:text-[color:var(--text-tertiary)] " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--brand)]";

const buttonBase =
  "tap inline-flex items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--brand)]";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when the person says yes to the survey; carries the name and role they typed. */
  onAnswerSurvey: (who: { respondent: string; role: string }) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

export function ReportDialog({ open, onOpenChange, onAnswerSurvey, returnFocusRef }: Props) {
  const { refresh } = useAuth();
  const [problem, setProblem] = useState("");
  const [respondent, setRespondent] = useState("");
  const [role, setRole] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // Every time the dialog opens it starts from a blank form.
  useEffect(() => {
    if (!open) return;
    setProblem("");
    setRespondent("");
    setRole("");
    setSending(false);
    setError(null);
    setSent(false);
  }, [open]);

  const send = () =>
    submitReport({
      problem: problem.trim(),
      respondent: respondent.trim() || undefined,
      role: role.trim() || undefined,
      page: typeof window !== "undefined" ? window.location.pathname : undefined,
    });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (sending) return;
    if (!problem.trim()) {
      setError("Describe the problem before sending.");
      document.getElementById("report-problem")?.focus();
      return;
    }

    setSending(true);
    setError(null);
    try {
      try {
        await send();
      } catch (err) {
        // The 15 minute access session may have lapsed while the form was open.
        if (err instanceof ApiError && err.status === 401 && (await refresh())) {
          await send();
        } else {
          throw err;
        }
      }
      setSent(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "Your session ended. Sign in again, then send your report."
          : err instanceof ApiError && err.status === 429
            ? "Too many reports sent recently. Please try again later."
            : "Your report could not be sent. Check your connection and try again.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (returnFocusRef?.current) {
            event.preventDefault();
            returnFocusRef.current.focus();
          }
        }}
        className="flex max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-md flex-col gap-0 overflow-hidden rounded-3xl border-[color:var(--border-default)] bg-[color:var(--surface-card)] p-0 text-[color:var(--text-primary)] shadow-[var(--shadow-elev-3)] sm:rounded-3xl"
      >
        {sent ? (
          <div className="flex flex-col items-center px-6 pb-6 pt-10 text-center">
            <CheckCircle2 className="h-10 w-10" style={{ color: "var(--status-green-text)" }} aria-hidden="true" />
            <DialogTitle className="mt-4 font-display text-xl">Report sent</DialogTitle>
            <DialogDescription className="mt-2 max-w-xs">
              We will take this into consideration to improve our service.
            </DialogDescription>
            <p className="mt-6 text-sm font-medium">Would you also like to answer a short usability survey?</p>
            <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
              It is ten quick statements about the system and takes about two minutes.
            </p>
            <div className="mt-6 flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className={`${buttonBase} border border-[color:var(--border-strong)] hover:bg-[color:var(--surface-raised)]`}
              >
                Not now
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => onAnswerSurvey({ respondent: respondent.trim(), role: role.trim() })}
                className={`${buttonBase} bg-[color:var(--brand)] text-white hover:opacity-90`}
              >
                Answer the survey
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogHeader className="px-5 pb-3 pr-12 pt-5 text-left">
              <DialogTitle className="font-display text-xl">Report a problem</DialogTitle>
              <DialogDescription>Tell us what went wrong so it can be fixed.</DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto border-y border-[color:var(--border-default)] px-5 py-4">
              <div>
                <label htmlFor="report-problem" className="text-sm font-medium">
                  What went wrong?
                </label>
                <textarea
                  id="report-problem"
                  value={problem}
                  onChange={(e) => {
                    setProblem(e.target.value);
                    if (error) setError(null);
                  }}
                  maxLength={2000}
                  rows={5}
                  placeholder="Describe the problem and the page where it happened."
                  aria-invalid={error && !problem.trim() ? true : undefined}
                  className={`${inputClass} mt-1.5 resize-y`}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="report-respondent" className="text-sm font-medium">
                    Name or code <span style={{ color: "var(--text-tertiary)" }}>(optional)</span>
                  </label>
                  <input
                    id="report-respondent"
                    value={respondent}
                    onChange={(e) => setRespondent(e.target.value)}
                    maxLength={80}
                    autoComplete="off"
                    placeholder="Leave blank to stay anonymous"
                    className={`${inputClass} mt-1.5`}
                  />
                </div>
                <div>
                  <label htmlFor="report-role" className="text-sm font-medium">
                    Your role <span style={{ color: "var(--text-tertiary)" }}>(optional)</span>
                  </label>
                  <input
                    id="report-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    maxLength={80}
                    autoComplete="off"
                    placeholder="For example, farm manager"
                    className={`${inputClass} mt-1.5`}
                  />
                </div>
              </div>
            </div>

            <div className="px-5 py-4">
              {error && (
                <p role="alert" className="mb-3 text-sm" style={{ color: "var(--status-red-text)" }}>
                  {error}
                </p>
              )}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className={`${buttonBase} border border-[color:var(--border-strong)] font-medium hover:bg-[color:var(--surface-raised)]`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sending}
                  className={`${buttonBase} bg-[color:var(--brand)] text-white hover:opacity-90 disabled:opacity-60`}
                >
                  {sending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {sending ? "Sending…" : "Send report"}
                </button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
