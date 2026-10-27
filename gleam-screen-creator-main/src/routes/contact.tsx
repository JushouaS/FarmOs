import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AppShell } from "@/components/farm/AppShell";

export const Route = createFileRoute("/contact")({
  head: () => ({ meta: [{ title: "Contact & Support — CereBroiler" }] }),
  component: ContactPage,
});

const FAQS = [
  { q: "How do I understand an alert?", a: "When you see an alert, tap 'What should I do?' to get a plain-language explanation and the recommended action." },
  { q: "Why is my camera offline?", a: "Check that the camera is plugged in and connected to your Wi-Fi. Try refreshing the Live Camera page." },
  { q: "How is chicken activity detected?", a: "The camera uses AI to track each chicken's movement. A bird is marked inactive if it shows little movement for more than 30 minutes." },
  { q: "How often is data updated?", a: "Sensor data updates every 2 minutes. Camera feeds are live. AI insights are generated on demand." },
];

function ContactPage() {
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent]       = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const sub  = encodeURIComponent(`Support Request: ${subject}`);
    const body = encodeURIComponent(`Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`);
    window.location.href = `mailto:support@cerebroiler.dev?subject=${sub}&body=${body}`;
    setSent(true);
    setTimeout(() => setSent(false), 4000);
  };

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>Need Help?</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--text-tertiary)" }}>We're here to help you keep your flock healthy.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: contact info + FAQ */}
        <div className="space-y-6">
          <div className="cb-card p-5 space-y-4">
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Contact Us</h2>
            {[
              { icon: "📞", label: "Phone",         value: "+63 916 145 1543" },
              { icon: "✉️", label: "Email",         value: "santos.jushouaoswald22" },
              { icon: "🕐", label: "Support Hours", value: "Mon–Sat, 10AM–11PM" },
            ].map((c) => (
              <div key={c.label} className="flex items-start gap-3">
                <span className="text-xl shrink-0">{c.icon}</span>
                <div>
                  <p className="label-section mb-0.5">{c.label}</p>
                  <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{c.value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* FAQ */}
          <div className="cb-card overflow-hidden">
            <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>FAQ</h2>
            </div>
            <div>
              {FAQS.map((faq, i) => (
                <div key={i} style={{ borderBottom: i < FAQS.length-1 ? "1px solid var(--border-subtle)" : "none" }}>
                  <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="flex w-full items-start justify-between gap-3 px-5 py-4 text-left">
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{faq.q}</span>
                    <svg className={`mt-0.5 h-4 w-4 shrink-0 transition-transform ${openFaq === i ? "rotate-180" : ""}`}
                      style={{ color: "var(--text-tertiary)" }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
                    </svg>
                  </button>
                  {openFaq === i && (
                    <div className="px-5 pb-4" style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--surface-raised)" }}>
                      <p className="pt-3 text-sm" style={{ color: "var(--text-secondary)" }}>{faq.a}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="lg:col-span-2">
          <div className="cb-card p-6">
            <h2 className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Send Us a Message</h2>
            <p className="mb-5 text-sm" style={{ color: "var(--text-tertiary)" }}>Describe your issue and we'll get back to you shortly.</p>

            {sent && (
              <div className="mb-4 flex items-center gap-3 rounded-lg p-4"
                style={{ background: "var(--status-green-bg)", border: "1px solid var(--status-green-border)" }}>
                <svg className="h-5 w-5" style={{ color: "var(--status-green)" }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                <p className="text-sm font-medium" style={{ color: "var(--status-green-text)" }}>
                  Your email client is opening… we'll respond soon!
                </p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="c-name" className="mb-1.5 block text-sm font-medium" style={{ color: "var(--text-primary)" }}>Name</label>
                  <input id="c-name" type="text" required value={name} onChange={(e) => setName(e.target.value)}
                    placeholder="Byron Duallo" className="cb-input" />
                </div>
                <div>
                  <label htmlFor="c-email" className="mb-1.5 block text-sm font-medium" style={{ color: "var(--text-primary)" }}>Email</label>
                  <input id="c-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com" className="cb-input" />
                </div>
              </div>
              <div>
                <label htmlFor="c-subject" className="mb-1.5 block text-sm font-medium" style={{ color: "var(--text-primary)" }}>Subject</label>
                <input id="c-subject" type="text" required value={subject} onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Camera not working" className="cb-input" />
              </div>
              <div>
                <label htmlFor="c-msg" className="mb-1.5 block text-sm font-medium" style={{ color: "var(--text-primary)" }}>Message</label>
                <textarea id="c-msg" required rows={5} value={message} onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe your issue in detail…"
                  className="cb-input resize-none" />
              </div>
              <button type="submit" className="btn-primary gap-2">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
                </svg>
                Send Message
              </button>
            </form>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
