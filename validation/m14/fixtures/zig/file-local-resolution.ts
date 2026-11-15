/**
 * ZIG — FILE-LOCAL RESOLUTION RATE, per relationship type.
 *
 * ## The question
 *
 * `script/m14/diagnose-incoming.mts` builds ONE global map from published bare name to
 * the files declaring it, then calls a target unresolved when no file declares that
 * name, and ambiguous when more than one does. Both verdicts are statements about a
 * GLOBAL name map, not about an edge.
 *
 * In Zig the overwhelming majority of edge targets are FILE-SCOPED BY CONSTRUCTION:
 * a declaration in `a.zig` and a declaration of the same name in `b.zig` are not two
 * candidates for one node, they are two different symbols that never shared a scope.
 * `const std = @import("std");` appears in hundreds of files and each one is a
 * different local binding of the same external module — the analyzer already marks
 * these with `metadata.zigImportDep === true`.
 *
 * So the honest question is not "does the bare name appear once in the corpus". It is:
 *
 *   **scoped to the edge's OWN file, does the target bind?**
 *
 * ## Why this is not the shared instruments' question
 *
 * `incoming-check.ts` and `diagnose-incoming.mts` both deliberately hold a corpus-wide
 * name map, because the question they were built for is whether an edge can reach a
 * declaration in ANOTHER file. That is the right question for them and the wrong
 * question for this one. Neither can answer it, so this file exists. It reports both
 * numbers side by side rather than only the flattering one.
 *
 * ## What it reports, per type
 *
 *   edges              total edges of that type in the sample
 *   fileLocal          target is a name published by a symbol IN THE EDGE'S OWN FILE
 *   fileLocalExternal  of those, the symbol is an import alias (zigImportDep) — the
 *                      target names an EXTERNAL module as bound locally, so the edge
 *                      is a binding reference and not a corpus-local declaration
 *   corpusLocal        target is published in the corpus but NOT in this file
 *                      (this is the population the global instrument calls ambiguous)
 *   absent             target is published nowhere in the sample
 *
 * `fileLocal + corpusLocal + absent` is `edges`, so the three are exhaustive and each
 * is checkable against the others.
 *
 * ## Population
 *
 * Deterministic: `find <root> -name '*.zig' | sort | head -N`, the same draw and the
 * same N as the shared instrument, so the two are comparable row for row. A rerun with
 * a different N is a different measurement, not a contradiction. The repo is printed
 * with every number.
 *
 * ## Instrument
 *
 * `parseFile` from `src/ast/pool-worker` — the PRODUCTION entry point, not `analyze()` and
 * not `ASTEngine.parseFile`, because `analyze()` is a per-file unit that skips the
 * pipeline stages (pool-worker, timeouts, truncation, enhancements). Every count below
 * comes from it.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/file-local-resolution.ts <root> [N] [--out path]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const positional = argv.filter((a) => !a.startsWith("--"))
const flag = (k: string, d: string) => {
  const hit = argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`))
  if (hit === undefined) return d
  const eq = hit.indexOf("=")
  return eq === -1 ? (argv[argv.indexOf(hit) + 1] ?? d) : hit.slice(eq + 1)
}
const root = positional[0] ?? "/home/ishaq2321/bb_tests/repositories"
const N = Number(positional[1] ?? 300)
const out = flag("out", "")

const files = execFileSync("bash", ["-lc", `find ${root} -name '*.zig' -type f | sort | head -${N}`], {
  encoding: "utf8",
  maxBuffer: 1 << 28,
})
  .trim()
  .split("\n")
  .filter(Boolean)

/** bare name -> the files that publish it, and per file whether it is an import alias */
const nameToFiles = new Map<string, Map<string, boolean>>()
/** edge counts, bucketed per type */
const buckets = new Map<string, { edges: number; fileLocal: number; fileLocalExternal: number; corpusLocal: number; absent: number }>()
/** the absent population, kept so it can be inspected rather than summarised away */
const absentNames = new Map<string, Set<string>>()
let symbols = 0
let parsed = 0
let failed = 0

const bump = (t: string, k: "edges" | "fileLocal" | "fileLocalExternal" | "corpusLocal" | "absent") => {
  let b = buckets.get(t)
  if (!b) buckets.set(t, (b = { edges: 0, fileLocal: 0, fileLocalExternal: 0, corpusLocal: 0, absent: 0 }))
  b[k]++
}

