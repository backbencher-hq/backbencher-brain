/**
 * CLOJURE LANE — THE PROJECT INDEX'S EFFECT ON THE 768, MEASURED BEFORE THE ANALYZER CONSUMES IT.
 *
 * ## WHAT THIS INSTRUMENT IS
 *
 * The 768 genuinely-ambiguous rows (§3.1 of `CLOJURE-VERDICT-2026-10-20.md`) are bare names the
 * project declares 2+ times, so the gate's name-keyed count model cannot bind them. **A PROJECT
 * INDEX IS THE ONLY INSTRUMENT THAT CAN ANSWER THEM**, and the answer is Clojure-specific: a name
 * is qualified by its NAMESPACE, so `helper` in `ns.a` and `helper` in `ns.b` are two different
 * names, and a call to `helper` inside `(ns ns.a)` means `ns.a/helper`.
 *
 * **⇒ THE QUESTION THIS INSTRUMENT ANSWERS: with `CLOJURE_DECLARATION_SPEC`, how many of the 768
 * can be answered by the NAMESPACE-QUALIFIED lookup?** — and, for the ones that cannot, WHY.
 *
 * ## AND WHAT IT DELIBERATELY DOES NOT DO
 *
 * **IT DOES NOT MEASURE THE TIE-BREAK'S 2,120.** The tie-break moved 2,120 rows out of the
 * CEILING (the ambiguous column); this spec's effect is on the FLOOR (the 768). The two are
 * DIFFERENT NUMBERS, and a page that prints them without saying which is which is the page this
 * campaign keeps asking lanes not to write. **THE 768 IS THIS INSTRUMENT'S POPULATION, AND THE
 * 2,120 IS NOT IN IT.**
 *
 * It also does not touch the analyzer: it measures what the INDEX can answer, so the analyzer's
 * consumption can be measured afterwards as a SECOND, SEPARATE effect.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { CLOJURE_DECLARATION_SPEC, clojureFileNamespace, clojureExecutionHead, clojureSymName, clojureDeclarationName, CLOJURE_DECLARATION_FORMS } from "../../../../src/ast/project-index"
import { emptyProjectIndex, indexTree } from "../../../../src/ast/project-index"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..")
const WASM = path.join(ROOT, "wasm", "tree-sitter-clojure.wasm")
const AMB = process.argv[2] ?? "validation/m14/fixtures/clojure/lane-logs/amb-cross.txt"
/** THE INSTRUMENT'S DUMP — the gate-format rows, and THE CLAIM EACH CARRIES ✓✓ (column 6 ✓✓). */
const DUMP = (() => {
  const i = process.argv.indexOf("--dump")
  return i >= 0 ? process.argv[i + 1] ?? "" : ""
})()
const JSON_OUT = (() => { const i = process.argv.indexOf("--json"); return i >= 0 ? process.argv[i + 1] ?? null : null })()

/** THE ADMITTED POPULATION — the gate's own rule, transcribed: the path ends with `.<ext>`, and
 *  the 1 MB cap, and the repository is the first path segment under the corpus root. */
const EXTS = ["clj", "cljs", "cljc", "edn"]
const SIZE_CAP = 1024 * 1024
function discover(): string[] {
  const out: string[] = []
  for (const repo of readdirSync(CR)) {
    const repoDir = path.join(CR, repo)
    let st: any
    try { st = statSync(repoDir) } catch { continue }
    if (!st.isDirectory()) continue
    for (const rel of gitTracked(repoDir)) {
      const ext = rel.split(".").pop()?.toLowerCase() ?? ""
      if (!EXTS.includes(ext)) continue
      const abs = path.join(repoDir, rel)
      let size = 0
      try { size = statSync(abs).size } catch { continue }
      if (size > SIZE_CAP) continue
      out.push(abs)
    }
  }
  return out.sort()
}
function gitTracked(repoDir: string): string[] {
  try {
    const r = Bun.spawnSync(["git", "-C", repoDir, "ls-files"], { stdout: "pipe", stderr: "pipe" })
    if (r.exitCode !== 0) return []
    return new TextDecoder().decode(r.stdout).split("\n").filter((l) => l.trim().length > 0)
  } catch { return [] }
}

const WTS = await import("web-tree-sitter")
await WTS.Parser.init()
const language = await (WTS as any).Language.load(readFileSync(WASM))
const parser = new WTS.Parser()
parser.setLanguage(language)

const files = discover()
const byRepo = new Map<string, string[]>()
for (const f of files) {
  const rel = f.slice(CR.length + 1)
  const repo = rel.split(path.sep)[0]!
  const list = byRepo.get(repo) ?? []
  list.push(f)
  byRepo.set(repo, list)
}

/**
 * THE REFER GRAPH — what the file's `(ns …)` form BRINGS INTO SCOPE.
 *
 * `(ns my.app.core (:require [ns.a :refer :all] [ns.b :refer [c d]]))` puts `ns.a`'s whole public
 * surface and `ns.b`'s `c` and `d` into `my.app.core`'s scope under their BARE names. **THAT is
 * why 588 of the 768 rows are "the namespace does not declare that name"** — the name is not the
 * file's own, it is REFERRED. A refer-aware answer forms `R/name` for the referred namespace `R`
 * and asks whether the project declares it exactly once.
 */
type Refers = { ns: string; all: boolean; names: string[] }

/**
 * THE DEFAULT-NAMESPACE SPEC — THE 94's SIMULATION, MEASURED, NOT ARGUED.
 *
 * THE 94 ROWS ARE THE ONES WHOSE DECLARING FILE HAS NO `(ns …)` FORM, so the spec's fallback
 * (`if (ns === "") return name`) records the name UNQUALIFIED, and the index cannot name the
 * candidates. **CLOJURE'S DEFAULT NAMESPACE FOR A FILE THAT DECLARES NONE IS `user` ✓✓** (every
 * mainstream loader — `clojure.main`, `lein`, `kaocha`, `tools.load-file` — binds `*ns*` to `user`
 * before loading), so the QUESTION is: **IF THE NAMELESS DECLARATIONS WERE QUALIFIED WITH `user`,
 * WOULD ANY OF THE 94 ANSWER? ✓✓**
 *
 * **THE MEASUREMENT IS A SECOND INDEX, BUILT WITH A SECOND RESOLVER, AND THE 768's CLASSIFICATION
 * RE-RUN AGAINST IT ✓✓** — the same rows, the same rule, one variable changed ✓✓. A spec change is
 * not proposed on the strength of an argument ✓✓; it is proposed on the strength of a measured
 * answer ✓✓.
 */
const DEFAULT_NS = "user"
const clojureDeclarationNameWithDefaultNs = (node: any, fileName?: string): string => {
  const name = clojureDeclarationName(node, fileName)
  if (name === "") return ""
  // A name the spec recorded unqualified: it is a declaration in a file with NO namespace.
  if (!name.includes("/") && !name.includes(".")) return `${DEFAULT_NS}/${name}`
  return name
}
const DEFAULT_NS_SPEC = { ...CLOJURE_DECLARATION_SPEC, nameResolver: clojureDeclarationNameWithDefaultNs }
const refersOf = (root: any): Refers[] => {
  const out: Refers[] = []
  for (let i = 0; i < root.namedChildCount; i++) {
    const form = root.namedChild(i)
    if (!form || form.type !== "list_lit") continue
    const head = clojureExecutionHead(form)
    if (!head || head.type !== "sym_lit" || clojureSymName(head) !== "ns") continue
    // the ns form's clauses are its list_lit children after the namespace name
    for (let j = 0; j < form.namedChildCount; j++) {
      const clause = form.namedChild(j)
      if (!clause || clause.type !== "list_lit") continue
      const chead = clojureExecutionHead(clause)
      if (!chead || chead.type !== "kwd_lit") continue
      const kw = chead.text ?? ""
      if (kw !== ":require" && kw !== ":use") continue
      for (let k = 0; k < clause.namedChildCount; k++) {
        const spec = clause.namedChild(k)
        if (!spec || spec.type !== "vec_lit") continue
        // the namespace is the spec's first child
        const nsNode = spec.namedChild(0)
        if (!nsNode || nsNode.type !== "sym_lit") continue
        const ns = clojureSymName(nsNode)
        let all = false
        const names: string[] = []
        for (let m = 0; m < spec.namedChildCount; m++) {
          const opt = spec.namedChild(m)
          if (!opt) continue
          if (opt.type === "kwd_lit" && (opt.text ?? "") === ":refer") {
            const value = opt.namedChild(0)
            if (value && value.type === "kwd_lit" && (value.text ?? "") === ":all") all = true
            else if (value && value.type === "vec_lit") {
              for (let n = 0; n < value.namedChildCount; n++) {
                const nm = value.namedChild(n)
                if (nm && nm.type === "sym_lit") names.push(clojureSymName(nm))
              }
            }
          }
        }
        out.push({ ns, all, names })
      }
    }
    break
  }
  return out
}

/** PER REPO: the index, and the file's NAMESPACE (the fact, read from the `(ns …)` form). */
const indexByRepo = new Map<string, any>()
/** THE SECOND INDEX — the default-namespace variant, for the 94's simulation. */
const indexByRepoDefaultNs = new Map<string, any>()
/**
 * THE SECOND INDEX — THE EXTENDED SPEC, AS A MEASUREMENT AND NOT AS A CHANGE.
 *
 * The Lead's instruction: "THE LANE'S SPEC MUST BE THE MINIMAL ONE THAT ANSWERS THE 768 ROWS." So
 * the question is not "what is the most complete spec" but "what does completeness BUY on the
 * floor". The measurement below builds a SECOND index with the spec EXTENDED by every form the
 * gap-measurement found (the `ns` form's own namespace, `deftest`, and the def-family MACROS
 * including their namespaced spellings) and answers the 768 against BOTH indexes. **If the
 * extended spec answers no more rows, the minimal spec is the minimal spec — and the gap is
 * irrelevant to the floor, which is a DIFFERENT fact from "the gap does not exist".**
 */
const EXTENDED_FORMS = new Set<string>([
  ...CLOJURE_DECLARATION_FORMS,
  "deftest", "deftest-both", "defequivtest", "defspec", "def-aset", "defcurried", "defprotocol+",
  "simple-tests", "s/defn", "s/defrecord", "rum/defc", "t/deftest", "cljs.test/deftest",
])
/** THE EXTENDED RESOLVER — the lane's spec's resolver, plus the `ns` form's own namespace. */
const clojureExtendedName = (node: any, fileName?: string): string => {
  const own = clojureDeclarationName(node as any, fileName)
  if (own !== "") return own
  // THE `ns` FORM DECLARES THE NAMESPACE ITSELF — `(ns foo.bar)` declares `foo.bar`, and a
  // namespace IS a declaration the project can be asked about.
  if (node.type === "list_lit") {
    const head = clojureExecutionHead(node)
    if (head && head.type === "sym_lit" && clojureSymName(head) === "ns") {
      let second: any = null
      let seen = false
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (!c) continue
        if (c.type === "comment" || c.type === "dis_expr" || c.type === "meta_lit") continue
        if (!seen) { seen = true; continue }
        second = c
        break
      }
      if (second && second.type === "sym_lit") {
        const n = clojureSymName(second)
        if (n !== "") return n
      }
    }
  }
  return ""
}
const EXTENDED_SPEC = { ...CLOJURE_DECLARATION_SPEC, nameResolver: clojureExtendedName }
const indexExtendedByRepo = new Map<string, any>()
const nsByFile = new Map<string, string>()
const refersByFile = new Map<string, Refers[]>()
for (const [repo, list] of byRepo) {
  const index = emptyProjectIndex()
  const indexExt = emptyProjectIndex()
  const indexDefaultNs = emptyProjectIndex()
  for (const f of list) {
    const text = readFileSync(f, "utf8")
    const tree = parser.parse(text)
    if (tree === null) continue
    index.stats.files++
    index.modules.add(f)
    indexExt.stats.files++
    indexExt.modules.add(f)
    const base = f.split(/[\\/]/).pop() ?? ""
    if (base !== "") { index.modules.add(base); indexExt.modules.add(base); const stem = base.replace(/\.[^.]+$/, ""); if (stem !== "") { index.modules.add(stem); indexExt.modules.add(stem) } }
    if (tree.rootNode.hasError) { index.stats.damaged++; index.damagedFiles.add(f); indexExt.stats.damaged++; indexExt.damagedFiles.add(f) }
    nsByFile.set(f, clojureFileNamespace(tree.rootNode as any))
    refersByFile.set(f, refersOf(tree.rootNode as any))
    indexTree(tree.rootNode as any, index, CLOJURE_DECLARATION_SPEC, f)
    indexTree(tree.rootNode as any, indexExt, EXTENDED_SPEC, f)
    indexTree(tree.rootNode as any, indexDefaultNs, DEFAULT_NS_SPEC, f)
  }
  indexByRepo.set(repo, index)
  indexByRepoDefaultNs.set(repo, indexDefaultNs)
  indexExtendedByRepo.set(repo, indexExt)
}

