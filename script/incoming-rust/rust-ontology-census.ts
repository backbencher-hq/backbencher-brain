/**
 * RUST ONTOLOGY + INCOMING CENSUS — lane INCOMING_RUST.
 *
 * ## What it answers, and why it is not source-derivation
 *
 * `ONTOLOGY-WORKSTREAM.md` Part 1 asks six questions per already-emitted
 * relationship type. Source-derivation answers the first ("is the type
 * constructible") and nothing else; `FIRING-CHECK.md` retracted a fleet-wide
 * "14 lanes at 10/10" claim on exactly that ground. This script measures
 * instead: it runs the PRODUCTION entry (`parseFile` from
 * `src/ast/pool-worker`, which is what the indexer calls) over a pinned corpus
 * and tallies what actually comes out.
 *
 * ## The incoming half — this lane's assigned direction
 *
 * Every emitted edge is walked and BOTH endpoints classified. A "resolvable"
 * endpoint is one a consumer can bind to: a name this file declares, or a
 * declared synthetic (`global`, `anonymous_impl`) that stands for a construct
 * the language does not name.
 *
 *   resolved       target names a symbol this file declares, uniquely
 *   ambiguous      target names a symbol this file declares, but 2+ of them
 *   unresolvable   target names nothing this file declares
 *   partial        source unresolvable, target resolved (or the reverse)
 *   synthetic      the endpoint is an analyzer-declared synthetic name
 *
 * An unresolvable target is then split by WHERE the name actually is, because
 * "unresolvable" is three different facts and the difference is the whole
 * point of this lane:
 *
 *   inRepo    some OTHER file of the same repository declares it — a real,
 *             stable symbol this per-file analyzer simply cannot see (the M12.44
 *             cross-file boundary)
 *   imported  THIS file's `use` list binds it — a real binding with no symbol
 *   stdish    a name Rust's own prelude/std owns (String, Vec, Option, …) —
 *             genuinely unknowable from any single file
 *   nowhere   no file in the corpus declares it and no `use` binds it
 *
 * ## The ruling half
 *
 * `overrides` is the type this lane was handed as missing. Prose is worthless
 * here — the workstream's founding case was a wrong prose justification for a
 * whole wave — so the constructs are COUNTED ON THE PARSE TREE:
 *
 *   duplicateImpls      two `impl` blocks for one nominal type (Rust's legal
 *                       "re-open the type" form, the same shape that carries
 *                       bash's `overrides` ruling)
 *   traitMethodInImpl    a trait METHOD name that an `impl` block also defines
 *                       — Rust's override in the only sense the language has
 *
 * READ-ONLY. Writes nothing.
 *
 * Run: npx tsx script/incoming-rust/rust-ontology-census.ts [--json] [--repo=ripgrep]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"
import { LANGS } from "../../script/m14/differential"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const ARGS = process.argv.slice(2)
const WANT_JSON = ARGS.includes("--json")
const REPO_FILTER = ARGS.find((a) => a.startsWith("--repo="))?.slice(7)
const LANG = (ARGS.find((a) => a.startsWith("--langs="))?.slice(8) ?? "rust").split(",")[0]
const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references", "exports",
  "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

// ---------------------------------------------------------------- corpus
interface FileRow { repo: string; dir: string; rel: string; abs: string; text: string }
const files: FileRow[] = []
for (const e of readdirSync(CR)) {
  if (REPO_FILTER && e !== REPO_FILTER) continue
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 2 * 1024 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
files.sort((a, b) => (a.repo + a.rel < b.repo + b.rel ? -1 : 1))
let totalBytes = 0
for (const f of files) totalBytes += f.text.length

// ---------------------------------------------------------------- accumulators
type Verdict = "resolved" | "ambiguous" | "unresolvable" | "partial" | "syntheticTarget"
interface Where { inRepo: number; imported: number; stdish: number; nowhere: number }
interface Acc {
  edges: number
  files: Set<string>
  verdict: Record<Verdict, number>
  srcResolved: number
  srcUnresolvable: number
  tgt: Where & { resolved: number; ambiguous: number; unresolvable: number; synthetic: number }
  /**
   * Project-scope resolution. The in-file verdict understates what the STORE can
   * do: `parallel-indexer` resolves a target by name against the WHOLE project,
   * and `brain_symbol.qualified_name` falls back to the bare name, so a name that
   * is unique across the repository joins even though no single file declares it.
   * That is the difference between "this analyzer cannot see it" and "no index
   * anywhere has it", and it is the number an incoming query actually depends on.
   */
  projUnique: number
  projAmbiguous: number
  projAbsent: number
  empties: number
  examples: Record<Verdict, string[]>
  confHist: Record<string, number>
  confUnder07: number
  evidenceClass: Record<string, number>
  unresolvableNames: Map<string, number>
  ambiguousNames: Map<string, number>
  /** why a name is declared more than once in one file — the kind multiset */
  ambigReasons: Map<string, number>
}
const acc = new Map<Type, Acc>()
for (const t of ALL_TYPES) {
  acc.set(t, {
    edges: 0, files: new Set(),
    verdict: { resolved: 0, ambiguous: 0, unresolvable: 0, partial: 0, syntheticTarget: 0 },
    srcResolved: 0, srcUnresolvable: 0,
    tgt: { resolved: 0, ambiguous: 0, unresolvable: 0, synthetic: 0, inRepo: 0, imported: 0, stdish: 0, nowhere: 0 },
    projUnique: 0, projAmbiguous: 0, projAbsent: 0,
    empties: 0,
    examples: { resolved: [], ambiguous: [], unresolvable: [], partial: [], syntheticTarget: [] },
    confHist: {}, confUnder07: 0, evidenceClass: {},
    unresolvableNames: new Map(), ambiguousNames: new Map(), ambigReasons: new Map(),
  })
}

