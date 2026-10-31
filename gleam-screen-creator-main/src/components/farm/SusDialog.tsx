import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, submitSus } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { T, tr } from "@/lib/i18n";

/* The System Usability Scale (SUS) questionnaire: ten statements answered from
 * 1 (strongly disagree) to 5 (strongly agree), in the standard order because the
 * score depends on it. It is separate from "Report a problem", but a report can
 * hand its name and role over so they are not typed twice. Answers go to the
 * API, which appends them to a CSV (see packages/api/src/routes/feedback.ts). */

export const SUS_STATEMENTS = [
  T("I think that I would like to use this system frequently."),
  T("I found the system unnecessarily complex."),
  T("I thought the system was easy to use."),
  T("I think that I would need the support of a technical person to be able to use this system."),
  T("I found the various functions in this system were well integrated."),
  T("I thought there was too much inconsistency in this system."),
  T("I would imagine that most people would learn to use this system very quickly."),
  T("I found the system very cumbersome to use."),
  T("I felt very confident using the system."),
  T("I needed to learn a lot of things before I could get going with this system."),
] as const;

const SCALE = [1, 2, 3, 4, 5] as const;
const SCALE_WORDS = [T("Strongly disagree"), T("Disagree"), T("Neutral"), T("Agree"), T("Strongly agree")];

const inputClass =
  "w-full rounded-xl border border-[color:var(--border-default)] bg-[color:var(--surface-raised)] px-3 py-2.5 text-sm " +
  "text-[color:var(--text-primary)] placeholder:text-[color:var(--text-tertiary)] " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--brand)]";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where keyboard focus goes when the dialog closes (the menu that opened it is gone by then). */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Filled in when the survey follows a problem report. */
  initialRespondent?: string;
  initialRole?: string;
};

