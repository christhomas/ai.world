# Handoff: AI World — mobile interface (Ledger II)

## Overview
A redesign of AI World's in-game interface for a Flutter phone build (iOS + Android, landscape)
and for retrofitting the existing web build (`src/ui/*`). It replaces eight hand-pinned HUD panels
with two surfaces — **dark glass while you play, paper while you read** — a single contextual action
card that names the verb, and one 44px row grammar shared by every list in the game. Four selectable
themes sit on top of one unchanged layout.

The design also fixes the reported interaction bug (keys leaking from panels into the world) with an
explicit three-state focus rule; see **Focus & input ownership**.

## About the design files
The files in this bundle are **design references created in HTML** — prototypes showing intended
look and behaviour, not production code to copy. The task is to **recreate these designs in the
target environment**: Flutter widgets for the app, and the existing TypeScript/DOM UI in
`src/ui/` for the web build. Nothing here should be shipped as HTML.

`AI World Mobile.dc.html` is a single scrolling design document. Each numbered round is a section,
newest first. Reference frames by id:

| id | what it is |
|---|---|
| `13a` | **Current direction.** Theme picker + the four themes as token columns |
| `11a / 11b / 11c` | The three looks, now themes: Vellum, Steel, Hairline |
| `10a` | **The layout of record** — walking, in reach, the pack, a shop, the system sheet |
| `12a / 12b / 12c` | Rejected architectures (summoned wheel, worldspace, split console). Kept for reference only — **do not build** |
| `1a` | Faithful recreation of today's touch HUD, rebuilt from the repo. Baseline for comparison |
| `1b / 1c` | Round-1 alternatives; superseded |

**Build `10a` + `13a`.** Everything else is history.

## Fidelity
**High-fidelity.** Colours, type sizes, spacing, row heights and hit targets are final and are stated
below in px at a 844×390 reference viewport (a landscape phone with the browser chrome gone). Recreate
pixel-accurately, then scale as described in **Scaling**.

## Reference viewport & scaling
- Design canvas: **844 × 390** logical px, landscape.
- The existing web build already has the right idea in `src/ui/style.css`: `--ui-scale` =
  `clamp(1px, min(100vh / 720, 100vw / 1080), 3px)`, capped at 3, floored at 1. Keep it.
