# Spotlight Design System

The Spotlight browser extension now follows a unified design system inspired by Apple's Human Interface Guidelines, with a glassmorphism treatment and spring-based motion. This document captures the foundations and implementation details so that future changes remain consistent.

## Foundations

### Color
Color is driven by CSS custom properties declared on the shadow root. Each theme exposes an identical token set so components can remain theme-agnostic.

| Token | Purpose | Dark | Light |
| --- | --- | --- | --- |
| `--spotlight-surface-primary` | Primary background for the floating sheet. | `rgba(22, 24, 28, 0.88)` | `rgba(255, 255, 255, 0.92)` |
| `--spotlight-surface-secondary` | Secondary backgrounds such as the input header. | `rgba(28, 31, 36, 0.78)` | `rgba(255, 255, 255, 0.86)` |
| `--spotlight-surface-tertiary` | Tertiary layers, icons, and menu panels. | `rgba(40, 44, 52, 0.68)` | `rgba(249, 249, 255, 0.82)` |
| `--spotlight-scrim` | Dimmed scrim behind Spotlight. | `rgba(9, 12, 17, 0.4)` | `rgba(15, 23, 42, 0.12)` |
| `--spotlight-text-primary` | Primary text. | `rgba(255, 255, 255, 0.94)` | `#1c1c1e` |
| `--spotlight-text-secondary` | Secondary text and metadata. | `rgba(255, 255, 255, 0.72)` | `rgba(60, 60, 67, 0.78)` |
| `--spotlight-text-tertiary` | Tertiary labels and supporting copy. | `rgba(255, 255, 255, 0.6)` | `rgba(60, 60, 67, 0.6)` |
| `--spotlight-accent` / `--spotlight-accent-strong` | Apple blue accents for focus and pills. | `#0a84ff` / `#0066cc` | `#0a84ff` / `#0066cc` |
| `--spotlight-result-hover` / `--spotlight-result-active` | Result hover and selection treatments. | `rgba(255, 255, 255, 0.08)` / `rgba(10, 132, 255, 0.22)` | `rgba(60, 60, 67, 0.08)` / `rgba(10, 132, 255, 0.16)` |
| `--spotlight-focus-ring` | Universal focus ring color. | `rgba(10, 132, 255, 0.5)` | `rgba(10, 132, 255, 0.42)` |

See `src/content/styles.css` for the complete token list. Components must consume these variables instead of hard-coded colors.【F:src/content/styles.css†L1-L125】

### Typography
- Primary font: `SF Pro Text` with platform fallbacks.
- Hierarchy: 16 px base size, 1.05 rem input text, 1 rem result titles, 0.75–0.9 rem meta and controls.
- Weight: 590–620 for key interactive labels to mirror Apple’s medium/semibold usage.【F:src/content/styles.css†L1-L52】【F:src/content/styles.css†L221-L276】

### Spacing & Shape
- Spacing scale: 4, 8, 12, 16, 20, 24, and 32 px tokens to keep rhythm consistent (`--spotlight-spacing-*`).
- Radius scale: 6, 10, 14, 18, and 22 px radii (`--spotlight-radius-*`).
- Layout keeps the centered sheet compact with softened corners and evenly spaced results to echo Spotlight on macOS.【F:src/content/styles.css†L8-L125】【F:src/content/styles.css†L134-L212】【F:src/content/styles.css†L316-L376】

### Motion
- Spring curve: `cubic-bezier(0.18, 0.9, 0.2, 1)` applied across overlays, inputs, result cards, and menus (`--spotlight-motion-spring`).
- Durations: 170 ms (micro interactions), 260 ms (primary transitions), 420 ms (background changes) via dedicated tokens.
- Overlay open/close, glass sheet scaling, and menu reveals all animate using these motion tokens to emulate Apple’s natural spring easing.【F:src/content/styles.css†L28-L206】【F:src/content/styles.css†L316-L612】【F:src/content/index.js†L68-L149】【F:src/content/index.js†L652-L712】

### Accessibility
- `color-scheme` supports both light and dark, updating automatically with system preferences via `matchMedia` listeners in the content script.【F:src/content/index.js†L71-L149】
- Motion respects `prefers-reduced-motion`, disabling transitions when requested.【F:src/content/styles.css†L1111-L1127】
- Focus rings and contrast ratios meet WCAG AA against both backgrounds.

## Components

### Overlay & Shell
- `spotlight-overlay` applies the dimmed scrim and subtle lift. The shell recreates macOS Spotlight’s floating sheet with translucent color-mix layers, soft borders, and elevated shadow.【F:src/content/styles.css†L127-L206】
- Overlay visibility is controlled by the host’s `data-open` attribute, producing smooth open/close animations coordinated with the JS helper `setOverlayVisibility`.【F:src/content/index.js†L105-L149】【F:src/content/index.js†L652-L712】

### Search Field
- The input container is a frosted capsule that lifts on focus, with placeholder suggestions (`spotlight-ghost`) fading in as secondary text.【F:src/content/styles.css†L197-L276】
- Slash and engine menus inherit the floating glass treatment and spring reveal to match Spotlight’s command popovers.【F:src/content/styles.css†L949-L1068】

### Subfilters & Bookmark Actions
- Subfilter chips stay pill-shaped with Apple blue tints and uppercase microcopy. When auxiliary actions appear they stay lightweight to avoid overpowering the search field.【F:src/content/styles.css†L278-L405】

### History Assistant
- The history assistant retains a tertiary frosted panel with stacked typography, micro tags, and accented controls for clarity.【F:src/content/styles.css†L433-L626】

### Results
- Results sit on a translucent list area with soft hover states, frosted icons, and Apple blue selection. Summary buttons, AI panels, and assistant controls reuse the same primitives for consistency.【F:src/content/styles.css†L632-L910】

## Motion Guidelines
- Use the motion tokens for any new interactive state. Favor transform + opacity combinations over animating layout when possible.
- Keep micro-interactions within ~170–220 ms; larger context shifts (overlay, menu) ride the 260 ms spring.
- Always provide an accessible fallback by checking `prefers-reduced-motion` before adding bespoke animations.【F:src/content/styles.css†L1111-L1127】

## Implementation Notes
- Theme is applied by setting `data-theme` on both the shadow host and the root container, driven by `applyDesignTheme` and `ensureDesignThemeListener`. Future overrides can set `data-theme="light"` or `"dark"` manually before initialization.【F:src/content/index.js†L70-L149】
- Overlay visibility and pointer-interaction states are centralized in `setOverlayVisibility`, ensuring transitions complete before the host is hidden. Reuse this helper for new states instead of manipulating style properties directly.【F:src/content/index.js†L115-L149】【F:src/content/index.js†L665-L712】
- Tokens are defined once in `styles.css`; new components should reference the existing variables to inherit theme support automatically.【F:src/content/styles.css†L28-L125】

## Extending the System
1. Define any new tokens alongside the existing set, providing values for both themes.
2. Build components with semantic class names (`spotlight-*`) and reuse shared primitives (chip, button, badge) to inherit motion and spacing.
3. For motion, compose animations from the declared spring curve and duration tokens; fall back to reduced motion guard rails.
4. Document any new component guidelines here to keep the system cohesive.

Following these rules preserves the Apple-inspired glass aesthetic, ensures smooth spring transitions, and keeps the experience coherent across future features.
