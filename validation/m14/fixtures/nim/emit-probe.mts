/**
 * NIM EMIT PROBE — the smallest question with the largest consequence.
 *
 * ## Why this exists
 *
 * A completed run of `script/m14/ontology-coverage-gate.ts nim` printed
 *
 *     emitted 0/10   ruled-sound 3   FALSIFIED 0   ruled-without-justification 7
 *     EXIT=1
 *
 * with the walk line
 *
 *     walk: 6063/6063 files (100.0%)  newly walked 0, resumed 6063
 *
 * `newly walked 0` is the whole answer. `resumableWalk` keeps an APPEND-ONLY log
 * of PATHS (`validation/m14/measurements/walk-nim.txt`) and nothing else — the
 * arbiter accumulates edges in an in-memory `observed` map that is populated only
 * inside `run(i)`. When every path is already in the log, `run` is never called, so
 * `observed` is empty and the arbiter reports the union of "emits nothing" and
 * "already walked" as "emits nothing".
 *
 * That makes the 0/10 an artifact of the checkpoint, not a statement about the
 * analyzer, and the two are indistinguishable from the printed output. A reader
 * (or an agent) taking the printed table at face value concludes this lane's
 * analyzer emits nothing, which is a claim about the world with no measurement
 * behind it. The brief's own rule covers it: an empty result over a non-empty
 * corpus is a failed check, not a pass.
 *
 * ## What this measures, and the only claim it makes
 *
 * It calls the SAME production entry point (`parseFile` from `src/ast/pool-worker`)
 * over a DETERMINISTIC, STRIDE-SAMPLED, BOUNDED slice of the same corpus the
 * arbiter discovers (git ls-files, `detectLanguageFromPath`, 512 KB cap) and prints
 * the per-type edge tally. A non-zero count here is what distinguishes "the
 * analyzer emits nothing" from "the arbiter resumed a finished walk".
 *
 * It is NOT the lane census: `census.ts` is the instrument of record, over the
 * whole corpus. This is the falsifier for a specific instrument claim, and it says
 * so on every run, because a small sample that got quoted as a census is the same
 * defect in a new place.
 *
 *   node --import tsx validation/m14/fixtures/nim/emit-probe.mts [N] [stride]
 *
 * Defaults: N=40 files, stride chosen so the sample spans the whole admitted set
 * (every stride-th file), NOT the first N — a prefix would be one repo's worth of
 * shape and would answer a different question.
 *
 * READ-ONLY. Writes nothing.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "nim"

// Same admission rule as script/m14/ontology-coverage-gate.ts and census.ts.
const files: { repo: string; dir: string; rel: string; abs: string }[] = []
for (const e of execFileSync("ls", ["-1", CR], { encoding: "utf8" }).split("\n").filter(Boolean)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > 512 * 1024) continue
      if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== LANG) continue
    } catch { continue }
    files.push({ repo: e, dir, rel, abs })
  }
}

const N = Math.max(1, Number(process.argv[2] ?? 40) || 40)
const explicitStride = Number(process.argv[3] ?? 0)
const stride = explicitStride > 0 ? explicitStride : Math.max(1, Math.floor(files.length / N))
const sample = files.filter((_, i) => i % stride === 0).slice(0, N)

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const

const tally = new Map<string, number>()
const typeFiles = new Map<string, Set<string>>()
let symbols = 0
let edges = 0
let emptyKind = 0
let degraded = 0
const perRepo = new Map<string, number>()

for (const f of sample) {
  const r: any = await parseFile(f.abs, f.dir)
  const rels: any[] = r.relationships ?? []
  const syms: any[] = r.symbols ?? []
  symbols += syms.length
  if (r.degraded) degraded++
  for (const s of syms) if (!s.kind) emptyKind++
  perRepo.set(f.repo, (perRepo.get(f.repo) ?? 0) + 1)
  for (const x of rels) {
    edges++
    const t = String(x.type ?? x.relationshipType ?? "")
    tally.set(t, (tally.get(t) ?? 0) + 1)
    const set = typeFiles.get(t) ?? new Set<string>()
    if (set.size < 6) set.add(`${f.repo}/${f.rel}`)
    typeFiles.set(t, set)
  }
}

console.log(`emit-probe — ${LANG}`)
console.log(`population: ${files.length} admitted files (git ls-files, detectLanguageFromPath, 512 KB cap)`)
console.log(`sample: ${sample.length} files, stride ${stride} from index 0 — a SPREAD, not a prefix`)
console.log(`repos in sample: ${[...perRepo.entries()].map(([r, c]) => `${r}:${c}`).join(" ")}`)
console.log(`symbols ${symbols}  relationships ${edges}  degradedFiles ${degraded}  emptyKindSymbols ${emptyKind}\n`)

const inOntology = (t: string) => (ALL_TYPES as readonly string[]).includes(t)
let anyOntology = false
console.log("type                    edges   files   example")
console.log("-".repeat(96))
for (const t of ALL_TYPES) {
  const n = tally.get(t) ?? 0
  if (n > 0) anyOntology = true
  console.log(`${t.padEnd(22)} ${String(n).padStart(6)}  ${String(typeFiles.get(t)?.size ?? 0).padStart(5)}   ${[...(typeFiles.get(t) ?? [])][0] ?? "-"}`)
}
console.log("-".repeat(96))
const outside = [...tally.entries()].filter(([t]) => !inOntology(t)).sort((a, b) => b[1] - a[1])
for (const [t, n] of outside) console.log(`${t.padEnd(22)} ${String(n).padStart(6)}  ${String(typeFiles.get(t)?.size ?? 0).padStart(5)}   (outside the 10)`)
if (outside.length === 0) console.log("(no relationship type outside the ontology 10)")

const nonzero = ALL_TYPES.filter((t) => (tally.get(t) ?? 0) > 0)
console.log(`\nVERDICT: ${nonzero.length}/10 ontology types produced edges through production parseFile on this sample.`)
console.log(nonzero.length === 0
  ? "  0 means the analyzer emits nothing HERE. It does NOT license a per-type ruling on its own:\n" +
    "  a ruling needs the construct probe the arbiter runs, not an empty edge table."
  : `  ${nonzero.join(", ")}`)
console.log(`\nSCOPE: this is a ${sample.length}-file spread, not the lane census (census.ts, whole corpus).`)
process.exit(0)