// ---------------------------------------------------------------- pass 1 — the production run
/** repo-wide symbol names, for the project-scope half of the verdict. */
const repoNames = new Map<string, Set<string>>()
/** repo-wide DECLARATION COUNT per name — the store's uniqueness gate reads this. */
const repoDeclCounts = new Map<string, Map<string, number>>()
let symbolsTotal = 0
let emptySymbolNames = 0
const imports = { rows: 0, names: 0, namesInFile: 0, modulePaths: 0, modulePathsLocalMod: 0 }
const importPathShapes = new Map<string, number>()
let idx = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    const label = `${f.repo}/${f.rel}`
    let repoSet = repoNames.get(f.repo)
    if (!repoSet) { repoSet = new Set(); repoNames.set(f.repo, repoSet) }
    let repoDecls = repoDeclCounts.get(f.repo)
    if (!repoDecls) { repoDecls = new Map(); repoDeclCounts.set(f.repo, repoDecls) }
    const byName = new Map<string, number>()
    const kindsByName = new Map<string, string[]>()
    for (const s of r.symbols ?? []) {
      const nm = String(s?.name ?? "")
      if (!nm) { emptySymbolNames++; continue }
      byName.set(nm, (byName.get(nm) ?? 0) + 1)
      repoSet.add(nm)
      repoDecls.set(nm, (repoDecls.get(nm) ?? 0) + 1)
      const k = String(s?.kind ?? "")
      const arr = kindsByName.get(nm) ?? []
      arr.push(k)
      kindsByName.set(nm, arr)
      symbolsTotal++
    }
    const modNames = new Set(
      (r.symbols ?? []).filter((s: any) => String(s?.kind ?? "").toLowerCase().includes("module")).map((s: any) => String(s.name)),
    )
    const importedNames = new Set<string>()
    for (const im of r.imports ?? []) {
      imports.rows++
      const p = String(im?.path ?? im?.module ?? "")
      if (p) {
        imports.modulePaths++
        const head = p.split("::")[0]
        importPathShapes.set(head, (importPathShapes.get(head) ?? 0) + 1)
        if (modNames.has(p) || modNames.has(p.split("::").filter(Boolean).pop() ?? "")) imports.modulePathsLocalMod++
      }
      const nm = String(im?.name ?? "")
      if (!nm) continue
      imports.names++
      importedNames.add(nm)
      if (byName.has(nm)) imports.namesInFile++
    }
    const repoSetRef = repoNames.get(f.repo)!
    for (const rel of r.relationships ?? []) {
      const t = String(rel?.type ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      const a = acc.get(t)!
      a.edges++
      a.files.add(label)
      const src = String(rel?.source ?? "")
      const tgt = String(rel?.target ?? "")
      if (!src || !tgt) a.empties++
      const srcS = byName.get(src) ?? 0
      const tgtS = byName.get(tgt) ?? 0
      const srcSyn = src === "global" || src === "anonymous_impl" || src.startsWith("macro:")
      const tgtSyn = tgt === "global" || tgt === "anonymous_impl" || tgt.startsWith("macro:")
      const srcOk = srcSyn || srcS > 0
      let verdict: Verdict
      if (!srcOk) { a.srcUnresolvable++; verdict = "partial" }
      else a.srcResolved++
      if (tgtSyn) {
        a.tgt.synthetic++
        verdict = verdict === "partial" ? "partial" : "syntheticTarget"
      } else if (tgtS === 1) a.tgt.resolved++
      else if (tgtS > 1) {
        a.tgt.ambiguous++
        a.ambiguousNames.set(tgt, (a.ambiguousNames.get(tgt) ?? 0) + 1)
        const ks = [...new Set(kindsByName.get(tgt) ?? [])].sort().join("+")
        a.ambigReasons.set(ks, (a.ambigReasons.get(ks) ?? 0) + 1)
      }
      else {
        a.tgt.unresolvable++
        a.unresolvableNames.set(tgt, (a.unresolvableNames.get(tgt) ?? 0) + 1)
        if (repoSetRef.has(tgt)) a.tgt.inRepo++
        else if (importedNames.has(tgt)) a.tgt.imported++
        else if (STDLISH.has(tgt)) a.tgt.stdish++
        else a.tgt.nowhere++
      }
      if (verdict === undefined) verdict = "unresolvable"
      if (srcOk && !tgtSyn && tgtS === 1) verdict = "resolved"
      else if (srcOk && !tgtSyn && tgtS > 1) verdict = "ambiguous"
      else if (srcOk && !tgtSyn) verdict = "unresolvable"
      a.verdict[verdict]++
      const conf = typeof rel?.confidence === "number" ? rel.confidence : -1
      a.confHist[conf < 0 ? "absent" : String(conf)] = (a.confHist[conf < 0 ? "absent" : String(conf)] ?? 0) + 1
      if (conf >= 0 && conf < 0.7) a.confUnder07++
      const ec = String(rel?.metadata?.evidenceClass ?? "<absent>")
      a.evidenceClass[ec] = (a.evidenceClass[ec] ?? 0) + 1
      if (a.examples[verdict].length < 5) {
        a.examples[verdict].push(`${label}:${rel?.line_number ?? "?"} ${src} -[${rel?.type}]-> ${tgt}`)
      }
    }
  }
}
/**
 * Rust's own prelude/std vocabulary. A `references` target in this set is a type
 * Rust itself owns, so no single file — and no corpus — can declare it. Naming
 * the set is what separates "unknowable from this file" from "this analyzer
 * failed to look", which is the distinction the incoming lane has to make.
 */
