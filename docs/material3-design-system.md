# Spotlight Material 3 Design System

The Spotlight extension now uses a unified Material You (Material 3) design language
with adaptive color, typography, shape, and motion foundations. This document
captures the system tokens and implementation guidance required to keep the UI
consistent across the overlay, popup, and settings experiences.

---

## 1. Dynamic Color Tokens

Dynamic color tokens are generated at runtime from the user's wallpaper or
system accent color. The content script resolves the preferred source color via
`SPOTLIGHT_THEME_REQUEST` and computes a tonal palette for both light and dark
modes. Tokens are exposed as CSS custom properties on the overlay host.

### 1.1 Source Color
- `--md-source`: HSL triplet representing the Material You source color (e.g.
  `228 96% 64%`).

### 1.2 Light Scheme
| Token | Description |
| ----- | ----------- |
| `--md-sys-color-primary` | Accent color for high-emphasis UI actions. |
| `--md-sys-color-on-primary` | Text/icon color on primary surfaces. |
| `--md-sys-color-primary-container` | Elevated container background for primary content. |
| `--md-sys-color-on-primary-container` | Text/icon color on primary containers. |
| `--md-sys-color-secondary` | Complementary accent for chips, filters, and supportive UI. |
| `--md-sys-color-on-secondary` | Text/icon color on secondary elements. |
| `--md-sys-color-secondary-container` | Background for secondary chips and menus. |
| `--md-sys-color-on-secondary-container` | Text/icon color on secondary containers. |
| `--md-sys-color-tertiary` | Expressive accent for AI and assistive features. |
| `--md-sys-color-on-tertiary` | Text/icon color on tertiary elements. |
| `--md-sys-color-tertiary-container` | Background for AI panels and status cards. |
| `--md-sys-color-on-tertiary-container` | Text/icon color on tertiary containers. |
| `--md-sys-color-surface` | Base scrim surface for the overlay. |
| `--md-sys-color-surface-dim`/`surface-bright` | Lower/upper tonal values for surface layering. |
| `--md-sys-color-surface-container-low[est]` | Container colors for low elevation content. |
| `--md-sys-color-surface-container[/-high/-highest]` | Container colors for elevated shells, cards, and menus. |
| `--md-sys-color-on-surface` | Primary text color on surfaces. |
| `--md-sys-color-on-surface-variant` | Secondary text/icon color. |
| `--md-sys-color-outline` | Divider and focus outline color. |
| `--md-sys-color-outline-variant` | Subtle border color for cards and menus. |
| `--md-sys-color-inverse-surface` | Color used for inverse surfaces (e.g., toast backgrounds). |
| `--md-sys-color-inverse-on-surface` | Text/icon color on inverse surfaces. |
| `--md-sys-color-inverse-primary` | Accent color when inverse elevation is needed. |
| `--md-sys-color-error`/`on-error`/`error-container`/`on-error-container` | Material error system tokens. |
| `--md-sys-color-shadow` | Shadow color for elevation levels. |
| `--md-sys-color-scrim` | Scrim color for the global overlay. |
| `--spotlight-surface-tint` | Tint color applied to glass surfaces. |

### 1.3 Dark Scheme
Dark-mode tokens mirror the light scheme, with values tuned for contrast on
nocturnal surfaces. The same token names are reused; the theme generator assigns
appropriate dark tonal values.

### 1.4 Dynamic Update Flow
1. Content script requests stored/wallpaper accent color from the service
   worker (`SPOTLIGHT_THEME_REQUEST`).
2. If unavailable, the script samples document accent variables or meta
   `theme-color` before falling back to the default source.
3. The tonal palette is generated in `createMaterialPaletteFromSource` and the
   host element receives the computed CSS variables alongside a `data-theme`
   attribute (`light`/`dark`).
4. Future updates should persist custom accent choices via
   `SPOTLIGHT_THEME_UPDATE` to keep palette changes in sync across tabs.

---

## 2. Typography Scale

