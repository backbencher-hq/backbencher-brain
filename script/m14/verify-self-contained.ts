/**
 * SELF-CONTAINMENT GATE — the repository must be complete in git, not only on the machine that built it.
 *
 * WHY THIS EXISTS. The 2026-11-01 one-branch consolidation left live files that main's own code depends on
 * OUT of git while they sat on disk as untracked leftovers:
 *
 *   - `script/m14/mutate-analyzer.ts` (tracked) statically imports `./vba-mutants` and `./matlab-mutants`,
 *     and both modules were UNTRACKED — a fresh clone could not load the fleet mutation harness at all;
 *   - `src/ast/engine.ts` resolves the matlab/vba grammars from `wasm/tree-sitter-{matlab,vba}.wasm`, and
 *     both wasm files were UNTRACKED — a fresh clone silently had no grammar for two of the 50 lanes;
 *   - `validation/m14/{matlab,vba}-grammar-pin.json` and the vendored `grammars/tree-sitter-{matlab,vba}`
 *     source they cite were UNTRACKED, so tracked specs cited evidence a reader could not open.
 *
 * Every gate in this session ran from the working tree, so none of them could see this class: the work was
 * GREEN and INCOMPLETE at the same time. This gate asks the only question that catches it — does the set of
 * files git knows about satisfy what the code actually imports and loads? — and it is deliberately narrow:
 *
 *   1. IMPORTS. Every relative static import in a tracked live `.ts`/`.mts` file must resolve to a TRACKED
 *      file. A specifier that exists on disk but is untracked is a fresh-clone breakage and FAILS. A
 *      specifier that exists nowhere is NOT this gate's finding: fixture contents embedded in source (e.g.
 *      `from "./B.sol"` inside a solc fixture string) and TS's `.js` → `.ts` ESM mapping produce such
 *      strings legitimately, and the repo has many. The gate names its rule so that limitation is visible.
 *   2. GRAMMAR ASSETS. Every `resolveWasm("<flat name>")` in `src/ast/engine.ts` whose repo copy
 *      `wasm/<flat name>` exists on disk must have that copy TRACKED. (A name with no repo copy is resolved
 *      from dependencies and is out of scope.)
 *   3. GRAMMAR PIN RECORDS. Every TRACKED `validation/m14/*-grammar-pin.json` must cite a `wasm` path that
 *      is tracked, and every vendored source directory it names must be tracked.
 *   4. FLEET-GUARD INPUTS. `verify-fleet.ts` reads four result/baseline files and, for every lane in
 *      `run-fixtures.ts`'s LANGS, a spec file and an `incoming-declaration.json`. All of them must be TRACKED.
 *      Found live by this check, after the first repair: lane `vb`'s
 *      `validation/m14/instruments/vb/incoming-declaration.json` was UNTRACKED — `verify-fleet` reconciled 50/50
 *      here only because the file sat on this disk, and a fresh clone would have reported the vb lane's inbound
 *      census ABSENT.
 *   5. LANE ASSETS. Every LANGS lane must have its analyzer module, its `script/m14/spec/<lane>-completeness.json`
 *      and at least one tracked fixture file. A lane whose analyzer or fixtures are not in git is a lane the
 *      repo cannot run.
 *
 * The archive/ tree is excluded BY DESIGN (it is a byte-for-byte recovery archive, not build input); so is
 * script/m14/tmp/ (scratch by convention).
 *
 * Usage: bun script/m14/verify-self-contained.ts
 * Exit 0 iff all three checks pass; each finding names the path and the fix.
 */
import { execSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const git = (args: string): string => execSync(`git ${args}`, { cwd: ROOT, encoding: "utf8" })
const tracked = new Set(git("ls-files").split("\n").filter(Boolean))
const isTracked = (p: string): boolean => tracked.has(p)

const findings: string[] = []
const notes: string[] = []

// ── 1. relative imports of tracked live TypeScript ────────────────────────────────────────────────────────
const EXCL = /^(archive\/|script\/m14\/tmp\/|script\/m[0-9]+\/tmp\/)/
const exts = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", "/index.ts"]
const stmt = /^\s*(?:import|export)\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/gm
let importCount = 0
let untrackedImportFindings = 0
for (const f of tracked) {
  if (!(f.endsWith(".ts") || f.endsWith(".mts")) || EXCL.test(f)) continue
  let text: string
  try { text = readFileSync(path.join(ROOT, f), "utf8") } catch { continue }
  stmt.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = stmt.exec(text))) {
    const spec = m[1]
    if (!spec.startsWith(".")) continue
    // GENERATED TYPE IMPORTS ARE NOT REPO DEPENDENCIES. `website/next-env.d.ts` (tracked, Next.js-generated)
    // imports `./.next/types/routes.d.ts`, which is build output and must NOT be tracked. Excluding the
    // generated directory keeps the gate about SOURCE completeness rather than about build caches.
    if (spec.includes("/.next/") || spec.startsWith(".next/")) continue
    importCount++
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(f), spec))
    if (exts.some((e) => isTracked(base + e))) continue
    const onDisk = exts.some((e) => existsSync(path.join(ROOT, base + e)))
    if (onDisk) {
      untrackedImportFindings++
      findings.push(`UNTRACKED module dependency: ${f} imports ${spec} (${base} exists on disk, is not tracked) — a fresh clone cannot load this module`)
    }
  }
}
notes.push(`imports: ${importCount} relative static specifiers over ${tracked.size} tracked files; ${untrackedImportFindings} untracked dependency/ies`)

