import { Icon } from "./Icon";

export function ThemeToggle() {
  return (
    <button
      onClick={() => {
        const root = document.documentElement;
        const dark = !root.classList.contains("dark");
        root.classList.toggle("dark", dark);
        try {
          localStorage.setItem("theme", dark ? "dark" : "light");
        } catch {
          // storage unavailable (private mode) — theme still applies for the session
        }
      }}
      className="rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
      aria-label="Toggle light/dark mode"
      title="Toggle light/dark mode"
    >
      {/* Icon visibility is CSS-driven so SSR markup matches on both themes */}
      <span className="dark:hidden">
        <Icon name="dark_mode" />
      </span>
      <span className="hidden dark:inline">
        <Icon name="light_mode" />
      </span>
    </button>
  );
}
