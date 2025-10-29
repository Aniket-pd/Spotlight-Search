# Spotlight Design System

The Spotlight extension now uses a unified, token-driven design system that delivers a professional, minimal, and cohesive UI in both light and dark themes. This guide documents the core foundations, component patterns, motion language, and theming rules so the experience can be maintained and extended without sacrificing polish.

## Design Principles

1. **Clarity first.** Information density, whitespace, and hierarchy should make it effortless to parse search results and actions at a glance.
2. **Balanced contrast.** Surfaces layer progressively using soft borders and depth so that primary content is foregrounded without harsh transitions.
3. **Tactile motion.** Micro-interactions respond quickly, easing in and out with short curves. Motion reinforces state changes without calling attention to itself.
4. **System aware.** The interface respects user preferences (color scheme, reduced motion) and provides explicit overrides for future expansion.

## Foundations

### Typography

| Token | Size | Weight | Usage |
| --- | --- | --- | --- |
| `--spotlight-font-size-xl` | 18px | Medium (500) | Primary command input and AI suggestions.
| `--spotlight-font-size-lg` | 16px | Semibold (600) | Result titles, section headers.
| `--spotlight-font-size-md` | 15px | Medium (500) | Body copy inside cards, menu descriptions.
| `--spotlight-font-size-sm` | 13px | Regular (400) | Status text, meta rows, supporting copy.
| `--spotlight-font-size-xs` | 12px | Semibold (600) | Badges, chips, helper labels.

- Primary family: `Inter, SF Pro Text, Segoe UI, system-ui`. Keep all typography components aligned to this stack.
- Letter spacing is slightly tightened (−0.01em) for display text and widened (0.08–0.12em) for uppercase utility labels.
- Use `font-weight-semibold` for actionable text (buttons, chips) to reinforce affordances.

### Color Palette

| Role | Light Theme | Dark Theme | Notes |
| --- | --- | --- | --- |
| Scrim | `rgba(15,18,26,0.45)` | `rgba(4,7,16,0.62)` | Semi-opaque overlay with blur to emphasize the dialog.
| Surface / Primary | `#FFFFFF` | `rgba(13,16,27,0.94)` | Main shell background; always pair with 1px border.
| Surface / Subtle | `#F5F7FB` | `rgba(18,22,35,0.92)` | Header gradients, cards, menus.
| Surface / Muted | `#EDF1F9` | `rgba(21,27,42,0.92)` | Inputs, secondary cards, AI panel.
| Border | `rgba(15,23,42,0.08)` | `rgba(148,163,255,0.16)` | Light separators between surfaces.
| Text / Primary | `#0F172A` | `#F1F5FF` | Default text color.
| Text / Secondary | `#475569` | `rgba(199,206,233,0.88)` | Meta information, body copy.
| Text / Muted | `rgba(71,85,105,0.72)` | `rgba(165,178,215,0.65)` | Tertiary hints and statuses.
| Accent | `#365CFF` | `#95A3FF` | Commands, focus states, emphasized controls.
| Positive | `#16A34A` | `#4ADE80` | Success chips, confirmations.
| Warning | `#F59E0B` | `#FBBC24` | Download paused, caution chips.
| Danger | `#DC2626` | `#FDA4AF` | Errors, destructive confirmations.
| Info | `#0EA5E9` | `#38BDF8` | Loading states, AI preview messaging.

All colors are exposed as CSS custom properties prefixed with `--spotlight-color-…` so future components can reuse the palette without hardcoded values.

### Spacing & Layout

- Base unit: `--spotlight-space-1` = 4px (0.25rem).
- Larger increments multiply the base (`--space-2` = 8px, `--space-5` = 20px, etc.).
- Vertical rhythm: section headers use `space-3` gaps, while stacked cards and lists use `space-2`.
- Dialog width is constrained to `min(780px, 94vw)` with generous surrounding scrim padding (`clamp(64px, 12vh, 120px)`).

### Elevation & Radii

- Radii scale: XS 6px, SM 8px, MD 10px, LG 14px, XL 18px, Pill 999px.
- Use `--spotlight-radius-xl` for the shell, `--radius-lg` for inputs/cards, and `--radius-pill` for badges and chips.
- Shadows progress from `--spotlight-shadow-xs` (subtle inset) to `--spotlight-shadow-lg` (dialog depth). Avoid stacking multiple shadows on the same element.

### Iconography & Imagery