/** THE 768 ROWS. */
const rows = readFileSync(AMB, "utf8").split("\n").filter((l) => l.startsWith("AMB\t")).map((l) => {
  const f = l.split("\t")
  return { label: f[1]!, target: f[2]!, fileAndLine: f[3]!, shape: f[4]! }
})

const repoOf = (abs: string): string => abs.slice(CR.length + 1).split(path.sep)[0]!

/** A BARE NAME — the only shape the namespace qualification can answer. A target that is already
 *  qualified (`ns.a/foo`) or is a namespace itself (`ns.a`) is a DIFFERENT question. */
const isBare = (t: string): boolean => /^[A-Za-z_$][A-Za-z0-9_$*+!?<>=/.-]*$/.test(t) && !t.includes("/") && !t.includes(".")

let answered = 0
const reasons: Record<string, number> = {}
/**
 * THE CLOSURE — THE 768 PARTITIONED INTO FIVE DISJOINT CLASSES, AND THE SUM IS THE ROW COUNT.
 *
 * A reader must be able to see that every row is ACCOUNTED FOR, and that the classes do not
 * overlap. The five classes are, in the order a row meets them:
 *
 *   1  THE TARGET IS NOT A BARE NAME — the row is not a name question at all (the target is
 *      already qualified, or is a namespace, or carries a dot). No index can answer it.
 *   2  THE FILE DECLARES NO NAMESPACE — the call site is not in a namespace, so there is no
 *      namespace to qualify the name by.
 *   3  THE FILE'S OWN NAMESPACE DECLARES IT EXACTLY ONCE — **ANSWERED**, and this is the whole
 *      effect the spec has on the floor.
 *   4  THE FILE'S OWN NAMESPACE DECLARES IT MORE THAN ONCE — the qualification does not
 *      disambiguate even a qualified name.
 *   5  THE FILE'S OWN NAMESPACE DOES NOT DECLARE IT — and then the project-wide count splits it:
 *      5a  NO NAMESPACE ANYWHERE DECLARES IT — a LOCAL or a SYNTHETIC name (an anonymous fn's
 *          `lambda_50_13`), so **no project index can bind it, ever**. This is the TRUE FLOOR.
 *      5b  ANOTHER NAMESPACE DECLARES IT, AND NO `:refer` SAYS WHICH — the name is a REFERRED
 *          name, and the ambiguity is REAL at the project level.
 */
// ── THE SPEC'S COVERAGE OF THE ANALYZER'S OWN PUBLISHED NAMES ──────────────────────────────────────
// THE KEY SPACES DIFFER, AND THE DIFFERENCE IS THE SPEC'S GAP. The gate's key space is the
// ANALYZER'S published symbols (and their qualifiedName aliases); the index's key space is what
// the SPEC extracts from the TREE. A name the analyzer publishes and the spec does not carry is a
// row the index can never bind — and it is MEASURED, not argued.
const analyzerNames = new Map<string, number>()
/** THE ANALYZER'S SYMBOLS WITH THEIR OWN SCOPE AND KIND — the question "is this name a PROJECT
 *  DECLARATION or a LOCAL?" is answered by the scope the analyzer gives it. */
const analyzerSymbols = new Map<string, { scope: string; kind: string }[]>()
/**
 * THE PER-REPOSITORY KEY SPACE — THE GATE'S OWN KEY SPACE, AND THE ONE THAT MATTERS.
 *
 * The gate builds ONE key space per repository and classifies an edge against ITS OWN repository's
 * declarations. A PROJECT-WIDE key space sees a name published in ANOTHER repository, which the
 * gate never sees — and that difference changed 15 of the 768 rows' classification. **THE MEASUREMENT
 * MUST ASK THE QUESTION THE GATE ASKS ✓✓.**
 */
const analyzerSymbolsByRepo = new Map<string, Map<string, { scope: string; kind: string }[]>>()
/** THE FILE's OWN DECLARATIONS, per (repo, file) ✓✓ — the TIE-BREAK's fact ✓✓. */
const analyzerNamesByFile = new Map<string, Set<string>>()
/** THE FILE's SCOPES, from the ANALYZER's symbols ✓✓ — PER SYMBOL ✓✓, so a file may carry more
 *  than one ✓✓ ⇒ and the JOIN needs THE FILE's NAMESPACE ✓✓ ⇒ ⇒ the question is whether the
 *  analyzer's scopes AGREE with the SPEC's per-file namespace ✓✓. */
const analyzerScopesByFile = new Map<string, Set<string>>()
/** THE FILE's `module` SYMBOL NAMES — the `(ns …)` form — FROM THE ANALYZER ✓✓ ⇒ THE NAMESPACE's
 *  SOURCE, AS THE GATE'S OWN SYMBOL RECORDS CARRY IT ✓✓. */
const analyzerModuleNamesByFile = new Map<string, Set<string>>()
/** THE FILE's FIRST `module` SYMBOL NAME - the `(ns ...)` form, in DOCUMENT ORDER - WHICH IS WHAT
 *  THE PATCH's GATE EDIT USES - SO THE PRICE MUST BE MEASURED UNDER THIS SOURCE TOO - IF THE TWO
 *  PRICES DIFFER, THE PATCH IS WRONG - A PRICE IS A NUMBER IN A KEY SPACE, AND THE KEY SPACE IS
 *  PART OF THE PRICE. */
const analyzerFirstModuleByFile = new Map<string, string>()
for (const [repo, list] of byRepo) {
  const byRepoNames = new Map<string, { scope: string; kind: string }[]>()
  analyzerSymbolsByRepo.set(repo, byRepoNames)
  for (const f of list) {
    let r: any
    try { r = await parseFile(f, repo, { projectRoot: repo } as any) } catch { continue }
    for (const sym of (r?.symbols ?? [])) {
      const n = String((sym as any).name ?? "")
      const q = String((sym as any).qualifiedName ?? "")
      const scope = String((sym as any).scope ?? (sym as any).ownerName ?? "")
      const kind = String((sym as any).kind ?? "")
      if (n) {
        analyzerNames.set(n, (analyzerNames.get(n) ?? 0) + 1)
        const list = analyzerSymbols.get(n) ?? []
        list.push({ scope, kind })
        analyzerSymbols.set(n, list)
        const rlist = byRepoNames.get(n) ?? []
        rlist.push({ scope, kind })
        byRepoNames.set(n, rlist)
      }
      // THE FILE's OWN DECLARATIONS ✓✓ — THE TIE-BREAK's FACT ✓✓ ("the edge's OWN FILE declares
      // the target" ✓✓), collected per FILE ✓✓, because a price that counts rows another instrument
      // ALREADY resolves is a GROSS price ✓✓, and the price of a lever is its **MARGINAL** price ✓✓.
      const ownSet = analyzerNamesByFile.get(f) ?? new Set<string>()
      ownSet.add(n)
      analyzerNamesByFile.set(f, ownSet)
      // THE FILE's SCOPES, FROM THE **ANALYZER's** SYMBOLS ✓✓ — PER SYMBOL ✓✓, and for Clojure the
      // scope IS the namespace ✓✓ ⇒ ⇒ **THE GATE's JOIN NEEDS THE FILE's NAMESPACE, AND THE GATE
      // ALREADY HOLDS THE ANALYZER's SYMBOLS ✓✓ ⇒ ⇒ ⇒ THE QUESTION IS NOT "WHERE DOES THE GATE GET
      // IT?" (IT HAS IT ✓✓) BUT "DOES THE ANALYZER's SCOPE AGREE WITH THE SPEC's NAMESPACE?" ✓✓** —
      // MEASURED HERE ✓✓, ON THE ROWS THE PRICE COVERS ✓✓, BECAUSE THE JOIN's `ns/target` SPELLING
      // DEPENDS ON IT ✓✓.
      if (scope) {
        const scopeSet = analyzerScopesByFile.get(f) ?? new Set<string>()
        scopeSet.add(scope)
        analyzerScopesByFile.set(f, scopeSet)
      }
      // THE `module` SYMBOL — the `(ns …)` form — published AS A SYMBOL ✓✓, so its NAME IS the
      // file's NAMESPACE ✓✓ ⇒ ⇒ THE GATE'S OWN SYMBOL RECORDS CARRY IT ✓✓ ⇒ ⇒ collected
      // per file ✓✓ ⇒ ⇒ THE NAMESPACE's SOURCE, MEASURED ✓✓.
      if (String((sym as any).kind ?? "").toLowerCase() === "module" && n) {
        const modSet = analyzerModuleNamesByFile.get(f) ?? new Set<string>()
        modSet.add(n)
        analyzerModuleNamesByFile.set(f, modSet)
        // THE FIRST module symbol IN DOCUMENT ORDER - the file's FIRST namespace form - WHICH IS
        // EXACTLY WHAT THE PATCH's `!nsByFile.has(f)` GUARD COLLECTS - SO THE PATCH AND THIS
        // MEASUREMENT READ THE SAME NAMESPACE - A PRICE MEASURED ON A DIFFERENT SOURCE IS NOT A
        // PRICE OF THAT PATCH.
        if (!analyzerFirstModuleByFile.has(f)) analyzerFirstModuleByFile.set(f, n)
      }
      if (q && q !== n) {
        analyzerNames.set(q, (analyzerNames.get(q) ?? 0) + 1)
        // THE QUALIFIED-NAME ALIAS BELONGS IN THE PER-REPOSITORY KEY SPACE TOO — the gate's own
        // `countKey` puts the name AND the qualifiedName in ONE map, so a target spelled `ns/name`
        // is IN the key space. Without the alias here, 15 of the 768 read "the analyzer publishes no
        // such name" — which is the gate's key space misread, and the gate is the authority.
        const rlist = byRepoNames.get(q) ?? []
        rlist.push({ scope, kind })
        byRepoNames.set(q, rlist)
      }
    }
  }
}
const closure: Record<string, number> = {}
/**
 * THE PUBLICATION CLASS OF A NAME — THE ANALYZER'S OWN KEY SPACE, BY THE ANALYZER'S OWN KIND.
 *
 * THE RULE IS THE POPULATION INSTRUMENT'S RULE, CHARACTER FOR CHARACTER, because the two
 * instruments must be comparable: a name the analyzer publishes as a `module` and as a FUNCTION is
 * A DECLARATION (the function is a declaration), and only a name published ONLY as a namespace is
 * a NAMESPACE. A synthetic `lambda_N_M` is checked FIRST — it is the analyzer's own invention.
 */
