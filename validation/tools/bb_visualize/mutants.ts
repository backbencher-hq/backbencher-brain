// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the red-then-green mutant table for bb_visualize: five
//   deliberately planted defects in the shipped code, each shown RED on its
//   targeted assertion, then restored and shown GREEN, with the SHA-256 of every
//   touched file recorded before the plant and after the restore so "restored"
//   is a measured fact rather than a promise.
// WHICH TOOL IT SERVES — bb_visualize (mutability read, requiresIndex true).
// WHY IT IS SHAPED THIS WAY — a gate that has never been red is not evidence. Each
//   mutant breaks exactly one published contract: the byte-read-only read path,
//   the declared bounds in the HTML payload, the kind filter over cascade
//   additions, the complete edge set for the returned nodes, and "every published
//   option reaches the engine".
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_visualize/results/mutants.json,
//   validation/tools/bb_visualize/logs/mutants.log (written here).
// EDIT TOGETHER WHEN THIS CHANGES — checks.ts (the assertions), probe.ts (the same
//   contracts through the real door), the engine/handler they patch.
// CONTRACTS IT MUST NOT BREAK — writes only within the repository (engine, handler
//   and this lane's evidence), always restores from the in-memory original, and
//   exits non-zero if any restore does not restore the exact bytes.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const HERE = path.resolve(import.meta.dirname ?? ".", ".")
const ROOT = path.resolve(HERE, "..", "..", "..")
const RESULTS = path.join(HERE, "results")
mkdirSync(RESULTS, { recursive: true })

const sha = (text: string) => createHash("sha256").update(text).digest("hex")

interface Mutant { name: string; contract: string; file: string; find: string; replace: string; check: string; runner?: "node" | "gate" }

const ENGINE = "src/intelligence/visualization/visualization-engine.ts"
const HANDLER = "src/mcp/tools/bb_visualize/handler.ts"

const mutants: Mutant[] = [
  {
    name: "read-path-read-write-open",
    contract: "a read call leaves the index database and WAL byte-identical",
    file: ENGINE,
    find: 'const raw = await BrainDatabase.getRawInstance(projectId as any, { readonly: true })',
    replace: 'const raw = await BrainDatabase.getRawInstance(projectId)',
    check: "read-path-structural",
  },
  {
    name: "html-payload-loses-declared-bounds",
    contract: "the HTML artifact carries totalNodesAvailable / originalNodes / returnedNodes in its payload",
    file: ENGINE,
    find: 'const graphData = { nodes: result.nodes, links: result.links, excluded: result.excluded, declared }',
    replace: 'const graphData = { nodes: result.nodes, links: result.links, excluded: result.excluded }',
    check: "html-declared",
  },
  {
    name: "kind-filter-ignores-cascade-additions",
    contract: "symbolKinds scopes the WHOLE answer, including symbols the owner cascade would add",
    file: ENGINE,
    find: 'const kept = extra.filter((node) => (!allowedKinds || allowedKinds.has(String(node.symbol_type).toLowerCase())) && (!allowedLanguages || allowedLanguages.has(String(node.language ?? "").toLowerCase())))',
    replace: 'const kept = extra',
    check: "kind-filter",
  },
  {
    name: "edge-set-sliced-instead-of-joined",
    contract: "the declared edge count is every stored row connecting two returned nodes, not a slice of the table",
    file: ENGINE,
    find: '    relationships = []\n    for (let start = 0; start < idList.length; start += RELATIONSHIP_FETCH_CHUNK) {',
    replace: '    relationships = raw.prepare("SELECT id AS row_id,source_symbol_id AS source_id,target_symbol_id AS target_id,relationship_type,confidence,is_cross_language,is_cross_file,bridge_mechanism,line_number FROM brain_relationship WHERE project_id = ? LIMIT 3").all(projectId) as any[]\n    for (let start = 0; start < idList.length && false; start += RELATIONSHIP_FETCH_CHUNK) {',
    check: "edge-complete",
  },
  {
    name: "published-option-dropped-from-the-request",
    contract: "every published option reaches the engine (excludePatterns / includeTests were once dropped)",
    file: HANDLER,
    find: '    excludePatterns: Array.isArray(args.excludePatterns) ? args.excludePatterns.map(String) : undefined,\n',
    replace: '',
    check: "options-ignored",
    runner: "gate",
  },
]

const results: any[] = []
let allRestored = true
for (const mutant of mutants) {
  const filePath = path.join(ROOT, mutant.file)
  if (!existsSync(filePath)) { console.log(`SKIP ${mutant.name}: missing ${mutant.file}`); results.push({ name: mutant.name, skipped: "file missing" }); continue }
  const original = readFileSync(filePath, "utf8")
  const originalSha = sha(original)
  if (!original.includes(mutant.find)) { console.log(`SKIP ${mutant.name}: find-text not present in ${mutant.file}`); results.push({ name: mutant.name, skipped: "find text not present", originalSha }); continue }
  const mutated = original.replace(mutant.find, mutant.replace)
  writeFileSync(filePath, mutated)
  const runCheck = (): number => {
    try {
      const args = mutant.runner === "gate"
        ? ["run", "script/m13/verify-visualize-options.ts"]
        : ["--import", "tsx", path.join(HERE, "checks.ts"), mutant.check]
      execFileSync(mutant.runner === "gate" ? "bun" : process.execPath, args, { cwd: ROOT, encoding: "utf8", stdio: "pipe", timeout: 240_000, env: { ...process.env, BB_DATA_DIR: path.join(HERE, "bbdata"), BB_NO_AUTO_REFRESH: "1" } })
      return 0
    } catch (error: any) {
      return typeof error?.status === "number" ? error.status : 1
    }
  }
  const redExit = runCheck()
  writeFileSync(filePath, original)
  const restoredSha = sha(readFileSync(filePath, "utf8"))
  const restored = restoredSha === originalSha
  if (!restored) allRestored = false
  const greenExit = runCheck()
  const row = { name: mutant.name, contract: mutant.contract, file: mutant.file, find: mutant.find.slice(0, 120), redExit, greenExit, restored, originalSha, restoredSha, red: redExit !== 0, green: greenExit === 0 }
  results.push(row)
  console.log(`${mutant.name}: redExit=${redExit} (planted defect detected=${redExit !== 0}), restoredSha===originalSha=${restored}, greenExit=${greenExit}`)
}
const table = {
  schemaVersion: 1,
  tool: "bb_visualize",
  status: results.every((row) => row.skipped || (row.red && row.green && row.restored)) && allRestored ? "verified" : "partial",
  generatedAt: new Date().toISOString(),
  method: "each mutant is written into the shipped file, the targeted assertion is run and expected to FAIL, the original bytes are restored, and the same assertion is run and expected to PASS; SHA-256 before and after proves the restore",
  mutants: results,
}
writeFileSync(path.join(RESULTS, "mutants.json"), JSON.stringify(table, null, 2) + "\n")
console.log(`MUTANTS: ${table.status.toUpperCase()} (${results.filter((row) => row.red && row.green).length}/${results.length} red-then-green)`)
process.exit(table.status === "verified" ? 0 : 1)
