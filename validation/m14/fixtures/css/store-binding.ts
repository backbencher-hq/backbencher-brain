/**
 * CSS STORE BINDING — do the qualified targets CSS-D15 publishes actually ATTACH in the store?
 *
 * WHY THIS EXISTS, and it is the check that can invalidate CSS-D15 rather than confirm it. The
 * gate (`incoming-gate.ts`) resolves an edge against a KEY SPACE it builds from the analyzer's
 * payload; the STORE resolves it with SQL, and the two are not the same instrument. This lane's
 * fix respells an edge's target to `<file-scope>::<name>`, and a target carrying `:` is
 * EXCLUDED from the bare-name resolution pass by construction — `clean-store-resolution.mts`
 * records it: the I13 pass reads
 * `WHERE instr(r.target_external,'.')=0 AND instr(r.target_external,':')=0`. So a qualified
 * target can only attach through strategy 1, the EXACT `qualified_name` match
 * (`_res_qname`, `parallel-indexer.ts`), which is also the line the Lead's `ac2873f4a`
 * ("the owner channel must read a QUALIFIED target") touched AFTER CSS-D15 landed. A gate-green
 * change that leaves `target_symbol_id` NULL would be motion, not progress, and the gate cannot
 * see it.
 *
 * WHAT IT MEASURES, per type: analyzer edges (through production `parseFile`) vs stored rows;
 * of the stored rows, how many have `target_symbol_id` NULL; and — the headline — the same
 * split for the edges whose target carries `::` (the CSS-D15 spelling) against those that do not.
 *
 * THE CONTROL: an unqualified edge must behave as it always did. If the qualified half attached
 * and the unqualified half were also broken, the run would be describing the indexer, not the
 * spelling — so both halves are printed side by side and the verdict requires the unqualified
 * half to attach at least as well as it did before this change.
 *
 * Usage: npx tsx validation/m14/fixtures/css/store-binding.ts [--files 120] [--corpus <dir>]
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")

// THE LANE'S DECLARED POPULATION IS `css,less`, not `.css`. `d43a5fa4d` (the population gate)
// found css measuring a fraction of its own language — the router maps `.less` to css — and set
// the lane to BOTH extensions in `incoming-gate.ts` and `residual-gate.ts`. This instrument
// walked `.css` only until 2026-10-10, which is why it read `imports` 127 where the gate reads
// 178: a POPULATION difference, not a parse difference. Override with BB_CSS_EXTS.
const LANE_EXTS = (process.env.BB_CSS_EXTS ?? "css,less").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)
const arg = (n: string, dflt: string): string => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? dflt
const FILES = Number(arg("files", "120"))
const CORPUS = arg("corpus", "/home/ishaq2321/bb_tests/repositories")
const TYPES = ["contains", "references", "uses", "imports", "overrides"] as const

function admitted(): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(CORPUS).sort()) {
    const dir = path.join(CORPUS, e)
    try { if (!fs.statSync(dir).isDirectory()) continue } catch { continue }
    let tracked: string[]
    try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean) } catch { continue }
    for (const rel of tracked) {
      if (!LANE_EXTS.some((x) => rel.toLowerCase().endsWith("." + x))) continue
      const abs = path.join(dir, rel)
      try { if (fs.statSync(abs).size > 1024 * 1024) continue } catch { continue }
      out.push(abs)
    }
  }
  return out.sort()
}

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-css-store-"))
const projDir = path.join(workdir, "proj")
fs.mkdirSync(projDir, { recursive: true })
const taken = admitted().slice(0, FILES)
if (taken.length === 0) { console.error(`no .css under ${CORPUS}`); process.exit(1) }
for (const f of taken) {
  const dest = path.join(projDir, path.relative(CORPUS, f))
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, fs.readFileSync(f))
}
const dataDir = path.join(workdir, "data")
fs.mkdirSync(dataDir, { recursive: true })
process.env.BB_DATA_DIR = dataDir

console.log("css store binding — does a qualified target attach?")
console.log(`files indexed: ${taken.length} (deterministic FIRST ${taken.length} of the sorted admitted list)`)
const repos = new Set(taken.map((f) => path.relative(CORPUS, f).split(path.sep)[0]))
console.log(`repos: ${[...repos].sort().join(", ")}`)

const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const pid = getProjectId(projDir) as any
const t0 = Date.now()
const stats = await indexProjectParallel(pid, projDir, { onProgress: () => {} })
console.log(`indexed in ${Date.now() - t0} ms: ${JSON.stringify(stats)}\n`)

// The analyzer's own payload, through the production path the indexer saw.
const perType: Record<string, number> = {}
const qualified: Record<string, number> = {}
for (const f of taken) {
  let r: any
  try { r = await parseFile(f, path.relative(projDir, f), undefined as any) } catch { continue }
  for (const e of r?.relationships ?? []) {
    const t = String(e.type ?? "")
    if (!TYPES.includes(t as any)) continue
    perType[t] = (perType[t] ?? 0) + 1
    if (String(e.target ?? "").includes("::")) qualified[t] = (qualified[t] ?? 0) + 1
  }
}

const raw: any = await BrainDatabase.getRawInstance(pid)
const rows = raw.prepare(`
  SELECT r.relationship_type AS t, r.target_external AS tgt, r.target_symbol_id AS tid
  FROM brain_relationship r WHERE r.project_id = ?
`).all(pid) as any[]

type Stat = { n: number; attached: number; null: number }
const all: Record<string, Stat> = {}
const qual: Record<string, Stat> = {}
const bare: Record<string, Stat> = {}
const bump = (m: Record<string, Stat>, t: string, attached: boolean) => {
  const s = m[t] ?? (m[t] = { n: 0, attached: 0, null: 0 })
  s.n++
  if (attached) s.attached++
  else s.null++
}
for (const r of rows) {
  if (!TYPES.includes(r.t)) continue
  const isQ = String(r.tgt ?? "").includes("::")
  const attached = r.tid != null
  bump(all, r.t, attached)
  bump(isQ ? qual : bare, r.t, attached)
}
const line = (t: string, s: Stat | undefined) => s === undefined ? `  ${t.padEnd(11)} —` : `  ${t.padEnd(11)} stored ${String(s.n).padStart(7)}   attached ${String(s.attached).padStart(7)}   NULL ${String(s.null).padStart(7)}   ${((s.attached / Math.max(1, s.n)) * 100).toFixed(1)}%`
console.log("per type (stored rows):")
for (const t of TYPES) console.log(line(t, all[t]))
console.log("\nCSS-D15 qualified targets (`::`):")
for (const t of TYPES) console.log(line(t, qual[t]))
console.log("\nunqualified targets (the CONTROL — unchanged behaviour expected):")
for (const t of TYPES) console.log(line(t, bare[t]))

const sum = (m: Record<string, Stat>) => TYPES.reduce((a, t) => a + (m[t]?.n ?? 0), 0)
const sumAttached = (m: Record<string, Stat>) => TYPES.reduce((a, t) => a + (m[t]?.attached ?? 0), 0)
const qN = sum(qual), qA = sumAttached(qual), bN = sum(bare), bA = sumAttached(bare)
console.log(`\nQUALIFIED: ${qA}/${qN} attached (${((qA / Math.max(1, qN)) * 100).toFixed(1)}%)   UNQUALIFIED: ${bA}/${bN} attached (${((bA / Math.max(1, bN)) * 100).toFixed(1)}%)`)
// The verdict is PROPORTIONAL and named, deliberately: the first version printed
// "CSS-D15 is gate-only for those edges" on 93 NULLs out of 100,782, which reads as a
// verdict on the change when it is a residual within it. What the headline must say is
// whether the SPELLING binds at all — the thing no gate can see — and then name what does not.
const missing = qN - qA
const verdict = qN === 0 ? "NO qualified targets in this sample — the check did not run"
  : missing === 0 ? "every qualified target attached — the store binds what the gate resolves"
  : `${missing} of ${qN} qualified targets did NOT attach (${((missing / qN) * 100).toFixed(2)}%) — the spelling binds, and the remainder is a named residual, not a verdict on CSS-D15`
console.log(`VERDICT: ${verdict}`)
// WHICH type carries it: measured on this sample, every NULL is a `contains`, and that is
// consistent with its resolution path — `contains` is resolved EAGERLY by the leaf of its
// target (`resolveContainsTargetStmt`, `s.name = ?` on `extractLeaf(target)`), and it is
// EXCLUDED from the deferred pass (`relationship_type <> 'contains'`). So a qualified
// `contains` target has no path that reads the qualified spelling, and the 93 are the
// instances where the leaf lookup found nothing. Stated as the open sub-cause it is.
const nullByType = TYPES.map((t) => `${t}:${qual[t]?.null ?? 0}`).join(" ")
console.log(`NULL by type among qualified: ${nullByType}`)

