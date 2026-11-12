# Component-by-component changes

Token names are unchanged, so a component that only reads `bg-surface` /
`text-fg` / `border-border` inherits the new look for free. What needs editing is
the structural vocabulary: border width, radius, shadow, height, and the places
that hard-code a hex or an old grey step.

> **Four systems.** Written for neo-brutalism and blueprint; the app now also
> ships Linea and Linear, four systems and eight combinations with dark mode.
> Everything below must work in every one of them without a conditional — components read token names only, and the
> structural difference comes from `--bw` / `--radius-*` / `--shadow-lift` via
> the `edge` / `lift` / `press` utilities. Read `theming.md` first.

## Global find-and-replace

| Before | After | Note |
| --- | --- | --- |
| `border` | `edge` | never a literal border: `--bw` is 2px or 1px by system |
| `border-t` / `-b` / `-r` | `edge-t` / `edge-b` / `edge-r` | |
| `rounded-*` | keep | the radius tokens carry it (0 or 2px) |
| `shadow-xs` | delete | flat is the default |
| `shadow-sm` / `shadow-md` | `lift-sm` / `lift` | |
| `text-faint` | `text-fg-3` | the grey ramp collapsed to three steps |
| `focus-ring` | keep | the utility itself was rewritten |
| `animate-view-enter`, `animate-panel-enter` | delete | resolve to `none` |
| `duration-[120ms] ease-out-soft` | `duration-[80ms]` | linear is the default now |

Hard-coded hexes to hunt: `#fff5f5`, `#7f1d1d`, `#991b1b`, `#166534`, `#14532d`,
`#a9c1ff` — all in PRDetail / PRDetailFailed / FindingDetail / Toast.

## ui/Button.tsx

Heights read `--ctl-h` (38 brutal, 36 blueprint), up from 32 (`sm` 28 → 32) to clear the 44px touch floor with the border.
All variants: `edge`, `lift-sm`, `press` utility,
`label-caps` at 12px (11px for `sm`), `uppercase`.

| Variant | Fill | Text |
| --- | --- | --- |
| `primary` | `bg-primary` | white |
| `acid` (new, replaces most `secondary` uses) | `bg-acid` | ink |
| `secondary` → rename `plain` | `bg-surface` | ink |
| `danger` | `bg-danger` | ink |
| `ghost` → `quiet` | transparent, no border, no shadow | `text-fg-2` |

Disabled: `bg-subtle`, `border-fg-3`, `text-fg-3`, **shadow removed** — a block
that cannot be pressed has nothing to press into. Do not use opacity.

## ui/Field.tsx, Combobox.tsx, MultiSelect.tsx

Height 38. `border-2 border-fg`, `shadow-hard-sm`, no radius. Focus uses the
`focus-ring` utility (3px blue outline, offset 3) instead of the old inset ring.
The leading label (`Model`, `Effort`) becomes `label-caps` in `text-fg-3`.
Error state: `bg-danger-soft` and an orange outline on focus — not a red border,
since the border is already ink everywhere.

Combobox dropdown: `border-2 border-fg`, `shadow-hard`, no radius; the highlighted
option is `bg-acid`, the `current` hint is a `chip`.

## SeverityBadge.tsx / StatusBadge.tsx

The biggest change. Both stop being dot + tinted pill and become solid blocks:
26px tall, `edge`, `label-caps` at 11px / `.07em`, no dot, no
animation. Colours come from `--color-sev-*-bg` / `--color-st-*-bg` with the matching
`-fg` for the label — and that is the one place the two systems differ in kind:
brutalism sets `-bg` to a saturated fill with ink text, blueprint sets it to
`transparent` and puts the colour on `-fg`. The component does not branch; the
tokens do.

Delete the `ping-dot` ring on Running. `FindingStateBadge` keeps three states:
Open (white), Posted (green fill), Dismissed (subtle fill + line-through).

## ui/Card.tsx

Rename mentally to "block": `bg-surface border-2 border-fg`, and `shadow-hard`
when it sits directly on the page. `Eyebrow` becomes a **label band** — a filled
strip on the left edge or across the top of the block, carrying `label-caps` in
ink on the section's colour (blue = background, red = problem, green = summary /
suggested fix). That band is what replaces the old grey eyebrow text.

## ui/Skeleton.tsx

Swap the shimmer for the `skeleton` utility: static 10px stripes with a 2px ink
border. No animation.

## ui/Toast.tsx

`bg-fg`, `text-page`, `border-2 border-fg`, and the offset shadow is the **accent**
rather than ink: `shadow-[5px_5px_0_var(--color-acid)]` for success,
`…_var(--color-danger)` for errors. Enter 120ms, exit 100ms.

## ui/Avatar.tsx

Square, `border-2 border-fg`, mono initials at 9px/700, ink text on a flat accent
fill (sky / amber / green / subtle). No gradients.

## DiffViewer.tsx

Gutters `bg-subtle` with a 2px ink divider between the second gutter and the code.
Hunk rows invert: `bg-diff-hunk-bg` (ink) with acid text. The finding range is the
acid block with `inset 5px 0 0` ink on the marker cell.

**Layout change:** the finding range viewer moves out of the 400px sidebar and
goes full width below the evidence, because at 400px every line over ~80 chars
was clipped. See the FindingDetail artboard.

## PRList.tsx / LocalBranches.tsx tables

Row height 44 → 52. Header `bg-subtle`, `border-b-2 border-fg`, `label-caps`.
Body rows keep a 1px `border-border-soft` divider — the one place a hairline is
allowed, because it is inside a bordered block. Hover fills the cells `bg-acid`
with no transition. Keyboard focus draws `inset 5px 0 0 var(--color-primary)` on
the first cell.

The row is the click target, and the title stays a real `<a>` so the accessible
name is the title. (The current `role="link"` on `<tr>` with an `onKeyDown`
handler should become that anchor plus a row click handler.)

## LocalReviewDetail.tsx

Findings rows lose the checkbox column and the post column entirely — there is
nowhere to post. The `Copy fix prompt` action gets promoted out of the findings
header into its own acid band above the thread, because it is the whole point of
the local track. Keep the smaller duplicate in the findings header.
