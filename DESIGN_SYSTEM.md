# Spotlight Design System

## Overview
Spotlight now mirrors the minimal glass overlay shown in the reference comps. Light mode leans into warm amber glass layered over the desktop wallpaper, while dark mode becomes a graphite scrim with a cool white core. Both palettes emphasize depth through translucent surfaces, precise borders, and softened shadows so the command list feels suspended above the page without heavy chrome.

Core principles:

- **Ambient luminosity.** Large surfaces use directional gradients and a subtle blend highlight to recreate the macOS glow. Scrims stay translucent so background context still peeks through.
- **Hierarchy by opacity.** Text and surface tokens step down in alpha to separate titles, metadata, and quiet utility copy without changing typography.
- **Minimal affordances.** Buttons, chips, and list rows rely on shared geometry, soft borders, and light motion instead of saturated fills so focus stays on the results.
- **Theme parity.** The same structure, spacing, and interaction states work in both themes by swapping the underlying token values.

## Foundations

### Color tokens
The palette lives at the top of `src/content/styles.css` as CSS custom properties. Tokens should always be referenced instead of hard-coded values.

| Token | Purpose | Light theme | Dark theme |
| --- | --- | --- | --- |
| `--spotlight-color-overlay` | Full-screen scrim | `rgba(66, 32, 18, 0.55)` | `rgba(6, 8, 12, 0.58)` |
| `--spotlight-surface-gradient` | Shell background | `linear-gradient(155deg, rgba(118, 62, 36, 0.78), rgba(36, 18, 10, 0.86))` | `linear-gradient(155deg, rgba(44, 46, 56, 0.82), rgba(10, 12, 18, 0.9))` |
| `--spotlight-surface-panel` | Secondary panels & assistants | `linear-gradient(155deg, rgba(92, 48, 26, 0.86), rgba(30, 16, 8, 0.92))` | `linear-gradient(155deg, rgba(38, 40, 54, 0.9), rgba(12, 14, 22, 0.94))` |
| `--spotlight-surface-border` | Shell outline | `rgba(255, 220, 186, 0.32)` | `rgba(136, 144, 168, 0.28)` |
| `--spotlight-surface-border-subtle` | Hairlines & dividers | `rgba(255, 220, 186, 0.14)` | `rgba(136, 144, 168, 0.14)` |
| `--spotlight-color-text-primary` | Primary text | `rgba(255, 247, 236, 0.94)` | `rgba(245, 247, 255, 0.95)` |
| `--spotlight-color-text-secondary` | Body text | `rgba(255, 247, 236, 0.72)` | `rgba(204, 210, 224, 0.72)` |
| `--spotlight-color-text-tertiary` | Metadata | `rgba(255, 247, 236, 0.56)` | `rgba(170, 176, 196, 0.56)` |
| `--spotlight-color-text-quiet` | Low-emphasis copy | `rgba(255, 247, 236, 0.4)` | `rgba(138, 144, 168, 0.42)` |
| `--spotlight-color-accent` | CTA accent | `#f6ba7a` | `#8ea8ff` |
| `--spotlight-color-accent-strong` | Accent highlight | `#f0a65c` | `#6f8cff` |
| `--spotlight-color-accent-soft` | Accent wash | `rgba(246, 186, 122, 0.18)` | `rgba(142, 168, 255, 0.18)` |
| `--spotlight-result-hover` | List hover background | `rgba(255, 255, 255, 0.06)` | `rgba(255, 255, 255, 0.05)` |
| `--spotlight-result-active` | Active row background | `rgba(255, 255, 255, 0.16)` | `rgba(255, 255, 255, 0.1)` |

Additional tokens for inputs, chips, menus, and elevation live alongside these variables—reuse them when adding new UI to keep the layered glass effect consistent.

