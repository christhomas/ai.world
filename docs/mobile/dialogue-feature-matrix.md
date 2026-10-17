# Conversations on the page and in the installed game

Refs #574. This records what the TypeScript game actually offers. Flutter draws these rows from
`models.conversation`; it does not keep another price list, quest tree or list of professions.
The touch journey, fitting long content and reaching every control on a device remain #584.

`src/mobile/dialogue-families.test.ts` and `src/mobile/contextual-dialogue.test.ts` bind the IDs in
these tables to executable fixtures. A missing target is an assertion failure, never a skipped
case. The tables describe the conditions that matter, rather than promising every action from
every person with the same trade.

The web fixture drives `Conversation`, the controller inside `DialogueBox`, with its keyboard
operations. The phone fixture assembles the real `headlessGame` through `create` in
`src/mobile/game-engine.ts`, sends JSON `interact`, `choose` and `nudge` requests, and reads the
serialized native models. It compares every page's words, the complete ordered choice list,
notes, quantity controls, reading ownership, gold, pack and quest statuses. A spy keeps the host
available for arranging state; it does not replace its implementation or the request handler.
This does not instantiate browser DOM widgets or Flutter widgets.

Both sides get independent heroes with the same possessions and independent conversation
contexts. The assembled phone world uses road seed 3. Rule targets are explicit: Testford's
register is founded with seed 1, counter names and speech use seed 5, and contextual targets are
placed in reach. Books contain real register records, including a burial and a charge. Elder
quests come from `generateQuests`, including their words; the fetch fixture selects a two-loaf
quest worth 50g. That quest, a willing soldier and a rescue contract use bounded seed searches
with asserted preconditions. These
are controlled rule fixtures, not evidence of a generated-world walk.

## People and counters

These families come from `game/talk.ts`, `game/counter.ts`, `game/enquiry.ts` and `game/shops.ts`.
The fixture checks the root choices and opens the listed shop/book/room/post submenus too.

| Fixture family | Preconditions | Web actions offered, in order |
| --- | --- | --- |
| `talk:store` | Storekeeper, daytime | Buy; Sell; Chat; Leave. Buy shows the store catalogue and item notes; Sell shows accepted carried goods and quantity dials. |
| `talk:smith` | Smith counter, daytime | Buy; Sell; Chat; Leave. Buys gear, arrows, gems and bones; locally forged gear can run out. Forging is world work, not a separate forge button here. |
| `talk:apothecary` | Apothecary counter with its birth book, daytime | Buy; Sell; Ask about the births; Chat; Leave. Without a room book, the records row is absent. |
| `talk:inn-local` | Innkeeper with room service, daytime | Buy; Sell; Take a room (fixture price 12g); Chat; Leave. The room offers Sleep or Not tonight. |
| `talk:inn-shared` | Innkeeper with room service and shared-world post | Buy; Sell; Take a room; The post shelf; Chat; Leave. Post offers collection or leaving a parcel; sending selects an item and recipient. |
| `talk:inn-night` | Innkeeper with room service after dark | Take a room; Back out into the dark. Kitchen and shop shelves are closed. |
| `talk:priest` | Congregation role, priest trade, church book supplied | Ask about the dead; Leave. Free gist, then paid detail when the book has entries. |
| `talk:clerk` | Keeper role, clerk trade, town hall books supplied | Ask about the people here; Ask who is descended from whom; Leave. The descent is unrolled; other records are read in pages. |
| `talk:sergeant` | Keeper role, sergeant trade, watch house charge sheet supplied | Ask about the charge sheet; Leave. |
| `talk:doctor-paid` | Doctor, two hearts missing, 14g treatment affordable | Pay 14 gold; Wait your turn (6 hours); Not now. |
| `talk:doctor-poor` | Same wound, empty purse | Wait your turn (6 hours); Not now. The paid row is absent; the doctor does not refuse free care. |
| `talk:doctor-favour` | Same wound, treatment fee waived | Let them see to it; Not now. |
| `talk:elder-fetch` | Elder, unaccepted fetch quest supplied | Accept; Not now. Active but incomplete quests instead give their reminder with no reward row. |
| `talk:elder-visit` | Elder, unaccepted visit quest supplied | Accept; Not now. Discovery is the visit prerequisite. |
| `talk:elder-ready` | Active fetch quest, required goods carried | Take the promised gold. Fetch turn-in consumes the requested goods; completed quests offer no second reward. |
| `talk:resident` | Ordinary villager, no counter role | Speech only. Personal news and gossip depend on the register and purse. |
| `talk:congregation` | Congregation outside a room with books | Speech only. |
| `talk:keeper-outdoors` | Clerk without a room book | Speech only. Books belong to the room, not the person's trade. |
| `talk:traveller` | Traveller without a counter role | Speech only. |
| `talk:wolf` | Creature without a human conversation role | The creature's line, with no choices. |

