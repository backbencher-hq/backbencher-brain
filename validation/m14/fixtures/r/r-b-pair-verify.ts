/**
 * R — IS BUCKET "B" A REAL EMITTER/PUBLISHER MISMATCH?
 *
 * ## The claim under test
 *
 * `diagnose-incoming.mts` reports, for R at 600 `.R` files:
 *
 *     B  unresolved targets: 1435
 *        containing '.': 217 (15%)
 *        final segment IS a published name: 71 (33%)
 *        EDGES recoverable by fixing the name function: 568   (calls 534, uses 34)
 *        examples: "is.null" ".col" ".fn" ".unpack" ".cols" ".fns"
 *
 * "Recoverable" there means: `unresolved.filter(t => t.includes("."))` where
 * `byName.has(t.split(".").pop())` — the FINAL SEGMENT of the target is a published name. Fixing
 * it is claimed to be "one canonical name fn", mechanical and free.
 *
 * ## Why that is not safe to assume for R
 *
 * R identifiers may legally contain `.` (`is.null`, `as.data.frame`, `t.test`), and — the case
 * the examples are made of — R has a NAMING CONVENTION that a leading `.` marks an internal
 * object. So `[".col"].split(".").pop()` is `"col"`, and tidyverse really does define BOTH
 * `.col` and `col` as separate functions.
 *
 * If that is what the 71 pairs are, then "fixing the name function" does not recover 568
 * edges. It would RESOLVE 568 edges onto declarations that never mention the target: the
 * reverse walk would then attribute them, confidently, to the wrong function. That is a
 * fabricated resolution, and it is worse than the unresolved count it replaces, because an
 * unresolved target is at least visibly unresolved.
 *
 * So this file does not count the pairs. It CLASSIFIES them, by the string relation between
 * target and final segment, and it checks each class against a falsifier.
 *
 * ## The classes, and what would overturn each
 *
 *   LEADING_DOT      T = "." + F. Distinct R identifiers by R's own convention. Repairing
 *                    this by trimming the dot asserts `.col` IS `col`. Overturned by finding
 *                    a corpus pair where the SAME body is published under both spellings —
 *                    i.e. one declaration, two names.
 *   NAMESPACE        T = "pkg::F" / "pkg:::F". Names F inside `pkg`. Whether the local `F` is
 *                    the same object is a package-boundary question this corpus walk cannot
 *                    answer. Overturned by a `pkg` that IS in the corpus and whose `F` is the
 *                    same declaration.
 *   INFIX            T = "a.b" where neither half is "." + F. e.g. `is.null` with F = `null`.
 *                    Overturned when `a.b` is a declared symbol AND its snippet shows the
 *                    bare `a`/`b` are unrelated.
 *   BARE_TAIL        T = "a.b" and F = b, where the declaration of F lives in the SAME file
 *                    that emits the edge. This is the only class a single canonical name fn
 *                    could honestly fix, and even then only if the two spellings denote one
 *                    object.
 *
 * ## Reproducing
 *
 *   npx tsx validation/m14/fixtures/r/r-b-pair-verify.ts
 *   BB_R_LIMIT=600 npx tsx validation/m14/fixtures/r/r-b-pair-verify.ts
 *
 * Population is the git-tracked R files under BB_CORPUS_ROOT, admitted by
 * `detectLanguageFromPath` — the same admission as `r-ambiguity-attribution.ts`, which admits
 * BOTH `.R` and `.r`. It is NOT the `find -name '*.R'` population of `diagnose-incoming.mts`,
 * so the pair SETS are the comparable artefact here, not the totals.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIMIT = Number(process.env.BB_R_LIMIT ?? 0)
const WORKERS = 4

interface Admitted { repo: string; rel: string; abs: string }
const admitted: Admitted[] = []
for (const e of readdirSync(CR).sort()) {
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
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "r") continue
    admitted.push({ repo: e, rel, abs })
  }
}
const covered = LIMIT > 0 ? admitted.slice(0, LIMIT) : admitted
const corpusDigest = createHash("sha256").update(covered.map((c) => c.abs).sort().join("\n")).digest("hex")

interface Decl { name: string; kind: string; file: string; rel: string; snippet: string; line: number }
interface Edge { t: string; type: string; file: string; rel: string }

const decls: Decl[] = []
const edges: Edge[] = []
let done = 0, degraded = 0, failed = 0
let cursor = 0
async function worker(): Promise<void> {
  while (cursor < covered.length) {
    const f = covered[cursor++]
    let r: any
    try { r = await parseFile(f.abs, f.repo) } catch { failed++; continue }
    // THE PREDICATE WAS DEAD, and it is one of the two reasons this file's own log disagrees with
    // `r-ambiguity-attribution.txt` about `degraded`. It read `r?.metadata?.degraded || r?.degraded`,
    // and production sets NEITHER: `extractFallback` (pool-worker.ts:457) and the >5 MB early return
    // (pool-worker.ts:931) both report a degraded parse as `fallback: true`, and `grep -rn degraded
    // src/ast/*.ts` finds prose and comments only. So this counter could not return non-zero for any
    // input — including the run whose log leads with `[BB-PARSE-ERR] ... scale-hue.R | memory access
    // out of bounds` and then reports `degraded 0`. Same walk, one trap, one dead counter.
    // MEASURED: `validation/m14/fixtures/r/probe-degraded-counter.ts` runs both predicates against
    // REAL production fallback objects; the sound one reads DEGRADED, this one read clean.
    if (r?.fallback === true || r?.metadata?.fallback === true) degraded++
    for (const s of Array.isArray(r?.symbols) ? r.symbols : []) {
      decls.push({
        name: String(s?.name ?? ""), kind: String(s?.kind ?? ""),
        file: f.abs, rel: f.rel, snippet: String(s?.snippet ?? ""),
        line: Number(s?.startLine ?? 0),
      })
    }
    for (const e of Array.isArray(r?.relationships) ? r.relationships : []) {
      const t = String(e?.target ?? "")
      if (t) edges.push({ t, type: String(e?.type ?? ""), file: f.abs, rel: f.rel })
    }
    done++
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

const published = new Map<string, Decl[]>()
for (const d of decls) {
  const cur = published.get(d.name)
  if (cur) cur.push(d)
  else published.set(d.name, [d])
}

const distinctTargets = [...new Set(edges.map((e) => e.t))]
const unresolved = distinctTargets.filter((t) => !published.has(t))
const B = unresolved.filter((t) => t.includes(".") && published.has(t.split(".").pop()!))

// edge weight per B target, by type
const weight = new Map<string, Record<string, number>>()
for (const e of edges) {
  if (!B.includes(e.t)) continue
  const w = weight.get(e.t) ?? {}
  w[e.type] = (w[e.type] ?? 0) + 1
  weight.set(e.t, w)
}

type Class = "LEADING_DOT" | "NAMESPACE" | "INFIX" | "BARE_TAIL"
interface Pair {
  target: string; final: string; cls: Class
  edges: number; byType: Record<string, number>
  finalDecls: number; finalFiles: number
  /** the edge's own file also declares the final segment — the only locally checkable case */
  sameFileAsEdge: boolean
  /** the target string is ITSELF a published name in some other file (then it is a scope clash) */
  targetDeclaredSomewhere: boolean
  /** a declaration whose snippet is identical under both spellings — the one-body-two-names falsifier */
  sameBody: boolean
}
function classify(t: string, f: string, edgeFile: string): Class {
  if (t === "." + f) return "LEADING_DOT"
  if (t.includes("::")) return "NAMESPACE"
  if (f.length > 0 && published.get(f)?.some((d) => d.file === edgeFile)) return "BARE_TAIL"
  return "INFIX"
}