### Typography
- Font stack: `"SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Base size: `16px` with `1.45` line-height. Titles drop to `15px` with slightly tighter tracking to match macOS.
- Weight usage: 600 for titles and CTA labels, 500 for filters, 400 for metadata. Avoid bold jumps; rely on the text color tokens for hierarchy.

### Spacing & radii
- Spacing tokens: `--spotlight-gap-2xs` (4px), `--spotlight-gap-xs` (6px), `--spotlight-gap-sm` (8px), `--spotlight-gap-md` (12px), `--spotlight-gap-lg` (16px), `--spotlight-gap-xl` (20px).
- Radii: `--spotlight-radius-small` (12px), `--spotlight-radius-medium` (16px), `--spotlight-radius-large` (20px), `--spotlight-radius-pill` (999px).
- Apply these consistently so edges align with the shell curvature.

### Elevation & blur
- Backdrop blur: `--spotlight-backdrop-filter = saturate(180%) blur(40px)` for shell, inputs, menus, and pills.
- Elevated shell shadow: `--spotlight-shadow-elevated` (warm) `0 42px 88px rgba(12, 4, 0, 0.65), 0 18px 36px rgba(12, 4, 0, 0.45)` / (dark) `0 46px 96px rgba(0, 0, 0, 0.6), 0 18px 40px rgba(0, 0, 0, 0.42)`.
- Floating menus reuse `--spotlight-shadow-floating` for a softer drop.
- Row focus uses a lifted shadow (`0 16px 34px rgba(10, 6, 2, 0.32)`) coordinated with the active background token.

## Component guidance

### Overlay & shell
- `.spotlight-overlay` fills the viewport with the overlay token while keeping the wallpaper visible.
- `.spotlight-shell` uses the gradient token, shell border, and blur plus a blend-mode highlight (`::before`) to emulate the Ventura glass edge.
- Keep shell padding (`20px 18px`) so the input and first list item breathe like the reference layout.

### Input region
- `.spotlight-input-container` always draws a 1px border, glass background, and the shared focus ring. This keeps the field integrated with the shell instead of floating.
- Icons, ghost text, and placeholder colors come directly from the text tokens; avoid hard-coded grays.
- The divider beneath the input uses `--spotlight-surface-border-subtle` for the thin rule separating filters.

### Filters & shortcuts
- Filter chips now start transparent with only hover and active states filling in. Use `--spotlight-chip-*` tokens and keep transitions gentle (0.22s).
- Subfilters share the same geometry. Focus states rely on a warm accent outline; avoid custom glows.
- The optional action button (`.spotlight-subfilters-action-button`) stays in the accent gradient with warm shadows. Success and error states shift the gradient, but the geometry stays consistent.

### Results list
- Rows stretch to the shell padding, gaining a 1px border and subtle lift on focus/active states. Do not add additional outlines.
- Titles use `15px/22px` with negative tracking to mirror macOS. Metadata stacks with `13px` size and secondary text color.
- Icons sit on a translucent tile with an inset highlight so favicons, letters, and downloads all feel cohesive.
- Scrollbars use muted surface tones to avoid distracting from the command list.

### Panels & menus
- AI panels, history assistant, and slash/engine menus all reuse the panel tokens and floating shadow.
- Buttons inside panels should stick to accent gradients or the neutral chip styles—no new color ramps.

### Status & tags
- Use the warm accent tokens for progress/default states. Dedicated positive/critical tokens remain available for success/error badges.
- Download tags keep their distinct states but reduce saturation to blend with the neutral shell.

## Theming
The stylesheet automatically respects `prefers-color-scheme`. To preview themes manually, set `data-theme="light"` or `data-theme="dark"` on the host element. Every new color or elevation token must define both theme values so the light (amber) and dark (graphite) experiences stay in sync.

## Implementation checklist

- [ ] Reference existing CSS variables; add new ones only when a component truly needs a distinct semantic token.
- [ ] Test changes in both light and dark themes to ensure contrast ratios stay above AA and the glass layering reads correctly.
- [ ] Keep interactions subtle—translate at most 1px on hover/focus and reuse the shared shadows.
- [ ] Update this document if you introduce new tokens, surface treatments, or component patterns.

Following this system keeps Spotlight visually aligned with the reference UI while remaining flexible for future commands and panels.