// ── 2. grammars the engine loads from the repo's own wasm/ directory ─────────────────────────────────────
const engine = readFileSync(path.join(ROOT, "src/ast/engine.ts"), "utf8")
const wasmNames = new Set<string>()
for (const m of engine.matchAll(/resolveWasm\("([^"]+)"\)/g)) wasmNames.add(m[1].split("/").pop()!)
let wasmChecked = 0
for (const name of wasmNames) {
  const repoCopy = path.posix.join("wasm", name)
  if (!existsSync(path.join(ROOT, repoCopy))) continue // dependency-resolved grammar, out of scope
  wasmChecked++
  if (!isTracked(repoCopy)) findings.push(`UNTRACKED grammar wasm: ${repoCopy} is loaded by src/ast/engine.ts but a fresh clone does not contain it`)
}
notes.push(`grammar wasm: ${wasmNames.size} resolveWasm() names, ${wasmChecked} with a repo copy checked`)

// ── 3. grammar pin records must cite tracked bytes and tracked vendored sources ───────────────────────────
let pinsChecked = 0
for (const f of tracked) {
  if (!/^validation\/m14\/[a-z0-9-]+-grammar-pin\.json$/.test(f)) continue
  pinsChecked++
  let pin: any
  try { pin = JSON.parse(readFileSync(path.join(ROOT, f), "utf8")) } catch (e) {
    findings.push(`UNREADABLE grammar pin: ${f} (${(e as Error).message.slice(0, 80)})`)
    continue
  }
  for (const key of ["wasm", "wired", "source"] as const) {
    const v = pin[key]
    const p = typeof v === "string" ? v : typeof v === "object" && v ? v.file : undefined
    if (typeof p === "string" && p.endsWith(".wasm") && !isTracked(p)) findings.push(`UNTRACKED wasm cited by ${f}: ${p}`)
  }
  for (const key of ["source", "grammarSource"] as const) {
    const v = pin[key]
    if (typeof v !== "string" || !v.startsWith("grammars/")) continue
    const dir = v.split("/").slice(0, 2).join("/")
    if (!existsSync(path.join(ROOT, dir))) continue
    const anyTracked = [...tracked].some((t) => t.startsWith(dir + "/"))
    if (!anyTracked) findings.push(`UNTRACKED vendored source cited by ${f}: ${dir}/`)
  }
}
notes.push(`grammar pins: ${pinsChecked} tracked pin record(s) checked`)

// ── 4. fleet-guard inputs: the files verify-fleet.ts demands must exist in git ─────────────────────────────
const fleetSrc = readFileSync(path.join(ROOT, "script/m14/verify-fleet.ts"), "utf8")
const fleetInputs = new Set<string>([...fleetSrc.matchAll(/readFileSync\(V\("([^"]+)"\)/g)].map((m) => m[1]))
const RUN_FIXTURES = readFileSync(path.join(ROOT, "script/m14/run-fixtures.ts"), "utf8")
const lanes: { lane: string; wasm: string; analyzerFile: string }[] = []
for (const m of RUN_FIXTURES.matchAll(/^\s{2}([a-z0-9_]+): \{ wasm: "([^"]+)", analyzerFile: "([^"]+)"/gm)) {
  lanes.push({ lane: m[1], wasm: m[2], analyzerFile: m[3] })
}
let laneChecks = 0
for (const l of lanes) {
  laneChecks++
  const spec = `script/m14/spec/${l.lane}-completeness.json`
  const decl = `validation/m14/instruments/${l.lane}/incoming-declaration.json`
  const analyzer = `src/ast/${l.analyzerFile}.ts`
  for (const [label, p] of [["fleet spec", spec], ["fleet inbound declaration", decl], ["lane analyzer", analyzer]] as const) {
    if (!isTracked(p)) findings.push(`UNTRACKED ${label}: ${p} (required by verify-fleet/run-fixtures for lane '${l.lane}')`)
  }
  const fixturePrefix = `validation/m14/fixtures/${l.lane}/`
  if (![...tracked].some((t) => t.startsWith(fixturePrefix))) findings.push(`NO TRACKED FIXTURES: ${fixturePrefix} (lane '${l.lane}')`)
}
for (const p of fleetInputs) if (!isTracked(p)) findings.push(`UNTRACKED fleet-guard input: ${p} (read by script/m14/verify-fleet.ts)`)
notes.push(`fleet guard: ${lanes.length} lane(s) checked for spec + inbound declaration + analyzer + fixtures; ${fleetInputs.size} static V("...") input(s) checked`)

console.log("verify-self-contained — is the repository complete in git, not just on this disk?")
for (const n of notes) console.log("  " + n)
if (findings.length > 0) {
  for (const f of findings) console.error(`SELF-CONTAINMENT FAILURE: ${f}`)
  console.error(`FAIL — ${findings.length} finding(s): the working tree is greener than the repository`)
  process.exit(1)
}
console.log("PASS — every tracked import, loaded repo grammar wasm, grammar pin and fleet-guard/lane input resolves to tracked bytes")
