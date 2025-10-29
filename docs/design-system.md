# Spotlight Search Design System

This document defines the unified visual language for the Spotlight Search browser extension. The system is inspired by Apple's Human Interface Guidelines (HIG) and embraces a glassmorphism aesthetic so the UI feels lightweight, immersive, and consistent across all surfaces. Every component in the extension uses the tokens and patterns described here.

## Core Principles

1. **Clarity first** – Typography, spacing, and hierarchy mirror the rhythm of macOS Spotlight and other HIG search experiences so results are scannable at a glance.
2. **Glass layers** – Surfaces layer frosted translucent panels above the user’s content while keeping the focus on results. Blur, gradients, and subtle borders reinforce depth.
3. **Vivid focus** – Interactions rely on accent gradients and soft focus rings that stand out in both light and dark contexts without overwhelming content.
4. **Consistency and reuse** – All colors, radii, transitions, and component recipes are defined as reusable tokens in `src/content/styles.css`. New UI should only use these tokens to ensure future updates inherit the same polish.

## Foundations

### Typography

| Token | Usage | Value |
| --- | --- | --- |
| `--spotlight-font-sans` | Body text, navigation, controls | `"SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` |
| `--spotlight-font-rounded` | Accents, highlight badges | `"SF Pro Rounded", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` |
| `--spotlight-font-mono` | URLs, metadata, keyboard hints | `"SF Mono", "Roboto Mono", ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace` |
| `--spotlight-text-lg` | Primary result titles | `17px` |
| `--spotlight-text-md` | Body copy, menu titles | `15px` |
| `--spotlight-text-sm` | Metadata, captions | `13px` |
| `--spotlight-text-caption` | Badges, indicators | `11px` |

Line heights follow HIG’s comfortable reading rhythm: `--spotlight-line-height-sm` (`1.35`) for dense metadata, `--spotlight-line-height-md` (`1.42`) for most copy, and `--spotlight-line-height-lg` (`1.48`) for long-form descriptions.

### Spacing

Spacing tokens (`--spotlight-space-*`) are increments of two that underpin padding, gaps, and layout gutters. Key breakpoints include:

- `--spotlight-space-8` (8 px) for tight chips and badges.
- `--spotlight-space-12` (12 px) for component gaps.
- `--spotlight-space-16` (16 px) for internal padding.
- `--spotlight-space-24` (24 px) and `--spotlight-space-28` (28 px) for major panel padding.

Use combinations of these values to maintain rhythm with the default layout.

### Radii & Shadows

- Radii range from `--spotlight-radius-sm` (8 px) for keyboard shortcuts and badges to `--spotlight-radius-xl` (24 px) for the main shell. Chips use `--spotlight-radius-pill` for HIG-like capsules.
- Shadows (`--spotlight-shadow-xs` through `--spotlight-shadow-lg`) give every elevation level a consistent blur and spread. Apply them exactly as defined in the stylesheet.

### Motion

Transitions use easing `--spotlight-ease` (`cubic-bezier(0.4, 0.14, 0.3, 1)`) with three durations: fast (120 ms), base (180 ms), and slow (240 ms). The design honors `prefers-reduced-motion` by zeroing these values.

## Color System & Theming

The design system supports light and dark modes automatically. The script in `src/content/index.js` detects the user’s `prefers-color-scheme` value and sets `data-theme="light"` or `data-theme="dark"` on the Shadow DOM root so the stylesheet can swap tokens.

### Shared Tokens

| Token | Purpose |
| --- | --- |
| `--spotlight-scrim` | Glassmorphism overlay tint behind the shell |
| `--spotlight-surface-primary` | Main shell gradient start color |
| `--spotlight-surface-secondary` | Main shell gradient end color |
| `--spotlight-surface-veil` | Header background tint |
| `--spotlight-surface-popover` | Slash/engine menu surface |
| `--spotlight-surface-hover` / `--spotlight-surface-active` | Interactive hover/active overlays |
| `--spotlight-border-soft` / `--spotlight-border-strong` | Frosted glass outline intensity |
| `--spotlight-text-*` | Primary through quaternary text roles |
| `--spotlight-accent`, `--spotlight-accent-strong`, `--spotlight-accent-gradient`, `--spotlight-accent-soft` | Accent blue palette & gradients |
| `--spotlight-positive`, `--spotlight-warning`, `--spotlight-critical` (+ `*-soft`) | Status feedback colors |
| `--spotlight-focus-ring`, `--spotlight-focus-ring-soft` | Ring and halo for focus states |

Light and dark themes redefine these tokens to maintain contrast while keeping the same component structure. Always reference tokens, not raw colors, when introducing new styles.

### Glass Treatment

The following recipe applies to all elevated surfaces:

```css
background: linear-gradient(155deg, var(--spotlight-surface-primary), var(--spotlight-surface-secondary));
backdrop-filter: blur(var(--spotlight-blur-strength)) saturate(150%);
border: 1px solid var(--spotlight-border-soft);
box-shadow: var(--spotlight-shadow-lg);
```

