# Theming — four systems behind one switch

The app ships **four** design systems. They are not a light/dark pair: they are
different visual languages that share a token grid. **Linea** is the default: it
follows the design system of `linea-web-v2` (`src/index.css` and `DESIGN.md` in
that repo) for colours, radius, borders and sentence-case type, and keeps the
Desk's own fonts. **Linear** follows the Linear app (linear.app): Inter, an
indigo accent, hairlines and tighter rows.

| | Linea | Neo-brutalism | Blueprint | Linear |
| --- | --- | --- | --- | --- |
| Ground | white cards on a pale slate page | warm bone `#EDE9E0` | graph paper `#F7F8F7`, 22px grid | white cards on a near-white page |
| Border | 1px | 2px ink | 1px hairline | 1px hairline |
| Radius | `0.375–0.875rem` on every `edge` box | 0 | 2px | `4–12px`, 6px on every `edge` box |
| Elevation | none | hard 5px offset shadow | none, ever | none |
| Display | Archivo 700, sentence case | Anton | Martian Mono 800 | Inter 600, sentence case |
| UI | Archivo | Archivo | JetBrains Mono | Inter |
| Severity / status | pale family fill, dark text (Linéa Bleu, Solaire, Forêt) | filled colour block | coloured label, quiet box | neutral box, coloured dot, quiet text |
| Reads like | the Linea apps | a poster | a spec sheet | the Linear app |

All four have a dark mode. Eight combinations total, and `index.css` carries all eight.

## How it works

`@theme` holds the defaults (brutalism / light) so Tailwind generates utilities
against them. The other seven combinations are plain CSS-variable overrides in
`@layer base`, keyed off two attributes on `<html>`:

```html
<html data-system="linea|brutal|blueprint|linear" data-theme="light|dark">
```

Because `bg-surface` compiles to `background-color: var(--color-surface)`, every
component follows the active system without knowing it exists. **Colour token
names are identical across systems** — that is the whole contract. Never write a
system-specific colour in a component.

### The structural tokens

Colour is the easy half. What actually separates the systems is five
non-colour variables, declared on `:root` and overridden per system:

| Token | Brutal | Blueprint | Used by |
| --- | --- | --- | --- |
| `--bw` | 2px | 1px | the `edge*` utilities |
| `--radius-*` | 0 | 2px | `rounded-*` |
| `--shadow-lift` | 5px offset | none | `lift`, `lift-sm` |
| `--grid-color` / `--grid-size` | transparent / 0 | 4.5% ink / 22px | `body` background |
| `--label-tracking` | .14em | .22em | `label-caps` |

Plus `--font-sans` / `--font-display`, `--row-h`, `--ctl-h`, `--page-pad`. Linear
is the densest: `--row-h` 44px and `--ctl-h` 32px, against 50px and 36px in Linea.

Linea and Linear set six more, which the other systems leave unset so their fallbacks
apply: `--edge-radius` (the radius the `edge` utility draws), `--label-font`,
`--label-size`, `--label-weight`, `--label-transform` (for `label-caps`) and
`--display-transform` (for `display-title`). Components still write their titles
as `font-display uppercase`; under Linea and Linear a rule on `.font-display`
sets them in sentence case, bold and tight. A box that fills a child to its edge (`Segmented`,
`Pager`) carries `overflow-hidden` so the fill follows the rounded corner.

Linear's badges are the one place a system adds markup by CSS: no component
draws a dot, so a rule in `index.css` puts one before the label of every element
that carries a `bg-sev-*-bg` or `bg-st-*-bg` class, coloured by the matching
`--color-*-dot` token. Renaming those classes means renaming them in that rule.

### Utilities, not raw classes

Three rules keep the switch honest:

1. **Never `border`.** Use `edge`, `edge-t`, `edge-b`, `edge-r`. A literal
   `border` class pins 1px and the brutal system silently loses its weight.
   The one exception is `edge-soft` — the 1px divider *inside* a bordered block,
   which is 1px in both systems by design.
2. **Never `shadow-*` directly.** Use `lift` / `lift-sm`.
3. **Never a hard-coded hex.** If a colour is needed that has no token, add the
   token to every block rather than inlining it.

The `press` utility carries the interaction difference: brutalism translates into
its shadow, blueprint has that suppressed and moves its border colour instead,
Linea and Linear move the border colour and sink by a pixel when pressed.
All are in `index.css`; components just add `press`.

## SystemProvider

Add `client/src/components/SystemProvider.tsx`:

```tsx
type System = "linea" | "brutal" | "blueprint" | "linear";
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

Lives at the bottom of the rail, above the repo switcher. Two controls stacked:
the system is a list (the `Select` primitive, labelled "Design system"), because
four names do not fit side by side in the rail; the mode is a `Segmented`:

```
SYSTEM   [ Linea ▾ ]        Linea · Brutal · Blueprint · Linear
MODE     [ LIGHT  | DARK ]
```

The `Segmented` is a `role="radiogroup"` with an `aria-label`, real `<button>`
children with `role="radio"`, and `aria-checked` on the active one. Labels are
`label-caps`. The active segment fills `--color-seg-on-bg`, which each system
sets — that difference is already in the CSS via the token, so the component
needs no conditional.

Behind a `SETTINGS_SHOW_SYSTEM_SWITCH` constant if you would rather not ship the
choice to users: the dual tokens cost nothing, the visible control is the part
worth gating.

## Verifying

The design canvas has a **Style switch** artboard that runs both systems off one
set of markup, with a live readout of the structural tokens. Match the behaviour
there. The acceptance test is blunt: flipping `data-system` on `<html>` in
devtools must change the whole app and break nothing — no element keeps a border
weight, a radius or a shadow from another system.
