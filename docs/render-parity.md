# Renderer parity check

Capture the same seed, camera, world time, and scene on both revisions. The
`STATIC_SCENE=1` shot mode waits for weather to settle, pauses the local game,
sets a fixed camera and light, and omits moving creatures. It supports the town
and mountain scenes. It leaves the world, terrain, props, and minimap visible.

```sh
OUT=/tmp/render-before STATIC_SCENE=1 RIG=classic node tools/shots.cjs town mountain
OUT=/tmp/render-after STATIC_SCENE=1 RIG=classic node tools/shots.cjs town mountain
SHOTS=/tmp/render-after EXCLUDE_RECT=1103,75,1415,394 \
  node tools/compare.cjs /tmp/render-before
```

Run the first capture from the base revision and the second from the candidate.
Use separate `PORT` values if they run together. Both images are 1440 by 900.
The excluded rectangle is the asynchronous minimap: its tile stream has a
different completion time in each browser run. Exclude the same rectangle from
both images; the strict 0.50% difference limit still applies to every other
pixel. The minimap has separate content assertions in `src/ui/minimap.test.ts`
and `src/ui/mapbase.test.ts`. Capture interiors normally, without this exclusion.

For a pull request, the `render-parity` label runs the comparison on a pinned
Ubuntu 24.04 runner. It checks out the PR base and GitHub's proposed merge result,
captures town and mountain with `STATIC_SCENE=1`, captures the interior normally,
then applies the 0.50% pixel limit. The artifact keeps both sets of PNGs and
separate outdoor and interior reports. Apply the label after the final render
commit so the report describes that exact head.
