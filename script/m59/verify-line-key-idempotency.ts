// script/m59/verify-line-key-idempotency.ts — M59.P4 (#822)
//
// #822 made a relationship's row identity include its call-site LINE. Two
// consequences must be proven, not assumed:
//
//   1. STALENESS — edit the caller so its call sites move from lines 4-7 to
//      6-9. The old rows (lines 4-7) must be GONE. If they linger, the index
//      reports call sites that no longer exist, which is worse than reporting
//      none: an agent would edit a line that is now something else.
//   2. DUPLICATION — the incremental path restores in-edges through
//      `repairInEdges`, whose id shape is `${source}:${type}:${target}:${line}:m40`
//      while production uses `${projectId}:rel:${source}:${target}:${type}:${line}`.
//      If both write the same semantic edge, one call site becomes two rows.
//
// Method: a two-file java fixture (A.java has 4 call sites into B.java), real
// pipeline, full index → edit B (does not change A's call lines) → incremental
// index → assert; then edit A (shifts the calls) → incremental index → assert.
// Every expected count comes from the fixture text, never from the index.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execSync } from "node:child_process"

const DATA = mkdtempSync(path.join(tmpdir(), "m59-idem-data-"))
process.env.BB_DATA_DIR = DATA

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

const B_SRC = `public class B {
  static int target() { return 1; }
}
`

function aSrc(pad: number): string {
  const lines = [
    "public class A {",
    ...Array.from({ length: pad }, (_, i) => `  // padding line ${i + 1}`),
    "  static int caller() {",
    "    int a = target();",
    "    int b = target();",
    "    int c = target();",
    "    int d = target();",
    "    return a + b + c + d;",
    "  }",
    "}",
  ]
  return lines.join("\n") + "\n"
}

// Where the 4 calls sit for a given padding: caller() starts after `pad+1`
// lines (class line + padding), then 2 lines to reach the first call.
function expectedLines(pad: number): number[] {
  const first = pad + 3
  return [first, first + 1, first + 2, first + 3]
}

let failures = 0
let checks = 0

function check(name: string, ok: boolean, detail: string) {
  checks++
  if (ok) console.log(`  PASS  ${name}  ${detail}`)
  else {
    failures++
    console.log(`  FAIL  ${name}  ${detail}`)
  }
}

