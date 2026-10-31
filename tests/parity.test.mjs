import { readFileSync } from "node:fs";
import { whyMismatch } from "../engine.js";
const cases = JSON.parse(readFileSync(new URL("./parity_cases.json", import.meta.url)));
let bad = 0, checked = 0;
for (const c of cases) {
  const r = whyMismatch(c.entries, c.total);
  const K = r.K, tonum = v => Math.round(Number(v) / 10 ** K * 1e6) / 1e6;
  const js = new Set(r.hypotheses.map(h => h.kind + "|" + h.fixed.map(tonum).sort((a, b) => a - b).join(",")));
  const py = new Set(c.hyps.map(([k, f]) => k + "|" + f.join(",")));
  checked++;
  if (js.size !== py.size || [...py].some(x => !js.has(x))) { bad++; if (bad <= 3) console.log("MISMATCH", c.entries.join(" "), "total", c.total, "\n  py:", [...py].slice(0, 4), "\n  js:", [...js].slice(0, 4)); }
}
console.log(`parity: ${checked - bad} of ${checked} cases identical between the Python tool and the JavaScript engine`);
process.exit(bad ? 1 : 0);
