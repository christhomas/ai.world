/*
 * Two sets of screenshots, and whether they are the same pictures.
 *
 * `shots.cjs` pins the world, the seed, the camera and what has to happen first, so a shot can be
 * retaken exactly — and then nothing in this repository ever read two of them. Not the script, and
 * nothing in `checks.yml` looks at `docs/screenshots/` at all.
 *
 * That is the gap under every graphics item on the list. #249's acceptance is "reference
 * screenshots before and after are identical" and #250's is "with the switch off, the G0 reference
 * screenshots are unchanged", and neither was a thing anybody could evaluate except by opening two
 * windows and squinting — which is exactly how you miss the fault #250 warns about. Shared tuning:
 * the sun at 2.6, the ambient at 0.45, the shadow bias. Move one for a second render path and the
 * first changes with it, invisibly, until it is three changes deep.
 *
 *   chore shots                        # take the pictures
 *   cp -r docs/screenshots /tmp/before # keep them
 *   ...make the change...
 *   chore shots
 *   chore compare -- /tmp/before       # and what moved
 *
 * It borrows playwright exactly the way `shots.cjs` and `playtest.cjs` do, and for the same reason
 * a browser toolchain has no business in a world-server image. The browser is here to *decode a
 * PNG*, which Node cannot do on its own and which is not worth a dependency: a canvas reads one in
 * three lines and this repository already pays for a browser.
 *
 * What counts as a difference, and why the threshold is what it is, is in `pictures.ts` — kept apart
 * from this so the decision can be held to in a test without a browser anywhere near it.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const HERE = process.env.SHOTS || 'docs/screenshots';
const THERE = process.argv[2];

/** The comparison's own rules, read out of the module the tests hold. */
const rules = () => {
  const src = fs.readFileSync(path.join(__dirname, 'pictures.ts'), 'utf8');
  const shade = /A_SHADE:\s*(\d+)/.exec(src);
  const much = /TOO_MUCH:\s*([\d.]+)/.exec(src);
  if (!shade || !much) throw new Error('pictures.ts no longer states its own thresholds');
  return { shade: Number(shade[1]), much: Number(much[1]) };
};

const pngsIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')) : []);

async function main() {
  if (!THERE) {
    console.error('usage: chore compare -- <directory of the pictures to compare against>');
    process.exit(2);
  }
  const { shade, much } = rules();
  const mine = pngsIn(HERE);
  const theirs = new Set(pngsIn(THERE));
  if (mine.length === 0) {
    console.error(`nothing to compare: no pictures in ${HERE}. Take some with \`chore shots\`.`);
    process.exit(2);
  }

  const browser = await chromium.launch({
    headless: true, executablePath: process.env.BROWSER || undefined,
  });
  const page = await browser.newPage();
  const lines = [];
  let worst = 0;
  let told = 0;

  for (const name of mine.sort()) {
    if (!theirs.has(name)) { lines.push(`  NEW    ${name}`); continue; }
    const read = async (file) => {
      const png = fs.readFileSync(file).toString('base64');
      return page.evaluate(async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        const { data, width, height } = canvas.getContext('2d')
          .getImageData(0, 0, canvas.width, canvas.height);
        return { width, height, data: Array.from(data) };
      }, png);
    };
    const before = await read(path.join(THERE, name));
    const after = await read(path.join(HERE, name));
    if (before.width !== after.width || before.height !== after.height) {
      lines.push(`  SIZE   ${name}: ${before.width}x${before.height} against ${after.width}x${after.height}`);
      told++;
      continue;
    }
    let moved = 0;
    const of = before.width * before.height;
    for (let at = 0; at < of; at++) {
      const px = at * 4;
      const apart = Math.max(
        Math.abs(before.data[px] - after.data[px]),
        Math.abs(before.data[px + 1] - after.data[px + 1]),
        Math.abs(before.data[px + 2] - after.data[px + 2]),
      );
      if (apart >= shade) moved++;
    }
    const share = of === 0 ? 0 : moved / of;
    worst = Math.max(worst, share);
    if (share > much) { told++; lines.push(`  MOVED  ${name}: ${(share * 100).toFixed(2)}% of it`); }
  }
  for (const name of [...theirs].sort()) if (!mine.includes(name)) lines.push(`  GONE   ${name}`);

  await browser.close();

  const report = [
    `PICTURES — ${told === 0 ? 'SAME' : 'CHANGED'} — ${new Date().toISOString()}`,
    `  ${mine.length} pictures against ${THERE}, worst ${(worst * 100).toFixed(2)}%,`,
    `  anything past ${(much * 100).toFixed(2)}% of a picture is reported`,
    ...lines,
  ].join('\n');
  console.log(report);
  const out = 'docs/reports';
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'pictures-report.txt'), `${report}\n`);
  process.exit(told === 0 ? 0 : 1);
}

main().catch((wrong) => { console.error(wrong); process.exit(1); });