## Contextual conversations

These menus are opened by `game/interact/*`. Their offered rows pass through the same native
conversation model as a keeper's. The fixture opens the actual interaction function at the
specified target; it does not reproduce the rows in a phone implementation.

| Fixture family | Preconditions and source | Web actions offered |
| --- | --- | --- |
| `context:stablehand` | Stablehand in reach, a stable stocking horse/goat/camel, empty purse; `village.ts` | The three breeds with prices; Not today. The horse's purchase refusal is exercised. |
| `context:fallen-craft` | In reach of the fallen craft, currently grounded; `travel.ts` | Climb in; Leave it be. |
| `context:dungeon-descent` | Underground selector reports downward stairs; `interact/index.ts` | Go deeper; Not yet. This isolates the selector's menu from dungeon geometry. |
| `context:dungeon-stairs` | Underground selector reports the way out; `interact/index.ts` | Climb out; Stay. |
| `context:pub` | In the matching village pub; `village.ts`, `pub.ts` | Darts; builder and cart enquiries; take a seeded errand, or collect when ready; Nothing, thanks. The fixture has an unaccepted fetch errand. |
| `context:notice-board` | At a village board with an unaccepted quest; `village.ts` | Take the errand; Leave it. An accepted or settled notice has no accept row. |
| `context:hall` | At the mayor's actual house; `village.ts`, `world/hall.ts` | Holding history, unread history, That is all; vacancy oath rows when work is vacant; a vote when the village's ballot is ready. The fixture checks the full list against the phone, plus the history rows. |
| `context:market-pitch` | At an empty connected-world market pitch; `village.ts` | Rent it; Leave it. Owned stalls instead offer stocking/takings; another trader's stall offers its listed lots. |
| `context:baths` | In reach of an existing sauna, fee affordable; `village.ts` | Pay; Another time. |
| `context:ferry` | At the near dock at the start of its timetable; `travel.ts` | Board (12g); Not now. The fixture has no gold and opens the fare refusal too. |
| `context:loft` | In the sky loft, a named shrine 300 tiles away already discovered; `travel.ts`, `loft.ts` | Far Shrine — 300 tiles (39g); Not today. Unknown or nearby places are excluded. |
| `context:shrine` | At a shrine above a living village; `wild.ts` | Descend; Ask the stones to raise high ground; Not now. An empty village adds the paid raising row. |
| `context:cave` | At an actual cave target in the fixture; `wild.ts` | Go in; Not now. |
| `context:giant-tree` | At a great tree; `wild.ts` | Push through; Leave it. |
| `context:campfire` | At warm campfire embers; `wild.ts` | Rest; Move on. |
| `context:mortar` | Mortar carried, one bitter herb; `herbs.ts`, `brewing.ts` | Salve and Warding Draught recipe rows with missing ingredients; Not now. The unavailable salve row is exercised. |
| `context:boatwright` | At a pier, no boat owned; `travel.ts` | Buy the boat; Another time. |
| `context:eagle` | At one of two partnered crags, fare affordable; `travel.ts` | Fly; Walk round. A baited nest also offers removal. |
| `context:skyward` | At an island's calling place; `travel.ts` | Fly up; Stand and watch. An empty purse exercises the refusal. A ridden horse adds dismount-or-ride-on before lift. |
| `context:sky-return` | At the sky island's return perch; `travel.ts` | Go back down; Stay a while. Descent is free. |
| `context:builder` | No commission held or unpaid, inland village, no house owned; `builder.ts` | A house with price and deposit; Nothing today. A house enables additions; water enables a jetty; water plus a harbour enables a boat. |
| `context:strongbox` | At a completed paid house with stored bread and gold; `builder.ts` | Put something in; Take something out; Leave it shut. The take-out submenu contains the stored gold and items. |
| `context:field` | Plantable village ground, wheat and pumpkin seeds, spring; `wild.ts`, `farming.ts` | Wheat; Pumpkin marked wrong season; Leave it. The pumpkin refusal is exercised. |
| `context:camp` | Tent carried, night, not sailing; `camp.ts` | Pitch the tent; Walk on. |
| `context:carcass` | A fallen wolf at the hero's feet, no knife/cart; `camp.ts` | Pull at it; Leave it for the eagles; Leave it. A knife changes the first row to Skin it; a suitable cart enables loading. |
| `context:cell` | At a standing station's cell door; `jail.ts` | Speech only: who is held and time left, or an empty-cell description. The fixture checks the empty-cell branch without skipping it. |
| `context:carrier` | Connected world, current unfinished load halfway along a connected road; `carrier.ts` | Guard the load; Rob the load; Let them pass. |
| `context:gift` | In reach of a registered resident, two loaves carried; `gifts.ts` | Give Bread; Never mind. Earned favours may add a collection row; gift order follows what the recipient values. |
| `context:hire` | In reach of a registered, willing soldier; `hire.ts` | All coin now; part coin and share; share only; Not today. Existing hires offer orders, parting, and renewal near expiry. |
| `context:rescue` | Elder in a failing village, seeded trouble at nearby stones; `rescue.ts` | I will go; Not today. Accepted work gives a reminder; completed work offers settlement. |
| `context:prayer` | Local connected world, shrine named Echoes; `prayer.ts` | Four named directions; Not now. A direction opens a warning and explicit confirmation or leaving the ground alone. |

