/**
 * A DETERMINISTIC per-label correctness check for julia — the stable figure the rotating F5 sample
 * cannot be.
 *
 * `script/m14/differential.ts --lang julia --sample 200` ROTATES its file sample every run, so its
 * covered% and MISSING counts are a sample size rather than a result. This lane's doc has claimed a
 * "direct 40-file check" (`extends 39/39 · instantiates 27/27 · uses 98.8% · references 97.3%`) and a
 * per-label `calls` figure (97.4% covered / 8.7% unexplained) with **no committed instrument behind
 * either** — the same defect this file's predecessor had for the `&&`/`||` subsets. A published
 * number with nothing to reproduce it from is not a measurement.
 *
 * So: a fixed file list, a fixed comparison, and every per-label number printed. Both sides are
 * derived per file:
 *
 *   analyzer side — `parseFile` from src/ast/pool-worker.ts (the PRODUCTION entry point, not
 *                   `analyze()`, which skips the pipeline stages)
 *   truth side    — the lane's five tree-truth oracles in script/m14/oracles/, each an independent
 *                   derivation from julia's own rule sharing no rule table, key set or resolver with
 *                   the analyzer
 *
 * An edge is a `(from, target)` pair per label. Direction is NOT part of the key and neither is the
 * source symbol's kind, because the oracles emit bare names and a name-keyed comparison is the only
 * one both sides can answer. That makes this a LOOSER test than F5's, and the limit is stated in the
 * output rather than left for a reader to assume.
 *
 * READ-ONLY. Writes nothing. No regex: node.type and named children only, throughout.
 *
 *   npx tsx validation/m14/fixtures/julia/direct-oracle-check.ts [--files 40]
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { deriveJuliaCallsTruth } from "../../../../script/m14/oracles/julia-calls"
import { deriveJuliaContainsTruth } from "../../../../script/m14/oracles/julia-contains"
import { deriveJuliaOverridesTruth } from "../../../../script/m14/oracles/julia-overrides"
import { deriveJuliaReferencesTruth, deriveJuliaUsesTruth } from "../../../../script/m14/oracles/julia-refs"
import { deriveJuliaExtendsTruth, deriveJuliaInstantiatesTruth } from "../../../../script/m14/oracles/julia-type-edges"
import { deriveJuliaImportsTruth } from "../../../../script/m14/oracles/julia-imports"
import { deriveJuliaExportsTruth } from "../../../../script/m14/oracles/julia-exports"
import { deriveJuliaDecoratesTruth } from "../../../../script/m14/oracles/julia-decorates"
import { deriveJuliaPartOfTruth } from "../../../../script/m14/oracles/julia-part-of"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const argv = process.argv.slice(2)
const want = Number(argv[argv.indexOf("--files") + 1]) || 40
const dump = argv.includes("--dump") ? Number(argv[argv.indexOf("--dump") + 1]) || 8 : 0
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-julia.wasm"))))

// ---- the admitted population, discovered exactly as the census and the arbiter discover it, then
// SORTED so the selection is a function of the corpus and not of directory order.
const all: { label: string; abs: string; dir: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "julia") continue
    all.push({ label: `${e}/${rel}`, abs, dir })
  }
}
all.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))

/**
 * Which files to check. Evenly SPACED through the sorted population rather than the first N, because
 * the first N of a sorted corpus is one repository and one corner of it: `Aqua.jl/...` sorts before
 * `DataFrames.jl/...` and `julia/...`, so a prefix would silently exclude every project but the first.
 * Spacing is deterministic, which is the point. The printed project list is DERIVED from the draw —
 * this line used to say "all three admitted projects", a hardcoded count that was true when the
 * corpus was three repositories and silently wrong the moment ecosystem packages were cloned in.
 */
const step = all.length / want
const files: typeof all = []
for (let i = 0; i < want; i++) files.push(all[Math.min(all.length - 1, Math.floor(i * step))])

type Edge = { label: string; from: string; target: string }
const TRUTHS: { fn: (root: any) => Edge[]; label: string }[] = [
  { label: "calls", fn: deriveJuliaCallsTruth as any },
  { label: "uses", fn: deriveJuliaUsesTruth as any },
  { label: "references", fn: deriveJuliaReferencesTruth as any },
  { label: "contains", fn: deriveJuliaContainsTruth as any },
  { label: "extends", fn: deriveJuliaExtendsTruth as any },
  { label: "instantiates", fn: deriveJuliaInstantiatesTruth as any },
  { label: "imports", fn: deriveJuliaImportsTruth as any },
  { label: "exports", fn: deriveJuliaExportsTruth as any },
  { label: "decorates", fn: deriveJuliaDecoratesTruth as any },
  { label: "part_of", fn: deriveJuliaPartOfTruth as any },
  { label: "overrides", fn: deriveJuliaOverridesTruth as any },
]
const LABELS = TRUTHS.map((t) => t.label)

