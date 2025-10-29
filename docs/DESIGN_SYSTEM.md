# Aurora Design System

The **Aurora Design System** powers the Spotlight Search extension. It combines Apple's Human Interface Guidelines (HIG) principles with a glassmorphism aesthetic to deliver a consistent, expressive, and accessible user interface.

This guide captures the visual language, interaction patterns, and implementation details required to extend the experience without breaking cohesion.

---

## 1. Design Principles

1. **Clarity first.** Content, not chrome, is the hero. Surfaces are translucent and layered to create depth without sacrificing legibility.
2. **Defer to user intent.** Every transition uses natural, responsive motion curves (matching Apple’s “ease in-out” timing) and respects reduced-motion preferences.
3. **Consistency through tokens.** Colors, typography, spacing, borders, and shadows are controlled exclusively through the tokens defined in `src/content/styles.css`.
4. **Delight with restraint.** Glassmorphism and gradients are subtle, using saturation and blur to evoke Apple platforms without overwhelming the search experience.

---

## 2. Design Tokens

Aurora exposes a constrained set of CSS custom properties on `:host`. All UI should reference these variables instead of hard-coded values.

### Color System

| Token | Purpose | Value |
| --- | --- | --- |
| `--aurora-color-overlay` | Dim the page while Spotlight is open | `rgba(6, 10, 20, 0.52)` |
| `--aurora-color-surface` | Primary container tint | `rgba(22, 28, 44, 0.78)` |
| `--aurora-color-surface-strong` | Elevated surfaces & menus | `rgba(28, 34, 52, 0.86)` |
| `--aurora-color-surface-subtle` | Dividers and strokes | `rgba(255, 255, 255, 0.08)` |
| `--aurora-color-text-primary` | Primary copy | `rgba(244, 247, 255, 0.98)` |
| `--aurora-color-text-secondary` | Secondary copy | `rgba(220, 228, 255, 0.76)` |
| `--aurora-color-text-tertiary` | Metadata and placeholders | `rgba(200, 210, 240, 0.62)` |
| `--aurora-color-text-inverse` | Text on light badges | `rgba(8, 10, 18, 0.92)` |
| `--aurora-color-accent` | Accent blue (buttons, focus) | `rgba(116, 160, 255, 0.92)` |
| `--aurora-color-accent-strong` | Accent gradient endpoint | `rgba(96, 210, 255, 0.85)` |
| `--aurora-color-positive` | Success states | `rgba(72, 199, 142, 0.88)` |
| `--aurora-color-negative` | Error states | `rgba(248, 135, 135, 0.88)` |

Gradients leverage `--aurora-gradient-accent`, `--aurora-gradient-surface`, and `--aurora-gradient-soft` for glass highlights.

### Typography