Menus and chips reuse a lighter version (less blur, softer border) for visual harmony.

## Component Library

All selectors live in `src/content/styles.css`. Each component section is self-contained so new UI can copy the relevant block.

### 1. Overlay & Shell
- `.spotlight-overlay` defines the screen scrim, blur, and centering.
- `.spotlight-shell` sets the primary glass card, width, and overflow handling.
- `.spotlight-input-wrapper` draws the frosted header area with subtle gradient separation.

### 2. Search Input Stack
- `.spotlight-input-container` combines the glass input field, border transitions, and pointer behavior.
- `.spotlight-input` uses SF Pro with accent-tinted selections.
- `.spotlight-ghost` provides inline suggestion text in tertiary color.
- `.spotlight-status` communicates search feedback with subdued typography.

### 3. Subfilters & Actions
- `.spotlight-subfilters` + `.spotlight-subfilters-scroll` handle chip layout with horizontal scroll.
- `.spotlight-subfilter` and `.spotlight-subfilter.active` implement capsule buttons mirroring HIG segmented controls.
- `.spotlight-subfilters-action-button` variants (`.running`, `.success`, `.error`) expose asynchronous bookmark organizer states.
- `.spotlight-spinner` supplies the loading micro-interaction.

### 4. Slash & Engine Menus
- `.spotlight-slash-menu` and `.spotlight-engine-menu` share the popover glass recipe.
- `.spotlight-slash-option`/`.spotlight-engine-option` define row spacing, hover, and active gradients.
- `.spotlight-engine-option-icon` wraps favicons or custom icons with consistent rounding.

### 5. Results List
- `.spotlight-results` manages list density, scrollbars, and max height.
- `.spotlight-result` covers the default card, while `.active`/`.focused` apply accent gradients.
- `.spotlight-result-icon` + `.spotlight-result-placeholder` handle iconography.
- `.spotlight-result-title`, `.spotlight-result-meta`, `.spotlight-result-url`, `.spotlight-result-command`, `.spotlight-result-summary-button` style textual content, keyboard hints, and AI summary controls.
- `.spotlight-result-history-assistant` highlights embedded assistant content.

### 6. History Assistant
- `.spotlight-history-assistant` and nested classes (`-header`, `-label`, `-meta`, `-form`, `-input`, `-submit`, `-status`, `-clear`, `-range`) create a cohesive mini-panel for natural-language browsing.

### 7. AI Panel (Tab Summaries)
- `.spotlight-ai-panel` and its header, controls, badge, copy, list, and status classes provide a compact summary drawer aligned with the rest of the results.

### 8. Accessibility & Focus
- All interactive elements use the shared focus-ring tokens to deliver clear keyboard states while respecting `prefers-reduced-motion`.
- Default contrast ratios exceed WCAG AA in both themes; accent gradients lighten text to `--spotlight-text-inverse` for readability.

## Interaction Guidelines

- **State changes**: Use the provided modifier classes (`.active`, `.focused`, `.running`, `.success`, `.error`, `.loading`) for consistent color and motion. Avoid inline styles for state changes—toggle classes instead.
- **Spacing**: Stack new components using existing gap tokens. When creating new rows or sections, mimic the padding and gap structure in `.spotlight-input-wrapper` and `.spotlight-results`.
- **Typography hierarchy**: Titles use `--spotlight-text-lg`/`600` weight. Metadata uses `--spotlight-text-sm`/`500`–`560`. Never mix fonts outside the defined families.
- **Glass layering**: Any new elevated component should combine a translucent background, blurred backdrop, soft border, and the designated shadow tier to remain coherent with the rest of the system.
- **Theming**: Do not hardcode colors. Instead, introduce new custom properties on `.spotlight-root` if an additional semantic role is needed, and set both light and dark values.

## Implementation Notes

- The stylesheet lives at `src/content/styles.css` and is injected inside a Shadow DOM. This guarantees isolation; global styles must be declared explicitly in that file.
- `src/content/index.js` manages theme synchronization. When adding DOM nodes manually, the theme attribute propagates automatically because all elements inherit from `.spotlight-root[data-theme="…"]`.
- Spinner, shimmer, and focus styles are the only animations. Keep new animations subtle and honor `prefers-reduced-motion` where appropriate.

## Extending the System

1. Add or adjust tokens in the `.spotlight-root` block and its `[data-theme]` variants.
2. Document any new token inside this file so future contributors maintain parity between code and documentation.
3. Build new components by copying existing structural patterns (input, chip, card) to ensure spacing, blur, and motion feel native to the extension.
4. Validate light/dark contrast with the accent palette to stay aligned with the HIG emphasis on legibility.

By following this design system, every UI element in the extension will stay coherent, resilient, and unmistakably aligned with the macOS glass aesthetic.
