/**
 * R LANE ORACLE — an independent second derivation of every relationship type the
 * analyzer emits, so the lane's six questions have an answer to question 3.
 *
 * WHY THIS FILE EXISTS
 *
 * `script/m14/differential.ts` has no `LANGS.r` entry, so the repository's own
 * harness has never computed a differential row for R. Every type this lane emits
 * is therefore a DERIVATION finding: stored and compared against nothing. That is
 * the workstream's own named failure mode — "the lane's differential reports 99.9%
 * coverage and 0 UNEXPLAINED, and that is TRUE, and it hid a missing relationship
 * type for the whole wave" — and R was maximally exposed to it, because the two
 * types R's object system reaches at all (`overrides`, `instantiates`) fired on 2
 * files and 1 file respectively, which is exactly the population a differential
 * samples away.
 *
 * WHAT IT DOES, AND WHAT IT IS WORTH — read this before quoting a number
 *
 * This oracle walks the parse tree and derives, per type, the SET of
 * (source, target) pairs the grammar says should exist. It is then compared with
 * production `parseFile` output in BOTH directions:
 *
 *   MISSING     the oracle derived an edge the analyzer did not emit. A candidate
 *               GAP. Each one is a measurement, not a verdict: some are the
 *               analyzer's documented gates doing their job.
 *   UNEXPLAINED the analyzer emitted an edge the oracle derived nothing for. A
 *               candidate FABRICATION, which the workstream calls the most
 *               expensive mistake available.
 *
 * The limit, stated because it is the limit the workstream header requires be
 * stated rather than glossed: both walkers read the SAME GRAMMAR. A grammar bug
 * shared by the analyzer and this oracle is invisible to it. Worse, for three
 * types the oracle re-implements the analyzer's own RULE, so it tests EXECUTION,
 * not the rule:
 *
 *   calls      source = nearest enclosing named binding (the analyzer's attribution)
 *   uses       member read = extract_operator outside callee position (the rule)
 *   overrides  base declared in the same file (the analyzer's reach)
 *
 * Those three are marked RULE-COUPLED below and their agreement number must not be
 * read as correctness of the rule. The other seven are checked against rules
 * derived from R's semantics rather than from the analyzer's code, and those are
 * the numbers that carry information.
 *
 * NO REGEX. Every node is reached through `node.type`, named children and field
 * names. A string literal or a comment cannot make a probe fire.
 *
 * USAGE
 *   npx tsx validation/m14/fixtures/r/oracle-r.ts [--sample N] [--repo NAME] [--json out.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

/** Types whose oracle rule IS the analyzer's rule. Agreement here tests execution. */
const RULE_COUPLED: Record<string, string> = {
  calls: "source attribution = nearest enclosing named binding",
  uses: "member read = extract_operator/subset2-string outside callee position",
  overrides: "base must be declared in the same file",
  contains: "file-scope bindings, but the analyzer nests them and this oracle does not",
}

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const SAMPLE_PER_REPO = Number(argOf("--sample") ?? 250)
const REPO_FILTER = new Set(argv.reduce<string[]>((a, v, i) => (v === "--repo" ? [...a, String(argv[i + 1])] : a), []))
const JSON_OUT = argOf("--json")

// ------------------------------------------------------------------ corpus
type CorpusFile = { repo: string; dir: string; rel: string; abs: string; text: string }
const files: CorpusFile[] = []
const reposSeen: string[] = []
for (const e of readdirSync(CR).sort()) {
  if (REPO_FILTER.size > 0 && !REPO_FILTER.has(e)) continue
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  const admitted: CorpusFile[] = []
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "r") continue
    admitted.push({ repo: e, dir, rel, abs, text })
  }
  if (admitted.length === 0) continue
  reposSeen.push(e)
  files.push(...admitted.slice(0, SAMPLE_PER_REPO))
}

// ------------------------------------------------------------------ grammar
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-r.wasm"))))