export function SusDialog({ open, onOpenChange, returnFocusRef, initialRespondent = "", initialRole = "" }: Props) {
  const { refresh } = useAuth();
  const [answers, setAnswers] = useState<number[]>(() => Array(SUS_STATEMENTS.length).fill(0));
  const [respondent, setRespondent] = useState("");
  const [role, setRole] = useState("");
  const [showMissing, setShowMissing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Set when every statement got the same rating; the next press sends anyway.
  const [sameWarning, setSameWarning] = useState(false);
  const questionRefs = useRef<Array<HTMLFieldSetElement | null>>([]);

  // Every time the dialog opens it starts from a blank form.
  useEffect(() => {
    if (!open) return;
    setAnswers(Array(SUS_STATEMENTS.length).fill(0));
    setRespondent(initialRespondent);
    setRole(initialRole);
    setShowMissing(false);
    setSending(false);
    setError(null);
    setDone(false);
    setSameWarning(false);
    // Only a fresh opening resets the form, not a change to the hand-over values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const answered = answers.filter((a) => a > 0).length;
  const total = SUS_STATEMENTS.length;

  const setAnswer = (index: number, value: number) => {
    setSameWarning(false);
    setAnswers((prev) => prev.map((a, i) => (i === index ? value : a)));
  };

  const send = () =>
    submitSus({
      respondent: respondent.trim() || undefined,
      role: role.trim() || undefined,
      answers,
    });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (sending) return;

    const firstMissing = answers.findIndex((a) => a === 0);
    if (firstMissing !== -1) {
      setShowMissing(true);
      const field = questionRefs.current[firstMissing];
      field?.scrollIntoView({ block: "center", behavior: "smooth" });
      field?.querySelector("input")?.focus({ preventScroll: true });
      return;
    }

    // The even-numbered statements are worded negatively, so the same rating
    // on all ten always scores exactly 50. Ask once before sending that.
    if (!sameWarning && answers.every((a) => a === answers[0])) {
      setSameWarning(true);
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
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? tr("Your session ended. Sign in again, then send your answers.")
          : err instanceof ApiError && err.status === 429
            ? tr("Too many reports sent recently. Please try again later.")
            : tr("Your answers could not be sent. Check your connection and try again."),
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
        className="flex max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-xl flex-col gap-0 overflow-hidden rounded-3xl border-[color:var(--border-default)] bg-[color:var(--surface-card)] p-0 text-[color:var(--text-primary)] shadow-[var(--shadow-elev-3)] sm:rounded-3xl"
      >
        {done ? (
          <div className="flex flex-col items-center px-6 pb-6 pt-10 text-center">
            <CheckCircle2 className="h-10 w-10" style={{ color: "var(--status-green-text)" }} aria-hidden="true" />
            <DialogTitle className="mt-4 font-display text-xl">{tr("Thank you for your feedback")}</DialogTitle>
            <DialogDescription className="mt-2 max-w-xs">
              {tr("Your answers help us make the system easier to use.")}
            </DialogDescription>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="tap mt-8 inline-flex items-center justify-center rounded-full bg-[color:var(--brand)] px-6 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--brand)]"
            >
              {tr("Done")}
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogHeader className="px-5 pb-3 pr-12 pt-5 text-left">
              <DialogTitle className="font-display text-xl">{tr("Usability survey")}</DialogTitle>
              <DialogDescription>
                {tr("This is the System Usability Scale (SUS). Rate each statement from 1 (strongly disagree) to 5 (strongly agree). It takes about two minutes.")}
              </DialogDescription>
              <div className="pt-2" aria-live="polite">
                <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--surface-raised)]">
                  <div
                    className="h-full rounded-full bg-[color:var(--brand)] transition-[width] duration-200"
                    style={{ width: `${(answered / total) * 100}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs" style={{ color: "var(--text-tertiary)" }}>{tr("{answered} of {total} answered", { answered, total })}</p>
              </div>
            </DialogHeader>

            {/* relative: keeps the visually hidden legends and radios inside this scroll area */}
            <div className="relative min-h-0 flex-1 space-y-3 overflow-y-auto border-y border-[color:var(--border-default)] px-5 py-4">
              {SUS_STATEMENTS.map((statement, i) => {
                const missing = showMissing && answers[i] === 0;
                return (
                  <fieldset
                    key={statement}
                    ref={(el) => {
                      questionRefs.current[i] = el;
                    }}
                    aria-describedby={missing ? `sus-missing-${i}` : undefined}
                    className="rounded-2xl border bg-[color:var(--surface-raised)] p-3.5"
                    style={{ borderColor: missing ? "var(--status-red-text)" : "var(--border-default)" }}
                  >
                    <legend className="sr-only">{tr("Statement {value} of {total}: {statement}", { value: i + 1, total, statement: tr(statement) })}</legend>
                    <p aria-hidden="true" className="text-sm leading-snug">
                      <span className="mr-1.5 font-mono text-xs" style={{ color: "var(--text-tertiary)" }}>
                        {i + 1}.
                      </span>
                      {tr(statement)}
                    </p>

                    <div className="mt-3 grid grid-cols-5 gap-1.5">
                      {SCALE.map((value) => (
                        <label
                          key={value}
                          className="tap relative flex cursor-pointer items-center justify-center rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface-card)] py-2 text-sm font-medium tabular-nums transition-colors hover:border-[color:var(--border-strong)] has-[:checked]:border-[color:var(--brand)] has-[:checked]:bg-[color:var(--brand)] has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[color:var(--brand)]"
                        >
                          <input
                            type="radio"
                            name={`sus-q-${i}`}
                            value={value}
                            checked={answers[i] === value}
                            onChange={() => setAnswer(i, value)}
                            className="sr-only"
                            aria-label={`${value}, ${tr(SCALE_WORDS[value - 1]!)}`}
                          />
                          <span aria-hidden="true">{value}</span>
                        </label>
                      ))}
                    </div>
                    <div
                      aria-hidden="true"
                      className="mt-1.5 flex justify-between text-[11px]"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      <span>{tr("Strongly disagree")}</span>
                      <span>{tr("Strongly agree")}</span>
                    </div>
                    {missing && (
                      <p id={`sus-missing-${i}`} className="mt-1.5 text-xs" style={{ color: "var(--status-red-text)" }}>
                        {tr("Choose a rating for this statement.")}
                      </p>
                    )}
                  </fieldset>
                );
              })}

              <div className="space-y-3 pt-2">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="sus-respondent" className="text-sm font-medium">
                      {tr("Name or code")} <span style={{ color: "var(--text-tertiary)" }}>{tr("(optional)")}</span>
                    </label>
                    <input
                      id="sus-respondent"
                      value={respondent}
                      onChange={(e) => setRespondent(e.target.value)}
                      maxLength={80}
                      autoComplete="off"
                      placeholder={tr("Leave blank to stay anonymous")}
                      className={`${inputClass} mt-1.5`}
                    />
                  </div>
                  <div>
                    <label htmlFor="sus-role" className="text-sm font-medium">
                      {tr("Your role")} <span style={{ color: "var(--text-tertiary)" }}>{tr("(optional)")}</span>
                    </label>
                    <input
                      id="sus-role"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      maxLength={80}
                      autoComplete="off"
                      placeholder={tr("For example, farm manager")}
                      className={`${inputClass} mt-1.5`}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-4">
              {(error || (showMissing && answered < total)) && (
                <p role="alert" className="mb-3 text-sm" style={{ color: "var(--status-red-text)" }}>
                  {error ?? tr("Answer all {total} statements to send. {value} left.", { total, value: total - answered })}
                </p>
              )}
              {sameWarning && !error && (
                <p role="alert" className="mb-3 text-sm" style={{ color: "var(--text-secondary)" }}>
                  {tr("You gave every statement the same rating. Statements 2, 4, 6, 8 and 10 are worded negatively, so please check your answers, or press Send anyway if they are right.")}
                </p>
              )}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="tap inline-flex items-center justify-center rounded-full border border-[color:var(--border-strong)] px-5 py-2.5 text-sm font-medium transition-colors hover:bg-[color:var(--surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--brand)]"
                >
                  {tr("Cancel")}
                </button>
                <button
                  type="submit"
                  disabled={sending}
                  className="tap inline-flex items-center justify-center gap-2 rounded-full bg-[color:var(--brand)] px-6 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--brand)] disabled:opacity-60"
                >
                  {sending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {sending ? tr("Sending…") : sameWarning ? tr("Send anyway") : tr("Send answers")}
                </button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