const STDLISH = new Set([
  "String", "Vec", "Option", "Result", "Box", "Rc", "Arc", "RefCell", "Cell", "Mutex", "RwLock",
  "HashMap", "HashSet", "BTreeMap", "BTreeSet", "VecDeque", "Cow", "Path", "PathBuf", "OsStr",
  "OsString", "CStr", "CString", "Duration", "Instant", "Iterator", "IntoIterator", "From",
  "Into", "TryFrom", "TryInto", "AsRef", "AsMut", "Deref", "DerefMut", "Drop", "Fn", "FnMut",
  "FnOnce", "Send", "Sync", "Sized", "Unpin", "Copy", "Clone", "Debug", "Display", "Default",
  "Eq", "PartialEq", "Ord", "PartialOrd", "Hash", "Hasher", "Iterator", "Error", "Formatter",
  "Read", "Write", "BufRead", "Seek", "Command", "Stdio", "ExitStatus", "Output", "Input",
  "Self", "bool", "char", "str", "f32", "f64", "i8", "i16", "i32", "i64", "i128", "isize",
  "u8", "u16", "u32", "u64", "u128", "usize", "Ordering", "Weak", "Entry", "Env", "Var",
  "Layout", "AtomicUsize", "AtomicBool", "NonNull", "PhantomData", "TypeId", "LineColumn",
  "Pattern", "Regex", "Utf8Error", "ParseIntError", "ParseFloatError", "TryFromIntError",
])
await Promise.all(Array.from({ length: 6 }, () => worker()))

