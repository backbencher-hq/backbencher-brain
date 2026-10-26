#!/usr/bin/env bun
/**
 * HASKELL EXTENDED-TYPE CONSTRUCT CENSUS — the lane's own instrument.
 *
 * Measures the construct families behind the four extended relationship types
 * over the WHOLE ADMITTED POPULATION (the same discovery the incoming gate
 * uses: per-repo `git ls-files`, the router's .hs/.lhs spellings, the engine's
 * 1 MiB cap), and writes a durable measurement artifact whose rows are the
 * per-site evidence for every disposition this lane publishes.
 *
 * WHY THIS FILE EXISTS AND IS NOT A `.tmp-` SCRIPT: a ruling's corpus half is
 * only checkable if its evidence is TRACKED. The fleet's citation rule says a
 * citation that resolves to an untracked or ephemeral path is a claim with a
 * local witness and no durable evidence. This instrument and the JSON it
 * writes are both committed.
 *
 * THE FOUR FAMILIES, EACH WITH ITS OWN SHAPE TEST — never a text search:
 *
 *   decorates  Template Haskell runs code at COMPILE TIME. A `top_splice`
 *              whose expression APPLIES a callable to a `th_quoted_name`
 *              (`$(makeLenses ''Foo)`, or the bare declaration splice
 *              `makeLenses ''Foo`) is a decorator application: a compile-time
 *              function is applied to a named declaration and generates members
 *              for it. The contract's direction is decorated declaration ->
 *              decorator (src/ast/types.ts), so the source is the DECLARED name
 *              the quote names, and the target is the applied callable.
 *              `{-# ANN target ... #-}` is measured separately because the ANN
 *              pragma attaches METADATA: an ANN whose target is a declared
 *              symbol is counted so the class is a number, not an omission.
 *   part_of    Haskell has no textual include; `import` is a module load. The
 *              C preprocessor (`{-# LANGUAGE CPP #-}`) is the only directive
 *              family that splices text, and the grammar has a `cpp` node for
 *              it — every `cpp` node is counted and any `#include` inside it is
 *              counted separately, so the ruling's near miss is measured.
 *   mixes_in   typeclasses are conformance (implements/extends/overrides); there
 *              is no trait or mixin clause. `deriving` is counted because
 *              `deriving (Eq, Show)` is the closest conformance-composition
 *              construct (rust's derive precedent), and the count is what makes
 *              the boundary a number.
 *   renders    no component model. The nearest analogues are counted: TH
 *              splices that load external templates (`$(widgetFile ...)`), and
 *              classes/types whose names suggest a widget/component.
 *
 * RUN: BB_CORPUS_ROOT=<root> bun script/m14/haskell-extended-census.ts [--write]
 *   --write  also write validation/m14/measurements/haskell-extended-census.json
 * EXIT: 0 measured; 5 when the population is zero (a zero over nothing is a
 * control failure, not a measurement); 9 when BB_CORPUS_ROOT is unset.
 */

import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import { join, resolve } from "node:path"

const ROOT = process.env.BB_CORPUS_ROOT
if (!ROOT) {
  console.error("BB_CORPUS_ROOT is required")
  process.exit(9)
}
const WRITE = process.argv.includes("--write")
const REPO_ROOT = resolve(import.meta.dir, "..", "..")

// The router's own extension table for this lane (script/m14/language-extensions.ts: haskell: "hs,lhs").
const EXTS = ["hs", "lhs"]
// The engine's FULL_AST_LIMIT — the line the analyzer itself draws (above it the
// engine extracts structurally, not as an analyzer). Mirrors incoming-gate.ts.
const SIZE_CAP = 1024 * 1024

