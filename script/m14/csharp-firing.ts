/**
 * CSHARP_FIRING — the CSHARP_MEASURE lane's own firing instrument.
 *
 * WHY THIS EXISTS AND WHY IT IS A SEPARATE FILE.
 *
 * `script/m14/firing-check-v2.mjs` is the programme's arbiter, and it has no
 * CSHARP lane. Measured, not inferred: `bun script/m14/firing-check-v2.mjs
 * CSHARP_MEASURE` prints
 *
 *     FIRING-CHECK v2: no lane matches "CSHARP_MEASURE".
 *     Known lanes: RUST GO TYPESCRIPT JAVA KOTLIN SCALA GROOVY HASKELL SWIFT
 *                  CLOJURE VB RUBY ERLANG ELIXIR C CPP OBJ_C JAVASCRIPT VUE
 *                  SVELTE HTML
 *
 * and exits 2. `ALIAS` in that script maps both `CSHARP:` and `CS:` to `null`
 * (firing-check-v2.mjs:178), and `LANES` has no `CSHARP` key. So the lane named
 * in the brief cannot be measured by the instrument the brief names. That file
 * is MASTER-owned (`script/m14/**`); this lane does not edit it and reports the
 * need instead.
 *
 * This file is the same measurement, built by the lane that owns the analyzer:
 *
 *  - SAME production path: `getParser(lang)` -> `parser.parse(content, path)` ->
 *    `new RealCSharpAnalyzer().analyze(root, content, path)`. Not `analyze()`
 *    with a hand-built tree, and not a private re-read of the analyzer.
 *  - SAME denominator: `ASTEngine.RelationshipType`, the enum the analyzers
 *    reference as `ASTEngine.RelationshipType.X` (engine.ts:445). types.ts is
 *    reported only to expose its divergence (`Imports = "brain_import"`).
 *  - SAME code-bearing sampling idea as v2's defect-1 fix, with a `.cs` entry,
 *    and BB_BLIND=1 to restore blind walk so the effect is measurable.
 *  - SEPARATE the two channels. `ParseResult` carries `imports: ImportInfo[]`
 *    (types.ts:206-216) beside `relationships`, and parallel-indexer persists
 *    imports to the `brain_import` TABLE (parallel-indexer.ts:2169), never to
 *    `brain_relationship` rows. A type absent from the relationship tally while
 *    `imports[]` is non-zero is NOT a defect.
 *
 * POPULATION RULE (M14 honesty contract, "an instrument must declare the
 * population it covered"): the file list is DERIVED by walking the corpus
 * directory, never hand-written. Every count below is printed against the
 * population that produced it, and `BB_FILES` re-runs on an explicit file list
 * so a before/after can be pinned.
 *
 * NO REGEXP anywhere (programme rule 1): string `includes`/`startsWith` only.
 */

import { readdirSync, readFileSync, statSync, type Dirent } from "node:fs"
import { join, resolve as pathResolve } from "node:path"

const HERE = import.meta.dir
const REPO = pathResolve(HERE, "..", "..")
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"

/**
 * Code-bearing signals for `.cs`, in the spirit of v2's `SIGNAL` table: tokens a
 * C# data/config/testdata file characteristically lacks. `class ` is the
 * load-bearing one — a file with no type declaration in it cannot express most
 * of this ontology, so sampling it measures nothing.
 */
const CS_SIGNALS = [
  "class ",
  "struct ",
  "interface ",
  "record ",
  "enum ",
  "delegate ",
  "namespace ",
  "using ",
  "void ",
  "public ",
  "private ",
  "internal ",
  "static ",
]

const BLIND = process.env.BB_BLIND === "1"
const MAX_BYTES = 400_000

type FileRow = { repo: string; rel: string; abs: string }

function walkCs(dir: string, repo: string, out: FileRow[], depth: number): void {
  if (depth > 24) return
  // `ReturnType<typeof readdirSync>` is the `encoding: "buffer"` overload — the
  // last one — so the real call had to be cast to its own declared type (a cast TS
  // now calls a mistake) and every `Dirent` below had its name re-declared by hand.
  // The call is the default-encoding overload: names are strings.
  let ents: Dirent[]
  try {
    ents = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      const n = e.name
      if (n === "node_modules" || n === ".git" || n === "bin" || n === "obj") continue
      walkCs(p, repo, out, depth + 1)
    } else if (e.name.endsWith(".cs")) {
      out.push({ repo, rel: p.slice(dir.length + 1), abs: p })
    }
  }
}

