/* ── Animated broiler mascot ─────────────────────────────────────
 * A white Ross 308 broiler drawn in SVG, the bird this product monitors
 * (R-22: direct product connection). Its motion reports the sign-in state
 * instead of decorating it (R-19):
 *   idle  — breathes and pecks now and then
 *   shy   — looks away with eyes shut while the password field has focus
 *   error — shakes its head on a failed attempt
 *   happy — hops and flaps once sign-in lands
 * Keyframes live in styles.css (.chick-*) and stop under reduced motion.
 * Sized by its container: the viewBox scales to any width. */

export type ChickenMood = "idle" | "shy" | "error" | "happy";

export function Chicken({
  mood = "idle",
  className = "",
  showGround = true,
}: {
  mood?: ChickenMood;
  className?: string;
  /** Ground shadow; off when the bird stands on another surface (a card edge). */
  showGround?: boolean;
}) {
  const eyesShut = mood === "shy" || mood === "happy";

  return (
    <svg
      viewBox="0 0 200 200"
      className={`chick block h-auto w-full overflow-visible ${className}`}
      data-mood={mood}
      aria-hidden="true"
      focusable="false"
    >
      {showGround && (
        <ellipse className="chick-shadow" cx="104" cy="186" rx="50" ry="6" fill="#000" opacity="0.22" />
      )}

      <g className="chick-body">
        {/* Legs */}
        <g stroke="#f59e0b" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M94 150 L92 180 M92 180 L84 184 M92 180 L99 185" />
          <path d="M114 150 L116 180 M116 180 L109 184 M116 180 L124 184" />
        </g>

        {/* Tail */}
        <path
          d="M62 96 C50 84 47 68 53 59 C59 67 63 71 67 75 C65 63 69 55 75 53 C77 63 77 71 79 76 Z"
          fill="#f7f5ee"
        />

        {/* Body */}
        <path
          d="M56 106 C52 80 66 66 79 73 C90 67 114 67 129 79 C147 93 151 121 141 139 C129 159 97 163 77 153 C61 145 58 126 56 106 Z"
          fill="#fbfaf6"
        />
        {/* Belly shade */}
        <path d="M63 128 C79 150 117 154 137 136 C129 157 93 163 71 149 Z" fill="#e7e3d7" />

        {/* Wing */}
        <g className="chick-wing">
          <path
            d="M86 104 C96 94 120 96 126 110 C130 124 116 136 98 132 C88 128 82 116 86 104 Z"
            fill="#ece8dd"
          />
          <path d="M95 117 C103 122 114 122 121 117" stroke="#d9d3c3" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>

        {/* Head: pivots at the neck for peck / shake / look-away */}
        <g className="chick-head">
          <circle cx="138" cy="72" r="20" fill="#fbfaf6" />
          {/* Comb */}
          <path
            d="M128 56 C126 47 133 43 137 49 C138 40 147 39 147 48 C150 42 158 45 155 54 C150 58 134 60 128 56 Z"
            fill="#ef4444"
          />
          {/* Beak */}
          <path d="M155 70 L169 74 L155 79 Z" fill="#f59e0b" />
          {/* Wattle */}
          <path d="M154 80 C152 88 158 92 160 86 C161 83 158 80 154 80 Z" fill="#ef4444" />
          {/* Cheek */}
          <circle cx="140" cy="79" r="3.4" fill="#fda4af" opacity="0.55" />
          {/* Eye */}
          {eyesShut ? (
            <path d="M142.5 69 Q146 72.2 149.5 69" stroke="#0f172a" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          ) : (
            <g className="chick-eye">
              <circle cx="146" cy="69" r="2.9" fill="#0f172a" />
              <circle cx="147" cy="68" r="0.9" fill="#ffffff" />
            </g>
          )}
        </g>
      </g>
    </svg>
  );
}