/** R's own backtick quoting for a reserved word used as a name. Index arithmetic. */
const bareName = (n: any): string | null => {
  if (!n) return null
  if (n.type === "identifier") return n.text.length > 1 && n.text.startsWith("`") && n.text.endsWith("`") ? n.text.slice(1, -1) : n.text
  if (n.type === "string") {
    const c = n.childForFieldName("content") ?? n.namedChildren.find((x: any) => x.type === "string_content")
    return c ? String(c.text) : null
  }
  return null
}
const argsOf = (call: any): any[] => {
  const a = call.childForFieldName("arguments")
  const out: any[] = []
  if (!a) return out
  for (let i = 0; i < a.namedChildCount; i++) { const c = a.namedChild(i); if (c && c.type === "argument") out.push(c) }
  return out
}
const firstPositional = (call: any): any => argsOf(call).find((a) => !a.childForFieldName("name")) ?? null
const calleeName = (fn: any): string | null => {
  if (!fn) return null
  if (fn.type === "identifier") return bareName(fn)
  if (fn.type === "namespace_operator" || fn.type === "extract_operator") return bareName(fn.childForFieldName("rhs"))
  return null
}
const namedArg = (call: any, want: string): any => {
  for (const a of argsOf(call)) if (bareName(a.childForFieldName("name")) === want) return a.childForFieldName("value")
  return null
}
/** Names in `v`: a bare name, or each positional arg of a call like c("A","B"). */
const namesIn = (v: any): string[] => {
  if (!v) return []
  if (v.type === "call") { const out: string[] = []; for (const a of argsOf(v)) { const b = bareName(a.childForFieldName("value")); if (b) out.push(b) } return out }
  const b = bareName(v)
  return b ? [b] : []
}
const listKeys = (v: any): string[] => {
  if (!v || v.type !== "call" || calleeName(v.childForFieldName("function")) !== "list") return []
  const out: string[] = []
  for (const a of argsOf(v)) { const k = bareName(a.childForFieldName("name")); if (k) out.push(k) }
  return out
}
const CLASS_CTORS = new Set(["R6Class", "setRefClass", "new_class", "new_base_class", "setClass"])