- **Touch targets never scale below 44px.** In the source that is already explicit ("44px is a
  measurement of a fingertip, not a design decision"). Keep that rule: the 44px row and the 44px
  tab are floors in real px, not in scaled units.
- Flutter: design in logical pixels at 844×390 and lay out with `LayoutBuilder`/`Flex`; do not
  use a global scale factor for hit targets.

## Reserved geometry (the rules that stop panels colliding)
Every element is positioned against one of these. This is the part today's UI lacks, and the reason
its panels overlap.

| band | size | who owns it |
|---|---|---|
| Left tab gutter | `x 0–44`, from `y 62` downward | the four book tabs. **The walk field excludes this column**, so a steering thumb can never open the pack |
| Left news indent | `x ≥ 56` | the news line and anything else pinned left |
| Thumb home | `x 24–128`, `y bottom 20–124` | the walk ring and its meters. Only element allowed into the tab gutter, and only because the tabs stop above it |
| Top-left readings | `top 0, left 0`, auto-size | body: `72/100 · 68 BREATH` |
| Top-right clock | `top 0, right 0`, auto-size | hour, day bar, day + season |
| Bottom-centre bearings | `bottom 0`, centred | errand bearing + nearest town |
| Action corner | `right 0, bottom 0`, width 190–212 | the action card; flush to both edges |
| Book | `left 0`, width **372** (44 spine + 328 page) | any reading surface; arrives from the left |

Safe-area insets (notch, home bar) are added outside these numbers — never cosmetic margins.
The source already does this correctly: "a gap kept for taste is waste, a gap kept for an
obstruction is a gap."

## Screens / views

### 1. Playing — nothing in reach (`10a walking`)
**Purpose:** walk, look, read the world.
**Layout:** no panels. Place name as type centred at `top 16` (18px, weight 500, letter-spacing 10px,
`text-indent: 10px` to return the last letter's tracking), a 148×2 gold rule under it. Readings in the
three edge bands above. Thumb ring at its home. Action card in the corner with the header
`NOTHING IN REACH` and the reflex pair.
**Components:**
- **Thumb ring** — 104px box. Outer arc r=46, stroke 5, health colour, `stroke-dasharray: 208 289`
  (= share × 2πr), `transform: rotate(-90)` so 0 is at the top. Inner arc r=37, stroke 3, breath
  colour, `158 232`. Track: `rgba(10,13,28,0.34)` fill, `rgba(255,255,255,0.14)` stroke. Centre nub
  40px circle, `rgba(214,221,255,0.2)`, 1px `rgba(214,221,255,0.34)`.
  **The ring is drawn where the thumb lands** (as `touch.ts` already does for the stick) — the home
  position is only where it rests.
- **Readings (top-left)** — stone slab, padding `7px 12px 8px`, 1px rule on the two inner edges.
  `72` in health green, `/100` in dim ink 9.5px, `68` in breath blue, `BREATH` 9.5px dim.
  Mono, 11px, letter-spacing 1px.
- **Clock (top-right)** — stone slab, padding `7px 12px 9px`, right-aligned, gap 5px:
  `☀ 12:03` (mono 19px 600, gold), day bar 118×3 (the phase gradient from `clock.ts`) with a 2×9px
  white marker, `DAY 1 · SPRING` (mono 9px, letter-spacing 2px).
- **Bearings (bottom-centre)** — stone slab, padding `6px 14px`, mono 10px, `white-space: nowrap`.
  Errand in `#b7f0c8`, nearest town in dim ink. Arrow glyphs from `compass.ts`.
- **Book tabs (left)** — four 44×44 cells, `rgba(6,9,22,0.66)`, 1px right + bottom rules, 1px gaps,
  icons at 21px. Icons are the verbatim paths from `src/ui/glyphs.ts` (`pack`, `book`, `map`, `sliders`).
- **Action card** — see below.

### 2. Playing — somebody in reach (`10a in reach`)
**Purpose:** act on what is in front of you.
**Layout:** identical to (1). The subject is identified **in the world** — a 54×16 gold ellipse ring
at their feet and their name 10px mono above them — not described in a panel.
**Action card**, 208px wide, flush to `right 0 / bottom 0`, stacked bottom-up:
1. **Reflex pair** (always present, never moves): `SWING` — flex 1, height 62, `rgba(150,140,255,0.62)`,
   1px `rgba(255,255,255,0.55)`, sword icon + label 19px/700 + key `X` 8.5px mono; and `GUARD` —
   62×62, `rgba(10,13,28,0.72)`, 1px `rgba(214,221,255,0.4)`, shield icon + `HOLD C`. 1px gap.
2. **Situational verbs**, 44px rows above it, `rgba(6,9,22,0.82)`, 1px `rgba(214,221,255,0.24)`,
   mono 12.5px letter-spacing 2px, label left, key right in dim 9px: `TALK / ENTER`, `GIVE OR TRADE / G`.
   Max three rows; they change with the situation.
3. **Header strip**, 28px, `rgba(6,9,22,0.86)`: `IN REACH` in gold mono 10px + subject 12.5px.
**Why:** the reflex verbs are where muscle memory can find them without looking; contextual verbs
come and go above them. Today's build has this backwards — `USE` owns the corner and the sword orbits
into the middle of the picture.

### 3. The book — your pack (`10a ledger pack`)
**Purpose:** wear, eat, inspect, drop.
**Layout:** 372px from the left edge. **Spine** 44px, `rgba(6,9,22,0.9)`: four 48px tab cells (active
tab filled with the page colour), then `margin-top: auto` and a 52px close cell with a gold ✕ above a
1px top rule. **Page** fills the rest: paper `linear-gradient(180deg,#f6efdc,#e8dcc0)`, ink `#2a2418`.
- Header: padding `9px 12px 8px`, `RUCKSACK` (17px, weight 500, letter-spacing 3px, `#6b3f1d`) and
  `246 gold · 11 carried · 3/6 worn` (mono 12px, `#6b3f1d`), 2px `#8a6a3d` bottom border.
- `WORN` label (mono 9px, letter-spacing 2px, `#8a7a5a`), then a 6-column grid, 44px cells, 4–5px gaps.
  Filled: `#ffe9b8` with 1px `#8a6a3d`; empty: 1px dashed `#b9a274`.
- `CARRIED` label, then the scrolling list.
- **World side:** the world keeps its light and its clock; a corner vignette
  `radial-gradient(120% 90% at 100% 100%, rgba(6,9,22,0.44), rgba(6,9,22,0.1) 70%)` and one
  `CONTROLS PARKED · I OR ✕ PUTS THE BOOK AWAY` chip on a stone strip. The hero and any subject must
  be composed into the visible half (`x ≥ 372`).

### 4. The row grammar (every list in the game)
One widget, four slots, used by pack, shop, journal, party, market, register and options:

```
[ chip 13–14px, rotated 45° ] [ name, flex 1 ] [ consequence, mono 11px dim ] [ verb or price, mono 11px 600 ]
```
- Height **exactly 44px** — `flex: 0 0 44px` (a flex child with the default `flex-shrink: 1` squashes
  to 34px and the list silently stops scrolling). In Flutter: fixed `SizedBox(height: 44)` inside a
  `ListView`, never `Expanded`.
- Ruled, not boxed: 1px `#d3c3a0` bottom border, no fill, no radius.
- Scroll container: `overflow-y: auto`, `min-height: 0` on the flex parent, and **a reserved
  scrollbar gutter** (`scrollbar-gutter: stable` / 12px right padding) or the bar paints over the verb.
- Verb colours: eat `#3d6b34`, wear `#6b3f1d`, look `#8a7a5a`, price `#2a2418` tabular-nums.
- **Item chips are cut squares in the world's vertex colours, not emoji.** The two families of
  picture in today's UI (colour emoji + thin strokes) become one.

### 5. A shop (`10a shop`)
Same book, plus a price column and a `BUY / SELL` pair (40px, active `#8a6a3d` on `#f6efdc`). A 48px
`BUY LANTERN · 45g` commit bar pinned to the page foot with `margin-top: auto`.
**What she says stays on the glass**: a band across the world half, `rgba(6,9,22,0.72)→(0.9)`, holding
the game's own 48×56 pixel portrait scaled whole to 72×84 (`src/ui/portrait.ts`, `image-rendering: pixelated`,
2px `#8fa0ff` border), her name in gold mono 10px, the line of speech at 14.5px/1.5, and
`SHE BUYS: …` in mono 9px. Words and choices stop being the same list — which is what makes a
seventeen-item shelf work on a phone.

### 6. Options → theme picker (`13a`)
A page of the same book. `THEME · HOW THE INTERFACE IS DRESSED`, then one 64px row per theme:
an 84×40 swatch **drawn in that theme** (its surface, its 1px rule, a 4px accent bar, `AaBb 72` in its
own face and ink, and a 26px action block in its action colour), the theme name (17px serif) with a
two-line-clamped note (mono 9.5px), and either an `ON ✓` chip (`#8a6a3d`, cream ink) or `USE IT`
(underlined, `#6b3f1d`). The list is the preview; there is no separate preview pane.

## Themes
A theme may change **only five things**: surface, rule, ink, accent, action — plus its face pairing.
Position, size, spacing and every hit target are identical across themes, so a new theme cannot break
a screen and needs no re-test.

| token | Stone (default) | Vellum | Steel | Hairline |
|---|---|---|---|---|
| surface | `rgba(6,9,22,0.72)` | `#f6efdc → #e8dcc0` | `#1b2230 → #10141c` | `rgba(4,6,10,0.66)` |
| rule | `rgba(214,221,255,0.14)` | `#8a6a3d` | `#4d5a6d` | `rgba(255,255,255,0.5)` |
| ink | `#eef2ff` | `#2a2418` | `#e8eef7` | `#ffffff` |
| dim ink | `#7f8bb3` | `#8a7a5a` | `#8a97a8` | `rgba(255,255,255,0.7)` |
| accent | `#ffd76a` | `#8a6a3d` | `#2f6fd0` | `#ffffff` |
| action | `rgba(150,140,255,0.62)` | `#8a2a14` | `#c2352a` | `#ffffff` (ink `#05070c`) |
| book page | paper `#f6efdc` | same vellum | slate `#151b26` | sheet `#f7f6f2` |
| display face | Space Grotesk | EB Garamond | Barlow Condensed | IBM Plex Mono |
| number face | IBM Plex Mono | IBM Plex Mono | IBM Plex Mono | IBM Plex Mono |

Stone is the default because it is the one that reads over a sunlit field **and** a cave floor.

## Focus & input ownership — the fix for the reported bug
Exactly one owner at a time, held in one place. Today it is inferred from a `:has()` selector in the
stylesheet, which is why keys leak into the world.

| state | who gets touches | who gets keys | world |
|---|---|---|---|
| `WORLD` | stick, verbs, tabs | all game keys | live, accepting input |
| `BOOK` | the page only | the page only; its own key or `Escape` closes | **live and lit, accepting nothing** |
| `TYPING` | the console only | the console only; `Escape` returns | live, accepting nothing |

- Flutter: one `FocusScope` per state; a `Shortcuts`/`Actions` map mounted only in `WORLD`; the book is
  a route/overlay with `ExcludeSemantics` + its own scope; `TYPING` is an `EditableText` with autofocus.
- Web: one guard at the top of the key handler reading a single `inputOwner` variable; delete the
  `:has()` visibility rules in `style.css` and drive them from that state instead.
- Opening a book **must release the stick** (today's `releaseStick()` call is correct — keep it) so the
  hero never walks into a wall behind a panel.
- Parked controls are shown, not hidden: the world-side vignette + the `CONTROLS PARKED` chip.

## Interactions & behaviour
- **Walk:** thumb down anywhere in the left field (minus the tab gutter) draws the ring at that point;
  8 sectors, dead zone 14px, range 54px — all already in `src/ui/touch.ts`, keep the maths.
- **Verbs:** press on pointer-down, never on release. Situational rows recompute as the nearest
  interactable changes; the reflex pair never re-lays-out.
- **Book:** slides in from the left, ~140–180ms ease-out; ✕ or the tab's own key closes it.
- **Theme change:** applies on the tap, no reload.
- Transitions: 90–120ms linear for control lit-states (source uses `90ms`), 150ms ease-out for panels.
  Respect `prefers-reduced-motion`.

## State needed
`inputOwner: 'world' | 'book' | 'typing'`, `openBook: 'pack' | 'journal' | 'map' | 'options' | null`,
`theme: 'stone' | 'vellum' | 'steel' | 'hairline'` (persisted), `nearest: {name, kind, verbs[]} | null`,
plus the existing game state (hp, breath, gold, worn, carried, clock, bearings). The verb stack is
**derived** from `nearest` — never stored.

## Design tokens
- Spacing: 1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24 (8-ish, with 44 and 62 as the target sizes).
- Type: display 27/21/18/17, body 14.5/13.5/12.5, mono 12/11/10/9.5/9 (labels at 9–10 always get
  2–3px letter-spacing and are never prose).
- Radius: **0 everywhere.** The only circles are the thumb ring, its nub and in-world subject rings.
- Rules: 1px; emphasis is a 2–3px bar on one side, never a border all round.
- Shadows: `0 2px 10px rgba(0,0,0,0.45)` on controls; `18px 0 40px rgba(0,0,0,0.5)` thrown right by the book.
- Contrast floor: 4.5:1 for all live UI text. Never alpha-mute small type over the world — put it on a
  surface at full-opacity ink.

## Assets
- **Icons:** the verbatim SVG paths in `src/ui/glyphs.ts` (`map, pack, book, sliders, turnLeft,
  turnRight, more, close, sword, shield, bow`) — 24×24 grid, `stroke="currentColor"`, width 2,
  round caps. Copy them; do not redraw. Flutter: ship as an icon font or `SvgPicture.string`.
- **Portrait:** `src/ui/portrait.ts` renders a 48×56 pixel face. Scale by whole multiples only
  (72×84 on a phone) with nearest-neighbour filtering. In the handoff frames it is a labelled slot,
  not artwork.
- **No other images.** The game has no textures and no image files; do not introduce any.
- Fonts: Space Grotesk, EB Garamond, Barlow Condensed, IBM Plex Mono (Google Fonts). Bundle them in
  the Flutter app rather than fetching at runtime.

## Files in this bundle
- `AI World Mobile.dc.html` — the design document (all rounds; build `10a` + `13a`).
- `support.js` — runtime for the above; not part of the design.
- `ref/` — screenshots from the repo used as the recreation baseline (`phone.png`, `town.png`,
  `rucksack.png`, `map.png`).

## Source files worth reading before starting
`src/ui/touch.ts` (stick maths, button semantics, the panel/stick interlock),
`src/ui/style.css` (`--ui-scale`, the CUT STONE rules, the phone media queries),
`src/ui/glyphs.ts` (icons), `src/ui/hud.ts` (health bar + carried summary),
`src/ui/clock.ts` (phase gradient), `src/ui/compass.ts` (bearings),
`src/ui/rucksack.ts`, `src/ui/portrait.ts`, `index.html` (the DOM the web build binds by id).

## Not in scope yet
Title screen, journal, full map, party, market stall, console, dungeon/interior HUD, the night and
winter palette check, and portrait-orientation layouts for the book screens. The system above is
sufficient to build them; they simply have not been drawn.
