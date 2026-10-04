/**
 * ORPHANED-MUTANTS GATE — a mutant file that nothing imports.
 *
 * WHY THIS FILE EXISTS
 *
 * Six lanes in the M60 ontology wave wrote a mutant array, verified in their own
 * harness that every mutant was caught, and reported a green suite. Those greens
 * were unsound. The mutants were never RUN by the shared gate.
 *
 * `script/m14/mutate-analyzer.ts` collects mutants into one `MUTANTS` array, and
 * a lane's mutants only reach it if that file imports them. Nothing checked the
 * import. The defect looked like this from inside a lane:
 *
 *   protobuf: "fixtures 2/2 passing" AND "6 survivors from a global run" — and
 *             the two numbers disagreed, because ZERO of the 1,481 global
 *             mutants were protobuf's. The 6 belonged to other languages.
 *   yaml:      "the doc says 15 mutants, all caught" — the array was never
 *             imported by the harness, so they had never run.
 *
 * This is the same shape as the relationship-type ruling the ontology coverage
 * gate exists for: a lane is silent about a class, the oracle is silent about the
 * same class, and the two agree because there is nothing to disagree about. Here
 * the silence is not in a report but in a WIRE.
 *
 * WHAT THIS ASSERTS
 *
 * For every file under script/m14 or script/m60 whose name ends in
 * "-mutants.ts" and which exports a CONSTANT ending in _MUTANTS, that constant is
 * SPREAD into the registry. Two failure modes, both previously silent:
 *
 *   1. an exported mutant registry that nothing imports
 *   2. an import that exists but whose spread is absent — the import compiles,
 *      the mutants still do not run — so this checks the SPREAD, not the import
 *
 * WHAT THIS DOES NOT ASSERT
 *
 * That the mutants are any good. A registered mutant can be a no-op that never
 * fires (protobuf had two), and a failing mutant is caught by
 * `mutate-analyzer.ts` itself, which reports survivors loudly. This gate only
 * answers "is it wired", never "does it work".
 *
 * READ-ONLY. Writes nothing.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.env.BB_M14_ROOT
  ? path.resolve(process.env.BB_M14_ROOT)
  : path.resolve((import.meta as any).dirname ?? __dirname, "..", "..")

const REGISTRY = path.join(ROOT, "script", "m14", "mutate-analyzer.ts")
const SEARCH_DIRS = [path.join(ROOT, "script", "m14"), path.join(ROOT, "script", "m60")]

function mutantFiles(): string[] {
  const out: string[] = []
  for (const dir of SEARCH_DIRS) {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (!name.endsWith("-mutants.ts")) continue
      const full = path.join(dir, name)
      try {
        if (!statSync(full).isFile()) continue
      } catch {
        continue
      }
      out.push(full)
    }
  }
  return out.sort()
}

const registrySrc = readFileSync(REGISTRY, "utf8")

const rows: { file: string; exportName: string | null; imported: boolean; registered: boolean; count: number }[] = []

for (const file of mutantFiles()) {
  const src = readFileSync(file, "utf8")
  // The exported registry array, if any. `run-*-mutants.ts` files are runners,
  // not registries, so they legitimately export nothing of this shape.
  const m = src.match(/^export const ([A-Z0-9_]+_MUTANTS)\b/m)
  if (!m) {
    rows.push({ file: path.relative(ROOT, file), exportName: null, imported: false, registered: false, count: 0 })
    continue
  }
  const exportName = m[1]
  const rel = path.relative(ROOT, file).replace(/\.ts$/, "")
  // The import may be written with or without a leading ./
  const imported = new RegExp(`from\\s+["'][^"']*${rel.replace(/[/]/g, "[/]")}["']`).test(registrySrc)
  // The spread is the thing that makes them RUN. An import alone compiles and
  // does nothing, which is why this checks the registry rather than the import.
  const registered = new RegExp(`\\.\\.\\.${exportName}\\b`).test(registrySrc)
  const count = (src.match(/^\s*id:\s*["'`]/gm) ?? []).length
  rows.push({ file: path.relative(ROOT, file), exportName, imported, registered, count })
}

const registries = rows.filter((r) => r.exportName !== null)
const runners = rows.filter((r) => r.exportName === null)
const unwired = registries.filter((r) => !r.registered)
const importOnly = registries.filter((r) => r.imported && !r.registered)

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(pad("file", 44) + pad("export", 26) + pad("mutants", 9) + "state")
console.log("-".repeat(104))
for (const r of rows) {
  const state = !r.exportName ? "runner (no registry)" : r.registered ? "WIRED" : r.imported ? "IMPORTED BUT NOT SPREAD" : "ORPHANED"
  console.log(pad(r.file, 44) + pad(r.exportName ?? "-", 26) + pad(String(r.count), 9) + state)
}
console.log("-".repeat(104))
console.log(
  `${registries.length} registries, ${runners.length} runner file(s), ` +
    `${registries.filter((r) => r.registered).length} wired, ` +
    `${unwired.length} unwired, ${importOnly.length} imported-but-not-spread`,
)
const totalMutants = registries.filter((r) => r.registered).reduce((n, r) => n + r.count, 0)
const orphanMutants = unwired.reduce((n, r) => n + r.count, 0)
console.log(`${totalMutants} mutants reachable from the shared registry; ${orphanMutants} defined but unreachable.`)

if (unwired.length > 0) {
  console.error("")
  console.error(`>>> THIS GATE FAILS. ${unwired.length} mutant file(s) export a registry that mutate-analyzer.ts does not spread:`)
  for (const r of unwired) console.error(`    ${r.file} -> ${r.exportName} (${r.count} mutants)`)
  console.error(">>> Those mutants have never run. A lane that verified them in its own harness got a real")
  console.error(">>> number, but the F4 gate cannot fail for that lane, so its green means nothing here.")
  process.exitCode = 1
} else {
  console.log("every exported mutant registry is wired into the shared registry")
}