async function main() {
  const project = mkdtempSync(path.join(tmpdir(), "m59-idem-proj-"))
  mkdirSync(path.join(project, "src"), { recursive: true })
  const aPath = path.join(project, "src", "A.java")
  const bPath = path.join(project, "src", "B.java")
  writeFileSync(aPath, aSrc(0))
  writeFileSync(bPath, B_SRC)

  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

  const pid = getProjectId(project) as any

  const siteRows = async () => {
    const raw = await BrainDatabase.getRawInstance(pid)
    return raw
      .prepare(
        `SELECT r.id, r.line_number AS line, r.relationship_type rt, r.target_external te
         FROM brain_relationship r
         JOIN brain_symbol s ON s.id = r.source_symbol_id
         LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
         WHERE r.relationship_type IN ('calls','call')
           AND s.name LIKE '%caller%'
           AND (COALESCE(ts.name,'') LIKE '%target%' OR COALESCE(r.target_external,'') LIKE '%target%')`,
      )
      .all() as Array<{ id: string; line: number | null; rt: string; te: string | null }>
  }

  const report = (tag: string, rows: Array<{ id: string; line: number | null }>) => {
    const ids = rows.map((r) => r.id)
    return {
      tag,
      rows: rows.length,
      lines: rows.map((r) => r.line).sort((a, b) => Number(a) - Number(b)),
      distinctIds: new Set(ids).size,
      idShapes: [...new Set(ids.map((i) => (i.includes(":rel:") ? "rel" : i.endsWith(":m40") ? "m40" : "other")))],
    }
  }

  // ── 1. full index ────────────────────────────────────────────────────────
  await indexProjectParallel(pid, project, {})
  const exp0 = expectedLines(0)
  const first = await siteRows()
  console.log(`after full index: ${JSON.stringify(report("full", first))}`)
  check(
    "full-index-per-site",
    first.length === 4 && exp0.every((l) => first.some((r) => r.line === l)),
    `${first.length} rows at ${JSON.stringify(first.map((r) => r.line).sort((a, b) => Number(a) - Number(b)))} expected ${JSON.stringify(exp0)}`,
  )

  // ── 2. edit B (A untouched): A's sites must be unchanged, no duplicates ──
  writeFileSync(bPath, `// comment added at the top of B\n` + B_SRC)
  await indexProjectParallel(pid, project, { isIncremental: true })
  const afterB = await siteRows()
  const repB = report("after-B-edit", afterB)
  console.log(`after editing B: ${JSON.stringify(repB)}`)
  check(
    "B-edit-keeps-A-sites-exactly-once",
    afterB.length === 4 && repB.distinctIds === 4,
    `${afterB.length} rows / ${repB.distinctIds} distinct ids, shapes=${JSON.stringify(repB.idShapes)} (expected 4 rows, no m40/rel duplication)`,
  )
  check(
    "B-edit-keeps-A-lines",
    exp0.every((l) => afterB.some((r) => r.line === l)),
    `lines ${JSON.stringify(repB.lines)} expected ${JSON.stringify(exp0)}`,
  )

  // ── 3. edit A so the 4 calls MOVE — stale rows must not survive ──────────
  const PAD = 2
  writeFileSync(aPath, aSrc(PAD))
  const srcLines = readFileSync(aPath, "utf8").split("\n")
  const exp1 = expectedLines(PAD)
  // independent confirmation from the edited text itself
  const textual = srcLines
    .map((l, i) => (l.includes("target()") && l.includes("=") ? i + 1 : 0))
    .filter(Boolean)
  check(
    "fixture-self-check",
    JSON.stringify(textual) === JSON.stringify(exp1),
    `edited source has calls on ${JSON.stringify(textual)}; expected ${JSON.stringify(exp1)}`,
  )

  await indexProjectParallel(pid, project, { isIncremental: true })
  const afterA = await siteRows()
  const repA = report("after-A-edit", afterA)
  console.log(`after editing A: ${JSON.stringify(repA)}`)
  check(
    "moved-sites-no-stale-rows",
    afterA.length === 4 && afterA.every((r) => r.line === null || exp1.includes(r.line)),
    `${afterA.length} rows at ${JSON.stringify(repA.lines)} — every row must sit on ${JSON.stringify(exp1)} (stale rows from ${JSON.stringify(exp0)} are the failure)`,
  )
  check(
    "moved-sites-exact-and-unduplicated",
    afterA.length === 4 && repA.distinctIds === 4 && exp1.every((l) => afterA.some((r) => r.line === l)),
    `${afterA.length} rows / ${repA.distinctIds} distinct ids at ${JSON.stringify(repA.lines)}, shapes=${JSON.stringify(repA.idShapes)}`,
  )

  const outDir = path.join(ROOT, "validation/m59/results")
  mkdirSync(outDir, { recursive: true })
  writeFileSync(
    path.join(outDir, "line-key-idempotency.json"),
    JSON.stringify(
      {
        probe: "M59.P4",
        issue: "#822",
        at: new Date().toISOString(),
        atCommit: execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim(),
        treeModifiedInputs: execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" })
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("?? ")).length,
        command: "npx tsx script/m59/verify-line-key-idempotency.ts",
        question:
          "after making row identity line-keyed, do edits leave stale rows, and does the repair path duplicate a site?",
        fullIndex: report("full", first),
        afterBEdit: repB,
        afterAEdit: repA,
        expectedLines: { first: exp0, afterMove: exp1 },
        status: failures === 0 ? "pass" : "fail",
        failures,
        checks,
      },
      null,
      2,
    ) + "\n",
  )
  console.log(`\nevidence: ${path.join(outDir, "line-key-idempotency.json")}`)

  rmSync(project, { recursive: true, force: true })
  if (failures > 0) {
    console.error(`\nFAILED (${failures}/${checks}).`)
    process.exit(1)
  }
  console.log(`\nAll checks passed (${checks}).`)
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