/**
 * THE COMPARATOR KEY, and the one asymmetry in it is deliberate and is NOT a loosening.
 *
 * A `contains` edge's analyzer-side TARGET is now the OWNER-QUALIFIED key the member symbol
 * publishes (`Counter.value`), because a bare member name collides across a project and left the
 * edge ambiguous by construction — measured 7,162 of 14,329 `contains` edges ambiguous at project
 * scope, with 0 qualifiedName aliases indexed before the change. See `memberKey` in
 * src/ast/real-julia-analyzer.ts.
 *
 * So for `contains` the qualifier is REMOVED before the comparison — exactly the prefix the
 * analyzer added (`<source>.`), and nothing else. It is the exact inverse of the analyzer's change,
 * not a heuristic about names: the oracle's own `from` must still match the analyzer's `from`, and
 * the target of a `contains` edge is by construction `<that same source>.<member>`. A name that is
 * ITSELF dotted (`Base.:(==)`) therefore still compares correctly — the prefix stripped is the
 * source, never a segment of the member name. Measured: with the qualifier left in place this
 * sample read `contains covered 0.0%`, an instrument reporting a total mismatch that the source
 * comparison had already ruled out.
 *
 * Every OTHER label is compared exactly as written, because there the analyzer publishes the bare
 * name the oracle derives: `extends`/`overrides` are also both-ends labels but their targets are
 * NOT qualified, and the four TARGET-only labels have no source comparison that would make a
 * prefix-strip well defined. Widening this set requires the analyzer to qualify that label first.
 */
const QUALIFIED_TARGET_LABELS = new Set(["contains"])
/** exact inverse of the analyzer's `<owner>.<name>` qualification: strip the owner prefix it added */
const unqualify = (owner: string, t: string): string =>
  owner && t.startsWith(owner + ".") ? t.slice(owner.length + 1) : t
/**
 * A LOCAL BINDING target is spelled `<source>\0<name>` by the analyzer so two same-named
 * parameters in different functions do not collide. The NUL is an internal key, not a name; the
 * oracle derives the bare name. Stripping the qualifier is the exact inverse of the analyzer's
 * binding step, just as `unqualify` is the inverse of the contains qualification.
 */
const unbind = (t: string): string => {
  const i = t.lastIndexOf("\0")
  return i >= 0 ? t.slice(i + 1) : t
}
/**
 * THE FIELD SEPARATOR IS NOT `|`, AND THE LANGUAGE IS WHY.
 *
 * Julia has an OPERATOR NAMED `|` — `(|)(x::Bool, y::Bool) = or_int(x, y)` in `base/bool.jl` is a
 * declaration whose NAME is the old separator — so every edge emitted from that function's body
 * carried a source that split into two fields. MEASURED on the whole population before this
 * change: `or_int` in `bool.jl` and `int.jl`, `isnothing` in `JuliaLowering/src/validation.jl`,
 * and `no_op_err` in `promotion.jl` each appeared TWICE, once as an unexplained analyzer row and
 * once as a missing truth row, because the two sides re-keyed the same edge differently around
 * the stray separator (the target-only re-key at `slice(3)` shifts by one). A key whose separator
 * occurs in a NAME cannot tell a missing edge from a mismatched key, which is the defect this
 * instrument exists to avoid.
 *
 * U+0001 is not a character a julia name can contain: it is not an identifier character, it
 * cannot appear in a `var"…"` spelling's source text, and `\.` splits on it safely.
 */
const SEP = "\u0001"
const key = (l: string, file: string, f: string, t: string) =>
  `${l}${SEP}${file}${SEP}${f}${SEP}${QUALIFIED_TARGET_LABELS.has(l) ? unqualify(f, unbind(t)) : unbind(t)}`
const truth = new Map<string, Set<string>>()
const analyzer = new Map<string, Set<string>>()
const perFileTruth = new Map<string, number>()
let unreadable = 0
let threw = 0

for (const f of files) {
  let text: string
  try { text = readFileSync(f.abs, "utf8") } catch { continue }
  const tree = parser.parse(text)
  if (!tree) { unreadable++; continue }
  for (const { fn, label } of TRUTHS) {
    let derived: Edge[] = []
    try { derived = fn(tree.rootNode) } catch { continue }
    const set = truth.get(label) ?? new Set<string>()
    for (const e of derived) set.add(key(label, f.label, e.from, e.target))
    truth.set(label, set)
    perFileTruth.set(f.label, (perFileTruth.get(f.label) ?? 0) + derived.length)
  }
  tree.delete?.()
  let r: any
  try { r = await parseFile(f.abs, f.dir) } catch { threw++; continue }
  for (const x of (r?.relationships ?? []) as any[]) {
    const t = String(x.type ?? x.relationshipType ?? "").toLowerCase()
    if (!LABELS.includes(t)) continue
    const set = analyzer.get(t) ?? new Set<string>()
    set.add(key(t, f.label, String(x.source ?? ""), String(x.target ?? "")))
    analyzer.set(t, set)
  }
}

