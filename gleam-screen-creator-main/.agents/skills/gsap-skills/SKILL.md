---
name: gsap-skills
description: Best practices for GSAP animation orchestration, 60fps performance, React integration lifecycle, and timeline choreography.
---

# GSAP Skills & Performance Guidelines

Derived from the official GreenSock AI coding rules for high-performance web animations.

## Core Directives

1. **Transform Over Layout (Zero Layout Thrashing)**
   - NEVER animate CSS layout properties: `top`, `left`, `right`, `bottom`, `width`, `height`, `margin`, `padding`, `border-width`.
   - ALWAYS animate composited transform properties: `x`, `y`, `scale`, `rotation`, `skewX`, `skewY`, and `opacity` / `autoAlpha`.
   - Use `force3D: true` to promote elements to their own GPU render layer when appropriate.

2. **React / SPA Integration Rules**
   - Clean up animations on unmount to prevent memory leaks and zombie tweens.
   - Use React `useRef` and scoped selectors rather than global query selectors.
   - For high-frequency continuous updates (e.g. tracking pointer or real-time sensor ticks), use `gsap.quickTo()` or requestAnimationFrame throttling.

3. **Timeline Choreography**
   - Use timeline labels and relative position parameters (`"<"` to align with previous start, `"-=0.2"` to overlap) to orchestrate complex UI sequences.
   - Set sensible defaults across timelines:
     ```js
     const tl = gsap.timeline({ defaults: { ease: "power2.out", duration: 0.3 } });
     ```
