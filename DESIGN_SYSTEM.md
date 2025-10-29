# Spotlight Design System

The Spotlight browser extension now follows a unified design system inspired by Apple's Human Interface Guidelines, with a glassmorphism treatment and spring-based motion. This document captures the foundations and implementation details so that future changes remain consistent.

## Foundations

### Color
Color is driven by CSS custom properties declared on the shadow root. Each theme exposes an identical token set so components can remain theme-agnostic.

| Token | Purpose | Dark | Light |
| --- | --- | --- | --- |
| `--spotlight-surface-primary` | Primary background for the shell and high-emphasis surfaces. | `rgba(12, 16, 28, 0.78)` | `rgba(255, 255, 255, 0.82)` |
| `--spotlight-surface-secondary` | Secondary backgrounds such as the input wrapper. | `rgba(18, 24, 42, 0.68)` | `rgba(252, 253, 255, 0.72)` |
| `--spotlight-surface-tertiary` | Tertiary layers and control fills. | `rgba(26, 32, 54, 0.6)` | `rgba(243, 246, 255, 0.68)` |
| `--spotlight-scrim` | Global overlay scrim behind the glass container. | `rgba(6, 10, 20, 0.55)` | `rgba(15, 23, 42, 0.18)` |
| `--spotlight-text-primary` | Primary text. | `rgba(248, 250, 255, 0.98)` | `#0f172a` |
| `--spotlight-text-secondary` | Secondary text and metadata. | `rgba(226, 230, 255, 0.76)` | `rgba(30, 41, 59, 0.76)` |
| `--spotlight-text-tertiary` | Tertiary labels and supporting copy. | `rgba(199, 205, 232, 0.65)` | `rgba(71, 85, 105, 0.68)` |
| `--spotlight-accent` / `--spotlight-accent-strong` | Accent gradients, controls, and focus states. | `#8da2ff` / `#5f7bff` | `#2563eb` / `#1d4ed8` |
| `--spotlight-result-hover` / `--spotlight-result-active` | Result hover and selection treatments. | `rgba(118, 141, 255, 0.18)` / `rgba(118, 141, 255, 0.26)` | `rgba(37, 99, 235, 0.1)` / `rgba(37, 99, 235, 0.16)` |
| `--spotlight-focus-ring` | Universal focus ring color. | `rgba(118, 141, 255, 0.48)` | `rgba(59, 130, 246, 0.45)` |

See `src/content/styles.css` for the complete token list. Components must consume these variables instead of hard-coded colors.【F:src/content/styles.css†L1-L126】

### Typography
- Primary font: `SF Pro Text` with platform fallbacks.
- Hierarchy: 16 px base size, 1.05 rem input text, 1 rem result titles, 0.75–0.9 rem meta and controls.
- Weight: 590–620 for key interactive labels to mirror Apple’s medium/semibold usage.【F:src/content/styles.css†L1-L172】【F:src/content/styles.css†L175-L210】

### Spacing & Shape
- Spacing scale: 4, 8, 12, 16, 20, 24, and 32 px tokens to keep rhythm consistent (`--spotlight-spacing-*`).
- Radius scale: 8, 12, 16, 20, and 26 px radii (`--spotlight-radius-*`).
- Layout uses generous padding inside the shell and compact gaps between results to balance density with clarity.【F:src/content/styles.css†L15-L113】【F:src/content/styles.css†L190-L217】【F:src/content/styles.css†L326-L356】

### Motion
- Spring curve: `cubic-bezier(0.16, 1, 0.3, 1)` applied across overlays, inputs, result cards, and menus (`--spotlight-motion-spring`).
- Durations: 160 ms (micro interactions), 280 ms (primary transitions), 460 ms (background changes) via dedicated tokens.
- Overlay open/close, glass shell scaling, and menu reveals all animate using these motion tokens to emulate Apple’s natural ease-out spring behavior.【F:src/content/styles.css†L27-L123】【F:src/content/styles.css†L128-L185】【F:src/content/styles.css†L356-L492】【F:src/content/index.js†L80-L149】【F:src/content/index.js†L652-L712】

### Accessibility
- `color-scheme` supports both light and dark, updating automatically with system preferences via `matchMedia` listeners in the content script.【F:src/content/index.js†L71-L149】
- Motion respects `prefers-reduced-motion`, disabling transitions when requested.【F:src/content/styles.css†L610-L620】
- Focus rings and contrast ratios meet WCAG AA against both backgrounds.

## Components

### Overlay & Shell
- `spotlight-overlay` applies the scrim, blur, and entrance transform. The shell glass container uses layered gradients, border, and drop shadow to deliver the glassmorphism effect.【F:src/content/styles.css†L128-L185】
- Overlay visibility is controlled by the host’s `data-open` attribute, producing smooth open/close animations coordinated with the JS helper `setOverlayVisibility`.【F:src/content/index.js†L105-L149】【F:src/content/index.js†L652-L712】

### Search Field
- The input container is a frosted capsule with inner glow and focus ring. Placeholder suggestions (`spotlight-ghost`) fade in as secondary text.【F:src/content/styles.css†L187-L251】
- Slash and engine menus share the same floating glass panel treatment and animate with spring transitions for continuity.【F:src/content/styles.css†L492-L556】

### Subfilters & Bookmark Actions
- Subfilter chips use uppercase labels, accent tints, and badges driven by tokens. Layout automatically collapses when no subfilters are available (`has-subfilters` helper classes). Action buttons adopt gradient glass fills with spring hover elevation.【F:src/content/styles.css†L253-L339】

### History Assistant
- Panel adopts tertiary glass surface with stacked typography and CTA button using accent gradients. Meta, range, and status text all map to the typography and color tokens for consistency.【F:src/content/styles.css†L341-L432】

### Results
- Results are glass cards with 12 px padding, spring hover scaling, and accent-tinted active states. Icons sit in frosted squares; badges, timestamps, and metadata reuse shared token colors. Summary buttons, AI panels, and assistant controls inherit the same component primitives to keep the system cohesive.【F:src/content/styles.css†L434-L590】

## Motion Guidelines
- Use the motion tokens for any new interactive state. Favor transform + opacity combinations over animating layout when possible.
- Keep micro-interactions within 160–220 ms; larger context shifts (overlay, menu) use the 280 ms spring.
- Always provide an accessible fallback by checking `prefers-reduced-motion` before adding bespoke animations.【F:src/content/styles.css†L610-L620】

## Implementation Notes
- Theme is applied by setting `data-theme` on both the shadow host and the root container, driven by `applyDesignTheme` and `ensureDesignThemeListener`. Future overrides can set `data-theme="light"` or `"dark"` manually before initialization.【F:src/content/index.js†L70-L149】
- Overlay visibility and pointer-interaction states are centralized in `setOverlayVisibility`, ensuring transitions complete before the host is hidden. Reuse this helper for new states instead of manipulating style properties directly.【F:src/content/index.js†L115-L149】【F:src/content/index.js†L665-L712】
- Tokens are defined once in `styles.css`; new components should reference the existing variables to inherit theme support automatically.【F:src/content/styles.css†L15-L126】

## Extending the System
1. Define any new tokens alongside the existing set, providing values for both themes.
2. Build components with semantic class names (`spotlight-*`) and reuse shared primitives (chip, button, badge) to inherit motion and spacing.
3. For motion, compose animations from the declared spring curve and duration tokens; fall back to reduced motion guard rails.
4. Document any new component guidelines here to keep the system cohesive.

Following these rules preserves the Apple-inspired glass aesthetic, ensures smooth spring transitions, and keeps the experience coherent across future features.