for (const f of files) {
  let r: any
  try {
    r = await parseFile(f, root)
    parsed++
  } catch {
    failed++
    continue
  }
  /** names this file publishes, and which of them are import aliases */
  const localNames = new Map<string, boolean>()
  for (const e of r?.relationships ?? []) {
    if (String(e?.type) === "imports" && (e?.metadata as any)?.zigImportDep === true) {
      const t = String(e?.target ?? "")
      // an `imports` edge whose target is a bare name is the LOCAL BINDING that name
      if (t) localNames.set(t, true)
    }
  }
  for (const s of r?.symbols ?? []) {
    const n = String(s?.name ?? "")
    if (!n) continue
    symbols++
    // an alias is published as a symbol AND named by an imports edge; a declaration
    // that is only a symbol is not an alias
    if (!localNames.has(n)) localNames.set(n, false)
    let m = nameToFiles.get(n)
    if (!m) nameToFiles.set(n, (m = new Map()))
    m.set(f, localNames.get(n) === true)
  }
  for (const e of r?.relationships ?? []) {
    const t = String(e?.target ?? "")
    if (!t) continue
    const type = String(e?.type ?? "")
    bump(type, "edges")
    if (localNames.has(t)) {
      bump(type, "fileLocal")
      if (localNames.get(t) === true) bump(type, "fileLocalExternal")
    } else if (nameToFiles.has(t)) {
      bump(type, "corpusLocal")
    } else {
      bump(type, "absent")
      let s = absentNames.get(t)
      if (!s) absentNames.set(t, (s = new Set()))
      s.add(type)
    }
  }
}

const rows = [...buckets.entries()]
  .sort((a, b) => b[1].edges - a[1].edges)
  .map(([type, b]) => ({
    type,
    ...b,
    fileLocalPct: b.edges ? +((100 * b.fileLocal) / b.edges).toFixed(2) : 0,
    corpusLocalPct: b.edges ? +((100 * b.corpusLocal) / b.edges).toFixed(2) : 0,
    absentPct: b.edges ? +((100 * b.absent) / b.edges).toFixed(2) : 0,
  }))

const totals = rows.reduce(
  (a, r) => ({
    edges: a.edges + r.edges,
    fileLocal: a.fileLocal + r.fileLocal,
    fileLocalExternal: a.fileLocalExternal + r.fileLocalExternal,
    corpusLocal: a.corpusLocal + r.corpusLocal,
    absent: a.absent + r.absent,
  }),
  { edges: 0, fileLocal: 0, fileLocalExternal: 0, corpusLocal: 0, absent: 0 },
)

const report = {
  population: { root, filesListed: files.length, parsed, failed, symbols },
  note:
    "fileLocal = target published by a symbol in the EDGE'S OWN FILE. corpusLocal = published elsewhere in the " +
    "sample, not here (what a global name map calls ambiguous). absent = published nowhere in the sample.",
  totals: {
    ...totals,
    fileLocalPct: +((100 * totals.fileLocal) / totals.edges).toFixed(2),
    corpusLocalPct: +((100 * totals.corpusLocal) / totals.edges).toFixed(2),
    absentPct: +((100 * totals.absent) / totals.edges).toFixed(2),
  },
  perType: rows,
  absentNames: [...absentNames.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 60)
    .map(([name, types]) => ({ name, types: [...types] })),
}

console.log(`population: ${files.length} files listed, ${parsed} parsed, ${failed} failed, ${symbols} symbols`)
console.log(`root: ${root}`)
console.log()
console.log(
  `type              edges   fileLocal   of which alias   corpusLocal      absent   fileLocal%  corpusLocal%  absent%`,
)
for (const r of rows) {
  console.log(
    `${r.type.padEnd(16)} ${String(r.edges).padStart(6)} ${String(r.fileLocal).padStart(10)} ${String(r.fileLocalExternal).padStart(16)} ${String(r.corpusLocal).padStart(12)} ${String(r.absent).padStart(10)} ${String(r.fileLocalPct).padStart(10)} ${String(r.corpusLocalPct).padStart(12)} ${String(r.absentPct).padStart(8)}`,
  )
}
console.log(
  `${"TOTAL".padEnd(16)} ${String(totals.edges).padStart(6)} ${String(totals.fileLocal).padStart(10)} ${String(totals.fileLocalExternal).padStart(16)} ${String(totals.corpusLocal).padStart(12)} ${String(totals.absent).padStart(10)}`,
)

if (out) {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(report, null, 2))
  console.error(`\nwrote ${out}`)
}