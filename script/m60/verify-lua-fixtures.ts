/**
 * M60: the Lua fixture lane, run.
 *
 * WHY THIS FILE EXISTS RATHER THAN ONE LINE IN run-fixtures.ts
 * -----------------------------------------------------------
 * `validation/m14/fixtures/lua/` holds six expectation files — 6 symbols, 26
 * symbols, 19 relationships and 14 forbidden relationships between them — and the
 * shared runner reports, in its own output:
 *
 *     fixture-lane gate: 1 fixture director(s) no runner lane claims: ..., lua
 *       lua: 6 expectation file(s) — evidence nothing executes.
 *
 * "Evidence nothing executes" is the phrase that matters. Six authored fixtures
 * have been sitting in the tree asserting nothing, and the guard that notices is
 * an advisory line in another lane's gate rather than a failure. A fixture that
 * cannot fail is a comment.
 *
 * The fix is one entry in `run-fixtures.ts`'s LANGS map:
 *
 *     lua: { wasm: "tree-sitter-lua.wasm", analyzerFile: "real-lua-analyzer",
 *            className: "RealLuaAnalyzer", ext: "lua" },
 *
 * and that entry is NOT pasted here, because `run-fixtures.ts` was under
 * uncommitted co-agent edit every time this was checked, and this repo has now
 * needed four separate repair commits for merges that damaged shared gate files
 * (`cf35b6d4`, `80e3108a`, `21d1db2a`, `1b22cddf`). Adding a lane to a file
 * another agent is mid-edit is how lines get lost.
 *
 * So this gate imports the SHARED `runLang` — the same function, the same
 * expectation semantics, the same `matchConstraints` — and supplies only the
 * LANGS entry locally. The fixtures therefore execute today, under the real
 * runner, and the shared map needs one line later rather than six fixtures needing
 * to be written again. `Object.assign` is used rather than a re-implementation for
 * the same reason the output-coverage audit calls the production filters: a copy
 * of the rules is a copy that can drift.
 *
 * WHAT IT DOES NOT CLAIM: this is not a substitute for the shared registration. The
 * milestone gate in `run-fixtures.ts` still will not run Lua until the LANGS entry
 * lands, and until it does, `fixtures: n/a` stays in the completion matrix.
 *
 * Usage: bun script/m60/verify-lua-fixtures.ts
 */
import { LANGS, runLang } from "../m14/run-fixtures"
import { readFileSync, writeFileSync } from "node:fs"

import * as path from "node:path"
import { fileURLToPath } from "node:url"
// Derived from this file's own location, NOT hardcoded. Six of this lane's scripts
// pinned $HOME/backbencher-brain, so in a lane worktree they read a path
// that does not exist and the gate died with ENOENT instead of reporting a verdict.
// A gate that cannot execute is not a gate, and the mutant battery looked green
// only because its failure was being read as a pass.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

const LUA = {
  wasm: "tree-sitter-lua.wasm",
  analyzerFile: "real-lua-analyzer",
  className: "RealLuaAnalyzer",
  ext: "lua",
} as unknown as (typeof LANGS)[keyof typeof LANGS]

Object.assign(LANGS as Record<string, unknown>, { lua: LUA })

const FIXTURES_DIR = new URL("../../validation/m14/fixtures/", import.meta.url).pathname
const EXPECTED = [
  "closure-scope",
  "edge-lines",
  "export-shapes",
  "local-declarations",
  "member-identity",
  "order-independent-ctor",
]

async function main() {
  const r = await runLang("lua")
  const ran = r.details.filter((d: any) => d.fixture !== "(none)").map((d: any) => String(d.fixture).replace(/^lua\//, ""))

  console.log("")
  console.log("M60 lua FIXTURE LANE — the six fixtures that used to assert nothing")
  console.log(`  fixtures executed : ${ran.length}  (expected ${EXPECTED.length})`)
  console.log(`  pass ${r.pass}   fail ${r.fail}`)
  console.log("")
  for (const d of r.details as any[]) {
    const id = String(d.fixture).replace(/^lua\//, "")
    if (d.fixture === "(none)") {
      console.log(`  MISSING  no fixture directory found — nothing ran`)
      continue
    }
    console.log(`  ${d.ok ? "PASS" : "FAIL"}  ${id}`)
    for (const p of d.problems ?? []) console.log(`        ${p}`)
  }

  // The six ids are named rather than counted, because "6 fixtures ran" and "the
  // six fixtures this lane authored ran" are different claims and only the second
  // is worth making. A fixture file that is renamed or deleted fails here instead
  // of quietly reducing the count.
  const missing = EXPECTED.filter((e) => !ran.includes(e))
  const extra = ran.filter((x) => !EXPECTED.includes(x))
  console.log("")
  if (missing.length) console.log(`  MISSING fixtures: ${missing.join(", ")}`)
  if (extra.length) console.log(`  UNEXPECTED fixtures: ${extra.join(", ")}`)

  const out = `${REPO}/validation/m60/results/lua-fixtures-lane.json"
  writeFileSync(
    out,
    JSON.stringify(
      {
        schemaVersion: 1,
        gate: "verify-lua-fixtures",
        note: "runs the six lua fixtures through the SHARED runLang; the shared LANGS map still has no lua entry, so the milestone gate does not yet run this lane",
        expected: EXPECTED,
        ran,
        pass: r.pass,
        fail: r.fail,
        details: r.details,
      },
      null,
      2,
    ),
  )
  console.log(`  wrote ${out}`)

  // A failure that names the shared runner's export invariant is not the lane's to
  // fix from here, and saying so is more useful than a red gate nobody can act on.
  // `run-fixtures.ts` carries an uncommitted co-agent edit, and this repo has needed
  // four repair commits for merges that damaged it, so the exemption is prepared in
  // script/m14/lua-lane-registration.ts rather than pasted.
  const openRunnerGap = r.details.some((d: any) => (d.problems ?? []).some((p: string) => p.startsWith("export invariant violated")))
  if (openRunnerGap) {
    console.log("  BLOCKED ON THE SHARED RUNNER, not on the lane:")
    console.log("    the export invariant requires every export to resolve to a top-level symbol.")
    console.log("    In Lua the module IS a returned object literal, so its exports are properties")
    console.log("    with no declaration site. The exemption is prepared in")
    console.log("    script/m14/lua-lane-registration.ts (PART 2); run-fixtures.ts is under")
    console.log("    uncommitted co-agent edit, so it was not touched.")
    console.log("")
  }

  const ok = r.fail === 0 && missing.length === 0 && extra.length === 0
  console.log("")
  console.log(ok ? `OK — ${r.pass} fixture assertions pass across ${ran.length} fixtures` : `FAIL — ${r.fail} failing, ${missing.length} missing, ${extra.length} unexpected`)
  process.exit(ok ? 0 : 1)
}

await main()
