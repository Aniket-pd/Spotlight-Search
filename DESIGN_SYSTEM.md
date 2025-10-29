# Spotlight Design System

This document describes the unified design system for the Spotlight extension UI. The
system is inspired by Apple's Human Interface Guidelines (HIG) and pairs those
principles with a glassmorphism visual language. The guidance below applies to all UI
surface areas rendered by the extension, including the command palette, search results,
menus, and assistant panels.

## Design Principles

1. **Clarity first** – Favor high contrast, ample whitespace, and descriptive copy.
   Elements should convey hierarchy through typography, color, and spatial rhythm.
2. **Depth with restraint** – Use layered translucency, gradients, and blur to create
   depth without distracting from content. Every glass surface must remain legible over a
   variety of page backgrounds.
3. **Fluid motion** – Interactions should feel responsive and calm. Transitions are
   limited to 200ms ease curves that reinforce focus changes (hover, selection, async
   status updates) without adding unnecessary motion.
4. **Human scale** – Controls and layout spacing follow an 8px baseline grid with
   consistent corner radii. Interactive targets are never smaller than 40×40px.

## Theming

Spotlight automatically mirrors the user's system preference between light and dark
modes. The shadow-root container exposes the active mode via the
`data-theme="light" | "dark"` attribute. This is applied inside `src/content/index.js`
when the overlay is prepared and updated whenever the `prefers-color-scheme` media query
changes.

When adding UI, select colors from the semantic tokens below. Avoid hard-coded color
values so future refinements remain centralized inside the theme definitions.

### Color Tokens

| Token | Dark value | Light value | Usage |
| --- | --- | --- | --- |
| `--spot-color-text-primary` | `#f5f5f7` | `#1c1c1e` | Primary body text and high emphasis labels |
| `--spot-color-text-secondary` | `rgba(229,229,234,0.75)` | `rgba(28,28,30,0.75)` | Secondary copy, metadata |
| `--spot-color-text-tertiary` | `rgba(209,213,219,0.6)` | `rgba(60,60,67,0.55)` | Tertiary labels, helper text |
| `--spot-color-text-muted` | `rgba(148,163,184,0.52)` | `rgba(60,60,67,0.38)` | Placeholders, subtle dividers |
| `--spot-color-accent` | `#0a84ff` | `#0a84ff` | Accent controls, focus rings |
| `--spot-color-critical` | `#ff453a` | `#ff3b30` | Error states, destructive actions |
| `--spot-color-positive` | `#32d74b` | `#34c759` | Success states |
| `--spot-color-warning` | `#ffd60a` | `#ff9500` | Warning badges |
| `--spot-surface-shell` | `rgba(30,32,42,0.65)` | `rgba(255,255,255,0.86)` | Dialog shell gradient start |
| `--spot-surface-shell-alt` | `rgba(22,24,32,0.82)` | `rgba(244,246,255,0.95)` | Dialog shell gradient end |
| `--spot-surface-input` | `rgba(16,18,28,0.78)` | `rgba(255,255,255,0.72)` | Resting input backgrounds |
| `--spot-surface-input-focused` | `rgba(26,30,44,0.92)` | `rgba(255,255,255,0.82)` | Focused input backgrounds |
| `--spot-surface-chip` | `rgba(78,92,126,0.35)` | `rgba(10,132,255,0.12)` | Filter and chip backgrounds |
| `--spot-surface-chip-active` | `rgba(10,132,255,0.28)` | `rgba(10,132,255,0.2)` | Hover/active chip states |
| `--spot-surface-tag` | `rgba(120,134,168,0.32)` | `rgba(142,142,147,0.18)` | Result tags and metadata pills |
| `--spot-surface-tag-strong` | `rgba(10,132,255,0.32)` | `rgba(10,132,255,0.22)` | Type badges |
| `--spot-surface-row-hover` | `rgba(10,132,255,0.2)` | `rgba(10,132,255,0.16)` | Hovered list rows |
| `--spot-surface-row-active` | `rgba(10,132,255,0.32)` | `rgba(10,132,255,0.24)` | Selected list rows |
| `--spot-surface-ai` | `rgba(60,70,96,0.58)` | `rgba(232,241,255,0.85)` | AI assistant panels |
| `--spot-surface-ai-border` | `rgba(112,138,255,0.32)` | `rgba(10,132,255,0.28)` | AI panel borders |
| `--spot-surface-menu` | `rgba(26,30,44,0.9)` | `rgba(255,255,255,0.92)` | Menus and popovers |
| `--spot-surface-scrim` | `rgba(12,15,21,0.35)` | `rgba(14,16,26,0.28)` | Global overlay scrim |