// ---------------------------------------------------------------- pass 2 — project-scope resolution
//
// Two passes, because the second needs every file's names and pass 1 only had
// its own. This pass asks the question an incoming query actually asks: "is the
// name this edge targets declared anywhere in this repository, and is it
// declared ONCE?" — which is exactly `parallel-indexer`'s name-only resolution
// gate (`_res_name_unique` keeps only names with `COUNT(*) = 1`), so the three
// buckets map one-to-one onto "resolves", "resolves arbitrarily" and "no row to
// join at all".
{
  let j = 0
  async function score(): Promise<void> {
    while (true) {
      const i = j++
      if (i >= files.length) return
      const f = files[i]
      let r: any
      try { r = await parseFile(f.abs, f.dir) } catch { continue }
      const decls = repoDeclCounts.get(f.repo)!
      for (const rel of r.relationships ?? []) {
        const t = String(rel?.type ?? "").toLowerCase() as Type
        if (!ALL_TYPES.includes(t)) continue
        const a = acc.get(t)!
        const tgt = String(rel?.target ?? "")
        if (!tgt || tgt === "global" || tgt === "anonymous_impl" || tgt.startsWith("macro:")) continue
        const n = decls.get(tgt) ?? 0
        if (n === 0) a.projAbsent++
        else if (n === 1) a.projUnique++
        else a.projAmbiguous++
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, () => score()))
}

// ---------------------------------------------------------------- instrument: the overrides probe
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const wasmPath = (LANGS as any)[LANG]?.wasm ?? "tree-sitter-rust.wasm"
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", wasmPath))))

const nodeTypeCounts = new Map<string, number>()
const probe = {
  duplicateImpls: { n: 0, files: new Set<string>(), examples: [] as string[] },
  traitMethodInImpl: { n: 0, files: new Set<string>(), examples: [] as string[] },
  localTraitImpl: { n: 0, files: new Set<string>(), examples: [] as string[] },
}
for (const f of files) {
  const label = `${f.repo}/${f.rel}`
  const t = parser.parse(f.text)
  if (!t) continue
  const walk = (n: any): void => {
    nodeTypeCounts.set(n.type, (nodeTypeCounts.get(n.type) ?? 0) + 1)
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(t.rootNode)

  const implsByType = new Map<string, string[]>()
  const traits = new Map<string, Set<string>>()
  const implMethods = new Map<string, Set<string>>()
  const localTraits = new Set<string>()
  const visit = (n: any): void => {
    if (n.type === "impl_item") {
      const ty = n.childForFieldName?.("type")
      const raw = ty ? String(ty.text) : ""
      const tyName = raw.replace(/^&+\s*(mut\s+)?/, "").split("<")[0].split("::").filter(Boolean).pop() ?? "<unnamed>"
      const list = implsByType.get(tyName) ?? []
      list.push(tyName)
      implsByType.set(tyName, list)
      const ms = implMethods.get(tyName) ?? new Set<string>()
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c?.type === "declaration_list") {
          for (let j = 0; j < c.namedChildCount; j++) {
            const f2 = c.namedChild(j)
            if (f2?.type === "function_item") ms.add(String(f2.childForFieldName?.("name")?.text ?? ""))
          }
        }
      }
      implMethods.set(tyName, ms)
      const tr = n.childForFieldName?.("trait")
      if (tr) {
        const leaf = String(tr.text).replace(/^&+\s*/, "").split("<")[0].split("::").filter(Boolean).pop() ?? ""
        if (localTraits.has(leaf)) {
          probe.localTraitImpl.n++
          probe.localTraitImpl.files.add(label)
          if (probe.localTraitImpl.examples.length < 5) probe.localTraitImpl.examples.push(`${label}: impl ${leaf} for ${tyName}`)
        }
      }
    } else if (n.type === "trait_item") {
      const nm = String(n.childForFieldName?.("name")?.text ?? "")
      const ms = new Set<string>()
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c?.type === "declaration_list") {
          for (let j = 0; j < c.namedChildCount; j++) {
            const f2 = c.namedChild(j)
            if (f2?.type === "function_signature_item") ms.add(String(f2.childForFieldName?.("name")?.text ?? ""))
          }
        }
      }
      traits.set(nm, ms)
      localTraits.add(nm)
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(t.rootNode)

  for (const [ty, list] of implsByType) {
    if (list.length >= 2) {
      probe.duplicateImpls.n += list.length - 1
      probe.duplicateImpls.files.add(label)
      if (probe.duplicateImpls.examples.length < 5) probe.duplicateImpls.examples.push(`${label}: impl ${ty} x${list.length}`)
    }
  }
  for (const [tn, ms] of traits) {
    for (const m of ms) {
      if (!m) continue
      for (const [ty, ims] of implMethods) {
        if (ims.has(m) && ty !== tn) {
          probe.traitMethodInImpl.n++
          probe.traitMethodInImpl.files.add(label)
          if (probe.traitMethodInImpl.examples.length < 5) probe.traitMethodInImpl.examples.push(`${label}: trait ${tn}::${m} vs impl ${ty}`)
        }
      }
    }
  }
  t.delete?.()
}

