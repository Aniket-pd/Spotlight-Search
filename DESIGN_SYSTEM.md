# Spotlight Design System

## Overview
The refreshed Spotlight extension follows Apple's Human Interface Guidelines (HIG) and embraces a glassmorphism aesthetic. The interface layers translucent surfaces over a softly blurred backdrop, combining depth, warmth, and clarity. Components are driven by a unified token set that keeps color, typography, spacing, and motion consistent across light and dark modes.

Key principles:

- **Clarity first.** Primary actions remain high contrast while supporting information uses secondary tones. Layouts breathe with generous spacing and rounded corners inspired by macOS.
- **Comfortable depth.** Glassmorphic surfaces use gradients, translucency, and layered shadows to separate UI levels without heavy borders.
- **Responsive theming.** The design automatically adapts to the page's preferred color scheme and can be overridden by setting `data-theme="light" | "dark"` on the Shadow DOM host.
- **Motion with purpose.** Hover, focus, and loading affordances rely on subtle elevation and opacity shifts that feel native to macOS.

## Foundations

### Color tokens
All colors are defined in `src/content/styles.css` as custom properties on `:host`. Tokens are inherited inside the Shadow DOM, so use the variables instead of hard-coded values.

| Token | Purpose | Light theme | Dark theme |
| --- | --- | --- | --- |
| `--spotlight-color-overlay` | Full-screen scrim behind the shell | `rgba(16, 44, 92, 0.26)` | `rgba(5, 12, 26, 0.56)` |
| `--spotlight-surface-gradient` | Shell background gradient | Soft white/ice blues | Navy glass gradient |
| `--spotlight-surface-panel` | Panel/assistant surfaces | `linear-gradient(135deg, rgba(255, 255, 255, 0.88), rgba(230, 240, 255, 0.78))` | `linear-gradient(135deg, rgba(28, 42, 82, 0.86), rgba(12, 22, 48, 0.94))` |
| `--spotlight-color-text-primary` | Primary text | Deep navy | Off-white |
| `--spotlight-color-text-secondary` | Body text | Navy 72% | Soft grey-blue |
| `--spotlight-color-text-tertiary` | Hints & meta | Navy 56% | Muted periwinkle |
| `--spotlight-color-text-quiet` | Low-emphasis captions | Navy 40% | Slate 52% |
| `--spotlight-color-accent` | Accent base | `#4d8dff` | `#6ea5ff` |
| `--spotlight-color-accent-strong` | Accent highlight | `#3765ff` | `#4d8dff` |
| `--spotlight-color-accent-soft` | Accent wash for hover states | `rgba(77, 141, 255, 0.18)` | `rgba(93, 155, 255, 0.2)` |
| `--spotlight-result-hover` | Result hover fill | `rgba(77, 141, 255, 0.18)` | `rgba(93, 155, 255, 0.2)` |

Additional tokens (chip borders, menu surfaces, shadows, etc.) are declared adjacent to these in the CSS. Always reuse the variable that matches the semantic intent instead of introducing new colors.

