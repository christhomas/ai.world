# Ledger shell composition

`LedgerShell` owns overlay geometry and focus, while the production composition owner retains
one session and passes the same persistent `NativeWorldView` as `world`. Its native Texture
stays mounted behind every registered route and theme. The shell does not create or dispose
sessions, generate game state or replace the production entrypoint.

Register `Map<String, LedgerPageBuilder>` for feature modules from #572–#578. `LedgerController`
opens named routes, back returns to the previous route, and close empties the book stack.
`LedgerRow` provides the 44px ruled list grammar with a rotated colour chip, flex name,
consequence and verb. `LedgerThemePicker` uses 64px rows with 84x40 previews. `LedgerActionCard`
provides 28px header, up to three 44px actual registered verb callbacks, optional primary
callback and 62px hold/cancel guard. Unsupported session actions are never fabricated.

`InputOwnerController` emits only the host contract's normalized input payload. The future
session facade wraps it in validated tick/sequence requests and continues stepping the world.
Book/text, talking/framing busy modes, pointer cancellation and app inactivity clear every held
token and send zero move/look/held/actions. Returning to WORLD requires fresh input. Feature
widgets identify each pointer/hardware key with an independent hold token and call release on
up/cancel; gameplay semantics stay in the shared host. Each owner has a separate focus scope,
parked world input/semantics are excluded, and Escape returns through book/text routing.

At 844x390 the book is 372px including a 44px spine, safe-area insets sit outside that width,
tabs start at y62 and stop above the y144 thumb-home band, action corner is 208px. The book
clamps to the safe width on smaller viewports. `onWorldComposition(Rect)` reports uncovered
world space after route or viewport changes so the host can compose its camera without
reconstructing the renderer. Book colour transitions respect reduced-motion settings.
Loading/reconnect/error status overlays park inputs; recovery callbacks are supplied by the host.

Four theme token sets share every layout constant. A theme changes its five colours and its face,
and nothing else. Small text surfaces are opaque for measurable contrast against sunlit worlds. Dim
Steel/Stone ink and Steel accent are brighter than the HTML reference, where its alpha and
background combinations cannot guarantee 4.5:1. Every live ink pair has a numerical contrast test.

**Faces, offline.** Space Grotesk (Stone), EB Garamond (Vellum), Barlow Condensed (Steel) and IBM
Plex Mono (Hairline, and every number in every theme) are bundled in `assets/fonts/` from the
google/fonts repository, under the SIL Open Font License 1.1. Their licences are in
`assets/licences/`, registered at start-up for the licence page. Nothing is fetched at run time.
`LedgerTokens.face` and `.numbers` give text at the design's sizes; numbers use tabular figures.

**Glyphs.** `ledger_glyphs.dart` copies `src/ui/glyphs.ts` mark for mark: map, pack, book, sliders,
the camera turns, more, close, sword, shield and bow. They are drawn by a small SVG path reader
(moves, lines, runs, cubic curves and arcs, absolute and relative) on the same 24-unit grid with a
2px round stroke. A test reads `glyphs.ts` and holds every mark to it. The book tabs are the pack,
book, map and sliders glyphs; the spine closes with a gold ✕ above a 1px rule and goes back with
the turn glyph. Every one keeps a semantic label.

**Motion.** The book slides in from the left over 150ms, easing out, and arrives at once when the
platform asks for reduced motion.

**Theme picker (13a).** One 64px row per theme, with its 84×40 swatch drawn in that theme: its
surface, 1px rule, 4px accent bar, `AaBb 72` in its own face and ink, and a 26px action block. Then
its name in EB Garamond, the design's own two-line note, and `ON ✓` or `USE IT`. The list is the
preview, and a tap applies the theme at once.

**Thumb ring.** `LedgerThumbRing` draws the design's 104px ring: health as the outer arc and breath
as the inner one, both from twelve o'clock, around a nub that moves with the thumb. The stick it
belongs to is #571's.

Widget tests measure 844x390 and 667x320/notched geometry, stable world State identity across
themes/routes, target heights, pointer guard cancellation, text/book transitions, lifecycle
parking, Escape/back/close and live recovery. The shared validated request fixture checks emitted
input shape. These tests do not fake a complete playable session or claim installed gameplay.
Only GitHub executes tests: baseline checks name three Flutter files; the integrated #587 full
Flutter suite is needed to execute `ledger_shell_test.dart`. Session wiring, theme persistence
through #577, multi-touch movement/hardware action integration, fonts/icons, golden screenshots
and installed native composition/keyboard proof remain #570 acceptance criteria.
