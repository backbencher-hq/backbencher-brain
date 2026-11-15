/**
 * R ONTOLOGY — the three questions `ontology-ten-types.ts` deliberately did not answer.
 *
 * ## Scope
 *
 * `ontology-ten-types.ts` answers Q1 (exists), Q2 (fires), Q5 (resolved, same-file
 * criterion) and Q6 (confident) over the whole admitted population. It prints its own
 * limitation that Q4 (labelled) is NOT measured, because a `uses` edge that should have
 * been `references` counts identically in an edge tally. This file is the instrument for
 * Q4, plus the two corrections Q5 needs:
 *
 *   BLOCK A  every edge keyed by (type, relationshipSubType). A subtype that appears under
 *            TWO ontology types is a labelling ambiguity and is named as one, not averaged
 *            away. A subtype under exactly one type is the label being consistent.
 *   BLOCK B  an INDEPENDENT carrier probe for `extends` and `implements`. R's inheritance
 *            carriers are named arguments (`inherit=`, `contains=`, `parent=`) and R's
 *            generic-implementation carrier is the `generic.class` dotted-name convention.
 *            The probe reads those off the parse tree WITHOUT the analyzer's rule table,
 *            so a label is checked against the syntax that produced it rather than against
 *            the analyzer's own opinion of itself.
 *   BLOCK C  confidence histogram + evidenceClass per type. Q6 asks whether the numbers are
 *            right, and a histogram is the only thing that answers "all edges are >= 0.7"
 *            honestly — a lane where everything sits at exactly 0.7 and a lane with a spread
 *            both satisfy the same threshold test and mean different things.
 *   BLOCK D  the endpoint SHAPE per type. Q5's same-file criterion returns 0.0% for
 *            `imports` and `exports`; that number is only interpretable if the reader knows
 *            the source endpoint is the literal `global` by construction, so this block
 *            prints the actual endpoint strings.
 *
 * ## A finding about this PROBE, recorded because it is the kind that hides a real defect
 *
 * The first version of BLOCK B reported 11 "unconditional implements carriers with no
 * edge" in Matrix/R/Ops.R — `Ops.x.x`, `A.M.n`, `diagOdiag` and 8 more. Every one of the
 * 22 top-level function bindings the probe thought were missing is removed by a top-level
 * `rm(...)` later in the same file: `rm(Ops.x.x)` at Ops.R:775, `rm(A.M.n, A.n.M)` at 639,
 * `rm(diagOdiag)` at 2029, and so on for all 22. The analyzer models `rm()` unbinding
 * (`removeTopLevelBindings`) and is RIGHT to drop them — R does not hold `Ops.x.x` after
 * line 775 either; the function exists only to be handed to `setMethod` at 471-479. The
 * probe was the thing that was wrong, and an oracle that over-claims is worse than no
 * oracle, because its misses point at correct code. So the probe now models `rm()` and the
 * count it reports is a count against a carrier set that R itself would agree with.
 *
 * ## A RETRACTED RESULT, kept here because the retraction is the measurement
 *
 * An earlier committed run of BLOCK B printed
 *
 *     extends    …so UNCONDITIONAL carriers with no edge:  14  <- a real gap
 *     implements …so UNCONDITIONAL carriers with no edge: 144  <- a real gap
 *
 * Both were defects in the probe, and each is verifiable by reading corpus source rather than by
 * re-running anything:
 *
 * 1. BACKTICK KEY MISMATCH. The implements carrier keyed on `lhs.text` RAW, so `` `$<-.AC` `` was
 *    one string and the published `$<-.AC` another. The two can never agree, so every backticked
 *    S3 method was counted once as a carrier with no edge AND once as an edge with no carrier.
 *    53 of `adjudicate-carriers.ts`'s 112 candidates are this.
 * 2. NO SYMBOL-SET CHECK. A carrier was called missing regardless of whether the analyzer COULD
 *    have published an edge. `implements` is an in-file registration of a generic, and base R's
 *    own replacement generics (`$<-`, `[[<-`, `[<-`, `names<-`) are not declared in the corpus
 *    files that define methods for them — `R6/tests/testthat/test-s3-methods.R` declares
 *    `` `$<-.AC` `` and no bare `$<-`. 53 candidates.
 * 3. WRONG SELF NAME FOR `new_class`. The extends carrier read the first ARGUMENT as the class
 *    name. S4 writes that (`setClass("Foo", contains = …)`); S7 does not — it writes the binding
 *    (`class_ggplot <- S7::new_class(name = "ggplot", parent = class_gg, …)`, ggplot2/R/all-classes.R:322).
 *    So the probe keyed the carrier `ggplot` while production published `class_ggplot`: ONE
 *    declaration, two keys, both directions of the diff wrong in the same file.
 *
 * The block now unquotes, reads the self name from the enclosing assignment first, and classifies
 * every remaining candidate by whether its ends are bindings the file declares. `adjudicate-carriers.ts`
 * is the instrument that settles this question over the whole population; the cross-reference is
 * deliberate, because two instruments over one grammar agreeing is worth more than one.
 *
 * ## The known R confusions this block is built to test
 *
 *   uses vs references     a member read (`obj$member`) and a dependency mention
 *                           (`library(dplyr)`) are both "a use of a name". The analyzer
 *                           puts member reads on `uses` and dependency mentions on
 *                           `references`; if any single subtype straddles the two, that is
 *                           the confusion, made countable.
 *   extends vs implements  S4/R6/S7/R5 class inheritance (`contains=`, `inherit=`,
 *                           `parent=`) is `extends`; the S3 `generic.class` registration
 *                           convention is `implements`. Block B derives both carriers from
 *                           the tree and checks which label each one received.
 *
 * ## Reproducing
 *
 *   npx tsx validation/m14/fixtures/r/labels-and-resolution.ts
 *   BB_R_LIMIT=300 npx tsx validation/m14/fixtures/r/labels-and-resolution.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIMIT = Number(process.env.BB_R_LIMIT ?? 0)
const WORKERS = 4
const MAX_EX = 4

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

const LABEL_ALIASES: Record<string, Type> = {
  brain_import: "imports", brain_call: "calls", brain_use: "uses",
  brain_contains: "contains", brain_reference: "references", brain_export: "exports",
  brain_extends: "extends", brain_implements: "implements",
  brain_overrides: "overrides", brain_instantiates: "instantiates",
}
function ontologyType(raw: unknown): Type | null {
  const s = String(raw ?? "").toLowerCase()
  if ((ALL_TYPES as readonly string[]).includes(s)) return s as Type
  return LABEL_ALIASES[s] ?? null
}

// ---------------------------------------------------------------- corpus
interface Admitted { repo: string; dir: string; rel: string; abs: string; text: string }
const admitted: Admitted[] = []
const reposWithR: Record<string, number> = {}
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
    admitted.push({ repo: e, dir, rel, abs, text })
    reposWithR[e] = (reposWithR[e] ?? 0) + 1
  }
}
const covered = LIMIT > 0 ? admitted.slice(0, LIMIT) : admitted
console.log(`R label/resolution census — production parseFile over the admitted R corpus`)
console.log(`corpus root: ${CR}`)
console.log(`admitted files: ${admitted.length} across ${Object.keys(reposWithR).length} repositories`)
console.log(`files walked: ${covered.length}${LIMIT > 0 ? " (BB_R_LIMIT prefix of the corpus-ordered list)" : " (whole population, no sampling)"}`)
console.log(`workers: ${WORKERS}\n`)

// ---------------------------------------------------------------- the tree probe (loaded BEFORE the walk; probeCarriers closes over `parser`)
// ---------------------------------------------------------------- BLOCK B — the tree probe
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-r.wasm"))))

/**
 * R's inheritance carriers, read as NAME = STRING pairs on the parse tree.
 *
 * Deliberately independent of the analyzer: it does not import `real-r-analyzer.ts`, it
 * does not read `extractNamedArguments`, and it resolves `c(...)` by walking the arguments
 * node itself. If it and the analyzer agree, that is two implementations over one grammar;
 * if they disagree, the disagreement is located by file and pair rather than averaged into a
 * percentage.
 */
