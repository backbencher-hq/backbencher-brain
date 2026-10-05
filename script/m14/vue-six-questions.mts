/**
 * VUE — THE SIX QUESTIONS, per emitted relationship type, with a number on each.
 *
 * WHY A SECOND INSTRUMENT. `vue-ontology-census.ts` answers "does the label fire,
 * at what count, in which files, and do both endpoints bind" — the census's
 * resolution column joins a target against the set of NAMES any admitted file
 * publishes. That is the wrong join for two of this lane's conventions:
 *
 *   `imports`      the target is the composite `${modulePath}:${item}`, so it
 *                  never equals a symbol name and the census reports 0.0%
 *                  resolution on 4,413 edges. That is a JOIN artefact, not a
 *                  defect — and a join artefact reported as a defect is worse
 *                  than useless, because it invites a "fix" that would break the
 *                  convention. The right join splits the composite and asks
 *                  whether the LOCAL BINDING the import introduces is a symbol
 *                  this file publishes.
 *   `instantiates` the target is the tag AS WRITTEN. Vue's own component
 *                  resolution is case-insensitive-ish in practice: a template
 *                  writes `<el-button>` and the registry holds `ElButton`. Vue
 *                  documents this ("component names are case-insensitive inside
 *                  in-DOM templates") — so an unresolvable kebab target is a
 *                  real resolution question, and the census's raw answer
 *                  (12.1% corpus-wide on 2,948 edges) cannot distinguish "the
 *                  analyzer emitted a name nothing holds" from "the analyzer
 *                  emitted a name Vue resolves and the graph does not".
 *
 * So this file re-asks q5 (RESOLVED) per convention, and adds what the census
 * cannot express: q4 (LABELLED) as a confidence × metadata-shape cross-tab, and
 * q6 (CONFIDENT) as the count of heuristic edges BY the shape that makes them
 * heuristic. An aggregate histogram says "1,921 edges are below 0.7"; only the
 * cross-tab says WHICH emission site produced them, which is the thing a fix
 * has to name.
 *
 * NOTHING here is claimed from source derivation. Every number is a count taken
 * from production `parseFile` over the corpus, or from the corpus's own text.
 *
 * CLI: npx tsx script/m14/vue-six-questions.mts --repo vuejs --dir <a,b,c> [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const REPOS = (argOf("--repo", "vuejs") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const EXTRA = (argOf("--dir", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const OUT = argOf("--out")
const MAX_BYTES = 512 * 1024

const files: Array<{ repo: string; dir: string; rel: string; abs: string; text: string }> = []
const seen = new Set<string>()
const admit = (dir: string, repo: string) => {
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { return }
  for (const rel of tracked) {
    if (!rel.endsWith(".vue")) continue
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > MAX_BYTES) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "vue") continue
    if (seen.has(abs)) continue
    seen.add(abs)
    files.push({ repo, dir, rel, abs, text })
  }
}
for (const e of REPOS) admit(path.join(process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories", e), e)
for (const d of EXTRA) admit(d, path.basename(d))
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
console.log(`vue six questions — ${files.length} .vue files, repos ${[...new Set(files.map((f) => f.repo))].join(",")}`)

// ── pass 1: production parseFile, one parse per file, stripped and retained ────
type Rel = {
  t: string; s: string; g: string; conf: number; line?: number
  md: Record<string, unknown>
}
type FileOut = {
  label: string
  names: Set<string>
  /** name -> kind, for the "is this target a declaration" questions */
  kinds: Map<string, string>
  /** component (Class-kind) names this file publishes */
  comps: Set<string>
  rels: Rel[]
  /** names of symbols the file owns as component members */
  owned: Set<string>
  /** names the file's own text writes (the "declared here" denominator) */
  written: Set<string>
}
const out: FileOut[] = []
let parseFail = 0, symbolTotal = 0, relTotal = 0
{
  let i = 0
  const work = async (): Promise<void> => {
    while (true) {
      const k = i++
      if (k >= files.length) return
      const f = files[k]
      let r: any
      try { r = await parseFile(f.abs, f.dir) } catch { parseFail++; continue }
      const fo: FileOut = { label: `${f.repo}/${f.rel}`, names: new Set(), kinds: new Map(), comps: new Set(), rels: [], owned: new Set(), written: new Set() }
      for (const s of r?.symbols ?? []) {
        const n = String(s?.name ?? "")
        if (!n) continue
        fo.names.add(n)
        fo.kinds.set(n, String(s?.kind ?? ""))
        if (String(s?.kind ?? "").toLowerCase() === "class") fo.comps.add(n)
        if (s?.ownerName) fo.owned.add(n)
        symbolTotal++
      }
      for (const x of r?.relationships ?? []) {
        const t = String(x.type ?? x.relationshipType ?? "")
        fo.rels.push({
          t,
          s: String(x.source ?? ""),
          g: String(x.target ?? ""),
          conf: typeof x.confidence === "number" ? x.confidence : 1,
          line: typeof x.line_number === "number" ? x.line_number : undefined,
          md: (x.metadata ?? {}) as Record<string, unknown>,
        })
        relTotal++
      }
      // The file's own text is the "is this name written here" denominator: a
      // target the file spells but publishes no symbol for is a MISSING SYMBOL,
      // which is a different defect from a target the file never mentions.
      const lower = f.text
      for (const m of lower.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) fo.written.add(m[0])
      out.push(fo)
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => work()))
}
const corpusNames = new Set<string>()
const corpusComps = new Set<string>()
for (const fo of out) { for (const n of fo.names) corpusNames.add(n); for (const c of fo.comps) corpusComps.add(c) }
console.log(`parsed ${out.length} files (parseFail ${parseFail}) — ${symbolTotal} symbols, ${relTotal} relationships, ${corpusNames.size} distinct symbol names`)

