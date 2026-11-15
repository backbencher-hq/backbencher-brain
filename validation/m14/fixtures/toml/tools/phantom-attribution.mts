/**
 * PHANTOM ATTRIBUTION PROBE — which fixtures-directory file manufactures which
 * relationship kind for `script/m14/completeness-inventory.ts` section B.
 *
 * `emittedKinds` reads EVERY top-level non-`.json` FILE of a lane's fixtures directory
 * and runs `ASTEngine.parseFile` on each, so a TypeScript tool at the top level is parsed
 * AS THE LANE'S LANGUAGE and its garbage edges are credited to the lane. This probe reads
 * exactly that population through exactly that code path and prints the kind set PER FILE,
 * so a fix can be checked against the population it changed rather than against a summary.
 *
 * The directory itself is excluded by the scanner (`statSync(...).isFile()`), which is why
 * tools live in `tools/`. Run it after adding a tool to the fixtures directory top level.
 *
 *   npx tsx validation/m14/fixtures/toml/tools/phantom-attribution.mts
 *
 * MEASURED, toml lane, 2026-10-09. BEFORE the move of construct-census.ts into tools/:
 *   16 top-level files read (9 .toml fixtures + 7 .ts tools), 0 directories.
 *   construct-census.ts alone -> calls imports instantiates references uses (261 edges).
 *   UNION over the population: calls, contains, imports, instantiates, references, uses.
 *   Section B read: "EMITTED but absent from requiredKinds: calls, imports, instantiates,
 *   references, uses".
 * AFTER the move: 15 top-level files read, `tools` skipped, and the union is UNCHANGED —
 * six other .ts tools (ambiguity-split, census, mutants, oracle-diff, pass2-probes,
 * ruled-gate) carry the same defect. The move is necessary and not sufficient.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"

// tools/ -> toml -> fixtures -> m14 -> validation -> root
const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const DIR = path.join(ROOT, "validation/m14/fixtures/toml")
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

const sources = readdirSync(DIR).filter((f) => {
  if (f.endsWith(".json")) return false
  try { return statSync(path.join(DIR, f)).isFile() } catch { return false }
})
const dirs = readdirSync(DIR).filter((f) => { try { return statSync(path.join(DIR, f)).isDirectory() } catch { return false } })

console.log(`fixtures dir: ${DIR}`)
console.log(`top-level FILES read by the scanner (${sources.length}): ${sources.join(" ")}`)
console.log(`top-level DIRECTORIES not read by the scanner (${dirs.length}): ${dirs.join(" ") || "(none)"}`)
console.log("")
const all = new Set<string>()
for (const f of sources) {
  const abs = path.join(DIR, f)
  let res: any = null
  try { res = await ASTEngine.parseFile(abs, readFileSync(abs, "utf8")) } catch { /* an unparseable source contributes nothing */ }
  const kinds = [...new Set<string>((res?.relationships ?? []).map((r: any) => String(r.type ?? r.relationshipType ?? "")).filter(Boolean))].sort()
  for (const k of kinds) all.add(k)
  console.log(`  ${f.padEnd(48)} ${String((res?.relationships ?? []).length).padStart(5)} edges  ${kinds.join(" ") || "(none)"}`)
}
console.log("")
console.log(`UNION emitted kinds over that population: ${[...all].sort().join(", ")}`)