const INHERITANCE_CARRIERS: Record<string, string> = {
  R6Class: "inherit", "R6::R6Class": "inherit",
  setRefClass: "contains",
  setClass: "contains",
  new_class: "parent",
}


// ---------------------------------------------------------------- BLOCK A / C / D accumulators
/** (type, subtype) -> count. subtype "(none)" is an edge with no relationshipSubType at all. */
const byTypeSubtype = new Map<string, { n: number; ex: string[] }>()
/** type -> confidence histogram, bucketed to 0.05 so a lane cannot pass by sitting on 0.7. */
const confHist = new Map<Type, Map<string, number>>()
/** type -> evidenceClass tally. */
const evByType = new Map<Type, Map<string, number>>()
/** type -> { srcShape: Map<string, number>, tgtShape: Map<string, number> } */
const endpointShape = new Map<Type, { src: Map<string, number>; tgt: Map<string, number>; tgtInFile: number; n: number }>()

function shapeRow(t: Type) {
  let r = endpointShape.get(t)
  if (!r) { r = { src: new Map(), tgt: new Map(), tgtInFile: 0, n: 0 }; endpointShape.set(t, r) }
  return r
}
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

for (const t of ALL_TYPES) { confHist.set(t, new Map()); evByType.set(t, new Map()) }

