# Installed-player feature acceptance matrix

Baseline inventory: `src/game/keys.ts`, `src/game/interact/index.ts`, all `src/ui/*` surface modules,
`src/save/store.ts`, `src/game/state.ts` and Ledger II `design/mobile/README.md` at 8086c294.
This is the architecture acceptance catalogue for #558. Every row is **pending** until its child
records installed gameplay evidence. A renderer screenshot (#569) or fake-session fixture does
not pass a gameplay scenario. Features grouped in a row must each execute the listed assertion.

Each ID expands to two named touch scenarios: `android.<ID>` on the Android API 35 emulator and
`ios.<ID>` on the iPhone 16/iOS 18 simulator. #584 owns their installed-app executable drivers;
feature children own seeded world setup and state assertions; #583 owns fresh-install offline
and cross-platform runs. For every row retain app/bundle SHA, device/OS/GPU, world seed/setup,
touch trace, before/after authoritative state, native UI/scene capture and test result as hosted
artifacts. L means airplane-mode local world; R means direct TLS shared world. L/R means both.
Physical-only evidence is called out below and must remain pending separately.

| ID / player feature | Source inventory | Owner | Mode | Android and iPhone touch scenario; required state assertions |
|---|---|---|---|---|
| entry-new | title | #572/#564 | L | Tap New, seed and name, start; world and player exist without network/script download |
| entry-continue | title, SessionSave | #572/#577 | L/R | Tap Continue; seed, world name/kind, position and camera restore; corrupt save offers recovery |
| entry-join | title, online | #572/#565 | R | Enter invite/join world; handshake/protocol rejection visible; direct connection with no relay |
| walk-look | keys, touch | #571 | L/R | Drag stick, turn/pinch camera, run/guard/release; position changes once per tick, diagonal speed bounded, cancelled touch clears held input |
| fight-bow | keys x/z, player | #571/#562 | L/R | Tap swing/loose, hold guard; target health/ammo/breath and cooldown change; authority agrees |
| magic | keys b/h/u/v | #571/#562 | L/R | Cast ward/blight/light/draught individually; spell state/resource/cooldown and rendered effect match |
| jump-wing | keys Space | #571/#574 | L/R | Tap jump on ground, deploy canvas wing aloft, land; altitude and equipment state correct |
| camera-photo | keys f/p/Enter, photo | #571/#578 | L/R | Toggle follow/free, enter framing, shutter/exit; scene revision captured, camera mode restored |
| focus-surfaces | screen, Ledger II | #570 | L/R | Open each book/dialogue/photo, then type; WORLD/BOOK/TYPING and busy mode correct; world stays live, stick/attacks parked, Escape closes current surface |
| hud-context | hud, readouts, clock, compass, countdown | #571/#562 | L/R | Move into/out of reach; health/breath/place/time/season/bearings/countdown and stable subject verb update without stale actions |
| room-door-bed | interact village, places | #574/#561 | L/R | Open door, talk keeper/landlord, sleep, leave threshold; indoor context/clock/player location and geometry agree |
| dungeon | places, dungeonmap | #574/#575/#561 | L/R | Descend, unlock, open chest, deeper stairs and climb out; level/key/loot/map discovery and scene change |
| sky | travel trySkyward/trySky | #574/#561/#577 | L/R | Fly to island, ask flight/return, save/reload aloft; sky anchor/position preserved and no ground interactions |
| horse | village tryHorse | #574 | L/R | Borrow/mount/ride/dismount; mount ownership/stamina and paddock collision state correct |
| boat-ferry | travel tryBoat/tryFerry | #574 | L/R | Board boat, sail, step ashore, board each ferry/arrive; aboard flags/route/location correct |
| eagle-craft-carrier | travel, carrier | #574 | L/R | Hire eagle/sky flight, board/land craft, inspect carrier; transport context/fees/altitude/cargo changes |
| farm | wild tryFarm | #574 | L/R | Sow/tend/harvest; field maturity, inventory, tools and ownership persist |
| forage-fish-dig | wild/herbs | #574 | L/R | Fish, dig, pick/grind herbs and fell tree; each tool/resource/depletion change verified |
| camp-cook-skin | camp/craft/wildcamps | #574 | L/R | Skin carcass, kindle/cook/rest/make camp/search camp; inventory/food/time/ownership and theft consequences |
| shrine-prayer | wild/prayer | #574 | L/R | Pray/offer at shrine; blessing/resource/timed effect changes and expiry |
| wreck-remains | wild | #574 | L/R | Search wreck and fallen pack; loot removed once, no duplicate inventory |
| building-chest | builder/wright | #574 | L/R | Hire builder, place valid building, reject invalid coast site, open chest; materials/ownership/chest contents persist |
| baths-hall-board-sign | village | #574/#575 | L/R | Visit baths, ask hall, notice board/signpost; payment/reputation/records and directions update |
| jail-nemesis-rescue | jail/nemesis/rescue | #574 | L/R | Visit cell, hear scheme, resolve timed choice, rescue/fight trouble; nemesis/rescue state and village welcome change |
| dialogue-shop-quest | dialogue/topics | #574 | L/R | Tap conversation choice/page, adjust shop quantity, buy/sell, accept/complete errand; money/items/quest state and exact quantity |
| gift-hire | gifts/hire | #574 | L/R | Give to NPC, hire/muster/share, casualty; precedence over player trade, inventory/gold/follower roster correct |
| pack-equipment | rucksack, state | #573 | L/R | Open pack, select/equip/unequip/use/drop item and stack quantity; carried/worn/resources and world drop match |
| map | worldmap/minimap/dungeonmap | #575 | L/R | Open, pan/zoom/centre each map, mark/discover; correct place/level/player/discovery/markers and no world movement |
| journal | journal | #575 | L/R | Read quests/history and navigate bearing; current task/completion/world records reflect state |
| roster-kin | roster/kin/portrait | #575 | L/R | Read person/relationship/history/portrait; stable IDs and generation/relationships match world |
| company-rally-party | players, people, keys k/l/r | #576 | R | Invite/accept/leave party, open company, rally; membership/player presence/ping recipients and expiry correct |
| chat | chat, keys t | #576 | R | Type/send/cancel chat; no gameplay key leaks, ordered messages/sender identity and reconnect behavior |
| player-trade | people | #576 | R | Give/trade with another player, change offer, accept/cancel; both authoritative inventories/gold update atomically |
| mail-stall | village, online, state | #576 | R | Send/read mail, list/buy/cancel stall stock; delivery/read flags, stock and balances survive reconnect |
| saves-world | SessionSave, state | #577/#564 | L/R | Save/kill/relaunch; seed/name/kind/camera/player/state/manifest/nemesis/roaming/sky/discovery/inventory restore, no partial commit |
| options-theme | switches/themes | #578/#570 | L/R | Switch Stone/Vellum/Steel/Hairline, see-through/quality/settings; applies immediately and survives relaunch |
| audio-accessibility | audio, switches, design | #578 | L/R | Mute/volume, reduced motion/text/readability; cues respect options, 44px targets and >=4.5:1 live text contrast |
| capture | photo | #578 | L/R | Frame and save/share photograph, deny permission/retry; acknowledged revision image and native error feedback |
| return-title | keys n/Escape | #572/#579 | L/R | Leave session/title/return; save policy honored, resources released, old generation cannot update UI |
| lifecycle-network | visibility, online | #579 | L/R | Background/resume/interruption, lose/rejoin network; controls released, save durable, clock monotonic, full resync before deltas |
| session-cycles | session/storage/scene | #582/#566 | L/R | Repeat new/load/dispose ten times; bounded buffers/queues and <=10% retained memory growth |
| fresh-install-crossplay | all above | #583/#584 | L/R | Fresh install offline complete loop, then Android/iPhone/web meet; same authority/features with no host computer |

## Coverage beyond the drawn handoff

Title, full journal/map, party, market stall, console, dungeon/interior HUD, night/winter palette
and portrait book layouts are explicitly absent from design frames, not permission to omit their
normal gameplay. #570 owns native treatment; feature owners above own behavior. Console diagnostic
world editors/operator commands are separate scope; ordinary contextual actions remain in #574.
Night/winter/cave and safe-area/native theme evidence belong #569/#570/#578. Controller support,
cloud-save sync and monetization are separate scope, not prerequisites or replacement interfaces.

Persistence coverage must include every `GameStateJson` domain field, not just SessionSave's header:
pack/worn, errands, kin, hired companions, farms/buildings/chests, camps, exploration/history,
mail/party/trade/stalls, player resources and world manifest/expansions. #577 must enumerate the
actual versioned payload at implementation time and assert migration fixtures for each schema.

## Evidence lanes and gates

#569: deterministic native renderer replay on both platforms, including imported depth/winding,
water/light/colour/geometry, rooms/dungeons/sky; captures prove pixels only. #584: installed native
UI touch traces and authority assertions for every row. #583: fresh-install offline and direct
cross-platform gameplay. #582: physical GPU/frame/thermal/memory/latency measurements. #580/#581:
physical signing/install/TestFlight/distribution. Permission prompts, phone calls/audio focus,
OS background kills, touch latency and thermal endurance need real devices. Simulator results
cannot mark those physical checks passed. Attach exact executable test IDs and artifact URLs when
implemented; the names above are required scenarios, not existing executable test files.
