// script/m14/js-ontology/js-bounded-resolution-probe.ts — the bounded pass's
// own resolution step, printed row by row.
//
// WHY THIS EXISTS. The M40 lifecycle corpus's S5 scenario (fingerprint
// adoption: index a project, move it, index it again) reads `resolvedEdges`
// 3 -> 4 once the bounded pass resolves the rows it re-stored — and "one more
// edge" is not a diagnosis. This probe reproduces that scenario and prints the
// rows, so the count is read rather than guessed:
//
//   A  after the full index      (the reference world)
//   B  after the adoption run    (files unchanged; the bounded path runs)
//   A\B / B\A  every row difference, by (type, source, target)
//
// It also prints each row's `is_cross_file` and whether the target lives in the
// row's own file, because that is the distinction the J12 insert-path rule is
// about: the insert path decides a candidate in the row's OWN FILE, and
// everything else is decided by the shared rules over the complete tables.
//
// Run:
//   bun run script/m14/js-ontology/js-bounded-resolution-probe.ts
//
// Output: stdout only. No result record is written — a probe that writes
// evidence competes with the gates that own it (the X1 lesson).

import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

// Isolated data dir, set BEFORE any bb module is imported (the corpus's rule).
const DATA = mkdtempSync(path.join(tmpdir(), "js-bounded-res-probe-data-"))
process.env.BB_DATA_DIR = DATA

const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))
const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))

const fixture = mkdtempSync(path.join(tmpdir(), "js-bounded-res-probe-"))
const projA = path.join(fixture, "projA")
const projB = path.join(fixture, "projB")
const runner = path.join(fixture, "runner.mjs")
writeFileSync(
  runner,
  `import { runCli } from ${JSON.stringify(path.join(ROOT, "src/cli/index.ts"))}\n` +
    `await runCli(process.argv.slice(2)).catch((e)=>{console.error("RUNNER_ERR:", e?.message ?? e); process.exit(1)})\n`,
)
const cli = (args: string[]) => {
  const r = spawnSync("bun", [runner, ...args], {
    encoding: "utf8",
    timeout: 300_000,
    env: { ...process.env, BB_DATA_DIR: process.env.BB_DATA_DIR! },
  })
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") }
}

mkdirSync(path.join(projA, "src"), { recursive: true })
writeFileSync(path.join(projA, "src", "a.ts"), 'import { helper } from "./h"\nexport function topFn(x: number): number { return helper(x) }\n')
writeFileSync(path.join(projA, "src", "h.ts"), "export function helper(x: number): number { return x * 2 }\n")

type Row = { id: string; type: string; src: string | null; tgt: string | null; xfile: number | null; name: string | null; file: string | null }
async function snapshot(projectPath: string, label: string): Promise<Row[]> {
  const pid = getProjectId(projectPath) as any
  const raw = await BrainDatabase.getRawInstance(pid)
  const rows = raw
    .prepare(
      `SELECT r.id AS id, r.relationship_type AS type, r.source_external AS src, r.target_external AS tgt,
              r.is_cross_file AS xfile, s.name AS name, sf.relative_path AS file
         FROM brain_relationship r
         LEFT JOIN brain_symbol s  ON s.id = r.target_symbol_id
         LEFT JOIN brain_file   sf ON sf.id = s.file_id
        WHERE r.project_id = ?`,
    )
    .all(pid) as Row[]
  const resolved = rows.filter((r) => r.name !== null)
  const unresolved = rows.filter((r) => r.name === null)
  console.log(`\n── ${label} — ${rows.length} rows, ${resolved.length} resolved, ${unresolved.length} unresolved`)
  for (const r of [...rows].sort((a, b) => (a.type + (a.tgt ?? "")).localeCompare(b.type + (b.tgt ?? "")))) {
    console.log(
      `   ${(r.name ? "RESOLVED" : "unresolved").padEnd(10)} ${r.type.padEnd(10)} ` +
        `${String(r.tgt).padEnd(22)} src=${String(r.src).padEnd(10)} -> ${r.name ?? "—"}${r.file ? ` (${r.file})` : ""} xfile=${r.xfile}`,
    )
  }
  return rows
}

const telemetry = (out: string) => out.split("\n").filter((l) => /bounded:|derived:/.test(l)).map((l) => l.trim())

const i5 = cli(["index", projA])
console.log(`index projA: exit ${i5.code}`)
for (const l of telemetry(i5.out)) console.log(`   ${l}`)
const A = await snapshot(projA, "A: after the full index at projA")

renameSync(projA, projB)
const r5 = cli(["index", projB])
console.log(`index projB (adoption): exit ${r5.code}${/adopt/i.test(r5.out) ? " (adoption reported)" : " (no adoption line)"}`)
for (const l of telemetry(r5.out)) console.log(`   ${l}`)
const B = await snapshot(projB, "B: after the adoption run at projB")

const key = (r: Row) => `${r.type}|${r.src ?? ""}|${r.tgt ?? ""}`
const aKeys = new Set(A.map(key))
const bKeys = new Set(B.map(key))
const onlyA = A.filter((r) => !bKeys.has(key(r)))
const onlyB = B.filter((r) => !aKeys.has(key(r)))
console.log(`\n── rows only in A (${onlyA.length}): ${onlyA.map((r) => `${r.type}:${r.tgt}`).join(", ") || "—"}`)
console.log(`── rows only in B (${onlyB.length}): ${onlyB.map((r) => `${r.type}:${r.tgt}`).join(", ") || "—"}`)
const resolvedA = A.filter((r) => r.name !== null).length
const resolvedB = B.filter((r) => r.name !== null).length
console.log(`── resolved: A=${resolvedA} B=${resolvedB} (delta ${resolvedB - resolvedA})`)

try {
  rmSync(fixture, { recursive: true, force: true })
  rmSync(DATA, { recursive: true, force: true })
} catch { /* best-effort */ }
