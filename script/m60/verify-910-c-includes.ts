// verify-910-c-includes.ts — M60/#910 acceptance, end to end on a REAL index.
//
// The issue measured three things at once (at 4bf9878f):
//   1. c emitted its includes as `references` + metadata.isImport, never as the
//      dedicated `imports` kind ts/js/python/dart already emit;
//   2. nothing consumed isImport/include_dependency — the stored marker was
//      write-only;
//   3. the one import-aware reader (LSP usages file-level section) filters
//      `relationship_type IN ('imports','exports')` with the root as target,
//      and c's include is file -> file with an external target, so c's
//      dependency view was empty no matter how the edge was typed.
//
// This gate indexes a two-language fixture project with the REAL indexer and
// asserts all four legs: the stored row's kind and identity, the brain_import
// external flag, the reader's outgoing section, and — through planted
// regressions — that the gate can fail. Expected `imports` counts are
// derived from the fixture text, never from the analyzer's own output.
//
// Run: npx tsx script/m60/verify-910-c-includes.ts   (bun also works)
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { handleGraphRequest, GRAPH_MODE_USAGES, GRAPH_SCHEMA_VERSION } from "../../src/lsp/graph_request"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const EVIDENCE = path.join(ROOT, "validation", "m60", "results", "910-c-includes.json")

// A per-run project id: the indexer is incremental, so re-running this gate
// against a reused project would skip every unchanged fixture file and then
// measure the PREVIOUS run's rows (observed live: a stale mutant edit made the
// baseline read as a regression). A fresh id is a guaranteed full index.
const PID = `verify-910-c-includes-${Date.now().toString(36)}`

// ── fixture: the shapes the issue measured, nothing else ────────────────────
// main.c includes one system header and one quoted project header; util.c
// includes the quoted header only; the ts pair is the CONTROL (its imports
// rows name a module leaf, not a path, so the outgoing read must not fire).
const FIXTURE: Record<string, string> = {
  "util.h": "int util_add(int a, int b);\n",
  "util.c": '#include "util.h"\nstatic int util_scale(int v) { return v > 0 ? v : -v; }\n',
  "main.c": '#include <stdio.h>\n#include "util.h"\nint main_entry(void) { printf("%d\\n", util_add(1, 2)); return 0; }\n',
  "mod.ts": "export function widgetThing(): number {\n  return 1\n}\n",
  "use.ts": 'import { widgetThing } from "./mod"\nexport function useThing(): number {\n  return widgetThing()\n}\n',
}

// Expected per file, read off the fixture text above: importer -> specifiers.
const EXPECTED_DEPS: Record<string, string[]> = {
  "main.c": ["stdio.h", "util.h"],
  "util.c": ["util.h"],
  "use.ts": [], // control: ts imports name a module leaf, the path read must not match
}
const EXPECTED_EXTERNAL: Record<string, number> = { "stdio.h": 1, "util.h": 0 }