- Favicons and menu icons sit inside 32×32 containers with `radius-sm` rounding.
- Placeholder glyphs use uppercase initials with `font-weight-semibold` and should rely on `--spotlight-color-tag-neutral` backgrounds.
- Status indicators (tags, chips) always use pill shapes with uppercase text for quick scanning.

### Motion

- Standard animation durations: `120ms` (fast), `180ms` (base), `260ms` (slow).
- Easing: `cubic-bezier(0.2, 0, 0.38, 0.9)` for standard transitions; `cubic-bezier(0.3, 0, 0.3, 1)` for emphasized hover/press states.
- Spinner uses a continuous 0.8s rotation tied to the current text color.
- `prefers-reduced-motion` collapses all durations to ~0ms while retaining state changes.

## Core Components

### Overlay & Shell

- `spotlight-overlay` fills the viewport with a blurred scrim to reduce background contrast.
- `spotlight-shell` hosts the dialog with XL rounding, 1px border, and large soft shadow. Keep overflow visible so menus can escape the shell bounds.

### Command Input

- Wrapper uses a vertical gradient from subtle surface to primary surface to stage the search field.
- Input container highlights on focus with both border and 3px focus ring; placeholder text is tertiary tone for low emphasis.
- Ghost suggestion overlays share font metrics with the input and fade in/out with 180ms transitions.

### Slash & Engine Menus

- Menus float below the input (`space-2` offset) and share the same radius and blur language.
- Options use `space-3` vertical padding and align content with `space-2` gaps.
- Active/hover states tint the background with `--spotlight-color-accent-soft` and elevate text weight.

### Subfilters & Actions

- Subfilters align in a horizontally scrollable strip with gradient mask to soften edges.
- Pills inherit accent states: default (neutral tag), hover (accent soft), active (solid accent).
- Primary action button uses uppercase text, accent soft background, and spinner overlay for progress states.

### History Assistant

- Card-like container inside the input stack; toggled visibility controls the layout.
- Inputs and secondary actions reuse the general button styles for consistent focus and hover feedback.
- Header metadata lines use pseudo-icon prefixes (`⏱`, `•`) and compact spacing for quick scanning.

### Results List

- `spotlight-results` scrolls up to 420px with custom scrollbar styling aligned to the theme.
- Result rows provide generous horizontal padding (`space-5`) and respond to hover/selection with accent hues.
- Meta rows wrap as needed with `space-2` gaps; badges and timestamps use uppercase, tabular numerals for alignment.
- History-assistant results keep a subtle accent background and left border accent when active to indicate context.

### AI Panel

- Nested card appended to relevant results. Uses muted surface with `shadow-xs`, uppercase title badge, and optional copy button.
- Lists default to `disc` markers (inside) and 13px typography.
- Status text colors shift between info, muted, and danger to reflect load states.

## Interaction States

- **Focus:** Buttons, inputs, and pills all share a 3px focus halo using `--spotlight-color-focus-ring`.
- **Disabled:** Lower opacity (`0.55–0.65`) combined with the default cursor removes affordance.
- **Active selection:** Adds a slight upward translation (`-1px`) to reinforce keyboard navigation.

## Theming & Extensibility

- Base tokens are defined on `:host` for the light theme.
- Explicit overrides are available via `data-theme="light"` or `data-theme="dark"` attributes on the shadow host.
- Without an attribute, the system respects `prefers-color-scheme` and automatically applies dark theme tokens when appropriate.
- When creating new components, reference existing tokens (e.g., `var(--spotlight-color-surface-muted)`) instead of hardcoding colors.
- Shadows, borders, and typography should always come from the token set to guarantee visual cohesion.

## Motion & Accessibility Guidelines

- Keep transitions under 260ms; use the `--spotlight-duration-fast` token for micro interactions (hover, pressed states).
- Ensure interactive elements update `cursor` and `opacity` to signal disabled states.
- Respect reduced motion preferences by leaning on instantaneous state changes rather than transform animations.

## Implementation Notes

- All styles live in `src/content/styles.css` and are scoped through the shadow DOM so they do not leak into the host page.
- Use `spotlight-root` as the mount node for any new UI. When adding elements, favor existing utility classes or extend them to keep spacing and radii consistent.
- Iconography and imagery should be masked or centered inside rounded containers to match the current favicon presentation.
- For theming, set `shadowHostEl.dataset.theme = 'dark'` (or `light`) in the content script if a manual toggle is introduced; otherwise rely on the default system detection.

By adhering to these guidelines and tokens, future enhancements will remain consistent, expressive, and polished across both light and dark experiences.