console.log(`direct oracle check — julia`)
console.log(`population ${all.length} admitted files, ${files.length} checked, evenly spaced and SORTED (not a prefix)`)
const repoName = (d: string): string => d.split("/").filter(Boolean).pop() ?? d
const projects = [...new Set(files.map((f) => repoName(f.dir)))].sort()
console.log(`selection: every ${step.toFixed(1)}th file of the sorted population; ${projects.length} of the ${new Set(all.map((f) => repoName(f.dir))).size} admitted projects are represented — ${projects.join(", ")}`)
console.log(`first: ${files[0]!.label}`)
console.log(`last:  ${files[files.length - 1]!.label}`)
console.log(`unreadable by the grammar: ${unreadable}   parseFile threw: ${threw}\n`)

console.log("DETERMINISTIC. The same corpus gives these numbers on every run; unlike the rotating F5 sample, nothing here is a sample size.\n")

/**
 * How much of an edge each oracle can actually check, measured rather than assumed.
 *
 * Four of the seven oracles emit `from: ""` — they derive the TARGET of a `calls` / `uses` /
 * `references` / `instantiates` edge and never its enclosing scope. So for those labels the only
 * question this instrument can answer is "does the truth side agree that this file calls/uses/
 * references/constructs this NAME", and NOT "is the edge attached to the right enclosing symbol".
 * `contains`, `extends` and `overrides` populate `from`, so those are compared on both ends.
 *
 * Comparing a four-label oracle on `(from, target)` against it anyway yields 0.0% covered, because
 * `""` never equals a scope name — which is what the first run of this file did, and it read as
 * "four oracles disagree with the analyzer completely" rather than "four oracles do not model the
 * source side". So the key is chosen per label from what the oracle populates, and the VERIFIED
 * column states which end that leaves unchecked. `sourceUnverified` is the count of edges whose
 * attachment this instrument says nothing about.
 */
const bothEnds = new Map<string, boolean>()
for (const f of files) {
  let text: string
  try { text = readFileSync(f.abs, "utf8") } catch { continue }
  const tree = parser.parse(text)
  if (!tree) continue
  for (const { fn, label } of TRUTHS) {
    let derived: Edge[] = []
    try { derived = fn(tree.rootNode) } catch { continue }
    if (derived.length === 0) continue
    const anyFrom = derived.some((e) => String(e.from ?? "").trim() !== "")
    bothEnds.set(label, (bothEnds.get(label) ?? true) && anyFrom)
  }
  tree.delete?.()
}

const kBoth = (l: string, file: string, f: string, t: string) => `${l}${SEP}${file}${SEP}${f}${SEP}${t}`
const kTgt = (l: string, file: string, t: string) => `${l}${SEP}${file}${SEP}${t}`
/** Re-key both sides under whichever key this label's oracle can answer. */
const truthKeyed = new Map<string, Set<string>>()
for (const l of LABELS) {
  const s = truth.get(l) ?? new Set<string>()
  truthKeyed.set(l, bothEnds.get(l) ? s : new Set([...s].map((k) => kTgt(l, k.split(SEP)[1]!, k.split(SEP).slice(3).join(SEP)))))
}
const analyzerKeyed = new Map<string, Set<string>>()
for (const l of LABELS) {
  const s = analyzer.get(l) ?? new Set<string>()
  analyzerKeyed.set(l, bothEnds.get(l) ? s : new Set([...s].map((k) => kTgt(l, k.split(SEP)[1]!, k.split(SEP).slice(3).join(SEP)))))
}

