import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/farm/AppShell";
import { useAuth } from "@/lib/auth-context";
import { farm, modelTelemetry } from "@/lib/farm/dataset";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — Cerebroil" }] }),
  component: SettingsPage,
});

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative h-6 w-11 rounded-full transition-colors shrink-0 before:absolute before:-inset-2.5 before:content-['']"
      style={{
        background: checked ? "var(--brand)" : "var(--surface-raised)",
        border: "1px solid var(--border-default)",
      }}
    >
      <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="label-section mb-3">{title}</h2>
      <div className="cb-card overflow-hidden divide-y" style={{ borderColor: "var(--border-subtle)" }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{label}</p>
        {sub && <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>{sub}</p>}
      </div>
      {/* Long values (model names, unit lists) wrap right-aligned instead of
          squeezing the label column on phones */}
      <div className="flex min-w-0 max-w-[55%] justify-end text-right [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

function OnlineDot({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full shrink-0"
        style={{
          background: ok ? "var(--cv-accent)" : "var(--status-red)",
          boxShadow: ok ? "0 0 4px var(--cv-accent)" : "none",
        }} />
      <span className="font-mono text-xs font-semibold"
        style={{ color: ok ? "var(--cv-accent)" : "var(--status-red-text)" }}>
        {label ?? (ok ? "Online" : "Offline")}
      </span>
    </div>
  );
}

function MonoVal({ value }: { value: string }) {
  return (
    <span className="font-mono text-xs font-semibold" style={{ color: "var(--cv-accent)" }}>{value}</span>
  );
}

function SettingsPage() {
  const { user } = useAuth();
  const [notif,   setNotif]   = useState({ email: true, push: false, sms: false });
  const [saved,   setSaved]   = useState(false);
  const [apiUrl,  setApiUrl]  = useState(modelTelemetry.apiEndpoint);
  const [rtspUrl, setRtspUrl] = useState("rtsp://[camera-ip]:554/stream1");

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="font-display text-xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
          Settings
        </h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--text-secondary)" }}>
          System configuration, Cerebroil CV Flock Monitor
        </p>
      </div>

      {/* Responsive grid: 1 col mobile, 2 col lg */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        {/* Left */}
        <div className="space-y-6">
          <Section title="Farm Information">
            <Row label="Farm Name"><MonoVal value={farm.facility.name} /></Row>
            <Row label="Pen"><MonoVal value={farm.facility.houseRange} /></Row>
            <Row label="Breed"><MonoVal value={farm.facility.breed} /></Row>
            <Row label="Manager">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {user?.fullName ?? user?.email ?? "Farm Manager"}
              </span>
            </Row>
            <Row label="Grow-out Cycle">
              <MonoVal value={`Day ${farm.cycle.day} / 42`} />
            </Row>
          </Section>

          <Section title="Notifications">
            <Row label="Email Alerts" sub="Critical and warning alerts via email">
              <Toggle checked={notif.email} onChange={(v) => setNotif((p) => ({ ...p, email: v }))} />
            </Row>
            <Row label="Push Notifications" sub="Browser push for real-time alerts">
              <Toggle checked={notif.push} onChange={(v) => setNotif((p) => ({ ...p, push: v }))} />
            </Row>
            <Row label="SMS Alerts" sub="Text message for critical severity only">
              <Toggle checked={notif.sms} onChange={(v) => setNotif((p) => ({ ...p, sms: v }))} />
            </Row>
          </Section>

          <Section title="Unit Preferences">
            <Row label="Weight Unit"><MonoVal value="Grams (g) / Kilograms (kg)" /></Row>
            <Row label="Temperature Unit"><MonoVal value="Celsius (°C)" /></Row>
          </Section>
        </div>

        {/* Right */}
        <div className="space-y-6">
          <Section title="Vision System Engine">
            <Row label="Detection Model" sub="Real-time bird tracking">
              <MonoVal value={modelTelemetry.detectionModel} />
            </Row>
            <Row label="Weight Model" sub="Automated weight calculation">
              <MonoVal value={modelTelemetry.weightModel} />
            </Row>
            <Row label="Target FPS">
              <MonoVal value={`${modelTelemetry.fps} fps`} />
            </Row>
            <Row label="Inference Latency">
              <MonoVal value={`${modelTelemetry.inferenceMs} ms`} />
            </Row>
            <Row label="Pipeline Status">
              <OnlineDot ok={modelTelemetry.pipelineStatus === "ACTIVE"} label={modelTelemetry.pipelineStatus} />
            </Row>
          </Section>

          <Section title="API & Camera Endpoints">
            <div className="px-4 py-4 sm:px-5 space-y-4">
              <div>
                <label className="label-section mb-1.5 block">FastAPI Backend URL</label>
                <input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)}
                  className="cb-input font-mono text-xs"
                  placeholder="http://localhost:4000" />
                <p className="mt-1 font-mono text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                  Backend server address for telemetry sync
                </p>
              </div>
              <div>
                <label className="label-section mb-1.5 block">RTSP Camera Stream URL</label>
                <input value={rtspUrl} onChange={(e) => setRtspUrl(e.target.value)}
                  className="cb-input font-mono text-xs"
                  placeholder="rtsp://192.168.x.x:554/stream1" />
                <p className="mt-1 font-mono text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                  Network video stream address for pen camera
                </p>
              </div>
            </div>
          </Section>

          <Section title="System Status">
            <Row label="CAM-01" sub="Pen 1 overhead camera"><OnlineDot ok={true} /></Row>
            <Row label="Temperature Sensor" sub="SN-241-H1"><OnlineDot ok={true} /></Row>
            <Row label="Humidity Sensor"    sub="SN-242-H1"><OnlineDot ok={true} /></Row>
            <Row label="Ammonia Sensor"     sub="SN-244-H1"><OnlineDot ok={true} /></Row>
            <Row label="Last Sync">
              <span className="font-mono text-xs" style={{ color: "var(--text-secondary)" }}>2 min ago</span>
            </Row>
          </Section>
        </div>
      </div>

      {/* Save row */}
      <div className="mt-6 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
        {saved && (
          <span role="status" className="text-center font-mono text-sm font-semibold sm:text-left" style={{ color: "var(--status-green)" }}>
            ✓ Changes saved
          </span>
        )}
        <button onClick={handleSave} className="btn-primary tap">Save Changes</button>
      </div>
    </AppShell>
  );
}