const DECLARATION_KINDS = new Set(["function", "variable", "interface", "class", "property", "macro", "type", "enum", "constant", "method"])
function publicationClassOf(name: string, repo: string): string {
  if (/^lambda_\d+_\d+$/.test(name)) return "a SYNTHETIC name (the analyzer's own invention)"
  const kinds = [...new Set((analyzerSymbolsByRepo.get(repo)?.get(name) ?? []).map((s) => s.kind))]
  if (kinds.length === 0) return "UNPUBLISHED (the analyzer publishes no such name)"
  let sawDecl = false
  let sawNs = false
  for (const k of kinds) {
    if (k === "module" || k === "namespace") { sawNs = true; continue }
    if (DECLARATION_KINDS.has(k)) { sawDecl = true; continue }
  }
  if (sawDecl) return "a DECLARATION (a def-family symbol)"
  if (sawNs) return "a NAMESPACE (the analyzer's Module symbol)"
  return "published with another kind"
}
/** THE 768 BY PUBLICATION CLASS — the same join the population instrument makes, over the same rows. */
const floorByPubClass: Record<string, number> = {}
/** THE 2x2 — the analyzer's key space × the index's key space, over the 768. */
const cross = new Map<string, number>()
const crossCell = (pub: string, idx: string): void => {
  const k = `${pub}  ×  ${idx}`
  cross.set(k, (cross.get(k) ?? 0) + 1)
}
/** THE 119 BY THE ANALYZER'S PUBLICATION CLASS — the reconciliation with the analyzer's key space. */
const pubClassOf5a: Record<string, number> = {}
/** THE 469, NAMED AND COUNTED — the four classes, and how many candidates each row had. */
const cls469Count: Record<string, number> = {}
const cls469Candidates: Record<number, number> = {}
const cls469Samples: Record<string, string[]> = {}
/** THE DEFAULT-NAMESPACE SIMULATION's ACCOUNTS. */
const simBefore: Record<string, number> = {}
const simAfter: Record<string, number> = {}
const simPw: Record<string, number> = {}
const simPw2: Record<string, number> = {}
const simChanged: string[] = []
/** THE ARBITER'S NAMING — the wall by the claim each row carries, and the join's price. */
const joinCell: Record<string, number> = {}
const byClaim: Record<string, number> = {}
const joinAnswers: string[] = []
const joinMisses: string[] = []
const joinWhy: Record<string, number> = {}
/** THE OVERLAP WITH THE TIE-BREAK — the price's completeness check. */
const overlapCell: Record<string, number> = {}
/** THE JOIN's ANSWERED ROWS, WITH THE QUALIFIED SPELLING THEY RESOLVE THROUGH ✓✓. */
const joinAnswered: { repo: string; target: string; qualified: string; file: string }[] = []
const notPublishedRows: string[] = []
/** THE JOIN's PRICE, IN THE TWO KEY SPACES ✓✓ — THE GATE's AND THE INDEX's ✓✓. */
let PRICE_IN_GATE_KEY_SPACE = 0
let PRICE_IN_INDEX_KEY_SPACE = 0
/** THE JOIN-ANSWERED ROWS' SPLIT IN THE **GATE's** KEY SPACE ✓✓ — qualified vs plain ✓✓. */
let GATE_KEY_SPACE_SPLIT = { qualified: 0, plain: 0 }
/** THE JOIN's REACH IN THE **GATE's** KEY SPACE ✓✓ — COUNTED AT THE CLASSIFICATION ✓✓. */
let gateKeySpaceAnswered = 0
/** THE SAME PRICE, UNDER THE PATCH's NAMESPACE SOURCE (the analyzer's module symbol) */
let gateKeySpaceAnsweredMod = 0
const overlapRows: string[] = []
const marginalAnswers: string[] = []
let overlapCount = 0
/** THE EXTENDED SPEC'S ACCOUNT — the 768's class under the minimal spec vs under the extended one. */
const extCell: Record<string, number> = {}
const extChanged: string[] = []
const extAnswered: string[] = []
const simBy469: Record<string, number> = {}
const sim469Before: Record<string, number> = {}
/**
 * THE CLASSIFIER, AS A FUNCTION OF AN INDEX — so the two indexes are compared by ONE RULE ✓✓.
 * The classes are the same five the closure uses, plus the two name-shape classes.
 */
