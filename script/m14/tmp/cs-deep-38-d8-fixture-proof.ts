// CS-DEEP-38 — prove the CS-D8 fixture cases are load-bearing, by running the PRE-FIX analyzer
// over the POST-FIX fixture. A forbidden row the old code never produced pins nothing, and the
// only way to know is to run the old code, not to reason about what it would have done.
//
// HOW IT RUNS THE OLD CODE, and why this file is a single-file-argument probe with a shell
// wrapper rather than a self-contained script. The engine resolves an analyzer by MODULE PATH
// (`src/ast/engine.ts` -> `await import("./real-csharp-analyzer")`), so there is no hook for
// handing it a different class. Two earlier attempts failed in instructive ways:
//
//   1. Passing an analyzer instance in options, which the engine does not accept. The rejection
//      fell through to a plain `parseFile`, which ran the CURRENT analyzer and printed
//      "pre-fix: no CS-D8 rows" — the exact output a broken instrument gives when it is wrong,
//      and a result that would have been filed as "the fixture pins nothing".
//   2. Swapping the file inside one process and re-importing. Bun caches the resolved module, and
//      the engine's own `await import("./real-csharp-analyzer")` carries no cache-busting query,
//      so the second run silently re-executed the first run's code. Both labels printed PRE-FIX
//      rows, which is what gave it away.
//
// So the swap happens BETWEEN processes, in the caller, and this file only reports. One process,
// one analyzer version, no cache to lie about.
//
// WHAT IT SHOWS (roslyn corpus evidence in cs-deep-33; fixture evidence here):
//   pre-fix   uses TakesGadget -> Gadget                @178   (a signature line)
//             uses TakesDoodadInLambda -> Doodad         @184
//             uses PrimaryCtorTakesSprocket -> Sprocket  @212
//   post-fix  all three absent; the CONTROL read survives.
//
// AND THE PART THAT WAS NOT EXPECTED. The control row `uses ReadWidget -> Widget` moves from
// line 194 to 196 across the fix. Line 194 is `public Widget ReadWidget(Widget widget)` — the
// PARAMETER TYPE — and 196 is `var same = Widget;`, the real read. Pre-fix, the defect's row and
// the correct row were the SAME (source, target) pair, so the emitter's dedup kept whichever came
// first and the graph pointed at the signature. The defect was not merely adding a wrong row; it
// was REPLACING a right one with a wrong one at a different line, and no row-presence check
// against the analyzer's own output could have told. That is why the fixture pins a line number
// on the control as well as a target on the forbidden rows.
//
// Usage:  bun cs-deep-38-d8-fixture-proof.ts --report [prefix|postfix]
//         (the shell wrapper swaps the analyzer and passes the matching label)
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()
const FIXTURE = "validation/m14/fixtures/csharp/read-collides-with-call.cs"
const NAMES = ["Gadget", "Doodad", "Sprocket", "Widget"]
const labelArg = process.argv.indexOf("--report")
const label = labelArg >= 0 ? (process.argv[labelArg + 1] ?? "run") : "run"

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const res: any = await ASTEngine.parseFile(FIXTURE, fs.readFileSync(FIXTURE, "utf8"))
const rels = (res.relationships ?? []).filter((r: any) => (r.type ?? r.relationshipType) === "uses")
console.log(`  ${label}:`)
for (const t of NAMES) {
  const hits = rels.filter((r: any) => r.target === t)
  if (hits.length === 0) { console.log(`     (none)  ${t}`); continue }
  for (const h of hits) console.log(`     ${h.source} -> ${t}  marker=${(h.metadata ?? {}).relationshipType} line=${h.line_number}`)
}
