# Illness transmission

An ill villager can pass a fever to another person in the same village. The model uses three shared contacts per person per day. Each contact reaches a sick person with probability `sick / population`; a contact with a sick person passes illness with probability 0.04. This gives the contact risk `1 - (1 - 0.04 × sick / population)^3`. The existing spontaneous risk is 0.012 per person per day. The two independent risks combine as `1 - (1 - spontaneous) × (1 - contact)`. A bathhouse reduces both risks by 40%; it does not cure somebody already sick. A doctor shortens a caught fever and is paid under the existing rule.

The sick count is frozen before any person's roll. A case caught tonight can infect someone tomorrow, never the next row merely because the register lists them second. Every person still spends exactly two draws from the village's named daily illness stream, whether already sick, wounded, or well. The first decides infection; the second decides severity. This preserves the stream's draw budget and makes replay independent of the number of cases found earlier in a pass. The village's other daily streams are unchanged.

Sick leave counts down after today's work, then tomorrow's cases are rolled. A one-day case therefore loses one full workday. Being ill blocks work but does not kill directly; lost food and wages can affect future births or hunger deaths. The benchmark below measures that net population effect rather than treating the fever as a direct death roll.

## Between villages and replay

Illness travels with an infected `Person` when the existing resettlement path moves people into an empty village. `walkOver` preserves the person's remaining `ill` days. The receiving village's next daily contact snapshot includes that settler, allowing person-to-person spread there. No separate random import is rolled. Ordinary cart traffic does not transmit illness in this model: cart facts record cargo and payments, not the carrier's identity or health, so inferring a sick carrier at replay time would invent an unrecorded fact.

Daily outbreaks follow from the world seed, village name, day, and the village's people at that date. Told deaths and arrivals are replayed on their recorded dates before later days are lived again. Tests cover late founding from the same seed, a historical death delivered late, fixed draw counts, no same-day cascade, and an infected resettler. As with the existing migration simulation, both replays need the same known villages and geography to make the same resettlement decision.

## Reproducible benchmark

Run `pnpm exec tsx tools/illness-benchmark.ts`. It compares the live contact rule with a counterfactual that disables only contact transmission. Both arms use the same founding seeds and rules for spontaneous illness, doctors, bathhouse construction, and the economy. Later village states may differ as illness changes work and food. Five fixed seeds (11, 23, 42, 77, 101) each found Ashford and Pine with eight houses and the same four trades. A workday is one day a trade holder is well enough to work. An observed case begins when a person first appears ill; `sick person-days / cases` measures the observed mean, including episodes cut off at the benchmark horizon.

| Days | Mode | Cases | Sick person-days | Days per case | Healthy workdays | Final population |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 30 | isolated | 111 | 267 | 2.41 | 6,558 | 320 |
| 30 | contact | 132 | 315 | 2.39 | 6,529 | 320 |
| 90 | isolated | 296 | 745 | 2.52 | 21,090 | 324 |
| 90 | contact | 360 | 903 | 2.51 | 20,970 | 326 |
| 180 | isolated | 727 | 1,823 | 2.51 | 47,272 | 578 |
| 180 | contact | 862 | 2,172 | 2.52 | 46,861 | 572 |

These are measurements from one run of the fixed seeds; the elapsed-time column printed by the script is host-dependent. Transmission adds 135 cases over 180 days without lengthening treatment per case. The villages supplied 411 fewer healthy workdays and ended with six fewer people in this cohort. Population is two higher in the contact arm at day 90; the net long-run effect depends on births and hunger as well as illness.