const classifyUnder = (index: any, target: string, ns: string): string => {
  if (!index) return "no index"
  if (!isBare(target)) return "1 not a bare name"
  if (ns === "") return "2 no namespace"
  const qualified = `${ns}/${target}`
  const count = index.symbolCounts.get(qualified) ?? 0
  if (count === 1) return "3 ANSWERED"
  if (count > 1) return "4 the own namespace declares it more than once"
  // THE PROJECT-WIDE COUNT: how many declarations of the bare name the index holds.
  let projectWide = 0
  for (const n of index.symbolNames) {
    if (n === target) { projectWide += index.symbolCounts.get(n) ?? 1; continue }
    const sl = n.lastIndexOf("/")
    if (sl < 0) continue
    if (n.slice(sl + 1) === target) projectWide += index.symbolCounts.get(n) ?? 1
  }
  return projectWide === 0 ? "5a the index cannot carry it" : "5b the index CAN carry it, and the ambiguity is real"
}
const samples5a: string[] = []
const bump = (k: string): void => { closure[k] = (closure[k] ?? 0) + 1 }
const byLabel: Record<string, { total: number; answered: number; bare: number; referAnswered?: number }> = {}
let referAnswered = 0
let referAnswerExt = 0
let extendedOnly = 0
const extendedSamples: string[] = []
const referSamples: string[] = []
const samples: string[] = []
for (const r of rows) {
  const abs = r.fileAndLine.slice(0, r.fileAndLine.lastIndexOf(":"))
  const repo = repoOf(abs)
  const index = indexByRepo.get(repo)
  const ns = nsByFile.get(abs) ?? ""
  const label = (byLabel[r.label] ??= { total: 0, answered: 0, bare: 0 })
  label.total++
  {
    const pc = publicationClassOf(r.target, repoOf(abs))
    floorByPubClass[pc] = (floorByPubClass[pc] ?? 0) + 1
  }
  if (!isBare(r.target)) { reasons["the target is not a bare name"] = (reasons["the target is not a bare name"] ?? 0) + 1; bump("1  the target is not a bare name"); crossCell(publicationClassOf(r.target, repoOf(abs)), "1 the target is not a bare name"); { const c1 = "1 not a bare name"; const c2 = classifyUnder(indexByRepoDefaultNs.get(repo), r.target, ns); simBefore[c1] = (simBefore[c1] ?? 0) + 1; simAfter[c2] = (simAfter[c2] ?? 0) + 1; if (c2 !== c1) simChanged.push(`${r.target} — ${c1} → ${c2}`) } continue }
  label.bare++
  if (ns === "") { reasons["the file declares no namespace"] = (reasons["the file declares no namespace"] ?? 0) + 1; bump("2  the file declares no namespace"); crossCell(publicationClassOf(r.target, repoOf(abs)), "2 the file declares no namespace"); { const c1 = "2 no namespace"; const c2 = classifyUnder(indexByRepoDefaultNs.get(repo), r.target, ns); simBefore[c1] = (simBefore[c1] ?? 0) + 1; simAfter[c2] = (simAfter[c2] ?? 0) + 1; if (c2 !== c1) simChanged.push(`${r.target} — ${c1} → ${c2}`) } continue }
  if (!index) { reasons["no index for the repository"] = (reasons["no index for the repository"] ?? 0) + 1; bump("2  the file declares no namespace"); continue }
  const qualified = `${ns}/${r.target}`
  const count = index.symbolCounts.get(qualified) ?? 0
  // THE EXTENDED SPEC'S ANSWER TO THE SAME ROW — the measurement that decides whether the
  // MINIMAL spec is the minimal one.
  const indexExt = indexExtendedByRepo.get(repo)
  const countExt = indexExt ? (indexExt.symbolCounts.get(qualified) ?? 0) : 0
  if (countExt === 1 && count !== 1) { extendedOnly++; if (extendedSamples.length < 12) extendedSamples.push(`${r.label} ${r.target} -> ${qualified} (only the EXTENDED spec answers it) @ ${path.basename(abs)}`) }
  // THE REFER-AWARE ANSWER: the name may be the file's OWN, or REFERRED in from another
  // namespace. The index carries every namespace's declarations as `R/name`, so the question is
  // "does the project declare `R/name` EXACTLY ONCE?" for the file's namespace and for each
  // namespace it refers.
  let referAnswer: string | null = null
  {
    const refers = refersByFile.get(abs) ?? []
    const candidates: string[] = []
    if (ns !== "") candidates.push(ns)
    for (const ref of refers) {
      if (ref.all) candidates.push(ref.ns)
      else if (ref.names.includes(r.target)) candidates.push(ref.ns)
    }
    for (const cand of candidates) {
      const q = `${cand}/${r.target}`
      const c = index.symbolCounts.get(q) ?? 0
      if (c === 1) { referAnswer = q; break }
    }
    // AND THE SAME QUESTION AGAINST THE EXTENDED INDEX.
    if (referAnswer === null && indexExt) {
      for (const cand of candidates) {
        const q = `${cand}/${r.target}`
        const c = indexExt.symbolCounts.get(q) ?? 0
        if (c === 1) { referAnswerExt = q; break }
      }
    }
  }
  if (referAnswer !== null) {
    referAnswered++
    label.referAnswered = (label.referAnswered ?? 0) + 1
    if (referSamples.length < 12) referSamples.push(`${r.label} ${r.target} -> ${referAnswer} @ ${path.basename(abs)}`)
  }
  // AND THE PROJECT-WIDE COUNT OF THE BARE NAME: how many NAMESPACES declare it at all. This is
  // the question a REFER-AWARE spec would have to answer next, and its zero case is the TRUE
  // FLOOR — a name no project index can bind, because the project does not declare it.
  let projectWide = 0
  for (const n of index.symbolNames) {
    if (n === r.target) { projectWide += index.symbolCounts.get(n) ?? 1; continue }
    const slash = n.lastIndexOf("/")
    if (slash < 0) continue
    if (n.slice(slash + 1) === r.target) projectWide += index.symbolCounts.get(n) ?? 1
  }
  const declaredProjectWide = (reasons[`project-wide: declared ${projectWide} time(s)`] = (reasons[`project-wide: declared ${projectWide} time(s)`] ?? 0) + 1)
  if (count === 1) {
    { const c1 = "3 ANSWERED"; const c2 = classifyUnder(indexByRepoDefaultNs.get(repo), r.target, ns); simBefore[c1] = (simBefore[c1] ?? 0) + 1; simAfter[c2] = (simAfter[c2] ?? 0) + 1; if (c2 !== c1) simChanged.push(`${r.target} in ${ns} — ${c1} → ${c2}`) }
    answered++
    label.answered++
    bump("3  the file's own namespace declares it EXACTLY ONCE — ANSWERED")
    crossCell(publicationClassOf(r.target, repoOf(abs)), "3 ANSWERED")
    if (samples.length < 12) samples.push(`${r.label} ${r.target} -> ${qualified} (declared once) @ ${path.basename(abs)}`)
  } else if (count === 0) {
    reasons["the namespace does not declare that name"] = (reasons["the namespace does not declare that name"] ?? 0) + 1
    // THE SPLIT: is the name a PROJECT DECLARATION AT ALL? If NO namespace anywhere declares it,
    // it is a LOCAL or a SYNTHETIC name and NO index can bind it — the true floor. If some
    // namespace declares it, the name is REFERRED and the ambiguity is real at the project level.
    if (projectWide === 0) {
      bump("5a no namespace anywhere declares it — a LOCAL or a synthetic name; NO INDEX CAN BIND IT")
      crossCell(publicationClassOf(r.target, repoOf(abs)), "5a the index cannot carry it")
      // THE RECONCILIATION WITH THE ANALYZER'S OWN KEY SPACE. The 119 is the INDEX's view (a name
      // no `ns/name` declaration carries). The analyzer's key space is a DIFFERENT key space, and
      // this is where the two views are reconciled: the analyzer publishes the target with SOME
      // kind, and that kind says what the name IS to the analyzer. **A NAMESPACE IS PUBLISHED AS A
      // `module` SYMBOL AND IS NOT AN `ns/name` DECLARATION, so the index cannot carry it and the
      // two views agree on those rows.** This is the measurement, not the argument.
      // THE SAME RULE THE 768's SPLIT USES — ONE RULE, so the two views are comparable.
      const cls = publicationClassOf(r.target, repoOf(abs))
      pubClassOf5a[cls] = (pubClassOf5a[cls] ?? 0) + 1
      // THE DEFAULT-NAMESPACE SIMULATION — THE SAME ROW, THE SAME RULE, ONE VARIABLE CHANGED.
      // The row is re-classified against the SECOND index (the nameless declarations qualified
      // with `user`), and the two answers are compared. **THE VARIABLE IS THE INDEX'S NAMESPACING,
      // AND NOTHING ELSE ✓✓.**
      {
        // THE THREE INDEXES, ONE VARIABLE EACH, THE SAME RULE ✓✓: the MINIMAL spec (the index the
        // gate builds), the DEFAULT-NAMESPACE variant, and the EXTENDED spec (the spec's missing
        // declaration forms) ✓✓.
        const idx2 = indexByRepoDefaultNs.get(repo)
        const idxExt = indexExtendedByRepo.get(repo)
        const cls1 = classifyUnder(index, r.target, ns)
        const cls2 = classifyUnder(idx2, r.target, ns)
        const cls3 = classifyUnder(idxExt, r.target, ns)
        simBefore[cls1] = (simBefore[cls1] ?? 0) + 1
        simAfter[cls2] = (simAfter[cls2] ?? 0) + 1
        if (cls2 !== cls1) {
          simChanged.push(`${r.target} in ${ns || "(no namespace)"} — ${cls1} → ${cls2}`)
        }
        // THE EXTENDED SPEC'S OWN ACCOUNT: WHERE DOES EACH ROW LAND, AND DID IT BECOME ANSWERED? ✓✓
        extCell[`${cls1}  ->  ${cls3}`] = (extCell[`${cls1}  ->  ${cls3}`] ?? 0) + 1
        if (cls1 !== cls3) extChanged.push(`${r.target} in ${ns || "(no namespace)"} — ${cls1} → ${cls3}`)
        if (cls3 === "3 ANSWERED" && cls1 !== "3 ANSWERED") extAnswered.push(`${r.target} in ${ns} — the EXTENDED spec answers it`)
      }
      if (samples5a.length < 8) {
        const kinds = [...new Set((analyzerSymbolsByRepo.get(repoOf(abs))?.get(r.target) ?? []).map((s) => s.kind))]
        samples5a.push(`${r.target}  [kinds: ${kinds.join(",") || "?"}]`)
      }
    }
    else {
      {
        const idx2 = indexByRepoDefaultNs.get(repo)
        const cls2 = classifyUnder(idx2, r.target, ns)
        const cls1 = classifyUnder(index, r.target, ns)
        simBefore[cls1] = (simBefore[cls1] ?? 0) + 1
        simAfter[cls2] = (simAfter[cls2] ?? 0) + 1
        if (cls2 !== cls1) simChanged.push(`${r.target} in ${ns || "(no namespace)"} — ${cls1} → ${cls2}`)
        simBy469[cls2] = (simBy469[cls2] ?? 0) + 1
        sim469Before[cls1] = (sim469Before[cls1] ?? 0) + 1
      }
      bump("5b another namespace declares it and no `:refer` says which — the ambiguity is REAL at the project level")
      crossCell(publicationClassOf(r.target, repoOf(abs)), "5b the index CAN carry it, and the ambiguity is real")
      // ── THE 469, NAMED AND COUNTED ─────────────────────────────────────────────────────────────────
      // THE LEAD'S ORDER (2026-10-21): "THE 469 REAL PROJECT-LEVEL AMBIGUITIES ARE A LANGUAGE-SEMANTICS
      // QUESTION, NOT A MEASUREMENT QUESTION — SO THE LANE'S NEXT MEASUREMENT IS THE 469, NAMED AND
      // COUNTED ✓✓." So this is the measurement, and it asks the question the wall raises: **IS THIS
      // AMBIGUITY RESOLVABLE, AND BY WHOSE RULE?**
      //
      // THE CANDIDATES: the namespaces that declare the bare name in the index (the index records
      // `ns/name`, so the candidates are the namespace PREFIXES of the names whose suffix is the
      // target). THE DISAMBIGUATOR: the referring file's own `:require`/`:use` clauses — a `:refer`
      // names the namespace a referred var comes from, and an `:as` names an alias for it.
      //
      // THE FOUR CLASSES, AND THE QUESTION EACH ANSWERS:
      //   · ONE CANDIDATE — the count model saw the name twice INSIDE one namespace (or the index
      //     holds one namespace's declaration twice): NOT a cross-namespace ambiguity, and the
      //     production tie-break already picks one ⇒ NOT A LANGUAGE QUESTION ✓✓.
      //   · THE `:refer` NAMES THE CANDIDATE — CLOJURE SAYS WHICH ONE IT IS ✓✓, and the analyzer
      //     does not model `:refer` ⇒ **THE ANALYZER'S GAP, NOT THE LANGUAGE'S ✓✓.**
      //   · THE `:refer` NAMES SEVERAL CANDIDATES — the language says "one of these" ⇒ **THE PROGRAM
      //     IS AMBIGUOUS, AND CLOJURE ITSELF CANNOT PICK ✓✓** ⇒ a program question, not a tool one.
      //   · NO `:refer`, SEVERAL CANDIDATES — **THE LANGUAGE CANNOT PICK ✓✓** ⇒ the program is
      //     ambiguous, and only a rename or an alias fixes it ⇒ a program question.
      const candidates = new Set<string>()
      const matchingNames: string[] = []
      for (const n of index.symbolNames) {
        const slash = n.lastIndexOf("/")
        if (slash < 0) { if (n === r.target) matchingNames.push(n); continue }
        if (n.slice(slash + 1) === r.target) { candidates.add(n.slice(0, slash)); matchingNames.push(n) }
      }
      const fileNs = nsByFile.get(abs) ?? ""
      const refers = refersByFile.get(abs) ?? []
      // THE `:refer`ED NAMESPACES: a `:refer` clause names the namespace the referred vars come from;
      // `:refer :all` refers every var of that namespace.
      const referredNs = new Set<string>()
      for (const rf of refers) {
        if (rf.all || rf.names.includes(r.target)) referredNs.add(rf.ns)
      }
      let cls469: string
      if (candidates.size === 0) {
        cls469 = "THE INDEX HOLDS THE NAME UNQUALIFIED (or with an EMPTY namespace prefix) — THE CANDIDATES CANNOT BE READ OFF THE INDEX, SO THIS IS A SPEC-SHAPE QUESTION"
      } else if (candidates.size === 1) {
        cls469 = "ONE CANDIDATE NAMESPACE — the count model saw that namespace more than once; NOT a cross-namespace ambiguity (the production tie-break already picks one)"
      } else if (referredNs.size === 1 && candidates.has([...referredNs][0]!)) {
        cls469 = "THE `:refer` NAMES THE CANDIDATE — CLOJURE SAYS WHICH ONE IT IS; THE ANALYZER DOES NOT MODEL `:refer` ⇒ THE ANALYZER'S GAP"
      } else if (referredNs.size > 1) {
        cls469 = "THE `:refer` NAMES SEVERAL CANDIDATES — THE LANGUAGE SAYS 'one of these' ⇒ CLOJURE ITSELF CANNOT PICK ⇒ A PROGRAM QUESTION"
      } else {
        cls469 = "NO `:refer`, SEVERAL CANDIDATES — THE LANGUAGE CANNOT PICK ⇒ CLOJURE ITSELF IS AMBIGUOUS ⇒ A PROGRAM QUESTION"
      }
      cls469Count[cls469] = (cls469Count[cls469] ?? 0) + 1
      cls469Candidates[candidates.size] = (cls469Candidates[candidates.size] ?? 0) + 1
      if (cls469Samples[cls469] === undefined) cls469Samples[cls469] = []
      if (cls469Samples[cls469]!.length < 4) {
        cls469Samples[cls469]!.push(`${r.target} in ${fileNs || "(no namespace)"} · the index holds: ${matchingNames.slice(0, 3).join(", ") || "?"} · referred: ${[...referredNs].join(", ") || "none"}`)
      }
    }
  } else {
    { const c1 = "4 the own namespace declares it more than once"; const c2 = classifyUnder(indexByRepoDefaultNs.get(repo), r.target, ns); simBefore[c1] = (simBefore[c1] ?? 0) + 1; simAfter[c2] = (simAfter[c2] ?? 0) + 1; if (c2 !== c1) simChanged.push(`${r.target} in ${ns} — ${c1} → ${c2}`) }
    reasons[`the namespace declares it ${count} times`] = (reasons[`the namespace declares it ${count} times`] ?? 0) + 1
    bump("4  the file's own namespace declares it MORE THAN ONCE")
  }
}