/** The oracle's verdict for one file: pairs per type, plus its own counts. */
type OracleFile = { label: string; pairs: Map<Type, Set<string>>; nodes: number }
const walkFile = (root: any, label: string): OracleFile => {
  const pairs = new Map<Type, Set<string>>()
  const add = (t: Type, s: string, d: string): void => { let set = pairs.get(t); if (!set) { set = new Set(); pairs.set(t, set) } set.add(`${s} ${d}`) }
  let nodes = 0

  // ---- pass 1: collect what later passes need, in one walk
  const classes = new Map<string, { system: string; bases: string[]; members: Set<string> }>()
  // Every class DECLARATION of a name, in line order. `classes` above keeps the LAST one,
  // which is a different class whenever a file redeclares a name -- R6's own test suite
  // declares `AC` 19 times in R6/tests/testthat/test-clone.R -- so the `overrides` pass
  // reads this list instead. Added after the analyzer moved to nearest-PRECEDING base
  // resolution (d2fc8626f): with `classes` alone this oracle reported 63 UNEXPLAINED
  // `overrides` edges (66.3%) at R6/tests/manual/encapsulation.R, all of them the shape
  // the analyzer had just stopped inventing. That number was a stale instrument, not a
  // fabrication rate, and the fix is recorded here so the next reader can tell which of
  // the two it is looking at.
  const classDecls = new Map<string, { system: string; bases: string[]; members: Set<string>; line: number }[]>()
  const s4Bases = new Map<string, string[]>()
  const s4Methods = new Map<string, Set<string>>()
  const topLevelBindings = new Set<string>()
  const commentsBefore: { node: any; text: string }[] = []
  const declaredNames = new Set<string>()

  const scan = (n: any): void => {
    nodes++
    if (n.type === "comment") { commentsBefore.push({ node: n, text: n.text }); return }
    if (n.type === "call") {
      const fn = n.childForFieldName("function")
      const fname = calleeName(fn)
      if (fname && CLASS_CTORS.has(fname)) {
        const cname = bareName(firstPositional(n)?.childForFieldName("value") ?? null)
        if (cname) {
          const bases = fname === "R6Class" ? namesIn(namedArg(n, "inherit")) : fname === "setClass" ? namesIn(namedArg(n, "contains")) : fname === "setRefClass" ? namesIn(namedArg(n, "contains")) : namesIn(namedArg(n, "parent"))
          const members = new Set<string>()
          for (const k of ["public", "private", "active", "fields", "methods"]) for (const m of listKeys(namedArg(n, k))) members.add(m)
          classes.set(cname, { system: fname, bases, members })
          let decls = classDecls.get(cname)
          if (!decls) { decls = []; classDecls.set(cname, decls) }
          decls.push({ system: fname, bases, members, line: n.startPosition.row })
          if (fname === "setClass") s4Bases.set(cname, bases)
        }
      }
      if (fname === "setMethod") {
        const a = argsOf(n)
        const m = bareName(a.find((x) => !x.childForFieldName("name"))?.childForFieldName("value") ?? null)
        const sig = a[1]?.childForFieldName("value")
        const owner = sig ? (bareName(sig) ?? (sig.type === "call" ? bareName(argsOf(sig)[0]?.childForFieldName("value") ?? null) : null)) : null
        if (m && owner) { if (!s4Methods.has(owner)) s4Methods.set(owner, new Set()); s4Methods.get(owner)!.add(m) }
      }
    }
    if (n.type === "function_definition") { const nm = bareName(n.childForFieldName("name")); if (nm) declaredNames.add(nm) }
    if (n.type === "binary_operator" || n.type === "=" || n.type === "assignment") {
      const op = n.childForFieldName("operator")
      const o = op ? String(op.text) : (n.type === "binary_operator" ? "" : "=")
      if (o === "=" || o === "<-") { const ln = bareName(n.childForFieldName("lhs") ?? n.childForFieldName("left")); if (ln) declaredNames.add(ln) }
    }
    for (let i = 0; i < n.childCount; i++) scan(n.child(i))
  }
  scan(root)
  // top-level bindings only: a direct child of `program` that binds a name
  for (let i = 0; i < root.namedChildCount; i++) {
    const c = root.namedChild(i)
    if (c.type === "function_definition") { const nm = bareName(c.childForFieldName("name")); if (nm) topLevelBindings.add(nm); continue }
    const op = c.childForFieldName?.("operator")
    const o = op ? String(op.text) : (c.type === "binary_operator" || c.type === "=" ? "=" : "")
    if (o === "=" || o === "<-") { const ln = bareName(c.childForFieldName?.("lhs") ?? c.childForFieldName?.("left")); if (ln) topLevelBindings.add(ln) }
  }

  // ---- pass 2: derive, per type, WITHOUT consulting the analyzer
  const derive = (n: any, owner: string | null): void => {
    nodes++
    switch (n.type) {
      case "call": {
        const fn = n.childForFieldName("function")
        const fname = calleeName(fn)
        if (fname) {
          // calls: the callee name, attributed to the enclosing named binding
          if (owner) add("calls", owner, fname)
          // imports / references: library(x) and require(x) name a PACKAGE.
          //
          // The first revision of this line derived `imports` ONLY from library/require,
          // and the analyzer emitted 2,053 of them, so 85.8% came back UNEXPLAINED — a
          // number that reads as "the analyzer fabricated 1,762 edges" and is actually
          // "the oracle knew about one of R's four dependency forms". R names a
          // dependency four ways and all four are on the tree:
          //
          //   library(dplyr) / require(methods)   a package, attached
          //   source("helpers.R") / sourceCpp(..) a FILE on disk
          //   dplyr::filter(x)                    a package, `::`
          //   internal:::secret()                  a package, `:::`
          //
          // An oracle narrower than the language cannot adjudicate the difference
          // between a convention and a fabrication, so all four are derived here.
          if (fname === "library" || fname === "require") {
            const v = firstPositional(n)?.childForFieldName("value") ?? null
            const pkg = bareName(v)
            if (pkg) { add("imports", "global", pkg); add("references", "global", pkg) }
          }
          if (fname === "source" || fname === "sourceCpp") {
            const v = firstPositional(n)?.childForFieldName("value") ?? null
            const f = bareName(v)
            if (f) { add("imports", "global", f); add("references", "global", f) }
          }
          // instantiates: `new("Cls")` for S4, `Cls$new()` for R6/R5
          if (fname === "new") {
            const cls = bareName(firstPositional(n)?.childForFieldName("value") ?? null)
            if (cls && owner && (s4Bases.has(cls) || classes.has(cls))) add("instantiates", owner, cls)
          }
          // extends: a class constructor naming a parent
          if (CLASS_CTORS.has(fname)) {
            const cname = bareName(firstPositional(n)?.childForFieldName("value") ?? null)
            const cls = classes.get(cname ?? "")
            if (cls) for (const b of cls.bases) add("extends", fname === "new_class" || fname === "new_base_class" ? (cname ?? "") : (cname ?? ""), b)
          }
        }
        if (fn?.type === "extract_operator") {
          const recv = bareName(fn.childForFieldName("lhs"))
          const mem = bareName(fn.childForFieldName("rhs"))
          if (mem === "new" && recv && owner && classes.has(recv)) add("instantiates", owner, recv)
        }
        break
      }
      case "extract_operator": {
        // uses: a member READ. Outside callee position, and not the target of an
        // assignment — both are the analyzer's gates, re-derived here so a change in
        // either shows up as a MISSING row rather than as silence.
        const inCallee = n.parent?.type === "call" && n.parent.childForFieldName("function")?.id === n.id
        const isAssignTarget = n.parent?.type === "binary_operator" && n.parent.childForFieldName?.("lhs")?.id === n.id && String(n.parent.childForFieldName?.("operator")?.text ?? "") === "<-"
        if (!inCallee && !isAssignTarget && owner) {
          const m = bareName(n.childForFieldName("rhs"))
          if (m) add("uses", owner, m)
        }
        break
      }
      case "subset2": {
        const inCallee = n.parent?.type === "call" && n.parent.childForFieldName("function")?.id === n.id
        if (!inCallee && owner) { const s = bareName(n.childForFieldName("arguments")); if (s) add("uses", owner, s) }
        break
      }
      case "binary_operator":
      case "=": {
        const op = n.childForFieldName("operator")
        const o = op ? String(op.text) : (n.type === "binary_operator" ? "" : "=")
        let bindsName: string | null = null
        if (o === "=" || o === "<-") {
          const ln = bareName(n.childForFieldName("lhs") ?? n.childForFieldName("left"))
          const rv = n.childForFieldName("rhs") ?? n.childForFieldName("right")
          if (ln && rv) {
            declaredNames.add(ln)
            bindsName = ln
            // implements: R's S3 convention is a DOTTED name — `print.foo`.
            const dot = ln.indexOf(".")
            if (dot > 0 && dot < ln.length - 1) add("implements", ln, ln.slice(0, dot))
            // references: an S7 binding to the class it names. `class_logical <-
            // new_base_class("logical")` binds `class_logical` to a class whose
            // identity is `logical`; the two are different objects and the graph has to
            // say so. 96 `references` edges came back UNEXPLAINED before this line,
            // every one of them this shape.
            if (rv.type === "call") {
              const rfn = calleeName(rv.childForFieldName("function"))
              if (rfn === "new_class" || rfn === "new_base_class") {
                const declared = bareName(firstPositional(rv)?.childForFieldName("value") ?? null)
                if (declared && declared !== ln) add("references", ln, declared)
              }
            }
          }
        }
        // THE OWNER RULE, and the reason it lives here rather than in a
        // `function_definition` case: tree-sitter-r gives a function node NO `name`
        // field. `f <- function() {}` is a `binary_operator` whose lhs is `f`; the
        // `function_definition` on the right is anonymous. Reading `name` off the
        // function node returns undefined, so an oracle that does it attributes every
        // call in the file to the file and derives ZERO `calls` edges — which is
        // exactly the number the first run of this file produced.
        const rhs = n.childForFieldName?.("rhs") ?? n.childForFieldName?.("right")
        const nextOwner = bindsName !== null && rhs && (rhs.type === "function_definition" || rhs.type === "function") ? bindsName : owner
        for (let i = 0; i < n.childCount; i++) derive(n.child(i), nextOwner)
        return
      }
      case "namespace_operator": {
        // `pkg::name` and `pkg:::name` both name a package as a hard dependency, and
        // the `references` edge beside them records the same fact at a different
        // confidence in the analyzer. Derived here so the two are comparable.
        const pkg = bareName(n.childForFieldName?.("lhs"))
        if (pkg) { add("imports", "global", pkg); add("references", "global", pkg) }
        break
      }
      case "function_definition":
      case "function": {
        // No owner is established here: the grammar records no name for an R function.
        // An ANONYMOUS function keeps the enclosing owner, which is the same
        // attribution the analyzer gives it and the reason its closure edges carry a
        // confidence below 1.0.
        for (let i = 0; i < n.childCount; i++) derive(n.child(i), owner)
        return
      }
      default: break
    }
    for (let i = 0; i < n.childCount; i++) derive(n.child(i), owner)
  }
  derive(root, null)

  // ---- exports: roxygen `@export` on the binding it documents. A CONVENTION, so
  // the instrument is the comment node, never the whole file's text.
  for (const { node, text } of commentsBefore) {
    if (!text.startsWith("#'") || !text.includes("@export")) continue
    // the binding this comment documents: the next sibling that declares a name
    let sib = node.nextNamedSibling
    while (sib) {
      let name: string | null = null
      if (sib.type === "function_definition") name = bareName(sib.childForFieldName("name"))
      else {
        const op = sib.childForFieldName?.("operator")
        const o = op ? String(op.text) : (sib.type === "binary_operator" || sib.type === "=" ? "=" : "")
        if (o === "=" || o === "<-") name = bareName(sib.childForFieldName?.("lhs") ?? sib.childForFieldName?.("left"))
      }
      if (name) { add("exports", "global", name); break }
      sib = sib.nextNamedSibling
    }
  }
  // ---- contains: the file-scope bindings, from `global`
  for (const b of topLevelBindings) add("contains", "global", b)
  // ---- overrides: a derived member shadowing a base member declared in the same file
  //
  // DIRECTION, and this oracle got it wrong first. It read `add("overrides", b, m)`
  // — the BASE as the source — which is the same inversion the analyzer carried, so
  // the two agreed 100% on a wrong answer. That is the sharpest instance of the
  // red-team finding this oracle's own header warns about ("an oracle that shares a
  // bug with the analyzer"), and it survived because the type was marked
  // RULE-COUPLED and nobody asked which way "coupled" pointed.
  //
  // The contract, from outside this lane: real-kotlin-analyzer.ts:537 emits
  // `${ownerName}.${s.name}` -> `${parent}.${s.name}`, and
  // script/m60/objc-line-truth.ts:77 says "an override's line is the overriding
  // declaration". The overriding declaration is the DERIVED one.
  //
  // BASE RESOLUTION IS BY POSITION, from R's own evaluation order rather than from
  // the analyzer's code: `inherit = AC` is an ordinary lookup performed when
  // R6Class() is CALLED, so the binding in scope is the last assignment to `AC`
  // before that line — not the last one in the file and not the union of all of
  // them. A file that redeclares a class therefore has as many distinct classes as
  // it has declarations, and the file-wide `classes` map above (one entry per NAME)
  // collapses them. Iterating that map is what produced the 63 UNEXPLAINED
  // `overrides` edges at R6/tests/manual/encapsulation.R noted at the declaration of
  // `classDecls`: every one of them was the walker pairing a derived declaration's
  // members against a LATER base declaration's members, a pairing R never performs.
  // With the rule below the same walk re-derives the emitted set.
  for (const [cname, decls] of classDecls) {
    for (const decl of decls) {
      if (!decl.members.size || !decl.bases.length) continue
      for (const base of decl.bases) {
        const prior = (classDecls.get(base) ?? []).filter(d => d.line < decl.line)
        if (!prior.length) continue
        const baseDecl = prior[prior.length - 1]
        for (const m of decl.members) if (baseDecl.members.has(m)) add("overrides", cname, m)
      }
    }
  }
  return { label, pairs, nodes }
}