// ── q4/q6: confidence × metadata shape, per label ─────────────────────────────
const shapeOf = (md: Record<string, unknown>): string =>
  Object.keys(md).filter((k) => k !== "evidenceClass").sort().join("+") || "(none)"
const crossTab = new Map<string, Map<string, number>>()
for (const fo of out) {
  for (const r of fo.rels) {
    let m = crossTab.get(r.t)
    if (!m) { m = new Map(); crossTab.set(r.t, m) }
    const key = `${shapeOf(r.md)} @conf=${r.conf}`
    m.set(key, (m.get(key) ?? 0) + 1)
  }
}

// ── q5 RESOLVED, per convention ───────────────────────────────────────────────
/**
 * `imports` targets are `${modulePath}:${item}` composites (this lane's own
 * convention, documented in the relationship table). The composite is the
 * MODULE-SPECIFIER fact and the local binding is the SYMBOL fact; only the
 * second can be a symbol. `modulePath` may itself contain a colon in a URL-ish
 * specifier, so the split is on the LAST colon — which is where the item is
 * written by construction, since the item is an identifier.
 */
const splitImport = (target: string): { module: string; item: string } => {
  const i = target.lastIndexOf(":")
  if (i < 0) return { module: "", item: target }
  return { module: target.slice(0, i), item: target.slice(i + 1) }
}
/**
 * Vue's own component-name resolution, as the runtime does it: a template may
 * write a component in PascalCase, camelCase or kebab-case and the compiler
 * resolves all three to the registered name. So the question "does an
 * `instantiates` target resolve" has to be asked against Vue's rule, not against
 * string equality — otherwise the measurement answers a question nobody asked.
 * The candidate set is derived from the rule, not from a guess at a naming
 * convention:
 *   kebab `el-button` -> PascalCase `ElButton` -> camelCase `elButton`
 */
const vueTagCandidates = (tag: string): string[] => {
  const out2 = [tag]
  if (!tag.includes("-")) return out2
  const pascal = tag.split("-").filter(Boolean).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("")
  out2.push(pascal)
  out2.push(pascal.charAt(0).toLowerCase() + pascal.slice(1))
  return out2
}