const pairs: Pair[] = B.map((t) => {
  const f = t.split(".").pop()!
  const w = weight.get(t) ?? {}
  const fdecls = published.get(f) ?? []
  const snips = new Set(fdecls.map((d) => d.snippet).filter((s) => s.length > 0))
  return {
    target: t, final: f, cls: classify(t, f, edges.find((e) => e.t === t)!.file),
    edges: Object.values(w).reduce((a, b) => a + b, 0), byType: w,
    finalDecls: fdecls.length, finalFiles: new Set(fdecls.map((d) => d.file)).size,
    sameFileAsEdge: fdecls.some((d) => d.file === edges.find((e) => e.t === t)!.file),
    targetDeclaredSomewhere: false,
    sameBody: snips.size === 1 && fdecls.length === 1 && fdecls[0].snippet.length > 0,
  }
})
// `targetDeclaredSomewhere`: the target is unresolved HERE only because the window
// excludes the file that declares it. Check against the whole `decls` population.
const declaredAnywhere = new Set(decls.map((d) => d.name))
for (const p of pairs) p.targetDeclaredSomewhere = declaredAnywhere.has(p.target)

pairs.sort((a, b) => b.edges - a.edges)

const totalBEdges = pairs.reduce((a, p) => a + p.edges, 0)
const byClass = new Map<Class, { pairs: number; edges: number }>()
for (const p of pairs) {
  const c = byClass.get(p.cls) ?? { pairs: 0, edges: 0 }
  c.pairs++; c.edges += p.edges
  byClass.set(p.cls, c)
}