const hdr = ["label", "verified", "truth", "analyzer", "covered", "missing", "unexplained", "covered%", "srcUnverified"]
console.log(hdr.map((h, i) => h.padEnd([16, 12, 8, 10, 9, 8, 12, 9, 15][i]!)).join(""))
console.log("-".repeat(100))
let tAll = 0
let aAll = 0
let cAll = 0
let uAll = 0
for (const l of LABELS) {
  const T = truthKeyed.get(l)!
  const A = analyzerKeyed.get(l)!
  let covered = 0
  for (const k of A) if (T.has(k)) covered++
  const unexplained = A.size - covered
  const missing = T.size - covered
  const both = bothEnds.get(l) === true
  // With no edges on either side there is nothing to verify and no evidence about which end an oracle
  // populates. Printing "TARGET only" there would be a default reading as a measurement — the same
  // "a zero that reads as a finding" shape this lane keeps catching. So say there is nothing to say.
  const verified = T.size === 0 && A.size === 0 ? "n/a" : both ? "both ends" : "TARGET only"
  tAll += T.size
  aAll += A.size
  cAll += covered
  uAll += unexplained
  const pct = A.size ? (100 * covered) / A.size : 0
  console.log(
    l.padEnd(16) +
      verified.padEnd(12) +
      String(T.size).padEnd(8) +
      String(A.size).padEnd(10) +
      String(covered).padEnd(9) +
      String(missing).padEnd(8) +
      String(unexplained).padEnd(12) +
      (A.size ? `${pct.toFixed(1)}%` : "n/a").padEnd(9) +
      (both || A.size === 0 ? "0" : String(A.size)),
  )
}
console.log("-".repeat(100))
console.log(
  "TOTAL".padEnd(16) +
    "".padEnd(12) +
    String(tAll).padEnd(8) +
    String(aAll).padEnd(10) +
    String(cAll).padEnd(9) +
    String(tAll - cAll).padEnd(8) +
    String(uAll).padEnd(12) +
    (aAll ? `${((100 * cAll) / aAll).toFixed(1)}%` : "n/a"),
)
console.log(`\noverall unexplained rate: ${aAll ? ((100 * uAll) / aAll).toFixed(1) : "0"}%`)

if (dump > 0) {
  /**
   * THE DISAGREEMENT IS CLASSIFIED BEFORE IT IS LISTED, because the two classes are different facts.
   *
   * The analyzer publishes QUALIFIED keys where an oracle publishes the name as written: a
   * `contains` member is `<owner>.<name>` and a `references` target that names a nested declaration
   * is retargeted to that declaration's own qualified key (`src/ast/real-julia-analyzer.ts`, the
   * own-key retarget). `unqualify` inverts the first for `contains`; it does NOT invert the second,
   * because the prefix is the DECLARATION's owner and not the edge's source. So a row whose target
   * differs from a truth row only in its qualifier is a KEY CONVENTION difference, while a row whose
   * LEAF differs names a different thing and is the only kind that can be an analyzer defect.
   *
   * The leaf test is `target` vs `prefix.target`: a suffix match after a dot, on the SAME file and
   * label. It is reported as a count per label and per direction, so a reader can see how much of the
   * residual is the convention and how much is not — the previous dump printed one undifferentiated
   * list, where a qualifier difference and a wrong name looked identical.
   */
  const leafOf = (t: string) => t.slice(t.lastIndexOf(".") + 1)
  for (const l of LABELS) {
    const T = truthKeyed.get(l)!
    const A = analyzerKeyed.get(l)!
    const un = [...A].filter((k) => !T.has(k))
    const mi = [...T].filter((k) => !A.has(k))
    const part = (k: string) => k.split(SEP)
    const truthLeaf = new Map<string, Set<string>>()
    for (const k of T) {
      const p = part(k)
      const key = `${p[0]}${SEP}${p[1]}${SEP}${leafOf(p[p.length - 1]!)}`
      truthLeaf.set(key, (truthLeaf.get(key) ?? new Set()).add(p[p.length - 1]!))
    }
    const analyzerLeaf = new Map<string, Set<string>>()
    for (const k of A) {
      const p = part(k)
      const key = `${p[0]}${SEP}${p[1]}${SEP}${leafOf(p[p.length - 1]!)}`
      analyzerLeaf.set(key, (analyzerLeaf.get(key) ?? new Set()).add(p[p.length - 1]!))
    }
    const sameLeaf = (k: string, other: Map<string, Set<string>>, exclude: string): boolean => {
      const p = part(k)
      const tgt = p[p.length - 1]!
      const cands = other.get(`${p[0]}${SEP}${p[1]}${SEP}${leafOf(tgt)}`)
      return !!cands && [...cands].some((x) => x !== tgt && x !== exclude)
    }
    const unQual = un.filter((k) => sameLeaf(k, truthLeaf, "")).length
    const miQual = mi.filter((k) => sameLeaf(k, analyzerLeaf, "")).length
    console.log(`\n${l} — ${un.length} unexplained, ${mi.length} missing | same-leaf-under-another-qualifier: ${unQual} unexplained, ${miQual} missing | different leaf: ${un.length - unQual} unexplained, ${mi.length - miQual} missing`)
    for (const k of un.slice(0, dump)) console.log(`  UNEXPLAINED  ${k.split(SEP).join("  ")}`)
    for (const k of mi.slice(0, dump)) console.log(`  MISSING      ${k.split(SEP).join("  ")}`)
  }
}

console.log(`\n"srcUnverified" is the honest cost of the four TARGET-only oracles: that many edges have their`)
console.log(`TARGET confirmed by an independent derivation and their SOURCE unexamined by any oracle in this repo.`)
console.log(`check with: npx tsx validation/m14/fixtures/julia/direct-oracle-check.ts --files ${want}`)