let failures = 0
const failedChecks: string[] = []
function check(label: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok: ${label}`)
  else {
    failures++
    failedChecks.push(label)
    console.log(`  FAIL: ${label} ${detail}`)
  }
}
console.log(`runtime: ${process.version} (${typeof Bun !== "undefined" ? "bun" : "node"})`)

const root = mkdtempSync(path.join(tmpdir(), "bb-910-"))
for (const [rel, text] of Object.entries(FIXTURE)) {
  const full = path.join(root, rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, text)
}

// Observed flake (measured 2026-09-21, ~1 run in 6): the pool's discovery
// occasionally comes back short — the two .ts files were absent from
// brain_file while the three .c files indexed, which made the CONTROL leg read
// as a regression (it is what caught it, loudly). The root cause is not
// established; what is established is that a short index is a HARNESS fault,
// never a verdict about the analyzer, so it is re-driven a bounded number of
// times and then reported as such instead of being scored as a defect.
async function index(): Promise<any> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await indexProjectParallel(PID, root, {})
    const raw = await BrainDatabase.getRawInstance(PID)
    const files = raw.prepare("SELECT COUNT(*) AS c FROM brain_file WHERE project_id = ?").get(PID) as any
    if ((files?.c ?? 0) === Object.keys(FIXTURE).length) return raw
    console.log(`  (index attempt ${attempt} saw ${files?.c ?? 0}/${Object.keys(FIXTURE).length} fixture files — re-driving the index; a short index is a harness fault, never a verdict)`)
  }
  throw new Error(
    `fixture never indexed completely: ${Object.keys(FIXTURE).length} files expected — refusing to score the analyzer against a short index`,
  )
}

type Raw = any

/** The acceptance law, evaluated against whatever is in the DB right now. */
async function violations(raw: Raw): Promise<string[]> {
  const out: string[] = []

  // Leg 1: the stored include row is a first-class `imports` edge whose
  // importer is the importing FILE (source_external), with no symbol endpoint
  // on either side, and the evidence (metadata + line) intact.
  for (const [importer, specifiers] of Object.entries(EXPECTED_DEPS)) {
    if (specifiers.length === 0) continue
    for (const spec of specifiers) {
      const row = raw
        .prepare(
          "SELECT * FROM brain_relationship WHERE project_id = ? AND relationship_type = 'imports' " +
            "AND target_external = ? AND source_external = ?",
        )
        .get(PID, spec, importer) as any
      if (!row) {
        out.push(`no first-class imports row ${importer} -> ${spec}`)
        continue
      }
      if (row.source_symbol_id !== null) out.push(`${importer} -> ${spec}: source_symbol_id should be NULL (file-level edge), got ${row.source_symbol_id}`)
      if (row.target_symbol_id !== null) out.push(`${importer} -> ${spec}: target_symbol_id should be NULL (external specifier), got ${row.target_symbol_id}`)
      if (!(typeof row.line_number === "number" && row.line_number > 0)) out.push(`${importer} -> ${spec}: line_number missing (${row.line_number})`)
      const md = JSON.parse(row.metadata ?? "{}")
      if (md.isImport !== true) out.push(`${importer} -> ${spec}: metadata.isImport lost`)
      if (md.relationshipType !== "include_dependency") out.push(`${importer} -> ${spec}: metadata.relationshipType lost`)
      if (md.evidenceClass !== "import_based") out.push(`${importer} -> ${spec}: evidenceClass should be import_based, got ${md.evidenceClass}`)
      if (md.fileLevel !== true) out.push(`${importer} -> ${spec}: metadata.fileLevel lost (the store keys the importer on it)`)
    }
  }

  // The old shape must be GONE: a references edge carrying include metadata is
  // exactly the ontology the issue charged.
  const legacy = raw
    .prepare("SELECT count(*) AS c FROM brain_relationship WHERE project_id = ? AND relationship_type = 'references' AND metadata LIKE '%include_dependency%'")
    .get(PID) as any
  if ((legacy?.c ?? 0) !== 0) out.push(`${legacy.c} include edge(s) still stored as references`)

  // Leg 2: brain_import carries the analyzer's own external classification.
  for (const [spec, external] of Object.entries(EXPECTED_EXTERNAL)) {
    const row = raw
      .prepare("SELECT is_external AS isExternal FROM brain_import WHERE project_id = ? AND import_path = ?")
      .get(PID, spec) as any
    if (!row) out.push(`brain_import row missing for ${spec}`)
    else if (row.isExternal !== external) out.push(`brain_import ${spec}: is_external=${row.isExternal}, expected ${external}`)
  }

  // Leg 3: the reader answers "what does this file include" (outgoing), and
  // only for the rows that can name their importer.
  for (const [importer, specifiers] of Object.entries(EXPECTED_DEPS)) {
    const symbol = importer.endsWith(".c") ? (importer === "util.c" ? "util_scale" : "main_entry") : "useThing"
    const resp: any = await handleGraphRequest(raw, PID, {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      symbol,
      mode: GRAPH_MODE_USAGES,
    })
    const deps: any[] = resp?.fileLevel?.dependencies ?? []
    const got = deps.map((d) => d.moduleSpecifier).sort()
    const want = [...specifiers].sort()
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      out.push(`fileLevel.dependencies for ${symbol} (${importer}) = ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`)
    }
    // Traceability: every served row must carry a stored row id (the
    // response-side gate's contract — an untraceable row must never ship).
    if (deps.some((d) => typeof d.rowId !== "string" || d.rowId.length === 0)) {
      out.push(`fileLevel.dependencies for ${symbol} served a row with no stored id`)
    }
    if (resp?.counts?.fileDependencyRows !== deps.length) {
      out.push(`fileLevel.dependencies count mismatch for ${symbol}: counts=${resp?.counts?.fileDependencyRows} rows=${deps.length}`)
    }
  }

  // Control: the ts root still gets its INCOMING file-level row (unchanged
  // behaviour) and its outgoing section stays empty — the outgoing read keys
  // on an exact importer PATH, so a module-leaf source can never match it.
  const tsResp: any = await handleGraphRequest(raw, PID, { schemaVersion: GRAPH_SCHEMA_VERSION, symbol: "widgetThing", mode: GRAPH_MODE_USAGES })
  const tsIncoming: any[] = tsResp?.fileLevel?.imports ?? []
  if (tsIncoming.length === 0) out.push("control: ts incoming imports section is now empty (the change must be additive)")
  if ((tsResp?.fileLevel?.dependencies ?? []).length !== 0) {
    out.push("control: ts outgoing dependencies section is non-empty — a module leaf matched a path")
  }

  return out
}

// ── the gate ────────────────────────────────────────────────────────────────
console.log("\nL: acceptance on a real index (c includes first-class, reader answers the file's own deps)")
let raw = await index()
let v = await violations(raw)
check("c includes are first-class imports rows with an importer, external flag, and a reading surface", v.length === 0, v.join(" | "))

// ── mutants: prove the gate can fail ────────────────────────────────────────
// Each mutant is a planted regression of one leg, and each must produce at
// least one violation. The fixture is re-indexed afterwards, so a later mutant
// never inherits an earlier one's edit.
// The mutants are row edits, so the fixture is snapshotted and restored by
// value rather than re-indexed: a second index of unchanged files is skipped
// by the incremental hash guard, which would leave mutant N's edit in place
// for mutant N+1 and make every later "CAUGHT" meaningless.
type Snap = { rel: any[]; imp: any[] }
function snap(r: Raw): Snap {
  return {
    rel: r.prepare("SELECT id, relationship_type, source_symbol_id, target_symbol_id, source_external, target_external, line_number, metadata FROM brain_relationship WHERE project_id = ?").all(PID),
    imp: r.prepare("SELECT id, is_external, line_number FROM brain_import WHERE project_id = ?").all(PID),
  }
}
function restore(r: Raw, s: Snap) {
  const ur = r.prepare("UPDATE brain_relationship SET relationship_type=?, source_symbol_id=?, target_symbol_id=?, source_external=?, target_external=?, line_number=?, metadata=? WHERE id=?")
  for (const row of s.rel) ur.run(row.relationship_type, row.source_symbol_id, row.target_symbol_id, row.source_external, row.target_external, row.line_number, row.metadata, row.id)
  const ui = r.prepare("UPDATE brain_import SET is_external=?, line_number=? WHERE id=?")
  for (const row of s.imp) ui.run(row.is_external, row.line_number, row.id)
}

console.log("\nM: planted regressions (the gate must fail on each)")
const MUTANTS: Array<{ name: string; apply: (r: Raw) => void }> = [
  {
    name: "M1 kind downgraded to references + metadata (the pre-#910 ontology)",
    apply: (r) => r.prepare("UPDATE brain_relationship SET relationship_type = 'references' WHERE project_id = ? AND target_external = 'stdio.h'").run(PID),
  },
  {
    name: "M2 importer dropped (source_external NULL — the pre-#910 store)",
    apply: (r) => r.prepare("UPDATE brain_relationship SET source_external = NULL WHERE project_id = ? AND target_external = 'util.h'").run(PID),
  },
  {
    name: "M3 brain_import external flag dropped (the hardcoded 0)",
    apply: (r) => r.prepare("UPDATE brain_import SET is_external = 0 WHERE project_id = ? AND import_path = 'stdio.h'").run(PID),
  },
  {
    name: "M4 target upgraded to a symbol endpoint (would move it into the incoming section)",
    apply: (r) => {
      const sym = r.prepare("SELECT id FROM brain_symbol WHERE project_id = ? AND name = 'util_add' LIMIT 1").get(PID) as any
      r.prepare("UPDATE brain_relationship SET target_symbol_id = ? WHERE project_id = ? AND target_external = 'util.h'").run(sym?.id ?? "none", PID)
    },
  },
  {
    name: "M5 evidence tier downgraded (import_based -> usage_contextual)",
    apply: (r) => {
      const rows = r.prepare("SELECT id, metadata FROM brain_relationship WHERE project_id = ? AND relationship_type = 'imports'").all(PID) as any[]
      for (const row of rows) {
        const md = JSON.parse(row.metadata ?? "{}")
        md.evidenceClass = "usage_contextual"
        r.prepare("UPDATE brain_relationship SET metadata = ? WHERE id = ?").run(JSON.stringify(md), row.id)
      }
    },
  },
]
let caught = 0
let restoreLeaks = 0
for (const m of MUTANTS) {
  const before = snap(raw)
  m.apply(raw)
  const got = await violations(raw)
  if (got.length > 0) {
    caught++
    console.log(`  CAUGHT  ${m.name}  (${got.length} violation(s): ${got[0]})`)
  } else {
    console.log(`  SURVIVED  ${m.name}  — the gate cannot see this regression`)
  }
  restore(raw, before)
  const after = await violations(raw)
  if (after.length > 0) {
    restoreLeaks++
    console.log(`  LEAK  ${m.name}: still failing after restore (${after[0]}) — the next mutant's verdict would be inherited`)
  }
}
check("each mutant is restored before the next runs (no inherited verdicts)", restoreLeaks === 0, `${restoreLeaks} leak(s)`)
check("the fixture passes again after all mutants were restored", (await violations(raw)).length === 0)
check("every planted regression is caught by the gate itself", caught === MUTANTS.length, `${caught}/${MUTANTS.length}`)