console.log(`R — is bucket B a real emitter/publisher mismatch?`)
console.log(`population: ${covered.length} git-tracked R files, ${new Set(covered.map((c) => c.repo)).size} repositories`)
console.log(`corpus file set sha256 ${corpusDigest}`)
console.log(`files walked OK ${done}   degraded ${degraded}   parse failures ${failed}`)
console.log(`published names ${published.size}   edges ${edges.length}   distinct targets ${distinctTargets.length}`)
console.log(`unresolved targets ${unresolved.length}   of those dotted-and-final-segment-published: ${pairs.length}`)
console.log(`edges behind those ${pairs.length} targets: ${totalBEdges}`)
console.log()
console.log(`CLASS, per target string  (edges = how many edges the class carries)`)
console.log(`class          pairs  edges   share   sameFileAsEdge  targetDeclaredSomewhere`)
for (const [cls, c] of [...byClass.entries()].sort((a, b) => b[1].edges - a[1].edges)) {
  const sf = pairs.filter((p) => p.cls === cls && p.sameFileAsEdge).length
  const td = pairs.filter((p) => p.cls === cls && p.targetDeclaredSomewhere).length
  console.log(
    `${cls.padEnd(14)} ${String(c.pairs).padStart(5)} ${String(c.edges).padStart(6)} ` +
    `${String(Math.round((100 * c.edges) / totalBEdges)).padStart(5)}% ${String(sf).padStart(14)} ${String(td).padStart(25)}`,
  )
}
console.log()

const repairable = pairs.filter((p) => p.sameFileAsEdge && p.targetDeclaredSomewhere === false)
console.log(`SINGLE-CANONICAL-FN REPAIRABLE (final segment declared in the SAME FILE that emits the edge:`)
console.log(`  the two spellings are in one lexical scope, so one name fn could reconcile them honestly)`)
console.log(`  targets ${repairable.length}   edges ${repairable.reduce((a, p) => a + p.edges, 0)}`)
console.log()
console.log(`THE FALSIFIER, per class — a repair asserts the two spellings are ONE object. This counts`)
console.log(`pairs where the evidence for that is present in the corpus, i.e. where it could hold.`)
console.log(`sameBody (one declaration, one snippet, both spellings) is the only positive evidence available`)
console.log(`without executing R, so a class with sameBody 0 is NOT repairable by renaming.`)
console.log(`class          pairs  sameBody  sameFileAsEdge`)
for (const cls of [...byClass.keys()].sort()) {
  const ps = pairs.filter((p) => p.cls === cls)
  console.log(
    `${cls.padEnd(14)} ${String(ps.length).padStart(5)} ${String(ps.filter((p) => p.sameBody).length).padStart(9)} ` +
    `${String(ps.filter((p) => p.sameFileAsEdge).length).padStart(14)}`,
  )
}
console.log()
console.log(`ALL ${pairs.length} B TARGETS, with edge weight`)
for (const p of pairs) {
  console.log(
    `  ${String(p.edges).padStart(4)}  ${p.cls.padEnd(11)} ${JSON.stringify(p.target).padEnd(22)} -> ${JSON.stringify(p.final).padEnd(16)} ` +
    `finalDecls ${String(p.finalDecls).padStart(3)} in ${String(p.finalFiles).padStart(2)} file(s)  ` +
    `sameFile ${p.sameFileAsEdge ? "Y" : "n"}  targetElsewhere ${p.targetDeclaredSomewhere ? "Y" : "n"}  ` +
    `${JSON.stringify(p.byType)}`,
  )
}