The matrix checks the complete native choice list against the web for every listed fixture. It
does not claim branch coverage of every possible stock list, civic ballot, building catalogue or
world seed. In particular, the hall fixture does not force a promotion ballot ready.

## Refusals and unchanged state

`src/mobile/dialogue-refusals.test.ts` drives both paths from matching state and checks the exact
web words plus gold, pack, quest status, charts, discoveries and the state version:

- Every shop: insufficient gold and night closure.
- Store: a chart already owned, even with no gold; an empty sell list.
- Food: empty cellar and a partial loaf's meals returned to the cellar before refusal.
- Smith: exhausted locally forged stock; no coin or sword moves.
- Smith, inn and apothecary: a carried mortar the shop does not buy.
- Inn: unaffordable room in daytime and at night; declined sleep; no parcel goods or recipients.
- Priest, apothecary, clerk and sergeant: nonempty books with an unaffordable detail fee; no paid sitting recorded.
- Fetch and visit errands: unmet requirements and declined acceptance; reopening a completed fetch quest cannot pay again.
- Sales: an out-of-range row; all displayed goods removed before confirmation; a displayed quantity above what remains.

The last sale case follows the web's existing policy: it sells only the amount still carried and
pays for that amount. It is a partial successful sale, not a refusal of the entire stale quantity.
`contextual-dialogue.test.ts` also compares the fare/load refusal for sky flight, a shared-world
prayer, a shrine's unaffordable raising and rain refusing a fire. The family visits compare the
boat, ferry, loft, horse, recipe and wrong-season refusal pages as well. The keeper-refusal fixture
enters a real store in seed 3 through `Places.enterBuilding`, finds clear floor beyond counter and
door reach, and compares the phone's `interact` result with the web selector, with the keeper both
present and absent. Both produce the same HUD words and preserve possessions.

There is no pack capacity check in these shop/quest rules. `GameState.give` adds to an item map;
inventing a “pack full” response on the phone would create a difference. A shop's unsuitable items
are filtered out of the sell list. If none remain, the keeper says the pack contains nothing they
can use. No additional quest level, reputation or prerequisite refusal exists in `talk.ts`.

## Actions that do not offer conversation rows

The broader #574 scope also names actions that are not conversation families. The code keeps
these in the shared game; the phone dispatches the same semantic action keys. They should not be
represented as invented native menus.

| Shared action family | Source and existing behavior |
| --- | --- |
| Cooking, lighting fires, felling | `interact/craft.ts`: direct effects and HUD lines; raw meat is the food that wants a fire. Rain refuses kindling. |
| Fishing, digging, harvesting | `interact/wild.ts`: direct actions/HUD progress. Sowing, unlike harvesting, opens the field conversation above. |
| Mining and forging | `mines.ts`, `mining.ts`, `forge.ts`: villagers' world work supplies ore and local smith stock. There is no player mining/forging choice in the interaction chain; the catalogue's pickaxe names `hew`, but no game interaction calls that ability. |
| Dungeon chests/locks | `places.ts`: shared underground interaction and HUD results; the locked-door text and stairs menus are selected in `interact/index.ts`. |
| Building entry/exit | `places.ts`, `interact/index.ts`: proximity decides the keeper or threshold. Without either, the HUD says “Stand at the door to leave, or at the counter to talk.” |
| Mount/dismount and boat/shore | `interact/village.ts`, `interact/travel.ts`: use the nearby mount or bought hull directly; unsuitable shore gives a HUD refusal. Buying a horse or hull opens a conversation. |
| Craft flight/landing | `interact/travel.ts`: found craft offers Climb in / Leave it be; while flying the action requests landing. Canvas-wing and parachute controls remain shared player actions. |

No device or local build/test was run for this fixture change. CI must establish compilation and
runtime results. These cases do not establish touch hit areas, frame behavior, generated-world
reachability, invalidation of an already open conversation after a target/place changes, or a real server's asynchronous refusal handling;
those remain separate integration/playtest evidence, including #584.
