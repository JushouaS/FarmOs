---
name: make-interfaces-feel-better
description: Concrete design-engineering rules for micro-polish. Concentric border radius, optical alignment, layered shadows, text wrapping, tabular numerals, and tactile active states.
---

# Make Interfaces Feel Better (Micro-Polish Guidelines)

Focused on the subtle details that elevate functional software into an exceptional, tactile experience.

## Rules & Checklists

### 1. Concentric Border Radius
- Formula: $R_{\text{inner}} = \max(0, R_{\text{outer}} - \text{padding})$.
- If an outer container has `rounded-xl` (12px) with `p-2` (8px padding), the inner child must have `rounded-[4px]`, never `rounded-xl`. Nested rounded items with identical radii look mismatched and sloppy.

### 2. Optical Alignment
- Geometric center is not always optical center.
- Play icons, right-pointing arrows, triangles, and off-center glyphs require slight manual optical nudges (e.g. `translate-x-[1px]`).
- Badges and status dots beside text should align with the cap-height of adjacent text, not the line-box baseline.

### 3. Layered Ambient & Contact Shadows
- Never use a single harsh black box-shadow like `box-shadow: 0 4px 12px rgba(0,0,0,0.5)`.
- Use dual-layer or multi-layer shadows:
  1. A tight, semi-sharp contact shadow to anchor the element (`0 1px 2px rgba(0,0,0,0.2)`).
  2. A soft, diffuse ambient shadow for elevation and depth (`0 8px 24px -4px rgba(0,0,0,0.3)`).
  3. A subtle 1px top highlight border / rim light (`inset 0 1px 0 rgba(255,255,255,0.08)` in dark mode).

### 4. Typography Stability & Wrap
- Use `font-variant-numeric: tabular-nums` (or `tabular-nums` in Tailwind) for all dynamic numbers, counters, clocks, GPS/depth/weight values, and latency stats so layout never jitters as characters change.
- Use `text-wrap: balance` for titles and cards.
- Use `text-wrap: pretty` for body paragraphs to avoid typographic orphans.

### 5. Tactile Feedback
- Interactive elements must feel physical:
  - `:hover` : subtle border glow or background tint transition (150ms).
  - `:active`: micro-press reduction (`transform: scale(0.97)` or `scale(0.98)`).
- Ensure minimum interactive hit target is at least 36px to 44px for accessibility.
