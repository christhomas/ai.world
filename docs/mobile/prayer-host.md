# Host-owned prayer services (#560)

The shared shrine interaction now receives a `PrayerHost` for one unsigned random seed, a saved
world restart and its owning session's liveness. It no longer calls browser navigation or Web
Crypto. The existing web game supplies those services through `createPrayerHost` in the browser
lifecycle adapter; native runtime hosting must supply its own implementation.

The gameplay rules remain in the existing prayer module: solo endless country only, warned
consequences, one recorded roll, strict save before confirmation/restart, and the existing due-day
and manifest rules. Confirmation rechecks eligibility and pending prayers so a stale or repeated
dialogue callback cannot add a second prayer or shape a shared world. An invalid native seed is
rejected before changing state or writing storage.

Asynchronous save callbacks check the same session's disposal fence before touching HUD/audio,
rolling back its model or requesting a restart. Disposal does not undo a write already committed;
it prevents the old session's completion from affecting another world. A due answer also rechecks
local authority after the save. Storage failures, including synchronous port exceptions, retain
the existing retry behavior. A restart failure reports that the save succeeded and permits retry.

Headless regressions remove window/document/crypto and exercise actual prayer decisions through
the supplied ports, duplicate confirmations, disposed sessions, authority changes, invalid seeds
and port failures. Existing full-disk tests still use the production opened-save composition.
GitHub runs all validation; no tests, builds or playtests were run locally.

This is another portion of #560, not a complete portable bootstrap or installed phone game.
Phone-side restart/loading, worker/asset/UI/scene composition and runtime integration remain open.