### Shadows, Blur, and Radii

* **Blur levels**: `--spot-blur-light (12px)`, `--spot-blur-medium (20px)`, and
  `--spot-blur-strong (32px)` control glass depth. Apply blur to translucent surfaces and
  scrims only.
* **Elevation**: `--spot-shadow-sm`, `--spot-shadow-md`, and `--spot-shadow-lg` provide
  the only shadow elevations. Larger shadows are reserved for the overlay shell.
* **Corner radii**: Radii follow an 8px rhythm—chips use `--spot-radius-pill`, inputs use
  `--spot-radius-md`, and dialog shells use `--spot-radius-lg`.

### Typography

* **Primary font**: `SF Pro Text` (system fallback stack provided in CSS). Avoid
  introducing additional font families.
* **Type ramp**: Use `--spot-font-size-xs (11px)`, `--spot-font-size-sm (12px)`,
  `--spot-font-size-md (14px)`, `--spot-font-size-lg (16px)`, and `--spot-font-size-xl
  (18px)` with weights `regular (400)`, `medium (500)`, and `semibold (600)`.
* **Line height**: `--spot-line-height-body (1.45)` ensures comfortable readability.

### Spacing

Spotlight follows a soft 8px grid expressed through the spacing tokens defined in
`src/content/styles.css`. Use these variables (`--spot-space-2`, `--spot-space-4`, etc.)
when defining padding, gap, or margin values. Mixing arbitrary spacing values leads to
misalignment and is discouraged.

## Component Guidelines

### Overlay Shell

* Use `spotlight-overlay` and `spotlight-shell` to create a frosted glass container with
  backdrop blur and gradient fill.
* Keep the shell width within 720–760px and center it vertically using flexible padding.
* Never place opaque backgrounds directly behind translucent shells; the host page should
  subtly show through.

### Inputs and Search Field

* The main query field uses `spotlight-input-container` and `spotlight-input`.
* Apply `.focused` to the container when it receives focus to trigger accent borders and
  ambient glow.
* Use the ghost element (`spotlight-ghost`) for inline autocomplete suggestions with
  reduced contrast.

### Menus and Command Lists

* Slash command and engine menus use the shared popover styles. Populate them with
  `.spotlight-slash-option` or `.spotlight-engine-option` elements.
* Active/hover states tint the background using the accent color; do not override this
  with custom shades.

### Subfilters and Chips

* Filter buttons use `.spotlight-subfilter`. Active states rely on `color-mix` accent
  blends—avoid reintroducing flat opaque fills.
* `spotlight-subfilters-action-button` is the single style for contextual quick actions.
  Apply modifier classes (`.running`, `.success`, `.error`) to communicate async status.

### Results List

* Rows rely on `.spotlight-result` with metadata tokens. Keep icons at 28×28px and allow
  titles to truncate with ellipses.
* Use `.spotlight-result-tag` for metadata pills and extend with additional modifier
  classes (`download-state-*`, `spotlight-result-tag-topsite`) for domain-specific colors.
* The summary trigger uses `.spotlight-result-summary-button`; do not create alternative
  button treatments within the results list.

### Assistant Panels

* The history assistant and AI summary panels share the glass surface tokens described
  above. Maintain the provided layout structure to keep typography and spacing aligned.

## Interaction States

| State | Treatment |
| --- | --- |
| Focus | Accent ring created with `box-shadow` (`color-mix` based on `--spot-color-accent`). |
| Hover | Increase translucency contrast or lighten surfaces using accent blends. |
| Active/Selected | Stronger accent tint with `--spot-surface-row-active` or gradient fills. |
| Disabled | Reduce opacity to 60–70% and remove hover/focus shadows. |
| Loading | Apply `.running` with the shared `spotlight-spinner`. |
| Success/Error | Apply `.success` or `.error` modifiers to action buttons to surface
  positive or critical states using semantic color tokens. |

## Implementation Checklist

1. **Use semantic tokens** – Reference the custom properties defined in
   `src/content/styles.css` instead of hard-coded colors or spacing.
2. **Respect theming** – New elements must read the active `data-theme` attribute and rely
  on existing tokens so they automatically adapt to light/dark modes.
3. **Maintain focus order** – Ensure keyboard navigation follows the visual order and
  every interactive control has a visible focus state.
4. **Test transparency** – Verify legibility on both dark and light host pages, checking
  for sufficient contrast with the blurred background.
5. **Document additions** – Update this file when introducing new components or tokens to
  keep the system authoritative.

Adhering to this design system keeps the Spotlight experience cohesive, accessible, and
in harmony with Apple's HIG-driven aesthetic.