// ── evidence ────────────────────────────────────────────────────────────────
const currentCommit = (await import("child_process")).execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim()
const result = {
  issue: "M60/#910",
  title: "c includes are first-class imports, and the usages file-level section answers the file's own dependencies",
  status: failures === 0 ? "verified" : "known-gap",
  checks: 3 + MUTANTS.length,
  passed: 3 + caught,
  failed: failures,
  failures: failedChecks,
  mutantsCaught: caught,
  mutantsTotal: MUTANTS.length,
  currentCommit,
  verifierCommand: "npx tsx script/m60/verify-910-c-includes.ts",
  evidenceFile: "910-c-includes.json",
  generatedAt: new Date().toISOString(),
  fixture: {
    files: Object.keys(FIXTURE),
    expectedDeps: EXPECTED_DEPS,
    expectedExternal: EXPECTED_EXTERNAL,
    control: "use.ts imports a module leaf, so the outgoing (path-keyed) read must not fire for it",
  },
  limitations: [
    "The INCOMING direction for c headers (\"who includes this file\") is not served: the stored specifier is the path as WRITTEN in the includer (\"util.h\") while the viewed file is a project path (\"src/util.h\"), so an exact match is impossible and a basename match would be a guess. Named here rather than shipped.",
    "brain_import.is_external now carries the analyzer's classification; a dependency the analyzer does not classify stays 0 (unknown is not external).",
    "Pool discovery was observed coming back short once in ~6 runs (the two .ts files missing while the .c files indexed), which is a harness fault and is re-driven up to 3 times by index(); the root cause is not established.",
  ],
}
mkdirSync(path.dirname(EVIDENCE), { recursive: true })
writeFileSync(EVIDENCE, JSON.stringify(result, null, 2) + "\n")
console.log(`\n910: ${result.status.toUpperCase()} (${result.passed}/${result.checks} checks, ${caught}/${MUTANTS.length} mutants caught)`)
try { rmSync(root, { recursive: true, force: true }) } catch {}
process.exit(failures === 0 ? 0 : 1)