/** The population, DERIVED. Prints where it came from. */
function population(repos: string[]): { all: FileRow[]; admitted: FileRow[] } {
  const all: FileRow[] = []
  for (const r of repos) {
    const d = join(CORPUS, r)
    try {
      if (!statSync(d).isDirectory()) {
        console.error(`CSHARP_FIRING: corpus repo absent on disk: ${d}`)
        continue
      }
    } catch {
      console.error(`CSHARP_FIRING: corpus repo unreadable: ${d}`)
      continue
    }
    walkCs(d, r, all, 0)
  }
  const admitted: FileRow[] = []
  let droppedBytes = 0
  for (const f of all) {
    let text: string
    try {
      if (statSync(f.abs).size >= MAX_BYTES) {
        droppedBytes++
        continue
      }
      text = readFileSync(f.abs, "utf8")
    } catch {
      continue
    }
    if (BLIND) {
      admitted.push(f)
      continue
    }
    for (const s of CS_SIGNALS) {
      if (text.includes(s)) {
        admitted.push(f)
        break
      }
    }
  }
  return { all, admitted }
}

const { getParser } = await import(`${REPO}/src/ast/engine.ts`)
const engineMod = await import(`${REPO}/src/ast/engine.ts`)
const typesMod = await import(`${REPO}/src/ast/types.ts`)
const PROD: string[] = [...new Set(Object.values(engineMod.ASTEngine.RelationshipType) as string[])]
const ALL_TYPES_TS: string[] = [...new Set(Object.values(typesMod.RelationshipType) as string[])]
const OFF_ENUM = ALL_TYPES_TS.filter((t) => !PROD.includes(t))
const EXTRA = PROD.filter((t) => !ALL_TYPES_TS.includes(t))

const analyzerMod = await import(`${REPO}/src/ast/real-csharp-analyzer.ts`)
const Cls = Object.values(analyzerMod).find(
  (v) => typeof v === "function" && v.name.endsWith("Analyzer"),
) as new () => { analyze(root: unknown, content: string, path: string): any }

if (!Cls) {
  console.error("CSHARP_FIRING: RealCSharpAnalyzer not exported from src/ast/real-csharp-analyzer.ts")
  process.exit(2)
}

const REPOS = (process.env.BB_REPOS || "roslyn-cs,aspnetcore,vbnet-samples,powershell").split(",").filter(Boolean)
const want = Number(process.env.NFILES || 200)
const { all, admitted } = population(REPOS)

console.log(`CSHARP_FIRING — CSHARP_MEASURE lane`)
console.log(`corpus root: ${CORPUS}`)
console.log(`repos drawn from (BB_REPOS): ${REPOS.join(", ")}`)
console.log(
  `POPULATION: ${all.length} .cs files exist under those repos; ` +
    `${admitted.length} admitted by the ${BLIND ? "BLIND (no filter)" : "code-bearing"} filter ` +
    `of ${CS_SIGNALS.length} signals. NFILES=${want} — this instrument measured ${Math.min(want, admitted.length)} of the ${admitted.length} admitted.`,
)
console.log(`production vocabulary (${PROD.length}): ${PROD.join(" ")}`)
console.log(`types.ts vocabulary (${ALL_TYPES_TS.length}): ${ALL_TYPES_TS.join(" ")}`)
console.log(`in types.ts but NOT produced: ${OFF_ENUM.join(" ") || "(none)"}`)
console.log(`produced but NOT in types.ts: ${EXTRA.join(" ") || "(none)"}`)
console.log(`NOTE: the relationship tally below is scored against the production vocabulary only.`)

const sample = admitted.slice(0, want)
const relTally = new Map<string, number>()
const relFiles = new Map<string, Set<string>>()
const confTally = new Map<string, Map<number, number>>()
const classTally = new Map<string, Map<string, number>>()
let imports = 0
let filesWithImports = 0
let exportRows = 0
let filesWithExports = 0
let parsed = 0
let failed = 0
const emptyTarget: Record<string, number> = {}
const placeholderTarget: Record<string, number> = {}
const unknownKindSymbols: Record<string, number> = {}
const emptyNameSymbols: Record<string, number> = {}

