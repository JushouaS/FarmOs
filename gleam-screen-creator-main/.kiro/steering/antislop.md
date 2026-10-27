---
inclusion: auto
name: antislop
description: Apply antislop UI/design quality rules whenever doing UI, visual, copy, or component work on this project.
---

# antislop — active for this project

All UI, visual, copy, and component work on CereBroiler must pass the antislop filter.

The full rulebook is at `antislop.md` in the project root (57 KB, 38 mandatory rules R-01 to R-38).

## Mode for this project

**DURING** — apply the rules while writing, not as a post-audit. Slop must not appear from the start.

`antislop active: during (session override).`

## Quick reference: the hard gates (absolute, no exceptions)

Any of these is an instant FAIL regardless of reason:

| Rule | Ban |
|------|-----|
| R-02 | Em dash (`—`) in any UI text |
| R-03 | Broken mobile layout / horizontal overflow |
| R-17 | Statistics without a real source (no fake numbers) |
| R-18 | Fake testimonials or AI-generated names |
| R-23 | Assets created without explicit instruction (use honest placeholders) |
| R-24 | Navbar links that go nowhere |
| R-25 | Text below WCAG AA contrast (4.5:1 normal, 3:1 large) |
| R-26 | Buttons or links that do nothing |
| R-27 | UI with no empty / loading / error state |
| R-28 | Generic FAQ questions not specific to CereBroiler |
| R-32 | Not keyboard-navigable, no visible focus ring |
| R-33 | Feature added by patching source files via script |
| R-34 | Light mode broken when dark mode toggle is shipped |
| R-35 | Delivered without running the app and clicking every control |
| R-36 | Fabricated security/compliance/performance claims |
| R-37 | Design built without direction, not labeled as draft |
| R-38 | Realistically-styled fabricated content |

## Design direction for CereBroiler

CereBroiler is a **commercial-grade AI broiler monitoring system** for a thesis project.

- **Identity:** agricultural AI/ML analytics, not generic SaaS
- **Palette:** dark surface (#0d1117) with green brand (#34d364 dark / #1e7e34 light), semantic status colors only for green/amber/red/blue
- **Typography:** Inter, clean, no decorative monospace for aesthetics
- **Mood:** professional, data-dense, trustworthy — closer to Vercel/Linear than Awwwards
- **Dials:** ENERGY 2 / RHYTHM 2 / MOTION 1

## Liveliness requirements

Every screen must have:
- One clear focal point
- Structural whitespace (not leftover padding)
- One deliberate accent (the brand green), not applied to everything
- An identity motif: the green status/activity indicators throughout

## Before delivering any UI change

Run the Delivery Gate from `antislop.md` (all four blocks). A change that skips the gate is unfinished.

Key checks:
- Every interactive element has a real behavior
- Both light and dark mode look correct
- Mobile layout is not broken
- No fake numbers, no generic copy buzzwords
- No em dashes in text

## Reference

Full rules: `#[[file:antislop.md]]`