// ------------------------------------------------------------------ compare
type Tally = { oracle: number; emitted: number; missing: number; unexplained: number; missingEg: string[]; unexplainedEg: string[] }
const tally = new Map<Type, Tally>()
const perFile: string[] = []
const get = (t: Type): Tally => { let x = tally.get(t); if (!x) { x = { oracle: 0, emitted: 0, missing: 0, unexplained: 0, missingEg: [], unexplainedEg: [] }; tally.set(t, x) } return x }

let cursor = 0
let filesOracled = 0
let filesCompared = 0
const worker = async (): Promise<void> => {
  for (;;) {
    const i = cursor++
    if (i >= files.length) return
    const f = files[i]
    const label = `${f.repo}/${f.rel}`
    let t: any
    try { t = parser.parse(f.text) } catch { continue }
    if (!t) continue
    filesOracled++
    const o = walkFile(t.rootNode, label)
    t.delete?.()
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    filesCompared++
    // The analyzer's edges, as a SET of pairs, so a duplicate edge does not inflate
    // either side of the comparison.
    const emitted = new Map<Type, Set<string>>()
    for (const rel of r.relationships ?? []) {
      const ty = String(rel.type ?? "").toLowerCase() as Type
      if (!(ALL_TYPES as readonly string[]).includes(ty)) continue
      let set = emitted.get(ty)
      if (!set) { set = new Set(); emitted.set(ty, set) }
      set.add(`${String(rel.source ?? "")} ${String(rel.target ?? "")}`)
    }
    for (const ty of ALL_TYPES) {
      const oSet = o.pairs.get(ty) ?? new Set<string>()
      const eSet = emitted.get(ty) ?? new Set<string>()
      const st = get(ty)
      st.oracle += oSet.size
      st.emitted += eSet.size
      for (const p of oSet) if (!eSet.has(p)) { st.missing++; if (st.missingEg.length < 6) st.missingEg.push(`${label} ${p.replace(" ", " -[?]-> ")}`) }
      for (const p of eSet) if (!oSet.has(p)) { st.unexplained++; if (st.unexplainedEg.length < 6) st.unexplainedEg.push(`${label} ${p.replace(" ", " -[?]-> ")}`) }
    }
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()))

