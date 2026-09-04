# Candidates

A proposal for a piece of the game's artwork, waiting to be looked at.

A candidate is a folder named after the idea, holding replacement files at the same paths they
have in the repository:

    art/candidates/warmer/src/ui/portrait.ts

Nothing here affects the game. `chore art faces --try warmer` draws the candidate beside what the
game currently uses, and `chore art approve warmer` copies its files into place, at which point it
stops being a proposal and becomes an ordinary uncommitted change you can review and commit.

Keeping proposals as whole files rather than as patches means a candidate always renders, however
old it is, and two of them can be compared against each other without either having been applied.
The other side of that is drift: a candidate is a snapshot, so one left here for a long time will
not have whatever the real files have gained since. That is usually the right answer for artwork,
where you are judging a look rather than merging a change, but it is worth knowing.

`warmer` is a worked example: warmer skin, brighter eyes, brows a pixel higher.