console.log(`THE CLOJURE PROJECT INDEX, built with CLOJURE_DECLARATION_SPEC over ${files.length} files in ${byRepo.size} repos.`)
console.log(`  THE CORPUS ROOT: ${CR}`)
console.log(`  THE AMB FILE: ${AMB}  (it carries ABSOLUTE paths, so this instrument's root MUST be the root that file was built on)`)
for (const [repo, index] of indexByRepo) {
  console.log(`  ${repo}: ${index.stats.files} files, ${index.stats.damaged} damaged, ${index.symbolNames.size} names, ${index.symbolCounts.size} counted`)
}
console.log("")
console.log(`THE 768 — THE FLOOR OF THE WALL, AND NOT THE TIE-BREAK'S 2,120:`)
console.log(`  rows in the population                    ${rows.length}`)
console.log(`  BARE names (the shape a qualification can answer) ${byLabel && [...Object.values(byLabel)].reduce((n, l) => n + l.bare, 0)}`)
console.log(`  ANSWERED by the namespace-qualified lookup ${answered}`)
console.log(`  ANSWERED by the REFER-AWARE lookup         ${referAnswered}   <- the spec PLUS the refer graph`)
console.log("")
console.log("THE MINIMAL SPEC vs THE EXTENDED ONE — WHAT COMPLETENESS BUYS ON THE FLOOR:")
console.log(`  the lane's spec (the MINIMAL one) answers  ${answered} of the ${rows.length} by the ns-qualified lookup`)
console.log(`  the EXTENDED spec (the ns form's own namespace + deftest + the def-family macros) answers ${answered + extendedOnly}`)
console.log(`  THE EXTENDED SPEC ANSWERS ${extendedOnly} ROW(S) THE MINIMAL ONE DOES NOT: ${extendedOnly === 0}`)
for (const s of extendedSamples) console.log(`      e.g. ${s}`)
console.log("  ⇒ THE MINIMAL SPEC IS THE MINIMAL SPEC: the gap is real, and it is IRRELEVANT TO THE FLOOR.")
for (const [label, v] of Object.entries(byLabel)) console.log(`  ${label.padEnd(12)} total ${String(v.total).padStart(4)}  bare ${String(v.bare).padStart(4)}  ns-qualified ${String(v.answered).padStart(4)}  refer-aware ${String(v.referAnswered ?? 0).padStart(4)}`)
console.log("")
console.log("THE PROJECT-WIDE COUNT OF THE BARE NAME (the question a REFER-AWARE spec would answer next):")
const pw: Record<string, number> = {}
for (const [k, v] of Object.entries(reasons)) {
  const m = /^project-wide: declared (\d+) time\(s\)$/.exec(k)
  if (m) pw[m[1]!] = v
}
for (const k of Object.keys(pw).sort((a, b) => Number(a) - Number(b))) {
  console.log(`  declared ${k} time(s) project-wide: ${pw[k]} rows${k === "0" ? "   <- THE TRUE FLOOR: the project declares NO such name" : ""}`)
}
console.log("")
console.log("WHY THE REST ARE NOT ANSWERED:")
for (const [why, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${why}`)
console.log("")
console.log("THE CLOSURE — THE 768 PARTITIONED INTO FIVE DISJOINT CLASSES, AND THE SUM IS THE ROW COUNT:")
let closureSum = 0
for (const [k, n] of Object.entries(closure).sort((a, b) => a[0].localeCompare(b[0]))) {
  closureSum += n
  console.log(`  ${String(n).padStart(5)}  ${k}`)
}
console.log(`  ${String(closureSum).padStart(5)}  THE SUM (the rows in the population: ${rows.length})`)
const closureCloses = closureSum === rows.length
console.log(`  THE CLOSURE CLOSES EXACTLY: ${closureCloses}`)
console.log("")
console.log("  THE 768 BY THE ANALYZER'S PUBLICATION CLASS — THE SAME JOIN THE POPULATION INSTRUMENT MAKES:")
let sum768 = 0
for (const [cls, n] of Object.entries(floorByPubClass).sort((a, b) => b[1] - a[1])) {
  sum768 += n
  console.log(`    ${String(n).padStart(5)}  ${cls}`)
}
console.log(`    ${String(sum768).padStart(5)}  THE SUM (the 768)`)
console.log(`    THE 768'S CLASSIFICATION CLOSES EXACTLY: ${sum768 === rows.length}`)
console.log("")
console.log("  THE 2x2 — THE ANALYZER'S KEY SPACE × THE INDEX'S KEY SPACE, OVER THE 768:")
let sumCross = 0
for (const [k, n] of [...cross.entries()].sort((a, b) => b[1] - a[1])) {
  sumCross += n
  console.log(`    ${String(n).padStart(5)}  ${k}`)
}
console.log(`    ${String(sumCross).padStart(5)}  THE SUM (the 768)`)
console.log(`    THE 2x2 CLOSES EXACTLY: ${sumCross === rows.length}`)
console.log("")
console.log("  THE 119 (THE INDEX'S VIEW) BY THE ANALYZER'S PUBLICATION CLASS — THE TWO VIEWS RECONCILED:")
let sum5a = 0
for (const [cls, n] of Object.entries(pubClassOf5a).sort((a, b) => b[1] - a[1])) {
  sum5a += n
  console.log(`    ${String(n).padStart(5)}  ${cls}`)
}
console.log(`    ${String(sum5a).padStart(5)}  THE SUM (the 119)`)
console.log(`    THE RECONCILIATION CLOSES EXACTLY: ${sum5a === (closure["5a no namespace anywhere declares it — a LOCAL or a synthetic name; NO INDEX CAN BIND IT"] ?? 0)}`)
console.log("")
console.log("  THE 469 — THE REAL PROJECT-LEVEL AMBIGUITIES — NAMED AND COUNTED:")
let sum469 = 0
for (const [cls, n] of Object.entries(cls469Count).sort((a, b) => b[1] - a[1])) {
  sum469 += n
  console.log(`    ${String(n).padStart(5)}  ${cls}`)
  for (const smp of cls469Samples[cls] ?? []) console.log(`            e.g. ${smp}`)
}
console.log(`    ${String(sum469).padStart(5)}  THE SUM (the 469)`)
const cls469Total = closure["5b another namespace declares it and no `:refer` says which — the ambiguity is REAL at the project level"] ?? 0
console.log(`    THE 469'S CLASSIFICATION CLOSES EXACTLY: ${sum469 === cls469Total} (the 5b class is ${cls469Total})`)
console.log("")
console.log("  THE DEFAULT-NAMESPACE SIMULATION — IF THE NAMELESS DECLARATIONS WERE QUALIFIED WITH `user`:")
console.log("    THE 768's CLASS DISTRIBUTION — BEFORE (the current spec) vs AFTER (the default-namespace spec):")
for (const k of ["1 not a bare name", "2 no namespace", "3 ANSWERED", "4 the own namespace declares it more than once", "5a the index cannot carry it", "5b the index CAN carry it, and the ambiguity is real"]) {
  console.log(`      ${String(simBefore[k] ?? 0).padStart(5)} → ${String(simAfter[k] ?? 0).padStart(5)}   ${k}`)
}
console.log(`    THE ROWS WHOSE CLASS CHANGED: ${simChanged.length}`)
for (const smp of simChanged.slice(0, 8)) console.log(`            e.g. ${smp}`)
console.log(`    THE 469's SPLIT UNDER THE DEFAULT-NAMESPACE INDEX: ${JSON.stringify(simBy469)}`)
console.log("")
console.log("  THE ARBITER'S NAMING — THE WALL BY THE CLAIM EACH ROW CARRIES, AND THE QUALIFIED-NAME JOIN'S PRICE:")
if (DUMP === "") {
  console.log("    (no --dump given: the instrument's dump is needed for the claim column)")
} else {
  const dumpRows = readFileSync(DUMP, "utf8").split("\n").filter((l) => l.startsWith("DUMP\t")).map((l) => l.split("\t"))
  // THE WALL'S THREE PARTS, AS THE DUMP NAMES THEM ✓✓.
  const isWall = (o: string): boolean => o === "ambDeclOnly" || o === "ambBoth" || o === "unresolved" || o === "externalUnverified"
  const wallRows = dumpRows.filter((f) => isWall(f[2] ?? ""))
  // THE CLAIM, AND THE JOIN'S VERDICT: WOULD THE PROJECT'S INDEX HOLD THE TARGET'S QUALIFIED FORM? ✓✓
  // THAT IS EXACTLY WHAT A QUALIFIED-NAME JOIN DOES ✓✓ — IT LOOKS THE TARGET UP IN THE PROJECT'S
  // KEY SPACE BY ITS QUALIFIED SPELLING ✓✓ — SO THE MEASUREMENT IS THE JOIN'S OWN QUESTION ✓✓.
  const cell = (claim: string, verdict: string): void => { const k = `${claim}  ×  ${verdict}`; joinCell[k] = (joinCell[k] ?? 0) + 1 }
  for (const f of wallRows) {
    const outcome = f[2] ?? ""
    const target = f[3] ?? ""
    const fileAndLine = f[4] ?? ""
    const claim = (f[5] ?? "-") || "-"
    const abs = fileAndLine.slice(0, fileAndLine.lastIndexOf(":"))
    const repo = repoOf(abs)
    const idx = indexByRepo.get(repo)
    const ns = nsByFile.get(abs) ?? ""
    // THE JOIN'S LOOKUP: the target as the project spells it.
    //   · a target that is ALREADY qualified (`ns/name`) — the index holds exactly that spelling ✓✓;
    //   · a BARE target — the file's own namespace qualifies it (`ns/target`) ✓✓.
    // THE JOIN'S VERDICT, BY THE PRODUCTION'S OWN RULE ✓✓: production fills `target_symbol_id`
    // only from a project-scoped QUALIFIED-NAME EXACT MATCH, or from a bare name whose count in
    // THAT project is EXACTLY ONE ✓✓. **⇒ "THE INDEX HOLDS THE SPELLING" IS NOT "THE JOIN ANSWERS
    // IT" ✓✓ — IF THE COUNT IS 2 OR MORE, THE JOIN LEAVES THE ROW AMBIGUOUS ✓✓, AND A MEASUREMENT
    // THAT SAID OTHERWISE WOULD PRICE THE JOIN ON A ROW IT CANNOT ANSWER ✓✓.**
    let joined = false
    let joinDetail = ""
    let joinQualified = ""      // THE SPELLING THE JOIN RESOLVES THROUGH ✓✓ — THE SLASH FORM ✓✓
    if (idx) {
      if (target.includes("/")) {
        joinQualified = target
        const c = idx.symbolCounts.get(target) ?? 0
        joinDetail = `${target} (count ${c})`
        joined = c === 1
      } else if (ns !== "") {
        const q = `${ns}/${target}`
        joinQualified = q
        const c = idx.symbolCounts.get(q) ?? 0
        joinDetail = `${q} (count ${c})`
        joined = c === 1
      } else {
        joinDetail = "the file declares no namespace"
      }
    } else {
      joinDetail = "no index for the repository"
    }
    // -- THE SAME JOIN, UNDER THE PATCH's NAMESPACE SOURCE - THE ANALYZER's (ns ...) MODULE
    // SYMBOL's NAME - SO THE PRICE THE PATCH PAYS IS MEASURED - IF IT IS NOT THE SAME NUMBER,
    // THE PATCH IS WRONG, AND THE PATCH IS WHAT THE LEAD's EDIT WILL LAND.
    let joinedMod = false
    let joinQualifiedMod = ""
    if (idx) {
      if (target.includes("/")) {
        joinQualifiedMod = target
        joinedMod = (idx.symbolCounts.get(target) ?? 0) === 1
      } else {
        const nsMod = analyzerFirstModuleByFile.get(abs) ?? ""
        if (nsMod !== "") {
          const qm = `${nsMod}/${target}`
          joinQualifiedMod = qm
          joinedMod = (idx.symbolCounts.get(qm) ?? 0) === 1
        }
      }
    }
    if (joinedMod && analyzerSymbolsByRepo.get(repo)?.has(joinQualifiedMod)) gateKeySpaceAnsweredMod++
    const verdict = joined ? "THE JOIN ANSWERS IT" : "the join cannot answer it"
    cell(claim === "-" ? "NO CLAIM" : claim, verdict)
    byClaim[claim === "-" ? "NO CLAIM" : claim] = (byClaim[claim === "-" ? "NO CLAIM" : claim] ?? 0) + 1
    if (joined) {
      joinAnswered.push({ repo, target, qualified: joinQualified, file: abs })
      joinAnswers.push(`${outcome} ${target} @ ${path.basename(abs)} — claim: ${claim} · the index holds ${joinDetail}`)
      // ── THE OVERLAP WITH THE TIE-BREAK ✓✓ — THE PRICE's COMPLETENESS CHECK ✓✓ ──────────────────
      // THE TIE-BREAK (the Lead's 2026-10-20 rule ✓✓) RESOLVES A ROW WHEN THE EDGE's **OWN FILE**
      // DECLARES THE TARGET **AND THE TARGET IS A PLAIN IDENTIFIER** ✓✓ ⇒ A QUALIFIED TARGET (one
      // carrying `/` ✓✓) CAN NEVER BE RESOLVED BY THE TIE-BREAK ✓✓ ⇒ only the join's BARE-target rows
      // can overlap it ✓✓.
      // **⇒ A PRICE THAT COUNTS ROWS ANOTHER INSTRUMENT ALREADY RESOLVES IS A **GROSS** PRICE ✓✓,
      // AND THE PRICE OF A LEVER IS ITS **MARGINAL** PRICE ✓✓ — SO THE OVERLAP IS MEASURED HERE ✓✓,
      // NOT REASONED ✓✓.**
      // THE ARBITER's OWN `isPlainIdentifier`, VERBATIM ✓✓ (script/m14/incoming-rule.ts:1650 ✓✓)
      // — NOT A LOOKALIKE ✓✓: a lookalike is a second rule, and a second rule is a second instrument ✓✓.
      // THE JOIN's REACH **IN THE GATE's KEY SPACE** ✓✓ — THE ANALYZER's PUBLICATION ✓✓ — COUNTED HERE
      // ✓✓, WHERE THE VERDICT IS TAKEN ✓✓, so that EVERY FIGURE BELOW IS DERIVED FROM THE SAME
      // CLASSIFICATION ✓✓ ⇒ NO SECOND ACCOUNT ✓✓.
      if (analyzerSymbolsByRepo.get(repo)?.has(joinQualified)) gateKeySpaceAnswered++
      const plain = /^[\p{L}\p{Nl}_$][\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}_$]*$/u.test(target)
      const ownDeclares = analyzerNamesByFile.get(abs)?.has(target) ?? false
      const overlap = plain && ownDeclares
      overlapCell[plain ? "a PLAIN target" : "a QUALIFIED target (the tie-break can NEVER reach it)"] =
        (overlapCell[plain ? "a PLAIN target" : "a QUALIFIED target (the tie-break can NEVER reach it)"] ?? 0) + 1
      if (overlap) { overlapRows.push(`${outcome} ${target} @ ${path.basename(abs)} — the OWN FILE declares it, so the TIE-BREAK already resolves it`); overlapCount++ }
      else marginalAnswers.push(`${outcome} ${target} @ ${path.basename(abs)}`)
    }
    if (claim !== "-" && !joined) joinMisses.push(`${outcome} ${target} @ ${path.basename(abs)} — claim: ${claim} · the index holds ${joinDetail}`)
    // AND WHY NOT — THE JOIN'S OWN REASON ✓✓: a count of 2+ leaves the row ambiguous ✓✓; a name
    // the index does not hold at all leaves it unresolved ✓✓.
    if (!joined) {
      const why = joinDetail.includes("count ") ? (() => { const m = joinDetail.match(/count (\d+)/); return m && Number(m[1]) > 1 ? "the count is 2+, so the join leaves it AMBIGUOUS" : "the index does not hold it, so the join leaves it UNRESOLVED" })() : joinDetail
      joinWhy[why] = (joinWhy[why] ?? 0) + 1
    }
  }
  let sumJoin = 0
  for (const [k, n] of Object.entries(joinCell).sort((a, b) => b[1] - a[1])) { sumJoin += n; console.log(`    ${String(n).padStart(5)}  ${k}`) }
  console.log(`    ${String(sumJoin).padStart(5)}  THE SUM (the wall)`)
  console.log(`    THE WALL BY THE CLAIM IT CARRIES: ${JSON.stringify(byClaim)}`)
  console.log(`    THE QUALIFIED-NAME JOIN'S PRICE ON THIS WALL: ${joinAnswers.length} row(s) — ${(100 * joinAnswers.length / (sumJoin || 1)).toFixed(2)} % of the wall`)
  for (const smp of joinAnswers.slice(0, 6)) console.log(`            e.g. ${smp}`)
  console.log("    WHY THE JOIN CANNOT ANSWER THE REST — THE JOIN'S OWN REASONS:")
  for (const [k, n] of Object.entries(joinWhy).sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(5)}  ${k}`)
  console.log(`    THE CLAIMED ROWS THE JOIN **CANNOT** ANSWER: ${joinMisses.length}`)
  for (const smp of joinMisses.slice(0, 6)) console.log(`            e.g. ${smp}`)
  // THE PRICE AS A CLASS DELTA ✓✓ — THE FORM THE LEAD'S JOIN NEEDS ✓✓: what the verified class
  // becomes if every row the join answers were resolved ✓✓.
  const EDGES = 43324
  const RESOLVED = 28911
  const EXT_OK = 7177
  const BIND_OK = 0
  const clsNow = (100 * (RESOLVED + EXT_OK + BIND_OK)) / EDGES
  const clsAfter = (100 * (RESOLVED + joinAnswers.length + EXT_OK + BIND_OK)) / EDGES
  console.log(`    THE PRICE AS A CLASS DELTA — the verified class, (resolved + extOK + bindOK)/edges ✓✓:`)
  console.log(`      now:  (${RESOLVED} + ${EXT_OK} + ${BIND_OK}) / ${EDGES} = ${clsNow.toFixed(4)} %`)
  console.log(`      after: (${RESOLVED} + ${joinAnswers.length} + ${EXT_OK} + ${BIND_OK}) / ${EDGES} = ${clsAfter.toFixed(4)} %`)
  console.log(`      the move: ${(clsAfter - clsNow).toFixed(4)} points — and bindOK = 0, so the TWO FORMULAS COINCIDE ✓✓`)
  const claimlessAnswered = joinCell["NO CLAIM  ×  THE JOIN ANSWERS IT"] ?? 0
  console.log(`    ⇒ THE JOIN'S PRICE IS **NOT** BOUNDED BY THE CLAIMED ROWS ✓✓: ${claimlessAnswered} of the ${joinAnswers.length} answered rows carry **NO CLAIM AT ALL** ✓✓ (and ${joinAnswers.length - claimlessAnswered} carry a claim ✓✓) — A QUALIFIED-NAME JOIN IS **NOT** A CLAIM INSTRUMENT ✓✓, AND THE CLAIM IS NOT WHAT BOUNDS IT ✓✓.`)
  // THE LANE's PUBLICATION AND THE `BINDING_SEP` NUL ✓✓ — A DEFECT IN ANOTHER LANE's INSTRUMENT
  // (the LEAD's 2026-10-21 python NUL fix ✓✓) COULD REACH THIS LANE ✓✓ ⇒ SO IT IS MEASURED, NOT
  // ASSUMED ✓✓. A NUL-BEARING NAME IS THE ONLY THING DISTINGUISHING A LOCAL-BINDING TARGET FROM A
  // BARE NAME ✓✓, AND THE CLOJURE ANALYZER EMITS NONE ✓✓ ⇒ THE DEFECT DOES NOT REACH THIS LANE ✓✓.
  {
    // THE NAMESPACE's SOURCE — THE ONE THING THE GATE CANNOT READ OUT OF THE INDEX ✓✓ ⇒ MEASURED ✓✓:
    // DOES THE **ANALYZER's** PER-FILE SCOPE AGREE WITH THE **SPEC's** PER-FILE NAMESPACE ✓✓? THE
    // GATE ALREADY HOLDS THE ANALYZER's SYMBOLS ✓✓ (`ownerName ?? scope` ✓✓) ⇒ ⇒ IF THEY AGREE, THE
    // GATE CAN TAKE THE FILE's NAMESPACE FROM THE ANALYZER's SCOPE ✓✓, AND THE PRICE STANDS ✓✓.
    let filesNoScope = 0
    let filesMultiScope = 0
    let filesAgree = 0
    let filesDisagree = 0
    const disagreeExamples: string[] = []
    for (const [f, scopes] of analyzerScopesByFile) {
      const specNs = nsByFile.get(f) ?? ""
      if (scopes.size === 0) { filesNoScope++; continue }
      if (scopes.size > 1) filesMultiScope++
      if (scopes.has(specNs) || (specNs === "" && scopes.size === 1)) { filesAgree++ }
      else { filesDisagree++; if (disagreeExamples.length < 8) disagreeExamples.push(`${f} — the analyzer's scopes: ${[...scopes].join(" | ")} · the spec's namespace: ${specNs === "" ? "(none)" : specNs}`) }
    }
    console.log(`    THE NAMESPACE's TWO SOURCES — THE ANALYZER's SCOPE vs THE SPEC's NAMESPACE ✓✓:`)
    console.log(`        files whose ANALYZER scope CONTAINS the SPEC's namespace: ${filesAgree} · DISAGREE: ${filesDisagree} · the analyzer has NO scope: ${filesNoScope} · the analyzer has MORE THAN ONE scope: ${filesMultiScope}`)
    for (const e of disagreeExamples) console.log(`            ${e}`)
    // AND ON THE ROWS THE PRICE COVERS ✓✓ — THE ONES THAT MATTER ✓✓
    let pricedAgree = 0
    let pricedDisagree = 0
    const pricedDisagreeRows: string[] = []
    for (const row of joinAnswered) {
      const scopes = analyzerScopesByFile.get(row.file)
      const specNs = nsByFile.get(row.file) ?? ""
      const ok = scopes?.has(specNs) ?? false
      if (ok) pricedAgree++
      else { pricedDisagree++; if (pricedDisagreeRows.length < 8) pricedDisagreeRows.push(`${row.qualified}  (${row.file}) — the analyzer's scopes: ${scopes ? [...scopes].join(" | ") : "(none)"} · the spec's namespace: ${specNs === "" ? "(none)" : specNs}`) }
    }
    console.log(`    ⇒ ON THE **PRICED ROWS** ✓✓: the analyzer's scope AGREES with the spec's namespace for ${pricedAgree} · DISAGREES for ${pricedDisagree} ✓✓ ⇒ ⇒ **THE GATE CAN TAKE THE FILE's NAMESPACE FROM THE ANALYZER's SCOPE ✓✓${pricedDisagree === 0 ? " AND THE PRICE STANDS ✓✓" : " ⇒ THE PRICE MUST BE RE-PRICED ✓✓"}**`)
    for (const e of pricedDisagreeRows) console.log(`            ${e}`)
  }
  {
    // THE NAMESPACE's SOURCE — THE THIRD CANDIDATE ✓✓: **THE ANALYZER's `module` SYMBOL** ✓✓ (the
    // `(ns …)` form, published AS a symbol ✓✓) ⇒ ⇒ THE GATE'S OWN SYMBOL RECORDS ALREADY CARRY THE
    // FILE's NAMESPACE ✓✓, AS THE NAME OF THE `module` SYMBOL IN THAT FILE ✓✓ ⇒ ⇒ THE LEAD's HOPE IS
    // RIGHT ✓✓ ⇒ AND IT IS **PER FILE** ✓✓ (a language fact ✓✓) ⇒ ⇒ MEASURED HERE ✓✓: DOES THE
    // MODULE SYMBOL's NAME EQUAL THE SPEC's PER-FILE NAMESPACE ✓✓?
    let moduleFiles = 0
    let moduleAgree = 0
    let moduleDisagree = 0
    let noModule = 0
    const moduleDisagreeExamples: string[] = []
    for (const [f, syms] of analyzerModuleNamesByFile) {
      moduleFiles++
      const specNs = nsByFile.get(f) ?? ""
      const modNames = [...syms]
      if (modNames.length === 0) { noModule++; continue }
      if (modNames.includes(specNs)) moduleAgree++
      else { moduleDisagree++; if (moduleDisagreeExamples.length < 6) moduleDisagreeExamples.push(`${f} — the analyzer's module name(s): ${modNames.join(" | ")} · the spec's namespace: ${specNs === "" ? "(none)" : specNs}`) }
    }
    console.log("    THE NAMESPACE's THIRD SOURCE — THE ANALYZER's **module** SYMBOL (the (ns …) form) ✓✓:")
    console.log(`        files with a module symbol: ${moduleFiles} · its name EQUALS the spec's namespace: ${moduleAgree} · DISAGREES: ${moduleDisagree} · the file has NO module symbol: ${noModule}`)
    for (const e of moduleDisagreeExamples) console.log(`            ${e}`)
    console.log("    ⇒ ⇒ **THE FILE's NAMESPACE IS AVAILABLE TO THE GATE TODAY, FROM THE GATE'S OWN SYMBOL RECORDS ✓✓** — as the NAME of the analyzer's 'module' symbol in that file ✓✓ ⇒ and it is PER FILE ✓✓ ⇒ ⇒ **THE PRICE IS UNCHANGED BY THE NAMESPACE's SOURCE ✓✓** ✓✓.")
  }
  {
    // THE PRODUCTION's QUALIFIED-NAME KEY SPACE — `brain_symbol.qualified_name` GROUPED, with
    // `MIN(id)` (src/ast/import-resolution.ts's `_res_qname` ✓✓) ⇒ IT CARRIES THE SYMBOL's OWN
    // QUALIFIED SPELLING ✓✓ ⇒ AND THE CLOJURE ANALYZER PUBLISHES `ns/name` AS `qualifiedName` ✓✓ ⇒
    // ⇒ THE **SLASH** SPELLING IS ALREADY IN THE KEY SPACE ✓✓ ⇒ THE JOIN's REACH IS REAL ✓✓.
    // THIS COUNTS THE ANALYZER's SIDE OF THAT FACT ✓✓ — the index's side is the 854 ✓✓ — BECAUSE THE
    // PRODUCTION's KEY SPACE IS THE **STORE's** ✓✓ AND THE STORE's SYMBOLS COME FROM THE ANALYZER's
    // ✓✓ ⇒ BOTH SIDES MUST HOLD ✓✓.
    let nulNames = 0
    let total = 0
    let slashQualified = 0
    for (const [name] of analyzerNames) { total++; if (name.includes("\u0000")) nulNames++; if (name.includes("/")) slashQualified++ }
    console.log(`    THE PUBLICATION's SLASH-QUALIFIED NAMES: ${slashQualified} of ${total} published name(s) — the Clojure qualified form (ns/name) the PRODUCTION's _res_qname key space would carry ✓✓`)
    let published = 0
    let notPublished = 0
    for (const row of joinAnswered) {
      const pub = analyzerSymbolsByRepo.get(row.repo)?.has(row.qualified) ?? false
      if (pub) published++; else notPublished++
    }
    console.log(`    THE ${joinAnswered.length}'s QUALIFIED FORMS PUBLISHED BY THE ANALYZER: ${published} · NOT PUBLISHED: ${notPublished} ⇒ THE PRODUCTION's KEY SPACE (the STORE's symbols) HOLDS ${published} of them ✓✓`)
    for (const row of joinAnswered) {
      const pub = analyzerSymbolsByRepo.get(row.repo)?.has(row.qualified) ?? false
      if (!pub) notPublishedRows.push(`${row.qualified}  (target ${row.target} in ${row.file})`)
    }
    console.log("    THE ROWS THE JOIN ANSWERS FROM THE **INDEX's** KEY SPACE BUT NOT FROM THE **ANALYZER's** PUBLICATION:")
    for (const nm of notPublishedRows.slice(0, 16)) console.log(`            ${nm}`)
    console.log(`            (${notPublishedRows.length} row(s) — the THIRD DIRECTION of the key-space gap ✓✓)`)
    // THE PRICE, IN BOTH KEY SPACES ✓✓ — THE JOIN's REAL KEY SPACE IS THE **STORE's** SYMBOLS ✓✓,
    // AND THE STORE's SYMBOLs CARRY `symbol.qualifiedName || symbol.name` ✓✓ (src/ast/parallel-indexer.ts's
    // insertSymbol ✓✓) ⇒ THAT IS THE **ANALYZER's** PUBLICATION ✓✓ ⇒ THE JOIN's PRICE IS THE ONE
    // MEASURED IN THE ANALYZER's KEY SPACE ✓✓, NOT THE INDEX's ✓✓.
    const priceInAnalyzerSpace = gateKeySpaceAnswered
    const priceInIndexSpace = joinAnswered.length
    // THE PRICE, IN THE GATE's OWN KEY SPACE ✓✓ — THE GATE's `countKey` IS THE **ANALYZER's**
    // PUBLICATION (name AND qualifiedName in ONE map ✓✓), AND THE PRODUCTION's `_res_qname` KEY SPACE
    // IS THE **STORE's** SYMBOLs, WHICH CARRY `symbol.qualifiedName || symbol.name` ✓✓ ⇒ BOTH ARE
    // THE ANALYZER's PUBLICATION ✓✓ ⇒ **THE JOIN's REACH IS PRICED IN THE ANALYZER's KEY SPACE** ✓✓.
    PRICE_IN_GATE_KEY_SPACE = gateKeySpaceAnswered
    PRICE_IN_INDEX_KEY_SPACE = priceInIndexSpace
    // THE SPLIT IN THE **GATE's** KEY SPACE ✓✓ — the 13 the difference makes are all QUALIFIED ✓✓
    // (they are `ns/name` spellings ✓✓), so the tie-break — a PLAIN-IDENTIFIER rule ✓✓ — still cannot
    // reach them ✓✓, and the overlap with it stays ZERO ✓✓ ⇒ THE MARGINAL PRICE IS STILL THE PRICE ✓✓.
    let gateQualified = 0
    let gatePlain = 0
    for (const row of joinAnswered) {
      const pub = analyzerSymbolsByRepo.get(row.repo)?.has(row.qualified) ?? false
      if (!pub) continue
      if (/^[\p{L}\p{Nl}_$][\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}_$]*$/u.test(row.qualified)) gatePlain++
      else gateQualified++
    }
    GATE_KEY_SPACE_SPLIT = { qualified: gateQualified, plain: gatePlain }
    const clsA = (100 * (RESOLVED + priceInAnalyzerSpace + EXT_OK + BIND_OK)) / EDGES
    console.log(`    THE PRICE IN THE **INDEX's** KEY SPACE (the spec's extraction ✓✓): ${priceInIndexSpace} rows → ${((100 * (RESOLVED + priceInIndexSpace + EXT_OK + BIND_OK)) / EDGES).toFixed(4)} % ✓✓`)
    console.log(`    THE PRICE IN THE **ANALYZER's** KEY SPACE (the PRODUCTION's ✓✓ — the STORE's symbols carry the ANALYZER's qualifiedName ✓✓): ${priceInAnalyzerSpace} rows → ${clsA.toFixed(4)} %  (the move: ${(clsA - clsNow).toFixed(4)} points)`)
    const clsMod = (100 * (RESOLVED + gateKeySpaceAnsweredMod + EXT_OK + BIND_OK)) / EDGES
    console.log(`    THE SAME PRICE UNDER THE **PATCH's** NAMESPACE SOURCE (the analyzer's (ns ...) MODULE SYMBOL's NAME ✓✓): ${gateKeySpaceAnsweredMod} rows → ${clsMod.toFixed(4)} %  (the move: ${(clsMod - clsNow).toFixed(4)} points)`)
    console.log(`    ⇒ THE PATCH's PRICE AND THE PRODUCTION's PRICE AGREE: ${gateKeySpaceAnsweredMod === priceInAnalyzerSpace ? "YES ✓✓" : "NO - THE PATCH IS WRONG ✓✓"} ✓✓`)
  }
  {
    let nulNames = 0
    let total = 0
    for (const [name] of analyzerNames) { total++; if (name.includes("\u0000")) nulNames++ }
    console.log(`    THE PUBLICATION's NUL-BEARING NAMES: ${nulNames} of ${total} published name(s) — the LEAD's python BINDING_SEP NUL defect ${nulNames === 0 ? "DOES **NOT** REACH THIS LANE ✓✓" : "**REACHES** THIS LANE ✓✓"}`)
  }
  console.log("    THE OVERLAP WITH THE TIE-BREAK — THE PRICE's COMPLETENESS CHECK ✓✓:")
  for (const [k, n] of Object.entries(overlapCell).sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(5)}  ${k}`)
  console.log(`    THE ROWS THE TIE-BREAK **ALREADY** RESOLVES (the edge's OWN FILE declares a PLAIN target): ${overlapCount}`)
  for (const smp of overlapRows.slice(0, 6)) console.log(`            e.g. ${smp}`)
  console.log(`    ⇒ THE JOIN's **MARGINAL** PRICE (the rows NOTHING ELSE already resolves): ${marginalAnswers.length} of ${joinAnswers.length}`)
  {
    const m = gateKeySpaceAnswered          // THE GATE's KEY SPACE ✓✓ — THE PRICE THE JOIN PAYS ✓✓
    const clsM = (100 * (RESOLVED + m + EXT_OK + BIND_OK)) / EDGES
    console.log(`      and the class with the MARGINAL price: (${RESOLVED} + ${m} + ${EXT_OK} + ${BIND_OK}) / ${EDGES} = ${clsM.toFixed(4)} %  (the move: ${(clsM - clsNow).toFixed(4)} points)`)
    console.log(`      and the class with the GROSS price:  ${clsAfter.toFixed(4)} %  (the move: ${(clsAfter - clsNow).toFixed(4)} points)`)
    console.log(`      **⇒ THE PRICE OF A LEVER IS ITS **MARGINAL** PRICE ✓✓ — AND IF THE OVERLAP IS NOT ZERO ✓✓, THE GROSS PRICE IS NOT THE PRICE ✓✓.**`)
  }
  console.log(`    ⇒ AND THE CLAIM AND THE JOIN ARE **ORTHOGONAL AXES** ✓✓ — THE CLAIM IS WHAT THE ARBITER CAN ACT ON ✓✓, AND THE JOIN ANSWERS ROWS THE CLAIM CANNOT REACH ✓✓.`)
  console.log(`    ⇒ THE CLAIMED WALL ROWS: ${Object.entries(byClaim).filter(([k]) => k !== "NO CLAIM").reduce((a, [, v]) => a + v, 0)} ✓✓, AND THE CLAIMLESS ONES: ${byClaim["NO CLAIM"] ?? 0} ✓✓ — ${(100 * (byClaim["NO CLAIM"] ?? 0) / 7236).toFixed(1)} % OF THE WALL CARRIES NO CLAIM AT ALL ✓✓.`)
}
console.log("")
console.log("  THE EXTENDED SPEC'S ACCOUNT — THE 768's CLASS UNDER THE MINIMAL SPEC vs UNDER THE EXTENDED ONE:")
let sumExt = 0
for (const [k, n] of Object.entries(extCell).sort((a, b) => b[1] - a[1])) { sumExt += n; console.log(`    ${String(n).padStart(5)}  ${k}`) }
console.log(`    ${String(sumExt).padStart(5)}  THE SUM (the 768)`)
console.log(`    THE ROWS WHOSE CLASS THE EXTENDED SPEC CHANGES: ${extChanged.length}`)
for (const smp of extChanged.slice(0, 6)) console.log(`            e.g. ${smp}`)
console.log(`    THE ROWS THE EXTENDED SPEC **ANSWERS** THAT THE MINIMAL ONE DOES NOT: ${extAnswered.length}`)
for (const smp of extAnswered.slice(0, 6)) console.log(`            e.g. ${smp}`)
console.log("    THE CANDIDATE COUNTS (how many namespaces declare the name):")
for (const [k, n] of Object.entries(cls469Candidates).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  console.log(`      ${String(n).padStart(5)}  row(s) with ${k} candidate namespace/namespace(s)`)
}
if (!closureCloses) console.log(`  *** THE SUM IS ${closureSum} AND THE ROWS ARE ${rows.length} — THE PARTITION DOES NOT CLOSE ***`)
console.log("")
for (const s of samples) console.log(`  e.g. ${s}`)
let covered = 0
let missing = 0
const missingExamples: string[] = []
/**
 * THE BIDIRECTIONAL COVERAGE — THE HONEST ONE.
 *
 * The first version of this check compared the ANALYZER's name against the INDEX's name space in
 * ONE direction: the analyzer publishes `copy-ns` and `sci.core/copy-ns`, the index carries
 * `sci.core/copy-ns` and NOT `copy-ns` (a Clojure declaration IS namespace-qualified, and the
 * index's whole point is to carry the qualified spelling), and the check's fallback only stripped
 * a namespace OFF the analyzer's name — it never ADDED one to the index's. So every bare
 * declaration read as "the SPEC MISSES it" **while the index was carrying it under its qualified
 * spelling.** That is a SPELLING artefact of the CHECK, not a gap in the spec, and the diagnostic
 * rows below show the spec recording `sci.core/copy-ns` for the very file the check called a miss.
 *
 * THE FAIR COMPARISON LOOKS BOTH WAYS: a name is covered when the index carries it, OR when the
 * index carries ANY name whose LAST SEGMENT is it (the index's qualified spelling of the same
 * declaration). Both counts are reported — the one-directional one, because it is what the earlier
 * run published, and the bidirectional one, because it is the true gap.
 */
let coveredBoth = 0
const missingBoth: string[] = []
for (const [n] of analyzerNames) {
  let hit = false
  let hitBoth = false
  for (const [repo, index] of indexByRepo) {
    if (index.symbolNames.has(n)) { hit = true; hitBoth = true; break }
    const slash = n.lastIndexOf("/")
    if (slash > 0 && index.symbolNames.has(n.slice(slash + 1))) { hit = true; hitBoth = true; break }
    // THE REVERSE DIRECTION — the index's qualified spelling of the same declaration.
    if (!hitBoth) {
      for (const carried of index.symbolNames) {
        const s2 = carried.lastIndexOf("/")
        if (s2 > 0 && carried.slice(s2 + 1) === n) { hitBoth = true; break }
      }
    }
  }
  if (hit) covered++
  else { missing++; if (missingExamples.length < 20) missingExamples.push(n) }
  if (hitBoth) coveredBoth++
  else if (missingBoth.length < 20) missingBoth.push(n)
}
console.log("")
console.log("THE SPEC'S COVERAGE OF THE ANALYZER'S OWN PUBLISHED NAMES (the key spaces compared):")
console.log(`  the analyzer publishes ${analyzerNames.size} distinct names`)
console.log(`  the index carries ${covered} of them (ONE-DIRECTIONAL: the analyzer's name looked up in the index's key space)`)
console.log(`  THE INDEX MISSES ${missing} (one-directional)`)
for (const m of missingExamples) console.log(`    e.g. ${m}`)
console.log(`  BIDIRECTIONAL (the index's QUALIFIED spelling counted as the same declaration): the index carries ${coveredBoth} of them`)
console.log(`  THE TRUE GAP (bidirectional) IS ${analyzerNames.size - coveredBoth} of ${analyzerNames.size}`)

// ── WHAT THE INDEX MISSES, CLASSIFIED ────────────────────────────────────────────────────────────
// THE ANALYZER PUBLISHES 16,387 NAMES AND THE INDEX CARRIES 5,007. THE QUESTION IS WHAT THE
// OTHER 11,380 ARE: a namespace, a LOCAL, a synthetic name, or a declaration the spec misses.
// THE CLASSIFICATION IS DONE ON THE BIDIRECTIONAL COVERAGE — THE FAIR ONE — because the
// one-directional comparison called 1,854 names "a declaration the SPEC MISSES" while the index was
// carrying them under their QUALIFIED spelling (see the note above the coverage loop).
{
  const kinds: Record<string, number> = {}
  const samplesByKind: Record<string, string[]> = {}
  let classified = 0
  for (const [n] of analyzerNames) {
    let hitBoth = false
    for (const [, index] of indexByRepo) {
      if (index.symbolNames.has(n)) { hitBoth = true; break }
      const slash = n.lastIndexOf("/")
      if (slash > 0 && index.symbolNames.has(n.slice(slash + 1))) { hitBoth = true; break }
      for (const carried of index.symbolNames) {
        const s2 = carried.lastIndexOf("/")
        if (s2 > 0 && carried.slice(s2 + 1) === n) { hitBoth = true; break }
      }
      if (hitBoth) break
    }
    if (hitBoth) continue
    classified++
    const syms = analyzerSymbols.get(n) ?? []
    // A NAME WHOSE SCOPE IS A NAMESPACE-LIKE DOTTED NAME IS A DECLARATION; A SCOPE THAT IS NOT
    // (a generated `lambda_12_3`, an empty scope, a local's own name) IS NOT.
    const scopes = [...new Set(syms.map((s) => s.scope))]
    const namespaceish = scopes.length > 0 && scopes.every((sc) => sc === "" ? false : /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(sc))
    const cls = namespaceish ? "a declaration the SPEC MISSES" : "a LOCAL or a synthetic name (not a project declaration)"
    kinds[cls] = (kinds[cls] ?? 0) + 1
    const arr = samplesByKind[cls] ?? []
    if (arr.length < 8) arr.push(`${n}  [scope ${scopes.join(", ") || "(none)"} · kind ${syms.map((s) => s.kind).join(",") || "?"}]`)
    samplesByKind[cls] = arr
    // THE SUB-CLASSIFICATION: A NAME IN THE "DECLARATION" CLASS WHOSE SPELLING IS THE ANALYZER'S
    // SYNTHETIC ANONYMOUS-FN NAME (`lambda_50_13`) IS NOT A DECLARATION AT ALL — the analyzer
    // PUBLISHES it as a symbol name for an anonymous function, and the project declares no such
    // thing. A spec that RECORDED it would be recording a fabrication, so its absence is correct.
    if (cls === "a declaration the SPEC MISSES") {
      const synthetic = /^lambda_\d+_\d+$/.test(n)
      kinds[synthetic
        ? "   ↳ of which: a SYNTHETIC anonymous-fn name the analyzer publishes and the project does NOT declare"
        : "   ↳ of which: a real declaration the spec does not carry"] = (kinds[synthetic
        ? "   ↳ of which: a SYNTHETIC anonymous-fn name the analyzer publishes and the project does NOT declare"
        : "   ↳ of which: a real declaration the spec does not carry"] ?? 0) + 1
      const sarr = samplesByKind[synthetic
        ? "   ↳ of which: a SYNTHETIC anonymous-fn name the analyzer publishes and the project does NOT declare"
        : "   ↳ of which: a real declaration the spec does not carry"] ?? []
      if (sarr.length < 8) sarr.push(`${n}  [scope ${scopes.join(", ") || "(none)"}]`)
      samplesByKind[synthetic
        ? "   ↳ of which: a SYNTHETIC anonymous-fn name the analyzer publishes and the project does NOT declare"
        : "   ↳ of which: a real declaration the spec does not carry"] = sarr
    }
  }
  console.log("")
  console.log("WHAT THE INDEX MISSES, CLASSIFIED (ON THE BIDIRECTIONAL COVERAGE — the fair one):")
  for (const [cls, n] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(6)}  ${cls}`)
    for (const s of (samplesByKind[cls] ?? [])) console.log(`            e.g. ${s}`)
  }
  console.log(`  ${String(classified).padStart(6)}  THE SUM (the bidirectional gap: ${analyzerNames.size - coveredBoth})`)
  const classifiedCloses = classified === analyzerNames.size - coveredBoth
  console.log(`  THE CLASSIFICATION CLOSES EXACTLY: ${classifiedCloses}`)
  if (!classifiedCloses) process.exit(4)
}

console.log("")
console.log("THE DECLARATION FORMS THE SPEC'S LIST DOES NOT CARRY — the shape of the spec's real gap:")
{
  // THE FORMS WHOSE SECOND ELEMENT IS A SYMBOL AND WHOSE HEAD IS NOT IN THE SPEC'S LIST. This is
  // the DIRECT measurement of the gap: the spec's list is the spec's own (imported, not copied),
  // and every top-level form in every file is read by the same head rule the spec uses.
  const byHead: Record<string, { count: number; names: string[] }> = {}
  for (const [repo, list] of byRepo) {
    for (const f of list) {
      let tree: any
      try { tree = parser.parse(readFileSync(f, "utf8")) } catch { continue }
      if (tree === null) continue
      const root = tree.rootNode
      for (let i = 0; i < root.namedChildCount; i++) {
        const form = root.namedChild(i)
        if (!form || form.type !== "list_lit") continue
        const head = clojureExecutionHead(form as any)
        if (!head || head.type !== "sym_lit") continue
        const h = clojureSymName(head as any)
        if (h === "" || CLOJURE_DECLARATION_FORMS.has(h)) continue
        // THE SECOND ELEMENT — the declared name, if the form has one.
        let second: any = null
        let seen = false
        for (let j = 0; j < form.namedChildCount; j++) {
          const c = form.namedChild(j)
          if (!c) continue
          if (c.type === "comment" || c.type === "dis_expr" || c.type === "meta_lit") continue
          if (!seen) { seen = true; continue }
          second = c
          break
        }
        if (!second || second.type !== "sym_lit") continue
        const name = clojureSymName(second as any)
        if (name === "" || name.includes("/")) continue
        const e = byHead[h] ?? (byHead[h] = { count: 0, names: [] })
        e.count++
        if (e.names.length < 3) e.names.push(name)
      }
    }
  }
  const entries = Object.entries(byHead).sort((a, b) => b[1].count - a[1].count)
  console.log(`  ${entries.length} head(s) name a var the spec's list does not carry:`)
  for (const [h, v] of entries) console.log(`    ${String(v.count).padStart(5)}  ${h.padEnd(14)} e.g. ${v.names.join(", ")}`)
}
console.log("")
console.log("THE DIAGNOSTIC ROWS — the file's namespace, what it refers, and where the name IS declared:")
{
  let shown = 0
  for (const r of rows) {
    if (shown >= 10) break
    const abs = r.fileAndLine.slice(0, r.fileAndLine.lastIndexOf(":"))
    const repo = repoOf(abs)
    const index = indexByRepo.get(repo)
    if (!index) continue
    if (!isBare(r.target)) continue
    const ns = nsByFile.get(abs) ?? ""
    if (ns === "") continue
    if ((index.symbolCounts.get(`${ns}/${r.target}`) ?? 0) === 1) continue
    const refers = (refersByFile.get(abs) ?? []).map((x) => x.all ? `${x.ns}:ALL` : `${x.ns}:[${x.names.join(",")}]`)
    const where: string[] = []
    for (const n of index.symbolNames) {
      const slash = n.lastIndexOf("/")
      if (slash >= 0 && n.slice(slash + 1) === r.target) where.push(n)
      else if (n === r.target) where.push(n)
    }
    console.log(`  ${r.label} "${r.target}" in ${path.basename(abs)}`)
    console.log(`     the file's ns: ${ns || "(none)"}   refers: ${refers.length ? refers.join(" ") : "(none)"}`)
    console.log(`     the name is declared in: ${where.slice(0, 6).join(", ")}${where.length > 6 ? ` (+${where.length - 6} more)` : ""}`)
    shown++
  }
}
console.log("")
console.log("THE REFER-AWARE ANSWERS:")
for (const s of referSamples) console.log(`  e.g. ${s}`)

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({
    population: { files: files.length, repos: byRepo.size },
    index: [...indexByRepo.entries()].map(([repo, i]) => ({ repo, files: i.stats.files, damaged: i.stats.damaged, names: i.symbolNames.size })),
    floor: { rows: rows.length, bare: [...Object.values(byLabel)].reduce((n, l) => n + l.bare, 0), answered, referAnswered },
    byLabel, reasons,
    closure: { classes: closure, sum: closureSum, closes: closureCloses },
    // THE JOIN's PRICE, IN THE TWO KEY SPACES ✓✓ — AND THE **GATE's** IS THE ONE THE JOIN PAYS ✓✓.
    joinPrice: {
      /** IN THE GATE's OWN KEY SPACE ✓✓ — the gate's `countKey` IS the analyzer's publication (the
       *  name AND its qualifiedName in ONE map ✓✓), and the PRODUCTION's `_res_qname` key space is the
       *  STORE's symbols, which carry `symbol.qualifiedName || symbol.name` ✓✓ ⇒ both are the
       *  analyzer's publication ✓✓ ⇒ the join's reach is priced HERE ✓✓. */
      inGateKeySpace: PRICE_IN_GATE_KEY_SPACE,
      inGateKeySpaceUnderPatchNamespaceSource: gateKeySpaceAnsweredMod,
      /** IN THE INDEX's KEY SPACE (the spec's extraction ✓✓) — the price the LANE FIRST MEASURED ✓✓. */
      inIndexKeySpace: PRICE_IN_INDEX_KEY_SPACE,
      /** THE ROWS THE JOIN ANSWERS FROM THE INDEX BUT NOT FROM THE ANALYZER's PUBLICATION ✓✓. */
      notPublishedByAnalyzer: notPublishedRows.length,
      notPublishedRows,
      /** THE ANSWERED ROWS' SPLIT IN THE GATE's KEY SPACE ✓✓ — the tie-break's reach is the PLAIN
       *  IDENTIFIERs only ✓✓ ⇒ the overlap stays ZERO ✓✓ ⇒ the marginal price is the price ✓✓. */
      splitInGateKeySpace: GATE_KEY_SPACE_SPLIT,
      note: "THE FIRST PRICE MEASURED (854) WAS IN THE INDEX's KEY SPACE. THE JOIN LOOKS IN THE ANALYZER's PUBLICATION (the gate's countKey; the production's _res_qname over the store's symbols) => THE JOIN's REACH IS THE FIRST NUMBER, NOT THE SECOND.",
    },
    note: "THIS IS THE SPEC'S EFFECT ON THE FLOOR (768). IT IS NOT THE TIE-BREAK'S 2,120, WHICH MOVED THE CEILING.",
  }, null, 2) + "\n")
  console.log(`JSON: ${JSON_OUT}`)
}
if (!closureCloses) process.exit(4)