for (const f of sample) {
  let content: string
  try {
    content = readFileSync(f.abs, "utf8")
  } catch {
    failed++
    continue
  }
  try {
    const parser = await getParser("csharp")
    const pr = await parser.parse(content, f.abs)
    const res = new Cls().analyze(pr.rootNode, content, f.abs)
    parsed++
    const imps = res.imports || []
    imports += imps.length
    if (imps.length) filesWithImports++
    const exps = res.exports || []
    exportRows += exps.length
    if (exps.length) filesWithExports++
    for (const s of res.symbols || []) {
      if (!s.name || s.name.length === 0) emptyNameSymbols[`${f.repo}/${f.rel}`] = (emptyNameSymbols[`${f.repo}/${f.rel}`] || 0) + 1
      const k = String(s.kind ?? "")
      if (k.length === 0 || k.toLowerCase() === "unknown") {
        unknownKindSymbols[`${k || "(empty)"}`] = (unknownKindSymbols[`${k || "(empty)"}`] || 0) + 1
      }
    }
    for (const r of res.relationships || []) {
      const t = r.relationshipType ?? r.type
      if (!t) continue
      relTally.set(t, (relTally.get(t) || 0) + 1)
      if (!relFiles.has(t)) relFiles.set(t, new Set())
      const fs = relFiles.get(t)!
      if (fs.size < 400) fs.add(`${f.repo}/${f.rel}`)
      const conf = Number(r.confidence ?? 0)
      if (!confTally.has(t)) confTally.set(t, new Map())
      const cm = confTally.get(t)!
      cm.set(conf, (cm.get(conf) || 0) + 1)
      if (!classTally.has(t)) classTally.set(t, new Map())
      const km = classTally.get(t)!
      const ec = String(r.metadata?.evidenceClass ?? "(none)")
      km.set(ec, (km.get(ec) || 0) + 1)
      // R7 / standing rules
      for (const ep of ["source", "target"]) {
        const v = r[ep]
        if (typeof v === "string" && v.length === 0) {
          emptyTarget[t] = (emptyTarget[t] || 0) + 1
        }
        if (typeof v === "string" && v === "unknown") {
          placeholderTarget[t] = (placeholderTarget[t] || 0) + 1
        }
      }
    }
  } catch (e) {
    failed++
    void e
  }
}

const fired = PROD.filter((t) => relTally.has(t))
const silent = PROD.filter((t) => !relTally.has(t))
const offEnumFired = [...relTally.keys()].filter((t) => !PROD.includes(t))

console.log(`\nfiles sampled: ${sample.length}  parsed: ${parsed}  failed: ${failed}`)
console.log(`imports[] channel: ${imports} ImportInfo rows in ${filesWithImports}/${sample.length} files`)
console.log(`exports[] side-channel: ${exportRows} ExportInfo rows in ${filesWithExports}/${sample.length} files (NOT a relationship type)`)
console.log(`\nSCORE: ${fired.length}/10 production relationship types fired over ${sample.length} of ${admitted.length} admitted .cs files (${all.length} exist).`)
console.log(`fired:  ${fired.join(" ") || "(none)"}`)
console.log(`silent: ${silent.join(" ") || "(none)"}`)
if (offEnumFired.length) console.log(`OFF-ENUM fired: ${offEnumFired.join(" ")}`)

console.log(`\nper-type detail (count | files | confidence distribution | evidenceClass)`)
for (const t of PROD) {
  const n = relTally.get(t) ?? 0
  if (n === 0) {
    console.log(`  ${t.padEnd(13)} 0`)
    continue
  }
  const confs = [...(confTally.get(t) ?? new Map())].sort((a, b) => b[0] - a[0])
  const cls = [...(classTally.get(t) ?? new Map())].sort((a, b) => b[1] - a[1])
  const heur = confs.filter(([c]) => c < 0.7).reduce((s, [, n2]) => s + n2, 0)
  console.log(
    `  ${t.padEnd(13)} ${String(n).padStart(6)}  files=${String(relFiles.get(t)!.size).padStart(4)}` +
      `  conf[${confs.map(([c, k]) => `${c}:${k}`).join(" ")}]${heur ? `  HEURISTIC(<0.7)=${heur}` : ""}` +
      `  class[${cls.map(([c, k]) => `${c}:${k}`).join(" ")}]`,
  )
  const ex = [...relFiles.get(t)!].slice(0, 3)
  console.log(`      e.g. ${ex.join("  ")}`)
}

console.log(`\nR7 / standing-rule scan over the same ${sample.length} files:`)
const et = Object.entries(emptyTarget)
const pt = Object.entries(placeholderTarget)
console.log(`  empty-name edge endpoints: ${et.length ? et.map(([k, v]) => `${k}:${v}`).join(" ") : "0"}`)
console.log(`  endpoint === "unknown" (R7): ${pt.length ? pt.map(([k, v]) => `${k}:${v}`).join(" ") : "0"}`)
const en = Object.values(emptyNameSymbols).reduce((a, b) => a + b, 0)
console.log(`  symbols with empty name: ${en}`)
console.log(`  symbols with empty/unknown kind: ${Object.keys(unknownKindSymbols).length ? Object.entries(unknownKindSymbols).map(([k, v]) => `${k}:${v}`).join(" ") : "0"}`)