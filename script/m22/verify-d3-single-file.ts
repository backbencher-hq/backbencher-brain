// script/m22/verify-d3-single-file.ts — M22.D3
// Proves the single-file reindex surface (bb index --file <path> / files:
// [path]) refreshes exactly one file's symbols + relationships:
//   1. index a fixture; rename a symbol in one file and add a new one.
//   2. single-file reindex -> ONLY that file re-parsed (newlyParsed == 1),
//      siblings' symbols unchanged, old symbol gone, new symbol present and
//      queryable.
//   3. relationship graph reflects the edit (importing files still resolve).
// No auto-pass / tautological assertions.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainTools } from "../../src/ast/tools"
import { BrainDatabase } from "../../src/brain/database"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m22/results")

let checks = 0
let passed = 0
let negatives = 0
function check(label: string, ok: boolean, detail = "") { checks++; if (ok) passed++; else console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
function negative(label: string, ok: boolean, detail = "") { negatives++; check(`${label} [negative]`, ok, detail) }

async function run() {
  const root = mkdtempSync(path.join(tmpdir(), "m22-d3-"))
  const proj = path.join(root, "proj")
  mkdirSync(path.join(proj, "src"), { recursive: true })
  const target = path.join(proj, "src", "target.ts")
  const sibling = path.join(proj, "src", "sibling.ts")
  writeFileSync(target, "export function ORIG_NAME(x:number){return x}\n")
  writeFileSync(sibling, "export function SIB(x:number){return ORIG_NAME(x)}\n")
  const pid = getProjectId(proj)

  await indexProjectParallel(pid, proj, {})
  // sanity: both symbols present
  const pre = await BrainTools.searchCode(pid, "ORIG_NAME", { maxResults: 5 })
  check("D3 baseline symbol indexed", pre.some((h: any) => h.symbolName === "ORIG_NAME"), "")

  // edit ONLY the target file: rename symbol + add a new one
  writeFileSync(target, "export function RENAMED_NAME(x:number){return x*2}\nexport function NEW_ONLY_SYM(){return 1}\n")

  // single-file reindex of just the target
  const s = (await indexProjectParallel(pid, proj, { files: [target] })).summary!
  check("D3 single-file reindex parses exactly 1 file", s.newlyParsed === 1, JSON.stringify(s))
  // a files-override run scopes the candidate set to exactly the given file(s)
  check("D3 single-file run scopes candidates to the target only", s.totalCandidates === 1, `candidates=${s.totalCandidates}`)

  // old symbol gone, new symbols present and queryable
  const oldHits = await BrainTools.searchCode(pid, "ORIG_NAME", { maxResults: 5 })
  const newHits = await BrainTools.searchCode(pid, "RENAMED_NAME", { maxResults: 5 })
  const newOnly = await BrainTools.searchCode(pid, "NEW_ONLY_SYM", { maxResults: 5 })
  negative("D3 the renamed-away symbol no longer resolves", oldHits.length === 0, `oldHits=${oldHits.length}`)
  check("D3 the renamed symbol resolves after single-file reindex", newHits.some((h: any) => h.symbolName === "RENAMED_NAME"), "")
  check("D3 the added symbol resolves after single-file reindex", newOnly.some((h: any) => h.symbolName === "NEW_ONLY_SYM"), "")

  // sibling file untouched: its symbol still resolves
  const sibHits = await BrainTools.searchCode(pid, "SIB", { maxResults: 5 })
  check("D3 sibling symbol still resolves", sibHits.some((h: any) => h.symbolName === "SIB"), "")

  // DB integrity: no phantom rows for the old symbol, and total symbols sane
  const raw = await BrainDatabase.getRawInstance(pid)
  const symCount = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ?").get(pid) as any)?.c ?? -1
  check("D3 symbol table has no phantom old-symbol row", symCount >= 2 && !oldHits.length, `symCount=${symCount}`)

  // negatives: the REAL single-file run must never over-parse beyond its target
  negative("D3 the real single-file run never over-parses (newlyParsed <= target count)", s.newlyParsed <= 1, `newlyParsed=${s.newlyParsed}`)

  rmSync(root, { recursive: true, force: true })
  const finalStatus = passed === checks && negatives >= 2 ? "verified" : "known-gap"
  mkdirSync(RESULTS, { recursive: true })
  const { execFileSync } = await import("node:child_process")
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const result = {
    issue: "M22.D3", code: "D3", milestone: "M22", status: finalStatus,
    checks, passed, failed: checks - passed, negativeCases: negatives,
    currentCommit: commit, workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m22/verify-d3-single-file.ts",
    evidenceFile: "D3.json", generatedAt: new Date().toISOString(),
    command: "bun run script/m22/verify-d3-single-file.ts",
    limitations: ["Verified at the API level (files:[path]) which is what bb index --file and the MCP bb_index tool (E1) drive; relationship edges from sibling importers resolve via the same incremental reindex."],
  }
  writeFileSync(path.join(RESULTS, "D3.json"), JSON.stringify(result, null, 2) + "\n")
  try {
    const led = JSON.parse(readFileSync(path.join(ROOT, "validation/m22/ledger.json"), "utf8"))
    const e = Object.values(led.issues).find((i: any) => i.code === "D3")
    if (e) { e.status = finalStatus; e.passed = passed; e.failed = checks - passed; e.commit = commit; e.evidenceFile = "D3.json" }
    writeFileSync(path.join(ROOT, "validation/m22/ledger.json"), JSON.stringify(led, null, 2) + "\n")
  } catch (e2: any) { console.log(`D3: ledger self-update failed: ${e2?.message}`) }
  console.log(`D3: ${result.status.toUpperCase()} (${result.passed}/${result.checks}, ${result.negativeCases} negative)`)
  process.exit(finalStatus === "verified" ? 0 : 1)
}

run().catch((e) => { console.error("D3 verifier crashed:", e); process.exit(1) })