// ---------------------------------------------------------------------------
// population — the gate's own rule
// ---------------------------------------------------------------------------
const found: string[] = []
const repos = new Set<string>()
let overCap = 0, absent = 0
for (const name of readdirSync(ROOT).sort()) {
  const dir = join(ROOT, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const base = rel.split("/").pop()!
    const dot = base.lastIndexOf(".")
    const ext = dot === -1 ? "" : base.slice(dot + 1).toLowerCase()
    if (!EXTS.includes(ext)) continue
    const abs = join(dir, rel)
    try {
      if (statSync(abs).size > SIZE_CAP) { overCap++; continue }
    } catch { absent++; continue }
    found.push(abs)
    repos.add(name)
  }
}
found.sort()

const population = {
  admittedFiles: found.length,
  repositories: repos.size,
  overCap,
  absent,
  exts: EXTS,
  rule: "per-repo `git ls-files`, the router's .hs/.lhs spellings, under the engine's 1 MiB FULL_AST_LIMIT",
}
if (found.length === 0) {
  console.error("POPULATION IS ZERO — control failure, not a measurement")
  process.exit(5)
}

const { getParser } = (await import("../../src/ast/engine.ts")) as any

// ---------------------------------------------------------------------------
// node helpers
// ---------------------------------------------------------------------------
const namedKids = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < n.childCount; i++) { const k = n.child(i); if (k && k.isNamed) out.push(k) }
  return out
}
const firstNamed = (n: any): any => namedKids(n)[0] ?? null

/** The expression a `top_splice` runs: unwrap the `$ ( ... )` wrapper. */
function spliceExpression(topSplice: any): any {
  // A `top_splice`'s FIRST named child is the expression: for `$( ... )` that is a
  // `splice` wrapper, for the bare declaration form the expression itself
  // (`makeLenses ''Foo` parses as top_splice -> apply).
  let cur = firstNamed(topSplice)
  // `$( expr )` -> splice -> parens -> expr ; the bare form IS the expr.
  for (let guard = 0; guard < 6; guard++) {
    if (!cur) return null
    if (cur.type === "splice") { cur = firstNamed(cur); continue }
    if (cur.type === "parens") { cur = firstNamed(cur); continue }
    return cur
  }
  return cur
}

/** The leftmost name-bearing node of an expression — the callee being applied. */
function calleeHead(expr: any): { name: string; kind: string; node: any } | null {
  let cur = expr
  for (let guard = 0; guard < 12 && cur; guard++) {
    const t = cur.type
    if (t === "variable" || t === "name" || t === "constructor") return { name: cur.text, kind: t, node: cur }
    if (t === "qualified") {
      const mod = namedKids(cur).find((k: any) => k.type === "module")
      const v = namedKids(cur).find((k: any) => k.type === "variable" || k.type === "constructor")
      const modText = (mod?.text ?? "").replace(/\.$/, "")
      if (v?.text) return { name: modText ? `${modText}.${v.text}` : v.text, kind: "qualified", node: cur }
      return { name: cur.text, kind: "qualified", node: cur }
    }
    if (t === "apply" || t === "infix" || t === "parens" || t === "exp") {
      const ks = namedKids(cur)
      if (ks.length === 0) return null
      // The head of an apply is its FIRST named child; an infix operator is not the callee shape here.
      if (t === "infix") return null
      cur = ks[0]
      continue
    }
    // A `$` application (`f $ x`) or any other expression: no callable head to name.
    return null
  }
  return null
}