// ---------------------------------------------------------------- BLOCK B accumulators
/** One inheritance declaration read off the tree: a base class and every spelling the class
 *  itself can carry. R does not force one spelling — `Foo <- new_class("Foo", parent = Bar)`
 *  names the class twice — so a comparison that insists on ONE spelling reports a disagreement
 *  over a naming convention, which is noise. The declaration is the unit; the spellings are how
 *  production might have named it. */
interface ExtendsDecl { spellings: Set<string>; base: string; conditional: boolean; fromLiteral: boolean }
/** Extends declarations on the TREE, keyed file. */
const treeExtendsDecls = new Map<string, ExtendsDecl[]>()
/** file -> the names a top-level `rm(...)` unbinds. Counted so the probe's own
 *  over-claim is visible as a number rather than as a silence. */
const treeRemovedByRm = new Map<string, Set<string>>()
/** Implements carriers on the tree: dotted `generic.class <- function`. */
const treeImplements = new Map<string, Set<string>>()
/** …and the subset whose declaration sits inside an if/while/for body. */
const treeImplementsConditional = new Map<string, Set<string>>()
/** file -> the symbol names production published for that file. A carrier whose END is not
 *  in this set is not an edge the analyzer could have published, so counting it as a missing
 *  edge is an over-claim. See the header: this check was absent from the first version. */
const fileSymbols = new Map<string, Set<string>>()
/** Emitted extends/implements edges keyed the same way, for set comparison. */
const emitExtends = new Map<string, Set<string>>()
const emitImplements = new Map<string, Set<string>>()

let parseFailures = 0
let degraded = 0
let idx = 0