| Token | Size / Line Height | Usage |
| ----- | ----------------- | ----- |
| `--md-sys-typescale-title-large` | 22 / 28 px | Overlay headers, modal titles. |
| `--md-sys-typescale-title-medium` | 18 / 24 px | Search field input, primary result titles. |
| `--md-sys-typescale-body-large` | 16 / 24 px | Supporting copy, AI summaries. |
| `--md-sys-typescale-body-medium` | 14 / 20 px | Secondary metadata, menu descriptions. |
| `--md-sys-typescale-label-large` | 14 / 20 px | Button labels, filters, badges. |
| `--md-sys-typescale-label-medium` | 12 / 16 px | Tags, timestamps, assistive labels. |

The font stack uses `Roboto Flex` / `Google Sans` with optical size (`"opsz"`)
and grade (`"GRAD"`) axes applied to interactive elements for improved clarity.

---

## 3. Shape & Layout System

### 3.1 Corner Radii
| Token | Radius |
| ----- | ------ |
| `--md-sys-shape-corner-extra-small` | 8 px |
| `--md-sys-shape-corner-small` | 12 px |
| `--md-sys-shape-corner-medium` | 16 px |
| `--md-sys-shape-corner-large` | 20 px |
| `--md-sys-shape-corner-extra-large` | 28 px |
| `--md-sys-shape-corner-full` | 999 px |

### 3.2 Layout Grid & Breakpoints
- **Chrome popup (≤ 640 px):** single-column layout, shell width = min(100vw,
  480 px), internal padding uses `space-md` (16 px) to preserve breathing room.
- **Overlay (default desktop):** shell width = min(760 px, 92 vw), 24 px outer
  padding, and responsive result cards with 16 px gutters.
- **Settings view (≥ 960 px):** two-column adaptive grid: 280 px navigation rail
  + fluid content column with 24 px gutters.

Spacing tokens:
- `--spotlight-space-2xs` = 4 px (micro gaps, icon spacing).
- `--spotlight-space-xs` = 8 px (chip gaps, inline labels).
- `--spotlight-space-sm` = 12 px (metadata stacks).
- `--spotlight-space-md` = 16 px (standard component padding).
- `--spotlight-space-lg` = 20 px (section padding, card gutters).
- `--spotlight-space-xl` = 24 px (shell padding, modal edges).

---

## 4. Elevation & Glassmorphism

Elevation tokens map to Material 3 shadow guidelines while preserving a soft
frosted effect:

| Level | Token | Shadow |
| ----- | ----- | ------ |
| 1 | `--md-sys-elevation-level1` | `0 1px 3px rgba(15,23,42,0.18)`, inset highlight for glass edges. |
| 2 | `--md-sys-elevation-level2` | `0 4px 8px rgba(15,23,42,0.16)` + subtle blur. |
| 3 | `--md-sys-elevation-level3` | `0 12px 24px rgba(15,23,42,0.18)` for the primary shell. |
| 4 | `--md-sys-elevation-level4` | `0 18px 32px rgba(15,23,42,0.2)` for expanded overlays. |

Glassmorphism treatment:
- Surfaces use `backdrop-filter: blur(26-30px) saturate(140-160%)`.
- `--spotlight-surface-tint` adds a faint tint derived from the source color to
  maintain Material You tonal balance.

---

## 5. Motion & Interaction

Animations follow Material 3 motion patterns with easing tokens defined at the
CSS layer (`standard`, `emphasized`, `decelerate`, `accelerate`). Key patterns:

| Pattern | Usage | Duration | Easing |
| ------- | ----- | -------- | ------ |
| Overlay enter (`overlay-fade-in`) | Shell presentation | 300 ms | `emphasized` |
| Surface lift (`surface-lift`) | Shell scale/translate spring | 300 ms | `emphasized` |
| Menu fade (`menu-fade-in`) | Context menus and slash palette | 250 ms | `emphasized` |
| Focus transitions | Input focus ring, chip selection | 200 ms | `standard` |
| Loading spinner | Indeterminate states | 0.8 s loop | Linear |