// ------------------------------------------------------------------ output
const out: string[] = []
const say = (s = "") => { out.push(s); console.log(s) }
const pc = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "-")
say(`R LANE ORACLE — independent second derivation vs production parseFile`)
say(`corpus root:     ${CR}`)
say(`repos:           ${reposSeen.length} -> ${reposSeen.join(", ")}`)
say(`files:           ${files.length} sampled, ${filesOracled} oracle-parsed, ${filesCompared} compared through parseFile`)
say("")
say(`THE LIMIT, restated: both walkers read the SAME GRAMMAR, so a grammar bug shared by`)
say(`both is invisible here. And ${Object.keys(RULE_COUPLED).length} types are RULE-COUPLED — the oracle`)
say(`re-derives the analyzer's own rule, so agreement tests EXECUTION, not the rule:`)
for (const [k, v] of Object.entries(RULE_COUPLED)) say(`  ${k}: ${v}`)
say(`The other ${ALL_TYPES.length - Object.keys(RULE_COUPLED).length} are checked against rules derived from R's semantics, not from the analyzer's code.`)
say("")
const hdr = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
say(hdr("type", 14) + hdr("oracle", 10) + hdr("emitted", 10) + hdr("missing", 22) + hdr("unexplained", 24) + "rule")
for (const ty of ALL_TYPES) {
  const s = get(ty)
  say(hdr(ty, 14) + hdr(String(s.oracle), 10) + hdr(String(s.emitted), 10) + hdr(`${s.missing} ${pc(s.missing, s.oracle)}`, 22) + hdr(`${s.unexplained} ${pc(s.unexplained, s.emitted)}`, 24) + (RULE_COUPLED[ty] ? "RULE-COUPLED" : "independent"))
}
say("")
say("EXAMPLES — the two directions that matter")
for (const ty of ALL_TYPES) {
  const s = get(ty)
  if (!s.missing && !s.unexplained) continue
  say(`${ty}:`)
  for (const e of s.missingEg) say(`  MISSING     ${e}`)
  for (const e of s.unexplainedEg) say(`  UNEXPLAINED ${e}`)
}
void perFile

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({
    lang: "r",
    corpusRoot: CR,
    sampling: `git-tracked files routed to "r", first ${SAMPLE_PER_REPO} per repo, git ls-files order`,
    repos: reposSeen,
    filesSampled: files.length,
    filesOracleParsed: filesOracled,
    filesCompared,
    ruleCoupled: RULE_COUPLED,
    types: ALL_TYPES.map((ty) => {
      const s = get(ty)
      return { type: ty, ruleCoupled: Boolean(RULE_COUPLED[ty]), oraclePairs: s.oracle, emittedPairs: s.emitted, missing: s.missing, unexplained: s.unexplained, missingExamples: s.missingEg, unexplainedExamples: s.unexplainedEg }
    }),
  }, null, 2))
  say("")
  say(`wrote ${JSON_OUT}`)
}
// The first run wrote its JSON and then sat there: the tree-sitter parser and the
// pool-worker timers it registered keep the event loop alive, so the process never
// exits on its own and a caller that waits on it waits forever. Every census in this
// lane is a batch job, so it ends explicitly.
process.exit(0)
