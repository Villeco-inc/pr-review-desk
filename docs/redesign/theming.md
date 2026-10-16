# Theming — three systems behind one switch

The app ships **three** design systems. They are not a light/dark pair: they are
different visual languages that share a token grid. **Linea** is the default: it
follows the design system of `linea-web-v2` (`src/index.css` and `DESIGN.md` in
that repo) for colours, radius, borders and sentence-case type, and keeps the
Desk's own fonts.

| | Linea | Neo-brutalism | Blueprint |
| --- | --- | --- | --- |
| Ground | white cards on a pale slate page | warm bone `#EDE9E0` | graph paper `#F7F8F7`, 22px grid |
| Border | 1px | 2px ink | 1px hairline |
| Radius | `0.375–0.875rem` on every `edge` box | 0 | 2px |
| Elevation | none | hard 5px offset shadow | none, ever |
| Display | Archivo 700, sentence case | Anton | Martian Mono 800 |
| UI | Archivo | Archivo | JetBrains Mono |
| Severity / status | pale family fill, dark text (Linéa Bleu, Solaire, Forêt) | filled colour block | coloured label, quiet box |
| Reads like | the Linea apps | a poster | a spec sheet |

All three have a dark mode. Six combinations total, and `index.css` carries all six.

## How it works

`@theme` holds the defaults (brutalism / light) so Tailwind generates utilities
against them. The other three combinations are plain CSS-variable overrides in
`@layer base`, keyed off two attributes on `<html>`:

```html
<html data-system="linea|brutal|blueprint" data-theme="light|dark">
```

Because `bg-surface` compiles to `background-color: var(--color-surface)`, every
component follows the active system without knowing it exists. **Colour token
names are identical across systems** — that is the whole contract. Never write a
system-specific colour in a component.

### The structural tokens

Colour is the easy half. What actually separates the two systems is five
non-colour variables, declared on `:root` and overridden per system:

| Token | Brutal | Blueprint | Used by |
| --- | --- | --- | --- |
| `--bw` | 2px | 1px | the `edge*` utilities |
| `--radius-*` | 0 | 2px | `rounded-*` |
| `--shadow-lift` | 5px offset | none | `lift`, `lift-sm` |
| `--grid-color` / `--grid-size` | transparent / 0 | 4.5% ink / 22px | `body` background |
| `--label-tracking` | .14em | .22em | `label-caps` |

Plus `--font-sans` / `--font-display`, `--row-h`, `--ctl-h`, `--page-pad`.

Linea sets six more, which the other systems leave unset so their fallbacks
apply: `--edge-radius` (the radius the `edge` utility draws), `--label-font`,
`--label-size`, `--label-weight`, `--label-transform` (for `label-caps`) and
`--display-transform` (for `display-title`). Components still write their titles
as `font-display uppercase`; under Linea a rule on `.font-display` sets them in
sentence case, bold and tight. A box that fills a child to its edge (`Segmented`,
`Pager`) carries `overflow-hidden` so the fill follows the rounded corner.

### Utilities, not raw classes

Three rules keep the switch honest:

1. **Never `border`.** Use `edge`, `edge-t`, `edge-b`, `edge-r`. A literal
   `border` class pins 1px and the brutal system silently loses its weight.
   The one exception is `edge-soft` — the 1px divider *inside* a bordered block,
   which is 1px in both systems by design.
2. **Never `shadow-*` directly.** Use `lift` / `lift-sm`.
3. **Never a hard-coded hex.** If a colour is needed that has no token, add the
   token to all four blocks rather than inlining it.

The `press` utility carries the interaction difference: brutalism translates into
its shadow, blueprint has that suppressed and moves its border colour instead.
Both are in `index.css`; components just add `press`.

## SystemProvider

Add `client/src/components/SystemProvider.tsx`:

```tsx
type System = "linea" | "brutal" | "blueprint";
type Theme = "light" | "dark";

const DEFAULT_SYSTEM: System = "linea";
const DEFAULT_THEME: Theme = "light";
```

It owns both values, writes them to `document.documentElement.dataset`
(`system`, `theme`), persists to `localStorage` under `prd:system` and
`prd:theme`, and exposes them through a context with setters. Read the stored
values **before first paint** with a tiny inline script in `index.html` so the
app does not flash the wrong system:

```html
<script>
  try {
    var d = document.documentElement.dataset;
    d.system = localStorage.getItem("prd:system") || "linea";
    d.theme  = localStorage.getItem("prd:theme")  || "light";
  } catch (e) {}
</script>
```

`theme` may also be `"auto"`, resolved against `prefers-color-scheme` — add it
only if asked; two explicit values are enough to start.

## The switch control

Lives at the bottom of the rail, above the repo switcher. Two segmented
controls stacked, both built from the same `Segmented` primitive:

```
SYSTEM   [ LINEA | BRUTAL | BLUEPRINT ]
MODE     [ LIGHT  | DARK      ]
```

Each is a `role="group"` with an `aria-label`, real `<button>` children, and
`aria-pressed` on the active one. Labels are `label-caps`. The active segment
fills `--color-fg` in brutalism and `--color-primary` in blueprint — that
difference is already in the CSS via the token, so the component needs no
conditional.

Behind a `SETTINGS_SHOW_SYSTEM_SWITCH` constant if you would rather not ship the
choice to users: the dual tokens cost nothing, the visible control is the part
worth gating.

## Verifying

The design canvas has a **Style switch** artboard that runs both systems off one
set of markup, with a live readout of the structural tokens. Match the behaviour
there. The acceptance test is blunt: flipping `data-system` on `<html>` in
devtools must change the whole app and break nothing — no element keeps a border
weight, a radius or a shadow from the other system.