async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= covered.length) return
    const f = covered[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { parseFailures++; continue }
    if (r?.fallback === true || r?.metadata?.fallback === true) degraded++
    const label = `${f.repo}/${f.rel}`

    const syms: any[] = r?.symbols ?? []
    const published = new Set<string>()
    for (const s of syms) { const nm = String(s?.name ?? ""); if (nm !== "") published.add(nm) }
    fileSymbols.set(label, published)

    for (const x of r?.relationships ?? []) {
      const t = ontologyType(x?.type ?? x?.relationshipType)
      if (!t) continue
      const sub = String(x?.metadata?.relationshipSubType ?? "(none)")
      const key = `${t}|${sub}`
      let row = byTypeSubtype.get(key)
      if (!row) { row = { n: 0, ex: [] }; byTypeSubtype.set(key, row) }
      row.n++
      const src = String(x?.source ?? "")
      const tgt = String(x?.target ?? "")
      if (row.ex.length < MAX_EX) row.ex.push(`${src} -> ${tgt}`)

      const c = Number(x?.confidence ?? NaN)
      bump(confHist.get(t)!, !(c >= 0) ? "NaN/absent" : c.toFixed(2))
      bump(evByType.get(t)!, String(x?.evidenceClass ?? "(absent)"))

      const sh = shapeRow(t)
      sh.n++
      bump(sh.src, src === "" ? "<empty>" : src)
      bump(sh.tgt, tgt === "" ? "<empty>" : tgt)
      if (published.has(tgt)) sh.tgtInFile++

      if (t === "extends") { let s = emitExtends.get(label); if (!s) emitExtends.set(label, s = new Set()); s.add(`${src}>${tgt}`) }
      if (t === "implements") { let s = emitImplements.get(label); if (!s) emitImplements.set(label, s = new Set()); s.add(`${src}>${tgt}`) }
    }

    probeCarriers(f, label)
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

function probeCarriers(f: Admitted, label: string): void {
  const tree = parser.parse(f.text)
  if (!tree) return
  const ex: ExtendsDecl[] = []
  const im = new Set<string>()
  const imCond = new Set<string>()
  /** Names a top-level `rm(...)` unbinds. Filled during the visit, applied at the end. */
  const rm = new Set<string>()

  const calleeText = (fn: any): string => {
    if (!fn) return ""
    if (fn.type === "identifier") return fn.text
    const ns = fn.childForFieldName?.("namespace")
    const nm = fn.childForFieldName?.("name")
    if (ns && nm) return `${ns.text}::${nm.text}`
    return fn.text ?? ""
  }
  const strOf = (n: any): string => {
    if (!n) return ""
    if (n.type === "string") return n.text.replace(/^["']|["']$/g, "")
    if (n.type === "identifier") return n.text
    return ""
  }
  /** R's quoted identifier is a plain `identifier` node that still carries its backticks.
   *  Production publishes the UNQUOTED name (`$<-`, not `` `$<-` ``), so a carrier keyed on the
   *  raw `lhs.text` can never agree with an emitted edge. Measured: 53 of 112 candidates in
   *  `adjudicate-carriers.ts`. Without this the probe invents a miss in BOTH directions. */
  const unquote = (t: string): string => t.replace(/^`+|`+$/g, "")
  const stringsIn = (n: any, out: string[]): void => {
    if (!n) return
    if (n.type === "string" || n.type === "identifier") { const s = strOf(n); if (s) out.push(s); return }
    // A call's CALLEE is not an argument. Skipping the `function` field is what stops
    // `contains = c("VIRTUAL", "Matrix")` from contributing a base class named `c` —
    // which is exactly what the first version of this probe did, and it reported 75
    // fabricated "unconditional carriers with no edge" before the fix.
    if (n.type === "call") {
      const fn = n.childForFieldName?.("function")
      const args = n.childForFieldName?.("arguments")
      stringsIn(args, out)
      void fn
      return
    }
    for (let i = 0; i < n.namedChildCount; i++) stringsIn(n.namedChild(i), out)
  }
  /** TRUE when the node sits inside an `if`/`while`/`for` body — a branch R may not take. */
  const insideConditional = (start: any, end: any): boolean => {
    let cur: any = start.parent
    while (cur && cur.startIndex < end) {
      if (cur.type === "if_statement" || cur.type === "while_statement" || cur.type === "for_statement") return true
      cur = cur.parent
    }
    return false
  }

  const visit = (n: any): void => {
    if (n.type === "call") {
      const callee = calleeText(n.childForFieldName?.("function"))
      const bare = callee.includes("::") ? callee.slice(callee.lastIndexOf("::") + 2) : callee
      // A top-level `rm(name)` unbinds `name`. R does not hold the binding afterwards, so a
      // declaration the analyzer drops because of it is CORRECT and must not be counted as
      // a missing edge. Derived from the tree, independently of the analyzer.
      if (bare === "rm" && n.parent?.type === "program") {
        const rargs = n.childForFieldName?.("arguments")
        for (let i = 0; rargs && i < rargs.namedChildCount; i++) {
          const a2 = rargs.namedChild(i)
          if (!a2) continue
          // `rm(x)` carries a bare `identifier`; `rm(x = x)` wraps it in an `argument`.
          // The first version of this read only the bare form and found 0 removals in 40
          // files, which is the same over-claim as before one layer up.
          if (a2.childForFieldName?.("name")) continue
          const v2 = a2.type === "argument" ? a2.childForFieldName?.("value") : a2
          if (v2?.type === "identifier") rm.add(v2.text)
          else if (v2?.type === "string") { const t2 = v2.text.replace(/^["']|["']$/g, ""); if (t2) rm.add(t2) }
        }
      }
      const argName = INHERITANCE_CARRIERS[callee] ?? INHERITANCE_CARRIERS[bare]
      if (argName) {
        // The class's own NAME. S4 writes it as the first string argument (`setClass("Foo", …)`);
        // S7/R6/R5 write it as the binding the call is assigned to (`class_ggplot <-
        // S7::new_class(name = "ggplot", parent = class_gg, …)`). Reading only the first
        // argument took `name = "ggplot"` for the S7 form and keyed the carrier `ggplot` while
        // production publishes `class_ggplot` — one declaration, two keys, both directions of the
        // diff wrong. So collect EVERY spelling and let the diff accept any of them.
        const spellings = new Set<string>()
        let fromLiteral = false
        {
          let cur: any = n.parent
          while (cur && cur.type !== "program") {
            if (cur.type === "binary_operator") {
              const op = cur.childForFieldName?.("operator")?.text
              const lhs = cur.childForFieldName?.("lhs")
              const rhs = cur.childForFieldName?.("rhs")
              // `.id`, NOT `===`. web-tree-sitter materialises a FRESH JS wrapper on every
              // `childForFieldName` call, so object identity is false for the SAME node:
              // verified directly, `rhs === n` -> false while `rhs.id === n.id` -> true. The
              // first version of this LHS preference therefore never fired, silently, and the
              // probe fell through to the first-argument fallback — which is how a correct
              // pair like `class_ggplot -extends-> class_gg` was reported as an edge with no
              // tree carrier while `ggplot -extends-> class_gg` was reported as a carrier with
              // no edge. Two rows of BLOCK B wrong from one `===`.
              if (rhs?.id === n.id && (op === "<-" || op === "=" || op === "<<-") && lhs?.type === "identifier") { spellings.add(unquote(lhs.text)); break }
            }
            cur = cur.parent
          }
          // The DECLARED class name, positional (`new_class("Foo", …)`) or named
          // (`new_class(name = "Foo", …)`). Both spellings name the same class in R. A
          // spelling taken from a STRING is the class name R will use; one taken from an
          // IDENTIFIER is a variable holding it, which is a different thing entirely and is
          // recorded as `fromLiteral: false` so the diff can say so.
          const argsAll = n.childForFieldName?.("arguments")
          for (let i = 0; argsAll && i < argsAll.namedChildCount; i++) {
            const a = argsAll.namedChild(i)
            if (!a || a.type !== "argument") continue
            const argNodeName = a.childForFieldName?.("name")?.text
            if (argNodeName !== undefined && argNodeName !== "name" && argNodeName !== "Class" && argNodeName !== "classname") continue
            const v = a.childForFieldName?.("value") ?? a
            const s = unquote(strOf(v))
            if (s) { spellings.add(s); if (v?.type === "string") fromLiteral = true }
          }
        }
        if (spellings.size) {
          const args = n.childForFieldName?.("arguments")
          for (let i = 0; args && i < args.namedChildCount; i++) {
            const a = args.namedChild(i)
            if (!a || a.type !== "argument") continue
            if (a.childForFieldName?.("name")?.text !== argName) continue
            const bases: string[] = []
            stringsIn(a.childForFieldName?.("value"), bases)
            for (const b of bases) {
              ex.push({ spellings: new Set(spellings), base: b, conditional: insideConditional(n, n.endIndex), fromLiteral })
            }
          }
        }
      }
    }
    // `generic.class <- function(...)`: the S3 registration convention. Only a call value
    // counts, because `x.y <- 5` is data, not a method.
    if (n.type === "binary_operator") {
      const op = n.childForFieldName?.("operator")?.text
      if (op === "<-" || op === "=" || op === "<<-") {
        const lhs = n.childForFieldName?.("lhs")
        const rhs = n.childForFieldName?.("rhs")
        const nm = lhs && lhs.type === "identifier" ? unquote(lhs.text) : ""
        // The RHS of `name.class <- ...` must be a `function_definition` (or a call to
        // one). `x.y <- 5` is data, not a method, so a bare value is excluded.
        const rhsIsFn = rhs?.type === "function_definition"
          || (rhs?.type === "call" && rhs.childForFieldName?.("function")?.type === "identifier" && rhs.childForFieldName("function").text === "function")
        if (nm.includes(".") && nm.indexOf(".") > 0 && !nm.startsWith(".") && rhsIsFn) {
          const pair = `${nm}>${nm.slice(0, nm.indexOf("."))}`
          im.add(pair)
          if (insideConditional(n, n.endIndex)) imCond.add(pair)
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) visit(n.namedChild(i))
  }
  visit(tree.rootNode)
  // `rm()` is collected during the walk because it can appear before OR after the
  // declaration it unbinds, so it can only be applied once the whole file is read.
  for (const nm of rm) {
    for (const pair of im) if (pair.split(">")[0] === nm) im.delete(pair)
    for (const pair of imCond) if (pair.split(">")[0] === nm) imCond.delete(pair)
  }
  // An `rm()` unbinds the NAME. A declaration whose every spelling is removed is not an edge
  // this file can carry: R does not hold the class afterwards either.
  const kept = ex.filter(d => ![...d.spellings].every(s => rm.has(s)))
  if (rm.size) treeRemovedByRm.set(label, rm)
  if (kept.length) treeExtendsDecls.set(label, kept)
  if (im.size) treeImplements.set(label, im)
  if (imCond.size) treeImplementsConditional.set(label, imCond)
  tree.delete?.()
}

// ---------------------------------------------------------------- BLOCK A
console.log("=".repeat(126))
console.log("BLOCK A — every emitted edge keyed by (type, relationshipSubType). A subtype under TWO types is a labelling ambiguity.")
console.log("=".repeat(126))
const subtypesByType = new Map<Type, Map<string, number>>()
for (const [key, row] of byTypeSubtype) {
  const [t, sub] = key.split("|")
  let m = subtypesByType.get(t as Type)
  if (!m) subtypesByType.set(t as Type, m = new Map())
  m.set(sub, row.n)
}
for (const t of ALL_TYPES) {
  const m = subtypesByType.get(t)
  console.log(`\n${t}${m ? `  (${m.size} subtype${m.size === 1 ? "" : "s"})` : "  (no edges)"}`)
  if (!m) continue
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1])
  for (const [sub, n] of rows) {
    const also = ALL_TYPES.filter((o) => o !== t && subtypesByType.get(o)?.has(sub))
    console.log(`  ${sub.padEnd(34)} ${n.toLocaleString().padStart(8)}${also.length ? `   ALSO UNDER: ${also.join(", ")}` : ""}`)
  }
}
const straddling = [...subtypesByType.entries()].flatMap(([t, m]) =>
  [...m.keys()].filter((sub) => ALL_TYPES.some((o) => o !== t && subtypesByType.get(o)?.has(sub))).map((sub) => ({ t, sub })))
console.log(`\nsubtypes straddling two ontology types: ${straddling.length}`)
for (const s of straddling) console.log(`  ${s.sub} -> ${s.t} and ${ALL_TYPES.filter((o) => o !== s.t && subtypesByType.get(o)?.has(s.sub)).join(", ")}`)

// ---------------------------------------------------------------- BLOCK B
console.log("\n" + "=".repeat(126))
console.log("BLOCK B — extends/implements checked against INDEPENDENT tree carriers, not against the analyzer's own rule table")
console.log("=".repeat(126))
function diff(tree: Map<string, Set<string>>, emit: Map<string, Set<string>>, verb: string) {
  let both = 0; const missing: string[] = []; const extra: string[] = []
  const missingPairs: { file: string; src: string; tgt: string; shown: string }[] = []
  for (const [file, pairs] of tree) {
    const e = emit.get(file) ?? new Set<string>()
    for (const p of pairs) {
      if (e.has(p)) { both++; continue }
      const shown = `${file}: ${p.replace(">", ` -${verb}-> `)}`
      if (missing.length < 400) missing.push(shown)
      const i = p.indexOf(">")
      missingPairs.push({ file, src: p.slice(0, i), tgt: p.slice(i + 1), shown })
    }
    for (const p of e) if (!pairs.has(p) && extra.length < 400) extra.push(`${file}: ${p.replace(">", ` -${verb}-> `)}`)
  }
  const treeTotal = [...tree.values()].reduce((a, s) => a + s.size, 0)
  const emitTotal = [...emit.values()].reduce((a, s) => a + s.size, 0)
  return { both, treeTotal, emitTotal, missing, missingPairs, extra }
}
/**
 * The extends side of the diff, one entry per DECLARATION rather than per string pair.
 *
 * R names a class twice when the name is written as a string: `class_labels <-
 * new_class("labels", parent = class_S3_gg)` binds `class_labels` and declares the class
 * `labels`, and production publishes the DECLARED name plus a `References` edge to the
 * binding. A diff keyed on one spelling reports half of every such declaration as a
 * disagreement. So a declaration matches when production published an edge under ANY of the
 * spellings the tree offers, and `matchedBy` says which spelling it used — a convention,
 * stated rather than hidden.
 */
function diffDecls(tree: Map<string, ExtendsDecl[]>, emit: Map<string, Set<string>>, verb: string) {
  let both = 0; let missingCond = 0
  const missingPairs: { file: string; src: string; tgt: string; shown: string; fromLiteral: boolean }[] = []
  const extra: string[] = []
  const matchedBy = new Map<string, number>()
  for (const [file, decls] of tree) {
    const e = emit.get(file) ?? new Set<string>()
    const covered = new Set<string>()
    for (const d of decls) {
      const hit = [...d.spellings].find(s => e.has(`${s}>${d.base}`))
      if (hit !== undefined) {
        both++
        covered.add(`${hit}>${d.base}`)
        matchedBy.set(hit === [...d.spellings][0] ? "binding" : "declared-string", (matchedBy.get(hit === [...d.spellings][0] ? "binding" : "declared-string") ?? 0) + 1)
        continue
      }
      if (d.conditional) missingCond++
      const shown = `${file}: ${[...d.spellings].join(" | ")} -${verb}-> ${d.base}`
      missingPairs.push({ file, src: [...d.spellings][0], tgt: d.base, shown, fromLiteral: d.fromLiteral })
    }
    for (const p of e) if (!covered.has(p) && extra.length < 400) extra.push(`${file}: ${p.replace(">", ` -${verb}-> `)}`)
  }
  const treeTotal = [...tree.values()].reduce((a, s) => a + s.length, 0)
  const emitTotal = [...emit.values()].reduce((a, s) => a + s.size, 0)
  return { both, treeTotal, emitTotal, missingPairs, missingCond, extra, matchedBy }
}
/**
 * A carrier with no edge is only a MISSING EDGE when the analyzer could have published one.
 * Both ends must be names the file itself binds: `implements` is an in-file registration of a
 * generic, so a carrier whose generic lives in base R (`$<-`, `[[<-`) and is not declared here
 * is not an edge this file can carry. The first version of this block had no such check and
 * reported 144 such carriers as "a real gap"; `adjudicate-carriers.ts` re-derived the same set
 * with the check and found 0 unadjudicated.
 */
function classify(pairs: { file: string; src: string; tgt: string; shown: string }[]) {
  const byCode = new Map<string, string[]>()
  const code = (p: { file: string; src: string; tgt: string; fromLiteral?: boolean }) => {
    const syms = fileSymbols.get(p.file)
    if (!syms) return "FILE_NOT_WALKED"
    if (!syms.has(p.tgt)) return "TARGET_NOT_DECLARED_IN_THIS_FILE"
    if (!syms.has(p.src)) return "SOURCE_NOT_DECLARED_IN_THIS_FILE"
    if (p.fromLiteral === false) return "CLASS_NAME_IS_AN_EXPRESSION"
    return "UNADJUDICATED"
  }
  for (const p of pairs) { const c = code(p); let a = byCode.get(c); if (!a) byCode.set(c, a = []); a.push(p.shown) }
  return byCode
}
const dEx = diffDecls(treeExtendsDecls, emitExtends, "extends")
const exCodes = classify(dEx.missingPairs)
const exUnadj = exCodes.get("UNADJUDICATED") ?? []
console.log(`\nextends`)
console.log(`  tree declarations (inherit=/contains=/parent= under a class constructor): ${dEx.treeTotal} in ${treeExtendsDecls.size} files`)
console.log(`  emitted extends pairs:                                              ${dEx.emitTotal} in ${emitExtends.size} files`)
console.log(`  agreement:                                                           ${dEx.both}`)
console.log(`  declaration with NO edge:                                           ${dEx.treeTotal - dEx.both}`)
console.log(`  …of which the declaring call is inside an if/while/for body:         ${dEx.missingCond} (a branch R may never take)`)
console.log(`  reason code for each (a carrier is only a MISSING EDGE when both ends are bindings this file declares):`)
console.log(`  …so UNADJUDICATED declarations (a real gap):                         ${exUnadj.length}${exUnadj.length ? "  <- a real gap" : ""}`)
for (const [code, rows] of [...exCodes.entries()].sort((a, b) => b[1].length - a[1].length))
  console.log(`      ${code.padEnd(36)} ${String(rows.length).padStart(4)}`)
for (const m of exUnadj.slice(0, 12)) console.log(`      ${m}`)
console.log(`  edge with no tree declaration:                                      ${dEx.extra.length}`)
console.log(`  …matched under the BINDING spelling ${dEx.matchedBy.get("binding") ?? 0}, under the DECLARED-STRING spelling ${dEx.matchedBy.get("declared-string") ?? 0}`)
for (const m of dEx.extra.slice(0, 12)) console.log(`      ${m}`)

const dIm = diff(treeImplements, emitImplements, "implements")
const rmNames = new Set<string>()
for (const s of treeRemovedByRm.values()) for (const n of s) rmNames.add(n)
console.log(`  names a top-level rm(...) unbinds across the walk: ${treeRemovedByRm.size} files, ${rmNames.size} distinct names`)
console.log(`  (a declaration removed by rm() is NOT a missing edge — R does not hold it either)`)
console.log(`\nimplements`)
console.log(`  tree carriers (top-level \`generic.class <- function(...)\`): ${dIm.treeTotal} in ${treeImplements.size} files`)
console.log(`  emitted implements pairs:                                   ${dIm.emitTotal} in ${emitImplements.size} files`)
console.log(`  agreement:                                                  ${dIm.both}`)
const missingImCond = dIm.missing.filter((m) => {
  const [file, pair] = m.split(": ")
  const cond = treeImplementsConditional.get(file)
  return !!(cond && cond.has(pair.replace(" -implements-> ", ">")))
})
console.log(`  …of which the declaration is inside an if/while/for body:   ${missingImCond.length} (a branch R may never take)`)
const imCodes = classify(dIm.missingPairs)
const imUnadj = imCodes.get("UNADJUDICATED") ?? []
console.log(`  reason code for each (a carrier is only a MISSING EDGE when both ends are bindings this file declares):`)
console.log(`  …so UNADJUDICATED carriers (a real gap):                     ${imUnadj.length}${imUnadj.length ? "  <- a real gap" : ""}`)
for (const [code, rows] of [...imCodes.entries()].sort((a, b) => b[1].length - a[1].length))
  console.log(`      ${code.padEnd(36)} ${String(rows.length).padStart(4)}`)
for (const m of imUnadj.slice(0, 12)) console.log(`      ${m}`)
console.log(`  edge with no tree carrier:                                  ${dIm.extra.length}`)
for (const m of dIm.extra.slice(0, 12)) console.log(`      ${m}`)

// ---------------------------------------------------------------- BLOCK C
console.log("\n" + "=".repeat(126))
console.log("BLOCK C — confidence and evidenceClass per type. A threshold test alone cannot see a lane sitting on 0.7.")
console.log("=".repeat(126))
console.log(["type".padEnd(13), "edges".padStart(8), ...Array.from({ length: 21 }, (_, i) => (i * 0.05).toFixed(2).padStart(6)), "NaN".padStart(7)].join(""))
for (const t of ALL_TYPES) {
  const h = confHist.get(t)!
  const total = [...h.values()].reduce((a, b) => a + b, 0)
  const cells: string[] = []
  for (let i = 0; i <= 20; i++) { const n = h.get((i * 0.05).toFixed(2)) ?? 0; cells.push(n ? n.toLocaleString().padStart(6) : "     .") }
  console.log([t.padEnd(13), total.toLocaleString().padStart(8), ...cells, (h.get("NaN/absent") ?? 0).toString().padStart(7)].join(""))
}
console.log("\nevidenceClass per type")
for (const t of ALL_TYPES) {
  const m = evByType.get(t)!
  const parts = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n.toLocaleString()}`)
  console.log(`  ${t.padEnd(13)} ${parts.length ? parts.join(" ") : "(no edges)"}`)
}

// ---------------------------------------------------------------- BLOCK D
console.log("\n" + "=".repeat(126))
console.log("BLOCK D — endpoint SHAPE per type. Q5's 0.0% for imports/exports is only readable against this.")
console.log("=".repeat(126))
for (const t of ALL_TYPES) {
  const sh = shapeRow(t)
  if (sh.n === 0) continue
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k}(${n.toLocaleString()})`).join(" ")
  console.log(`\n${t}  (${sh.n.toLocaleString()} edges)`)
  console.log(`  source: ${top(sh.src)}`)
  console.log(`  target: ${top(sh.tgt)}`)
  console.log(`  target present in the same file's symbol set: ${sh.tgtInFile.toLocaleString()} / ${sh.n.toLocaleString()} = ${((sh.tgtInFile / sh.n) * 100).toFixed(1)}%`)
}

console.log(`\nfiles attempted: ${covered.length}   parse failures: ${parseFailures}   degraded parses: ${degraded}`)
process.exitCode = parseFailures === 0 && degraded === 0 ? 0 : 1
