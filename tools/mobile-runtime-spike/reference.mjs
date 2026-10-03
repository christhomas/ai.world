import { readFileSync, writeFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { performance } from 'node:perf_hooks';
let identity = 0;
const context = createContext({ host: { now: () => performance.now(), uuid: () => `00000000-0000-4000-8000-${String(identity++).padStart(12, '0')}`, echo: bytes => bytes.slice(0), report: console.log } });
new Script(readFileSync('runtime-spike-out/workload.js', 'utf8')).runInContext(context, { timeout: 30000 });
const result = await new Script('MobileSpike.run()').runInContext(context, { timeout: 30000 });
writeFileSync('runtime-spike-out/reference.json', JSON.stringify({ host: 'Node reference (not phone evidence)', node: process.version, ...result }, null, 2));
console.log(result);