// ---------------------------------------------------------------- report
const pct = (n: number, d: number): string => (d === 0 ? "-" : `${((n / d) * 100).toFixed(1)}%`)
const top = (m: Map<string, number>, n = 8): string[] =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} x${v}`)

const report: any = {
  lang: LANG,
  repoFilter: REPO_FILTER ?? null,
  corpus: { root: CR, files: files.length, bytes: totalBytes, repos: [...new Set(files.map((f) => f.repo))] },
  symbols: { total: symbolsTotal, emptyNames: emptySymbolNames },
  imports: { ...imports, topPathHeads: top(importPathShapes, 12) },
  types: Object.fromEntries(ALL_TYPES.map((t) => {
    const a = acc.get(t)!
    return [t, {
      edges: a.edges, files: a.files.size,
      resolved: a.verdict.resolved, ambiguous: a.verdict.ambiguous,
      unresolvable: a.verdict.unresolvable, partial: a.verdict.partial, syntheticTarget: a.verdict.syntheticTarget,
      srcResolved: a.srcResolved, srcUnresolvable: a.srcUnresolvable,
      tgt: a.tgt, projectUnique: a.projUnique, projectAmbiguous: a.projAmbiguous, projectAbsent: a.projAbsent,
      emptyEndpoints: a.empties,
      confidenceUnder07: a.confUnder07, confidenceHistogram: a.confHist, evidenceClass: a.evidenceClass,
      examples: a.examples,
      topUnresolvableTargets: top(a.unresolvableNames),
      topAmbiguousTargets: top(a.ambiguousNames),
      ambiguityReasons: top(a.ambigReasons, 6),
    }]
  })),
  grammar: { distinctNodeTypes: nodeTypeCounts.size },
  overridesProbe: {
    duplicateImpls: probe.duplicateImpls.n, duplicateImplFiles: probe.duplicateImpls.files.size,
    duplicateImplExamples: probe.duplicateImpls.examples,
    traitMethodInImpl: probe.traitMethodInImpl.n, traitMethodInImplFiles: probe.traitMethodInImpl.files.size,
    traitMethodInImplExamples: probe.traitMethodInImpl.examples,
    localTraitImpl: probe.localTraitImpl.n, localTraitImplFiles: probe.localTraitImpl.files.size,
    localTraitImplExamples: probe.localTraitImpl.examples,
  },
}

if (WANT_JSON) {
  console.log(JSON.stringify(report, null, 1))
} else {
  console.log(`rust ontology + incoming census — ${report.corpus.files} files (${(totalBytes / 1024 / 1024).toFixed(2)} MB) in [${report.corpus.repos.join(", ")}]`)
  console.log(`symbols ${symbolsTotal} (${emptySymbolNames} empty names) · import rows ${imports.rows} · bound names ${imports.names} (${imports.namesInFile} resolve to a symbol this file declares) · module paths ${imports.modulePaths} (${imports.modulePathsLocalMod} name a local mod)`)
  console.log(`  import path heads: ${report.imports.topPathHeads.join(", ")}`)
  console.log(`grammar: ${report.grammar.distinctNodeTypes} distinct node types observed\n`)
  console.log(`${"type".padEnd(13)}${"edges".padStart(7)}${"files".padStart(6)}${"resolved".padStart(9)}${"ambig".padStart(7)}${"unresolv".padStart(9)}${"partial".padStart(8)}${"synth".padStart(7)}`)
  console.log("-".repeat(66))
  for (const t of ALL_TYPES) {
    const r = report.types[t]
    console.log(
      t.padEnd(13) + String(r.edges).padStart(7) + String(r.files).padStart(6) +
      String(r.resolved).padStart(9) + String(r.ambiguous).padStart(7) +
      String(r.unresolvable).padStart(9) + String(r.partial).padStart(8) + String(r.syntheticTarget).padStart(7),
    )
  }
  console.log("-".repeat(66))
  for (const t of ALL_TYPES) {
    const r = report.types[t]
    if (r.edges === 0) { console.log(`\n${t}: 0 edges / 0 files — the construct produced nothing through the production path on this corpus`); continue }
    console.log(`\n${t}: ${r.edges} edges / ${r.files} files`)
    console.log(`  source endpoint: resolves ${r.srcResolved} (${pct(r.srcResolved, r.edges)}) · unresolvable ${r.srcUnresolvable}`)
    console.log(`  target endpoint: resolves ${r.tgt.resolved} (${pct(r.tgt.resolved, r.edges)}) · ambiguous ${r.tgt.ambiguous} · unresolvable ${r.tgt.unresolvable} (${pct(r.tgt.unresolvable, r.edges)}) · synthetic ${r.tgt.synthetic}`)
    console.log(`  target at PROJECT scope (whole repo indexed): unique ${r.projectUnique} (${pct(r.projectUnique, r.edges)}) · shared ${r.projectAmbiguous} · in no repository ${r.projectAbsent} (${pct(r.projectAbsent, r.edges)})`)
    if (r.tgt.unresolvable > 0) {
      console.log(`    unresolvable target lives: another file of the repo ${r.tgt.inRepo} · this file's own use-list ${r.tgt.imported} · rust prelude/std ${r.tgt.stdish} · NOWHERE in the corpus ${r.tgt.nowhere}`)
    }
    console.log(`  confidence: ${JSON.stringify(r.confidenceHistogram)} (under 0.7: ${r.confidenceUnder07})`)
    console.log(`  evidenceClass: ${JSON.stringify(r.evidenceClass)}`)
    if (r.topUnresolvableTargets.length) console.log(`  top unresolvable targets: ${r.topUnresolvableTargets.join(", ")}`)
    if (r.topAmbiguousTargets.length) console.log(`  top ambiguous targets: ${r.topAmbiguousTargets.join(", ")}`)
    if (r.ambiguityReasons.length) console.log(`  why a target is declared twice (kind multiset): ${r.ambiguityReasons.join(", ")}`)
    for (const k of ["resolved", "ambiguous", "unresolvable", "partial", "syntheticTarget"]) {
      if (r.examples[k].length) console.log(`  ${k}: ${r.examples[k].slice(0, 2).join(" | ")}`)
    }
  }
  console.log(`\nOVERRIDES construct probe (parse tree, ${files.length} files):`)
  console.log(`  duplicate impl blocks for one type : ${probe.duplicateImpls.n} across ${probe.duplicateImpls.files.size} files  ${probe.duplicateImpls.examples.slice(0, 3).join(" | ")}`)
  console.log(`  trait method name also in an impl  : ${probe.traitMethodInImpl.n} across ${probe.traitMethodInImpl.files.size} files  ${probe.traitMethodInImpl.examples.slice(0, 3).join(" | ")}`)
  console.log(`  impl of a trait declared in-file   : ${probe.localTraitImpl.n} across ${probe.localTraitImpl.files.size} files  ${probe.localTraitImpl.examples.slice(0, 3).join(" | ")}`)
}
