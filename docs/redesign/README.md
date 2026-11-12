# Redesign handoff — two design systems, one switch, new navigation

> **Since this handoff.** The app now ships four design systems, each in light
> and dark, eight combinations in all: Linea (the default), Neo-brutalism,
> Blueprint and Linear. This document was written for the first two; what it says
> of "both systems" holds for all four. `theming.md` describes them.

This folder is the brief for implementing the new design in `client/`.
It was derived from a design canvas built against this repo; the canvas is the
visual source of truth and the docs here are the implementation contract.

**Canvas:** "PR Review Desk", in David's Claude artifacts
(claude.ai/code/artifacts). Twelve artboards:

| Artboard | Covers |
| --- | --- |
| Design tokens | the brutalist palette, type, geometry, motion |
| Component reference | every atom with hover / focus / disabled |
| Navigation map | the two-track IA and the state → screen table |
| PR list, PR list · empty | `PRList.tsx` |
| PR detail, PR detail · failed | `PRDetail.tsx` |
| Finding detail | `FindingDetail.tsx`, incl. read-only mode |
| Local branches | `LocalBranches.tsx` |
| Local review | `LocalReviewDetail.tsx` |
| **Direction D · Blueprint** | the second system's foundations |
| **Style switch** | both systems live, off one set of markup |

## What ships

Three things, and they are independent enough to land separately:

1. **A dual-system theme.** Neo-brutalism (poster: 2px ink, hard shadows,
   filled colour blocks) and Blueprint (spec sheet: hairlines, graph paper, mono
   throughout, coloured labels). Four combinations counting dark mode, all in
   `index.css`, switched by two attributes on `<html>`. See `theming.md`.
2. **Rebuilt components.** Same components, new structural vocabulary. They read
   token names only, so they serve both systems without conditionals.
   See `components.md`.
3. **A navigation rebuild.** The breadcrumb-only header is replaced by a
   persistent rail + crumb bar + pager, because the app now has two entry points
   (GitHub PRs and local branches) and a breadcrumb cannot show the one you are
   not in. See `navigation.md`.

## Files here

- `index.css` — drop-in replacement for `client/src/index.css`. All four
  system × mode combinations, plus the `edge` / `lift` / `press` / `label-caps`
  utilities the components depend on.
- `theming.md` — how the switch works, the `SystemProvider`, and the three rules
  that keep it honest (never `border`, never `shadow-*`, never a raw hex).
- `components.md` — per-component changes and the global find-and-replace table.
- `navigation.md` — the `AppShell` / rail / crumb bar / pager spec.

## Suggested order

**1 — Theme.** Copy `index.css` over `client/src/index.css`, add the pre-paint
script from `theming.md` to `index.html`, run `npm run dev`. The app will be
mostly right and partly broken: radii vanish, borders go to ink, badges still
draw dots. Fix nothing yet. Flip `data-system="blueprint"` in devtools and
confirm the whole page changes.

**2 — Atoms.** `ui/Button`, `ui/Field`, `ui/Combobox`, `ui/MultiSelect`,
`ui/Card`, `ui/Avatar`, `ui/Skeleton`, `ui/Toast`, then `SeverityBadge` and
`StatusBadge`. Per `components.md`. Check each one in **both** systems as you go
— it is much cheaper than retrofitting later.

**3 — Global sweep.** Run the find-and-replace table across `client/src`, then
hunt the hard-coded hexes it lists. This is where `border` → `edge` happens.

**4 — SystemProvider + switch control.** Per `theming.md`. Small, and it makes
every later step verifiable in both systems.

**5 — AppShell.** Per `navigation.md`. The only structural change: `App.tsx`
loses its header, each screen passes crumbs and actions. Derive the section from
the existing `ViewState` prefix — do not add a second source of truth.

**6 — Screens.** `PRList` and `LocalBranches`, then `PRDetail` and
`LocalReviewDetail`, then `FindingDetail` (which changes layout: evidence bands
in two columns, diff full width below).

**7 — Pager + keys.** `ui/Pager`, then the keyboard table in `navigation.md`.

Steps 1–3 are mechanical. Step 5 is the one worth reviewing before going further.

## Acceptance

- Flipping `data-system` on `<html>` in devtools changes the entire app and
  breaks nothing. No element keeps a border weight, radius or shadow from the
  other system.
- No `border` / `border-2` class anywhere in `client/src` — only `edge*`.
  No direct `shadow-*` — only `lift` / `lift-sm`. No hard-coded hex.
- Every interactive element is a real `<button>` / `<a>` / `<input>` with a
  label; icon-only controls have `aria-label`. The `role="link"` on `<tr>` in
  `PRList` / `LocalBranches` becomes a real anchor on the title.
- Focus is a 3px outline offset 3px, visible on every control, never replacing
  the border.
- Disabled controls drop their shadow rather than going translucent.
- Text hits 4.5:1 on its fill in all four combinations. Brutalism's blue is the
  only fill that takes white text; everything else takes ink.
- A local finding shows no comment editor at all — not a disabled one.

## Not in scope

⌘K is specified but not designed past the button. `Repositories` and `Settings`
in the rail have no screens yet; they render as inert buttons. Which system
ships as the default is still open — `theming.md` has it as a one-line constant,
currently `brutal`.

## One real bug spotted while reading the code

`client/src/components/LocalBranches.tsx`, `repoLabelFromId` ends with
`return lastDash > 0 ? parts : parts` — both branches return the same value, so
the function does not do what its name says. Unrelated to the redesign, but
worth a look while you are in that file.