### Typography
- Base font stack: `"SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Base size: `16px` with `line-height: 1.45`.
- Use weight 600 for titles, 500 for chips, 700 for AI badges, and uppercase meta text with `letter-spacing: 0.08em` to mirror HIG patterns.
- Text colors come from `--spotlight-color-text-*` tokens only.

### Spacing & radii
Reusable spacing tokens keep layouts balanced:

- `--spotlight-gap-2xs` (4px), `--spotlight-gap-xs` (6px), `--spotlight-gap-sm` (8px), `--spotlight-gap-md` (12px), `--spotlight-gap-lg` (16px), `--spotlight-gap-xl` (20px).
- Radii: `--spotlight-radius-small` (12px), `--spotlight-radius-medium` (16px), `--spotlight-radius-large` (24px), `--spotlight-radius-pill` (999px).
- Apply these tokens when adding new components to avoid uneven paddings or corners.

### Elevation & blur
- Global blur strength is captured in `--spotlight-backdrop-filter` (`saturate(160%) blur(28px)`).
- Elevated surfaces use `--spotlight-shadow-elevated` (`0 40px 80px rgba(15, 23, 42, 0.18)` light / `0 46px 90px rgba(2, 6, 20, 0.72)` dark).
- Floating menus use `--spotlight-shadow-floating`.
- Inputs and buttons add accent-colored shadows on hover/focus to match HIG depth cues.

## Component guidelines

### Overlay shell
- `.spotlight-overlay` fills the viewport with the overlay token and blur.
- `.spotlight-shell` applies the glass gradient, `--spotlight-shadow-elevated`, and `--spotlight-radius-large`.
- Keep shell width capped to `min(720px, 92vw)` to maintain comfortable reading widths.

### Input region
- `.spotlight-input-container` uses `--spotlight-input-bg` and `--spotlight-input-border`. Focus states use `--spotlight-input-focus-ring` and never introduce ad-hoc glow colors.
- The query field inherits `--spotlight-color-text-primary`; placeholder text uses `--spotlight-input-placeholder` for consistent contrast.
- Ghost suggestions (`.spotlight-ghost`) pull from `--spotlight-color-text-tertiary` and should only toggle opacity.

### Menus (slash commands & search engines)
- Menu surfaces reuse `--spotlight-menu-surface`, `--spotlight-menu-border`, and `--spotlight-shadow-floating`.
- Options use `var(--spotlight-color-accent-soft)` / `var(--spotlight-color-accent-soft-strong)` for hover/active states. Do not add standalone gradients.
- Icons live on chip surfaces (`--spotlight-chip-bg` + `--spotlight-chip-border`).

### Subfilters & utility chips
- `.spotlight-subfilter` and `.spotlight-subfilters-action-button` use the pill radius token and accent soft states.
- Primary CTAs (AI organizer, history assistant submit) always use the accent gradient (accent → accent-strong) with the shared drop shadow.
- Counts or metadata chips should use `--spotlight-color-accent-soft` background with primary text.

### Results list
- Rows highlight with `--spotlight-result-hover` / `--spotlight-result-active` and never change typography weight.
- Titles rely on `--spotlight-color-text-primary`, URLs on `--spotlight-color-text-tertiary`, and timestamps on `--spotlight-color-text-quiet`.
- Command results tint chips using accent soft tokens. Web-search URLs switch to the accent color to signal outbound actions.

### Panels (AI summaries, history assistant)
- Panels use `--spotlight-surface-panel` and `--spotlight-surface-panel-border` with inset 1px highlights for glass depth.
- Titles and meta lines fall back to tertiary text; actionable elements use accent soft fills.
- Status colors: loading → `--spotlight-color-accent`, empty → `--spotlight-color-text-quiet`, error → `rgba(255, 138, 138, 0.92)`.

## Theming
`ensureThemeSync` in `src/content/index.js` applies the correct theme attribute to the Shadow DOM host based on `prefers-color-scheme`. To override in development, set `data-theme="light"` or `data-theme="dark"` on `#spotlight-root` before the stylesheet loads.

When introducing new elements:

1. Use the semantic token that best matches the element (e.g., `--spotlight-chip-bg` for neutral pills, `--spotlight-color-accent-soft` for accent washes).
2. Define any additional tokens at the top of `styles.css` with both light and dark values, then reuse them.
3. Keep focus rings and hover states accessible by meeting WCAG AA contrast on both themes (the existing tokens already satisfy this—verify when adding new combinations).
4. Avoid hard-coded alpha gradients that could clash with glass layers.

## Motion & Interaction
- Hover states shift background and optionally translate by 1px for tactile feedback.
- Focus-visible states rely on accent-colored outlines (`var(--spotlight-color-accent)` variants). Do not use browser defaults.
- Loading spinners share the `.spotlight-spinner` component to keep motion consistent.

## Implementation checklist
Before merging a new UI change:

- [ ] Ensure all colors use existing CSS custom properties or add new ones with light & dark values.
- [ ] Verify the change in both light and dark themes (`prefers-color-scheme` or `data-theme` override).
- [ ] Confirm hover/focus states stay within the accent palette and keep sufficient contrast.
- [ ] Update this document if you introduce new tokens or components.

Following this design system keeps Spotlight visually cohesive and makes future enhancements faster and safer.