type Res = { n: number; srcLocal: number; tgtLocal: number; tgtCorpus: number; tgtVueResolved: number; spelledHere: number }
const res = new Map<string, Res>()
const blanks = new Map<string, Res>()
const samples = new Map<string, string[]>()
const bump = (m: Map<string, Res>, k: string, f: (r: Res) => void): void => {
  let r = m.get(k)
  if (!r) { r = { n: 0, srcLocal: 0, tgtLocal: 0, tgtCorpus: 0, tgtVueResolved: 0, spelledHere: 0 }; m.set(k, r) }
  f(r)
}
for (const fo of out) {
  for (const r of fo.rels) {
    bump(res, r.t, (x) => { x.n++ })
    if (fo.names.has(r.s) || fo.comps.has(r.s)) bump(res, r.t, (x) => { x.srcLocal++ })
    const spelled = fo.written.has(r.g) || (r.t === "imports" && fo.written.has(splitImport(r.g).item))
    if (spelled) bump(res, r.t, (x) => { x.spelledHere++ })
    if (r.t === "imports") {
      if (fo.names.has(splitImport(r.g).item)) bump(res, r.t, (x) => { x.tgtLocal++ })
      if (corpusNames.has(splitImport(r.g).item)) bump(res, r.t, (x) => { x.tgtCorpus++ })
    } else if (r.t === "instantiates") {
      if (corpusNames.has(r.g) || corpusComps.has(r.g)) bump(res, r.t, (x) => { x.tgtCorpus++ })
      const cands = vueTagCandidates(r.g)
      if (cands.some((c) => corpusComps.has(c) || corpusNames.has(c))) bump(res, r.t, (x) => { x.tgtVueResolved++ })
    } else {
      if (fo.names.has(r.g)) bump(res, r.t, (x) => { x.tgtLocal++ })
      if (corpusNames.has(r.g)) bump(res, r.t, (x) => { x.tgtCorpus++ })
    }
    const blankTarget = r.g.trim().length === 0 || r.s.trim().length === 0
    if (blankTarget) {
      bump(blanks, r.t, (x) => { x.n++ })
      let arr = samples.get(r.t)
      if (!arr) { arr = []; samples.set(r.t, arr) }
      if (arr.length < 10) arr.push(`${fo.label}: ${JSON.stringify(r.s)} -> ${JSON.stringify(r.g)}`)
    }
  }
}
const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`)

// ── the Vue-owned `extends` question: which BRANCH produced the rows ──────────
// Source derivation cannot answer "fires?" — a branch whose predicate never
// matches is dead code and every fixture can still pass. The discriminator is
// the metadata the two producers stamp on the row: the Vue Options-API branch
// writes `{isMixin, isOptionsApi}` at confidence 0.9; the JS/TS delegate writes
// `{sourceKind}` at confidence 1.0. Counting rows by that key says which
// producer actually fired on this corpus, which is the difference between "the
// type is EMITTED" and "the type is EMITTED BY THIS LANE".
const extendsByProducer = new Map<string, { n: number; files: Set<string>; examples: string[] }>()
for (const fo of out) {
  for (const r of fo.rels) {
    if (r.t !== "extends") continue
    const own = r.md.isOptionsApi === true
    const key = own ? "vue-options-api-branch" : "js-ts-delegate"
    let e = extendsByProducer.get(key)
    if (!e) { e = { n: 0, files: new Set(), examples: [] }; extendsByProducer.set(key, e) }
    e.n++
    e.files.add(fo.label)
    if (e.examples.length < 8) e.examples.push(`${fo.label}: ${r.s} -> ${r.g} (conf ${r.conf})`)
  }
}

// ── R7 on SYMBOLS: the file-stem identity, and whether the marker survives ────
// The analyzer marks a component whose identity fell back to the file stem with
// `metadata.synthesized` / `identityFromFileStem`. The m60 surface audit reads
// exactly that marker to decide whether a name the file never writes is a
// finding. So the marker has to SURVIVE the production entry — and the census
// reported `synthesized 0` against 673 such symbols, which is either "no
// component fell back" or "the marker is dropped". This counts both sides.
let stemIdentitySymbols = 0, stemIdentityMarked = 0
let declaredNameUnreadable = 0
const stemSamples: string[] = []
for (const fo of out) {
  for (const r of fo.rels) void r
}
{
  let i = 0
  const work = async (): Promise<void> => {
    while (true) {
      const k = i++
      if (k >= files.length) return
      const f = files[k]
      let r: any
      try { r = await parseFile(f.abs, f.dir) } catch { return }
      const stem = path.basename(f.rel, path.extname(f.rel))
      for (const s of r?.symbols ?? []) {
        const md = (s?.metadata ?? {}) as Record<string, unknown>
        if (String(s?.kind ?? "").toLowerCase() !== "class") continue
        if (md.isVueComponent !== true && String(s?.name ?? "") !== stem) continue
        if (!f.text.includes(stem)) {
          stemIdentitySymbols++
          if (md.synthesized === true) stemIdentityMarked++
          if (md.declaredNameUnreadable === true) declaredNameUnreadable++
          if (stemSamples.length < 12) stemSamples.push(`${f.repo}/${f.rel}: stem ${JSON.stringify(stem)} published as ${JSON.stringify(s.name)} md=${JSON.stringify(md)}`)
        }
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => work()))
}

// ── report ────────────────────────────────────────────────────────────────────
const labels = [...new Set(out.flatMap((fo) => fo.rels.map((r) => r.t)))].sort()
console.log("\n" + "=".repeat(118))
console.log("Q4/Q6 — label × metadata-shape × confidence (heuristic = conf < 0.7)")
console.log("=".repeat(118))
for (const t of labels) {
  const m = crossTab.get(t)!
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1])
  const heur = rows.filter(([k]) => Number(k.split("@conf=")[1]) < 0.7).reduce((a, [, v]) => a + v, 0)
  console.log(`\n${t}: ${rows.reduce((a, [, v]) => a + v, 0)} edges, ${heur} heuristic`)
  for (const [k, v] of rows.slice(0, 8)) console.log(`   ${String(v).padStart(6)}  ${k}`)
}
console.log("\n" + "=".repeat(118))
console.log("Q5 — RESOLVED, per convention")
console.log("=".repeat(118))
console.log(`${"label".padEnd(14)}${"edges".padStart(8)}${"srcLocal".padStart(11)}${"tgtLocal".padStart(11)}${"tgtCorpus".padStart(12)}${"tgtVueRule".padStart(12)}${"spelledHere".padStart(13)}`)
for (const t of [...new Set([...res.keys()])].sort()) {
  const r = res.get(t)!
  console.log(`${t.padEnd(14)}${String(r.n).padStart(8)}${pct(r.srcLocal, r.n).padStart(11)}${pct(r.tgtLocal, r.n).padStart(11)}${pct(r.tgtCorpus, r.n).padStart(12)}${pct(r.tgtVueResolved, r.n).padStart(12)}${pct(r.spelledHere, r.n).padStart(13)}`)
}
console.log("\n" + "=".repeat(118))
console.log("WHICH PRODUCER emitted `extends` (source derivation cannot see this)")
console.log("=".repeat(118))
for (const [k, e] of extendsByProducer) {
  console.log(`  ${k}: ${e.n} edges in ${e.files.size} files`)
  for (const x of e.examples) console.log(`     ${x}`)
}
console.log("\n" + "=".repeat(118))
console.log("R7 — the file-stem component identity and whether its marker survives production")
console.log("=".repeat(118))
console.log(`  components whose identity is a name the file never writes: ${stemIdentitySymbols}`)
console.log(`  of those, carrying metadata.synthesized through parseFile:   ${stemIdentityMarked}`)
console.log(`  carrying metadata.declaredNameUnreadable:                    ${declaredNameUnreadable}`)
for (const s of stemSamples) console.log(`     ${s}`)
const blankTotal = [...blanks.values()].reduce((a, r) => a + r.n, 0)
console.log(`\nblank/whitespace endpoints across all labels: ${blankTotal}`)
for (const [k, arr] of samples) for (const s of arr) console.log(`   ${k}: ${s}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    schemaVersion: 1,
    at: new Date().toISOString(),
    corpus: { files: files.length, repos: [...new Set(files.map((f) => f.repo))], commits: Object.fromEntries([...new Set(files.map((f) => f.dir))].map((d) => { let c = "unknown"; try { c = execFileSync("git", ["-C", d, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { } return [d, c] })) },
    runtime: { files: out.length, parseFail, symbols: symbolTotal, relationships: relTotal, distinctSymbolNames: corpusNames.size, distinctComponentNames: corpusComps.size },
    labelConfidenceCrossTab: Object.fromEntries([...crossTab.entries()].map(([k, v]) => [k, Object.fromEntries([...v.entries()].sort((a, b) => b[1] - a[1]))])),
    resolved: Object.fromEntries([...res.entries()]),
    blankEndpoints: Object.fromEntries([...blanks.entries()]),
    blankSamples: Object.fromEntries(samples),
    extendsByProducer: Object.fromEntries([...extendsByProducer.entries()].map(([k, v]) => [k, { n: v.n, files: [...v.files], examples: v.examples }])),
    stemIdentity: { symbols: stemIdentitySymbols, markedSynthesized: stemIdentityMarked, declaredNameUnreadable, samples: stemSamples },
    instrument: "production ASTEngine.parseFile via src/ast/pool-worker",
  }, null, 2))
  console.log(`\nevidence: ${OUT}`)
}
