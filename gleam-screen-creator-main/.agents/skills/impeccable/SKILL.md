---
name: impeccable
description: Design language and anti-slop guidelines for professional frontend applications. Eliminates generic AI templates, enforces strong visual hierarchy, bespoke color tokens, typography contrast, purposeful whitespace, and authentic data density.
---

# Impeccable Design Guidelines

Impeccable enforces craftsmanship and intentionality across all user interfaces, eliminating predictable "AI slop" (muddy gradients, generic blue/purple accents, uniform card-padding monotony, low contrast, and unconsidered typography).

## Core Principles

1. **Intentional Hierarchy (Bolder vs. Quieter)**
   - Every screen MUST have exactly one primary focal point.
   - Do not make every card compete for attention with identical borders, backgrounds, and shadows.
   - Distinguish high-frequency telemetry from reference data with varied typography weight and density.

2. **Disciplined Color & Contrast**
   - No generic multi-stop gradient backgrounds.
   - Use unified, high-contrast surface tokens (e.g. slate-950 page background, slate-900 card surface, slate-800 raised elements).
   - Accents are deliberate and scarce: reservation of CV/AI accents (lime/emerald) strictly for live badges, bounding boxes, and active status.
   - Strict adherence to WCAG AA / AAA contrast standards (>4.5:1 for standard text, >3:1 for large/mono).

3. **Typography with Purpose**
   - Headings: bold, tight tracking (`tracking-tight`), `text-wrap: balance`.
   - Body & descriptions: readable, legible, `text-wrap: pretty`.
   - Numbers & Telemetry: tabular figures (`font-variant-numeric: tabular-nums`), explicit units, crisp monospaced font where appropriate.
   - Clear size scale with distinct jumps (e.g., 11px micro labels, 13px captions, 14px body, 18px subheaders, 24px+ primary stats).

4. **Authentic Data Density**
   - Real-world domain context (e.g. livestock telemetry, computer vision bounding boxes, environmental sensors).
   - No placeholder lorem ipsum or fabricated meaningless charts.
   - Meaningful status states: nominal (green), warning (amber), critical (red), info (blue).