All motion automatically shortens under `prefers-reduced-motion: reduce` to
maintain accessibility. Spatial transitions rely on scale + translate to mirror
Material's spring-like feel.

---

## 6. Component Usage Examples

### 6.1 Buttons
- **Primary action (`spotlight-subfilters-action-button`, submit buttons):**
  uses `--md-sys-color-primary` background, 16 px vertical padding, full-radius
  shape. Hover elevates to level 2 and lightens tint.
- **Assist buttons (`spotlight-result-summary-button`):** tonal-filled chips
  with outline accent; transitions include upward translation and tint change.
- **Danger state:** swap to `--md-sys-color-error` background with
  `--md-sys-color-on-error` text.

### 6.2 Cards & Panels
- Results list items use tonal surfaces with hover/active states blending
  primary tint (14%). Active items translate by 2 px to communicate focus.
- AI summary (`spotlight-ai-panel`) leverages the tertiary container with badge
  tokens for model status.
- History assistant card reuses surface container colors with level-1 elevation
  and spring transitions for visibility toggles.

### 6.3 Overlays & Menus
- Global overlay: scrim background (70% opacity) + dynamic blur.
- Slash command / search engine menus share medium elevation (level 3) and
  animated entrance via `menu-fade-in`.
- Engine icons sit inside 32 px containers tinted by secondary color.

### 6.4 Search Bar
- Input field uses medium shape (16 px radius) with container-high background.
- Focus state animates border tint + 3 px focus halo using the primary color.
- Ghost suggestions live in the same container, blending `on-surface` at 30%
  opacity for unobtrusive hints.

### 6.5 Modals & Dialogs
- Primary shell: level-3 elevation, 20 px corner radius.
- Secondary dialogs (settings) reuse the same tokens but adopt larger radii
  (`extra-large`) when the viewport permits to emphasize hierarchy.

---

## 7. Adaptive Layout Guidance

- **Search overlay:** maintain 12 vh top offset on desktop. On small screens,
  collapse top padding to `space-md` and allow the shell to stretch edge-to-edge
  with consistent 16 px inner padding.
- **Settings panel:** switch to stacked layout < 720 px, ensuring chips and
  filters wrap with `space-xs` gaps.
- **Popup view:** align header, search, and results on a 4 px baseline grid.

Use CSS grid or flex gap tokens instead of hard-coded pixel values to stay
aligned with the design system.

---

## 8. Accessibility & Consistency Checklist

1. **Color contrast:** dynamic palette ensures ≥ 4.5:1 contrast for text on
   containers. When introducing new surfaces, mix with `--md-sys-color-surface`
   and re-evaluate contrast using the tokens above.
2. **Motion:** keep durations within the defined token set. For new transitions,
   pick from the Material easing curves to maintain rhythm.
3. **Elevation:** apply level tokens only; avoid bespoke shadows. Combine with
   `--spotlight-surface-tint` for consistent frosted glass visuals.
4. **Touch targets:** minimum 44 x 44 px interactive area. Use spacing tokens to
   preserve comfortable hit zones.
5. **Dynamic color updates:** if new screens expose accent pickers, persist them
   via `SPOTLIGHT_THEME_UPDATE` and call `ensureMaterialTheme(true)` to refresh
   open overlays.
6. **Iconography:** use 20 px filled icons for menus and 24–32 px for cards.
   Icons should inherit the `on-*` token of their container.
7. **Typography:** prefer the defined type tokens; avoid arbitrary font-size
   declarations to keep baseline rhythm consistent.

---

## 9. Future Integration Tips

- Introduce new component variants by extending the token tables rather than
  embedding hard-coded hex values.
- For wallpaper-driven themes on ChromeOS, listen to theme updates in the
  background worker and broadcast `SPOTLIGHT_THEME_REQUEST` responses to active
  tabs to trigger palette recomputation.
- When adding new animations, document the easing and duration in this file to
  maintain a single source of truth.

This design system ensures the Spotlight extension remains consistent with
Material 3 standards while embracing adaptive, glassmorphic visuals across light
and dark environments.
