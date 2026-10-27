---
name: transitions-dev
description: Production-ready CSS motion and transition patterns. Natural easing curves, micro-interactions, spring feel, enter/exit sequences, and accessible motion guards.
---

# Transitions.dev Motion Guidelines

High-performance CSS micro-interactions and transition patterns that feel fluid, responsive, and natural.

## 1. Natural Easing Functions
Default `linear` or `ease` feels stiff or mechanical. Use spring-like deceleration curves:
- Natural Spring Entry: `cubic-bezier(0.16, 1, 0.3, 1)` (snappy start, gentle organic landing).
- Tactile Press / Release: `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- Standard transition duration:
  - Fast feedback (buttons, toggles, badges): 120ms – 180ms.
  - Modals, panels, tabs, card reveals: 220ms – 320ms.

## 2. Enter & Exit Choreography
- Combine subtle transform with opacity for enters:
  ```css
  @keyframes fadeSlideUp {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.99);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
  ```
- Use staggered entry delays on lists and telemetry grids (`animation-delay: calc(var(--i, 0) * 40ms)`).

## 3. Hardware Acceleration & Performance
- Only animate `transform` and `opacity`.
- Use `transform-gpu` or `will-change: transform, opacity` during active transitions.
- Avoid animating `top`, `left`, `width`, `height`, `margin`, `padding` which trigger layout recalculations.

## 4. Accessibility
- Always guard animations with `@media (prefers-reduced-motion: reduce)`:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
  ```
