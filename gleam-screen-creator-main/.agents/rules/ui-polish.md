---
inclusion: auto
name: ui-polish-and-micro-interactions
description: Global rule applying impeccable design language, make-interfaces-feel-better micro-polish, transitions.dev motion patterns, and GSAP-skills performance guidelines to all UI components.
---

# UI Polish & Micro-Interactions Standards

Whenever authoring or refactoring frontend interfaces:

1. **Impeccable Hierarchy & Theme**
   - Zero AI slop (no generic purple-blue gradients, no uniform flat cards).
   - Unified slate dark/light surfaces (`--surface-page`, `--surface-card`, `--surface-raised`).
   - Reserve bright accents strictly for status, live telemetry, and active detections.
   - High data authenticity and contrast meeting WCAG AA/AAA standards.

2. **Make Interfaces Feel Better (Micro-Polish)**
   - **Concentric Radii**: Ensure nested rounded elements satisfy $R_{inner} = \max(0, R_{outer} - \text{padding})$.
   - **Layered Elevation**: Use multi-layer ambient and contact shadows (`elevation-1`, `elevation-2`, `elevation-3`).
   - **Tabular Numerals**: Apply `tabular-nums` / `font-variant-numeric: tabular-nums` to every counter, timer, coordinate, and metric.
   - **Text Wrap**: Apply `text-wrap: balance` on titles and `text-wrap: pretty` on body text.
   - **Tactile Active Feedback**: Add `.tactile-btn` for micro-press (`transform: scale(0.972)` on `:active`).

3. **Transitions.dev Natural Motion**
   - Use organic spring deceleration curves (`cubic-bezier(0.16, 1, 0.3, 1)`).
   - Stagger entrance animations subtly on loaded lists.
   - Respect `@media (prefers-reduced-motion: reduce)`.

4. **GSAP & Animation Performance**
   - Animate exclusively hardware-accelerated properties (`transform`, `opacity`).
   - Never animate layout properties (`width`, `height`, `margin`, `padding`, `top`, `left`).