- `--aurora-font-sans`: `"SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Base font-size: `16px`
- Headline (input text): `18px`, weight 600, negative tracking for focus.
- Metadata: 12–13px with lighter weights to echo SF Pro’s typographic scale.

### Spacing & Layout

Spacing uses a modular 4px scale:

| Token | Value |
| --- | --- |
| `--aurora-space-1` | 4px |
| `--aurora-space-2` | 8px |
| `--aurora-space-3` | 12px |
| `--aurora-space-4` | 16px |
| `--aurora-space-5` | 20px |
| `--aurora-space-6` | 24px |
| `--aurora-space-7` | 32px |

### Shape & Elevation

- Radii: `--aurora-radius-sm` (8px), `--aurora-radius-md` (12px), `--aurora-radius-lg` (18px), `--aurora-radius-xl` (26px), and `--aurora-radius-pill` for fully rounded chips.
- Shadows: `--aurora-shadow-lg`, `--aurora-shadow-md`, `--aurora-shadow-sm`, `--aurora-shadow-focus`. They follow Apple’s soft drop shadow patterns.
- Blur: `--aurora-blur-strong` (overlay), `--aurora-blur-medium` (shell), `--aurora-blur-soft` (menus/chips).

### Motion

- Durations: `--aurora-duration-instant` (120ms), `--aurora-duration-fast` (180ms), `--aurora-duration-medium` (240ms), `--aurora-duration-slow` (420ms).
- Easing: `--aurora-ease-standard` (Apple’s standard curve), `--aurora-ease-emphasized` (springy emphasis), `--aurora-ease-exit` (gentle fade-out).
- Respect reduced motion: the media query swaps durations to nearly zero and clamps keyframe animations.

---

## 3. Component Library

Each class in `styles.css` maps to a component. Use these building blocks to maintain consistency.

### Overlay & Shell
- `.spotlight-overlay` dims the page with translucent blur.
- `.spotlight-shell` is the primary container: gradient glass surface, 26px radius, `var(--aurora-shadow-lg)`.

### Search Input
- `.spotlight-input-wrapper` hosts the command surface.
- `.spotlight-input-container` provides the frosted capsule with a focus glow.
- `.spotlight-input` uses the headline typography scale.
- `.spotlight-ghost` handles inline autocomplete suggestions.
- `.spotlight-status` communicates query state in tertiary color.

### Context Menus
- `.spotlight-slash-menu` and `.spotlight-engine-menu` share geometry and rely on `aurora-fade-in` animation for entry.
- Options use `.spotlight-slash-option` / `.spotlight-engine-option` with accent hover/active gradients.
- `.spotlight-engine-option-icon` ensures icons sit inside a translucent squircle.

### Subfilters & Actions
- `.spotlight-subfilters` orchestrates layout (scrollable chip row + actions).
- `.spotlight-subfilter` is the glass chip, `.active` uses `--aurora-gradient-accent`.
- `.spotlight-subfilters-action-button` wraps AI/organize actions with success/error states fed by `--aurora-color-positive` and `--aurora-color-negative`.
- `.spotlight-spinner` reuses the design-system spinner animation.

### History Assistant
- `.spotlight-history-assistant` surfaces AI automation controls with a soft gradient header.
- `.spotlight-history-assistant-form` uses spacing token `--aurora-space-3` and the shared input/button styles.
- `.spotlight-history-assistant-clear`, `.spotlight-history-assistant-action`, `.spotlight-history-assistant-status` all inherit type colors from the token palette.

### Results & Panels
- `.spotlight-results` standardizes list spacing and scrollbars.
- `.spotlight-result` cards animate gently on hover/active, matching the HIG focus shift.
- `.spotlight-result-summary-button` and `.spotlight-ai-panel-copy` share the pill button style.
- `.spotlight-ai-panel` adopts Aurora’s elevated surface for AI summaries, with `.spotlight-ai-panel-badge` for status tags.
- `.spotlight-focus-banner` is the low-profile status row appended to the list.

### Utility Classes
- `.spotlight-hidden`, `.spotlight-muted` offer consistent visibility and tone adjustments without ad-hoc CSS.

---

## 4. Interaction & Motion Guidelines

- **Hover & focus:** Use accent gradients with small `-1px` translations for discoverability. Focus states apply `--aurora-shadow-focus` instead of custom outlines.
- **Menu transitions:** Always use `aurora-fade-in` for contextual surfaces. Pair with `transform-origin: top center` to mimic macOS sheets.
- **Loading indicators:** Apply `.spotlight-spinner` for inline progress. Avoid bespoke spinners.
- **Reduced motion:** Never introduce new keyframes without considering the `prefers-reduced-motion` override.

---

## 5. Implementation Checklist

1. Reference tokens instead of raw values for colors, spacing, radii, or shadows.
2. Keep gradients subtle (opacity < 0.95) to preserve legibility.
3. Apply `backdrop-filter` with the provided blur tokens on any new translucent surface.
4. Use `.spotlight-result`, `.spotlight-subfilter`, and `.spotlight-subfilters-action-button` styles when introducing analogous components.
5. Document new patterns by updating this guide to protect cohesion.

---

## 6. Handoff Notes

- Primary stylesheet: `src/content/styles.css` (shadow DOM scoped).
- Tokens are declared at the top of the file; extend by adding new variables there before applying them downstream.
- For additional components, follow the naming convention `spotlight-[component]-[element]` to stay within the design system namespace.

By adhering to Aurora, contributors can ship new features rapidly while maintaining the extension’s polished, Apple-inspired experience.
