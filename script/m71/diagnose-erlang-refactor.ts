// script/m71/diagnose-erlang-refactor.ts — REVIEW PROBE (not a gate).
//
// E10's Erlang leg (`rebar3/apps`, symbol `cth_fail_fast`) now refuses with D3's
// zero-site error instead of answering ok with "0 site(s) across 0 file(s)". That is
// the right outcome for a silent no-op — but only if the engine genuinely has nothing
// to rename, rather than a bug in the lookup. This measures the grammar's side of it on
// a synthetic module: is a function's declaration name an occurrence at all, and does
// the symbol the corpus leg picked (an Erlang MODULE attribute) look the same?
//
// Run: npx tsx script/m71/diagnose-erlang-refactor.ts

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { executeEdit } from "../../src/intelligence/edit/edit-engine"
import { parseForSafety } from "../../src/ast/safety-primitives"
import { ASTEngine } from "../../src/ast/engine"

const CODE = `-module(target).\n-export([target/1]).\n\ntarget(X) -> X + 1.\n\nuse() -> target(1).\n`

const parsed = await parseForSafety("target.erl", CODE)
console.log("-- occurrences of target --")
for (const o of parsed.occurrences) {
  if (o.text !== "target" && o.text !== "target.erl") continue
  console.log(`   parentType=${o.parentType} line=${o.startLine} [${o.startIndex},${o.endIndex}]`)
}
console.log(`-- occurrence count total: ${parsed.occurrences.length}, declaredNames: ${parsed.declaredNames.length} --`)
for (const d of parsed.declaredNames) console.log(`   declaredName ${d.text} type=${d.declarationType}`)

const root = mkdtempSync(path.join(tmpdir(), "bb-m71-erlang-"))
mkdirSync(root, { recursive: true })
writeFileSync(path.join(root, "target.erl"), CODE)
const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})
  const raw = await BrainDatabase.getRawInstance(projectId as any)
  const syms = raw.prepare("SELECT name, symbol_type, byte_start, byte_end FROM brain_symbol WHERE project_id = ?").all(projectId) as any[]
  console.log("-- indexed symbols --")
  for (const s of syms) console.log(`   ${JSON.stringify(s)}`)
  for (const name of syms.map((s) => s.name)) {
    try {
      const res = await executeEdit(root, projectId, { mode: "refactor", symbolName: String(name), newName: "renamedThing", dryRun: true, format: false } as any)
      console.log(`   refactor ${name}: ok, changes=${res.changes.length}, summary=${JSON.stringify(res.summary)}`)
    } catch (e: any) {
      console.log(`   refactor ${name}: REFUSED ${String(e?.message).slice(0, 150)}`)
    }
  }
  console.log(`-- findSymbol(cth_fail_fast) sanity: ${(await ASTEngine.findSymbol(projectId, "target")).matches?.length ?? 0} match(es) for 'target' --`)
  console.log(`-- file on disk unchanged: ${readFileSync(path.join(root, "target.erl"), "utf8") === CODE} --`)
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}
console.log("PROBE COMPLETE")