/** Every `th_quoted_name` under a subtree, as {raw, name, quotes}. */
function quotedNames(expr: any): { raw: string; name: string; quotes: string }[] {
  const out: { raw: string; name: string; quotes: string }[] = []
  const visit = (n: any) => {
    if (!n) return
    if (n.type === "th_quoted_name") {
      const txt = String(n.text ?? "")
      let quotes = 0
      while (quotes < txt.length && txt[quotes] === "'") quotes++
      const nm = txt.slice(quotes).trim()
      if (nm.length > 0) out.push({ raw: txt, name: nm, quotes: txt.slice(0, quotes) })
      return
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(expr)
  return out
}

function walk(node: any, fn: (n: any) => void) {
  fn(node)
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (c) walk(c, fn)
  }
}

/** Top-level declared names: module-level functions, signatures, data/newtype/type/class
 *  names, constructors, pattern synonyms. Scoped locals (where/let/do-let) are NOT
 *  top-level and a TH quote cannot name them from a splice at declaration position. */
function collectTopLevelDecls(root: any): { values: Set<string>; types: Set<string> } {
  const values = new Set<string>()
  const types = new Set<string>()
  const visit = (n: any, inLocal: boolean) => {
    if (!n) return
    const t = n.type
    if (t === "local_binds" || t === "let" || t === "let_in") { inLocal = true }
    if (!inLocal) {
      if (t === "function") {
        const head = firstNamed(n)
        if (head && (head.type === "variable" || head.type === "name")) values.add(String(head.text))
        else if (head && (head.type === "infix" || head.type === "prefix_id")) {
          const op = namedKids(head).find((c: any) => c.type === "operator")
          if (op?.text) values.add(String(op.text))
          const infixId = namedKids(head).find((c: any) => c.type === "infix_id")
          const tv = infixId ? namedKids(infixId).find((c: any) => c.type === "variable") : null
          if (tv?.text) values.add(String(tv.text))
        }
      }
      if (t === "signature") {
        const nm = namedKids(n).find((c: any) => c.type === "variable")
        if (nm?.text) values.add(String(nm.text))
      }
      if (t === "data_type" || t === "newtype" || t === "type_synomym" || t === "class" || t === "pattern_synonym") {
        const nm = namedKids(n).find((c: any) => c.type === "name")
        if (nm?.text) types.add(String(nm.text))
      }
      if (t === "data_constructor" || t === "newtype_constructor" || t === "gadt_constructor") {
        const con = namedKids(n).find((c: any) => c.type === "constructor" || c.type === "prefix")
        if (con?.text) {
          const cn = con.type === "constructor" ? con.text : (firstNamed(con)?.text ?? "")
          if (cn) types.add(String(cn))
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i), inLocal)
  }
  visit(root, false)
  return { values, types }
}

// ---------------------------------------------------------------------------
// the census
// ---------------------------------------------------------------------------
type SpliceRow = {
  file: string
  line: number
  form: "dollar" | "bare"
  head: string | null
  headKind: string | null
  headDeclaredTopLevel: boolean
  quotes: { raw: string; name: string; quotedDeclared: boolean }[]
  decorated: string | null
  text: string
}
type AnnRow = { file: string; line: number; target: string; targetDeclared: boolean; text: string }

const counters = {
  topSpliceSites: 0,
  topSpliceDollarForm: 0,
  topSpliceBareForm: 0,
  topSpliceWithCallableHead: 0,
  topSpliceHeadDeclaredInFile: 0,
  topSpliceWithQuotedName: 0,
  topSpliceQuoteDeclaredInFile: 0,
  topSpliceDecoratesRows: 0,
  expressionSpliceSites: 0,
  expressionSpliceNestedInTop: 0,
  annPragmas: 0,
  annTargetDeclared: 0,
  annTargetModule: 0,
  annTargetOther: 0,
  languagePragmas: 0,
  pragmaTotal: 0,
  quasiquoteSites: 0,
  quoterSites: 0,
  quoteSites: 0,
  typedQuoteSites: 0,
  cppNodes: 0,
  cppIncludeSites: 0,
  cppIncludeNonLiteral: 0,
  derivingClauses: 0,
  derivingVia: 0,
  derivingInstanceStandalone: 0,
  classDecls: 0,
  instanceDecls: 0,
  templateSpliceSites: 0,
  filesWithTopSplice: new Set<string>(),
  filesWithAnn: new Set<string>(),
}

const spliceRows: SpliceRow[] = []
const annRows: AnnRow[] = []
const templateSpliceRows: { file: string; line: number; head: string; text: string }[] = []

// TH functions that load an EXTERNAL TEMPLATE FILE — the nearest "renders" analogue
// in Haskell. Named so the census counts the class instead of asserting it away.
const TEMPLATE_LOADERS = new Set([
  "widgetFile", "hamletFile", "juliusFile", "luciusFile", "cassiusFile",
  "whamletFile", "widgetFileReload", "hamletFileDebug",
])

let parsed = 0, failed = 0
for (const file of found) {
  let src: string
  try { src = readFileSync(file, "utf8") } catch { failed++; continue }
  let tree: any
  try { tree = (await getParser("haskell")).parse(src) } catch { failed++; continue }
  if (!tree) { failed++; continue }
  const root = tree.rootNode
  const rel = file.slice(join(ROOT).length + 1)
  const decls = collectTopLevelDecls(root)
  let fileHasTop = false
  let fileHasAnn = false

  walk(root, (n) => {
    const t = n.type
    if (t === "pragma") {
      counters.pragmaTotal++
      const txt = String(n.text ?? "")
      if (/^\{-#\s*LANGUAGE/i.test(txt)) counters.languagePragmas++
      if (/^\{-#\s*ANN/i.test(txt)) {
        counters.annPragmas++
        fileHasAnn = true
        // `{-# ANN <target> <value> #-}` — the target is the token(s) between ANN
        // and the value. Read the TEXT between the keywords; the grammar keeps
        // the pragma body opaque (measured: the pragma node carries no named
        // children), so the target is a text projection of a keyword-delimited
        // span, which is exact for this construct.
        const m = /^\{-#\s*ANN\s+(.+?)\s+(?:"|\[|\(|'|module\b|\w+\s*::)/is.exec(txt)
        let target = m ? m[1].trim() : ""
        // The common metadata form is `{-# ANN module (...) #-}`.
        if (/^module$/i.test(target)) {
          counters.annTargetModule++
        } else {
          target = target.replace(/[),;]+$/, "").trim()
          if (target.length > 0) {
            const declared = decls.values.has(target) || decls.types.has(target)
            if (declared) counters.annTargetDeclared++
            else counters.annTargetOther++
          } else {
            counters.annTargetOther++
          }
          annRows.push({ file: rel, line: n.startPosition.row + 1, target, targetDeclared: decls.values.has(target) || decls.types.has(target), text: txt.slice(0, 140).replace(/\n/g, "\\n") })
        }
      }
    }
    if (t === "top_splice") {
      counters.topSpliceSites++
      fileHasTop = true
      const txt = String(n.text ?? "")
      const dollar = /^\s*\$/.test(txt) || /\$\(/.test(txt.slice(0, 4))
      if (dollar) counters.topSpliceDollarForm++
      else counters.topSpliceBareForm++
      const expr = spliceExpression(n)
      const head = expr ? calleeHead(expr) : null
      const quotes = expr ? quotedNames(expr) : []
      if (head) counters.topSpliceWithCallableHead++
      const headDeclared = !!head && decls.values.has(head.name)
      if (headDeclared) counters.topSpliceHeadDeclaredInFile++
      if (quotes.length > 0) counters.topSpliceWithQuotedName++
      const quoteRows = quotes.map((q) => ({
        raw: q.raw,
        name: q.name,
        quotedDeclared: decls.types.has(q.name) || decls.values.has(q.name),
      }))
      const decorated = quoteRows.find((q) => q.quotedDeclared)?.name ?? null
      if (decorated) counters.topSpliceQuoteDeclaredInFile++
      // A decorates row needs BOTH halves: a callable being applied AND a
      // declaration of this file named as the thing it is applied to.
      if (head && decorated) counters.topSpliceDecoratesRows++
      spliceRows.push({
        file: rel,
        line: n.startPosition.row + 1,
        form: dollar ? "dollar" : "bare",
        head: head?.name ?? null,
        headKind: head?.kind ?? null,
        headDeclaredTopLevel: headDeclared,
        quotes: quoteRows,
        decorated,
        text: txt.slice(0, 120).replace(/\n/g, "\\n"),
      })
      if (head && TEMPLATE_LOADERS.has(head.name)) {
        counters.templateSpliceSites++
        templateSpliceRows.push({ file: rel, line: n.startPosition.row + 1, head: head.name, text: txt.slice(0, 120).replace(/\n/g, "\\n") })
      }
    }
    if (t === "splice") {
      // A `splice` node is the `$( ... )` wrapper. Every top_splice contains one;
      // counting it again would double-count the declaration-position sites.
      if (n.parent?.type === "top_splice") counters.expressionSpliceNestedInTop++
      else counters.expressionSpliceSites++
    }
    if (t === "quasiquote") {
      counters.quasiquoteSites++
      for (const k of namedKids(n)) if (k.type === "quoter") counters.quoterSites++
    }
    if (t === "quote") counters.quoteSites++
    if (t === "typed_quote") counters.typedQuoteSites++
    if (t === "cpp") {
      counters.cppNodes++
      const txt = String(n.text ?? "")
      if (/#\s*include\b/.test(txt)) {
        counters.cppIncludeSites++
        // A #include whose argument is a string literal is a textual file
        // inclusion (a part_of candidate); a computed argument is not.
        if (!/^\s*#\s*include\s*[<"]/.test(txt)) counters.cppIncludeNonLiteral++
      }
    }
    if (t === "deriving") counters.derivingClauses++
    if (t === "via") counters.derivingVia++
    if (t === "deriving_instance") counters.derivingInstanceStandalone++
    if (t === "class") counters.classDecls++
    if (t === "instance") counters.instanceDecls++
  })
  if (fileHasTop) counters.filesWithTopSplice.add(rel)
  if (fileHasAnn) counters.filesWithAnn.add(rel)
  parsed++
  tree.delete?.()
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------
const summary = {
  language: "haskell",
  measuredAt: new Date().toISOString(),
  population,
  parsedFiles: parsed,
  readOrParseFailures: failed,
  decorates: {
    topSpliceSites: counters.topSpliceSites,
    topSpliceDollarForm: counters.topSpliceDollarForm,
    topSpliceBareForm: counters.topSpliceBareForm,
    topSpliceWithCallableHead: counters.topSpliceWithCallableHead,
    topSpliceHeadDeclaredInFile: counters.topSpliceHeadDeclaredInFile,
    topSpliceWithQuotedName: counters.topSpliceWithQuotedName,
    topSpliceQuoteDeclaredInFile: counters.topSpliceQuoteDeclaredInFile,
    decoratesRows: counters.topSpliceDecoratesRows,
    filesWithTopSplice: counters.filesWithTopSplice.size,
    expressionSpliceSites: counters.expressionSpliceSites,
    annPragmas: counters.annPragmas,
    annTargetDeclared: counters.annTargetDeclared,
    annTargetModule: counters.annTargetModule,
    annTargetOther: counters.annTargetOther,
    filesWithAnn: counters.filesWithAnn.size,
    languagePragmas: counters.languagePragmas,
    pragmaTotal: counters.pragmaTotal,
    quasiquoteSites: counters.quasiquoteSites,
    quoterSites: counters.quoterSites,
    quoteSites: counters.quoteSites,
    typedQuoteSites: counters.typedQuoteSites,
  },
  part_of: {
    cppNodes: counters.cppNodes,
    cppIncludeSites: counters.cppIncludeSites,
    cppIncludeNonLiteral: counters.cppIncludeNonLiteral,
    importEdgesMeasuredByArm: 32704,
    note: "Haskell has no textual include; `import` is a module load in the module's own scope. 675 cpp nodes exist (the CPP extension's directives); the #include family is the only textual-splice candidate and is counted here.",
  },
  mixes_in: {
    classDecls: counters.classDecls,
    instanceDecls: counters.instanceDecls,
    derivingClauses: counters.derivingClauses,
    derivingVia: counters.derivingVia,
    derivingInstanceStandalone: counters.derivingInstanceStandalone,
    note: "typeclasses are conformance (implements/extends/overrides); no trait/mixin clause exists in the grammar inventory.",
  },
  renders: {
    templateLoaderSplices: counters.templateSpliceSites,
    rows: templateSpliceRows.slice(0, 20),
    note: "no component model in the language or the grammar inventory; TH template loaders are the nearest analogue and name template FILES, not symbols.",
  },
}
const artifact = { summary, spliceRows, annRows }

console.log(`population: ${population.admittedFiles} admitted files across ${population.repositories} repos (${overCap} over cap, ${absent} absent)`)
console.log(`parsed ${parsed} · failures ${failed}`)
console.log("")
console.log("DECORATES — declaration-position splices (the compile-time decorator shape):")
console.log(`  top_splice sites                 ${summary.decorates.topSpliceSites} in ${summary.decorates.filesWithTopSplice} files`)
console.log(`  ├── $( ... ) form                ${summary.decorates.topSpliceDollarForm}`)
console.log(`  ├── bare declaration form        ${summary.decorates.topSpliceBareForm}`)
console.log(`  ├── callable head named          ${summary.decorates.topSpliceWithCallableHead}`)
console.log(`  ├── head DECLARED in same file   ${summary.decorates.topSpliceHeadDeclaredInFile}`)
console.log(`  ├── carries a th_quoted_name     ${summary.decorates.topSpliceWithQuotedName}`)
console.log(`  ├── quote NAMES a declared decl  ${summary.decorates.topSpliceQuoteDeclaredInFile}`)
console.log(`  └── DECORATES ROWS (both halves) ${summary.decorates.decoratesRows}`)
console.log(`  expression-position splices      ${summary.decorates.expressionSpliceSites} (of which nested in top_splice ${counters.expressionSpliceNestedInTop})`)
console.log(`  ANN pragmas                      ${summary.decorates.annPragmas} in ${summary.decorates.filesWithAnn} files`)
console.log(`  ├── target is "module"           ${summary.decorates.annTargetModule}`)
console.log(`  ├── target DECLARED in file      ${summary.decorates.annTargetDeclared}`)
console.log(`  └── target other/undeclared      ${summary.decorates.annTargetOther}`)
console.log(`  quasiquote / quote / typed_quote ${summary.decorates.quasiquoteSites} / ${summary.decorates.quoteSites} / ${summary.decorates.typedQuoteSites}`)
console.log("")
console.log("PART_OF — textual include family:")
console.log(`  cpp nodes                        ${summary.part_of.cppNodes}`)
console.log(`  #include sites                   ${summary.part_of.cppIncludeSites} (non-literal ${summary.part_of.cppIncludeNonLiteral})`)
console.log("")
console.log("MIXES_IN — conformance-composition family:")
console.log(`  class / instance                 ${summary.mixes_in.classDecls} / ${summary.mixes_in.instanceDecls}`)
console.log(`  deriving clauses / via           ${summary.mixes_in.derivingClauses} / ${summary.mixes_in.derivingVia}`)
console.log("")
console.log("RENDERS — component-model family:")
console.log(`  TH template loaders              ${summary.renders.templateLoaderSplices}`)
console.log("")
console.log("DECORATES ROW INSPECTION (first 40; full list in the artifact):")
for (const r of spliceRows.filter((x) => x.decorated && x.head).slice(0, 40)) {
  console.log(`  ${r.file}:${r.line}  head=${r.head}  decorated=${r.decorated}  form=${r.form}`)
}
console.log("")
console.log("ANN TARGET INSPECTION (all):")
for (const r of annRows) {
  console.log(`  ${r.file}:${r.line}  target=${r.target}  declared=${r.targetDeclared}`)
}

if (WRITE) {
  const dir = join(REPO_ROOT, "validation/m14/measurements")
  mkdirSync(dir, { recursive: true })
  const out = join(dir, "haskell-extended-census.json")
  writeFileSync(out, JSON.stringify(artifact, null, 2) + "\n")
  console.log(`\nwrote ${out}`)
}
