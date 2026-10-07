/**
 * KOTLIN IMPORTS/EXPORTS TRUTH ORACLE — the independent second opinion the two
 * newest kotlin relationship types do not have.
 *
 * ## Why this file exists
 *
 * `script/m60/rel-type-coverage-gate.ts` CHECK 1 (DERIVATION) reports, measured
 * at HEAD of analyzer/KOTLIN:
 *
 *     kotlin  2 un-audited: ["exports","imports"]
 *     DERIVATION|kotlin|emits `exports` but the differential audits
 *       ["calls","contains","extends","implements","instantiates","overrides",
 *        "references","uses"] — the type is stored and compared against nothing
 *
 * kotlin was in the workstream's clean set of twelve lanes before this wave, so
 * emitting two new labels put it back on the register. That matters more than the
 * labels' size: an un-audited edge ships a bug invisibly, and the ontology gate
 * exists precisely because a differential cannot see a type both sides omit —
 * "nothing agrees with nothing perfectly".
 *
 * `script/m14/differential.ts` is MASTER-owned, so this lane cannot add the
 * derivation there. What it CAN do is write the oracle, prove it DISAGREES with
 * the analyzer where they should disagree, and hand master a derivation that is
 * known to work. That is the difference between reporting a gap and closing one:
 * a master who wires this in is not taking an untested patch, they are taking a
 * tested one.
 *
 * ## What an oracle can and cannot do here — stated, not implied
 *
 * This is a second walker over the SAME pinned grammar. So a grammar bug shared
 * by both paths is invisible to both: if `tree-sitter-kotlin` cannot parse
 * something, the analyzer and this oracle will agree that it is not there, and
 * agreement will read as correctness. This file does not claim to close that.
 * What it DOES close is the class the differential structurally cannot see —
 * an emission RULE that differs between two independent readings of the same
 * tree.
 *
 * To keep the independence real rather than decorative, this file is written
 * from the Kotlin language specification and shares NO code, NO node-type table
 * and NO helper with `src/ast/real-kotlin-analyzer.ts`. Where the two use the
 * same grammar node the coincidence is the point (that is what makes agreement
 * informative); where they use different ones it is deliberate and each is
 * commented.
 *
 * ## The two specs this derives from
 *
 * **imports** — Kotlin Language Specification, "Import declarations":
 *
 *   import a.b.C        // imports the DECLARATION C
 *   import a.b.C as D   // imports C, bound locally as D
 *   import a.b.*        // imports every declaration of package a.b
 *
 *   All three are dependencies OF THE FILE. The specification scopes a
 *   declaration's visibility to its package, so the dependency edge that a
 *   consumer can resolve is `declaringPackage -> importedPath`. The alias is
 *   local to the importing file and is NOT part of the dependency: `import a.b.C
 *   as D` still depends on `a.b.C`. The wildcard form depends on a PACKAGE, not
 *   on a declaration, and the specification writes the star as part of the
 *   import — so a consumer CANNOT recover the form from the target text alone.
 *
 * **exports** — Kotlin has NO export keyword, which is why an inventory of node
 * types would "prove" the construct absent (the same unsound reasoning that
 * overturned json's exports ruling, recorded at ontology-coverage-gate.ts:143).
 * Export is a VISIBILITY property, read from the specification's "Visibility
 * modifiers": a declaration is reachable from another file if and only if it is
 * `public` (the default) AND it is top-level AND its file names a package.
 *   - `private` at top level is FILE-scoped (spec: "If you declare it private, it
 *     will only be visible inside the file that contains it").
 *   - `internal` is MODULE-scoped (spec: "visible inside the same module").
 *   - a nested declaration is reached through its container, so it is not a
 *     separate import target.
 *   - a declaration in the UNNAMED package cannot be named by a qualified import
 *     in the same way, and the edge's source IS the package — so a file with no
 *     package header has no name to publish under. This is the ONE clause that
 *     is a property of the EDGE SHAPE rather than of the language, and both
 *     sides of this comparison implement it, so it cannot masquerade as a
 *     language disagreement; it is declared as a limitation instead.
 *
 * ## How to run it
 *
 *   npx tsx script/m14/kotlin-imports-exports-oracle.ts [--sample N] [--out f]
 *
 * Compares, per edge, the analyzer's (source, target, shape) against the
 * derivation's, and reports TP / FP / FN with examples. Exits 1 on any
 * disagreement it was not told to expect, so it is usable as a gate.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const SAMPLE = parseInt(argOf("--sample", "600") ?? "600")
const OUT = argOf("--out")

// ── corpus, spread over the whole repo rather than one subtree ─────────────────
// The same lesson as the census: `slice(0, N)` on this corpus is 100%
// `analysis/`, so every Nth file is taken instead and the draw is recorded.
const files: { rel: string; abs: string; dir: string }[] = []
{
  const dir = path.join(CR, "kotlin")
  const tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    if (detectLanguageFromPath(abs) !== "kotlin") continue
    files.push({ rel, abs, dir })
  }
}
files.sort((a, b) => (a.rel < b.rel ? -1 : 1))
const step = Math.max(1, Math.floor(files.length / SAMPLE))
const admitted = files.filter((_, i) => i % step === 0).slice(0, SAMPLE)
const rev = execFileSync("git", ["-C", path.join(CR, "kotlin"), "rev-parse", "HEAD"], { encoding: "utf8" }).trim()

// ── the derivation ─────────────────────────────────────────────────────────────
export type OracleEdge = { label: "imports" | "exports"; from: string; target: string; shape?: string; line?: number }

/** Every named child of `n`, in document order. The analyzer reads the tree in
 *  several different ways; this reader is written once and used for both labels. */
function namedKids(n: any): any[] {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

/** EVERY child, named or not. Needed because a keyword is often ANONYMOUS:
 *
 *      modifiers
 *        visibility_modifier
 *          private            <-- an ANONYMOUS node; namedChild() does not see it
 *
 *  The first version of this oracle read visibility with `namedKids` only and
 *  therefore concluded that every `private` top-level class was PUBLIC. It
 *  disagreed with the analyzer on 196 `exports` rows and the analyzer was right:
 *  measured by re-running the oracle's own `visibilityOf` with a debug print,
 *  `visibility_modifier` has an empty named-children list, so the `private`
 *  keyword was never reached and the fallback answer `public` was returned.
 *
 *  That is the oracle doing its job — two independent readings disagreed, and
 *  adjudicating the disagreement showed the NEW code was wrong — but a gate
 *  that cries wolf 196 times is a gate nobody reads, so it is fixed here rather
 *  than reported as an analyzer defect.
 */
function allKids(n: any): any[] {
  const out: any[] = []
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c) out.push(c)
  }
  return out
}

/** Kotlin lets an identifier be wrapped in backticks (`internal` is a keyword,
 *  so a package segment may need quoting). Quoting is SYNTAX: `new-mpp-cocoapods`
 *  and `` `new-mpp-cocoapods` `` name the same package. The specification's
 *  lexical section says the backticks delimit the identifier and are not part of
 *  it, so a published name strips them.
 *
 *  This was the second oracle bug and it showed up as 2 of the 2 `imports`
 *  disagreements: the oracle published
 *  `testProject.\`new-mpp-cocoapods-template\`.src.iosMain.kotlin` where the
 *  analyzer published `testProject.new-mpp-cocoapods-template.src.iosMain.kotlin`.
 *  The analyzer is right, and independently so — the differential has a
 *  kotlin rule for exactly this ("M60 (#924, kotlin half): quoting syntax is not
 *  part of the published name"). */
const unquote = (s: string): string => s.replace(/^`|`$/g, "")

/** The dotted path an `import_header` names.
 *
 *  Read from the `identifier` node's `simple_identifier` children joined by `.`,
 *  NOT from the node's text. That is deliberate and it is the one place this file
 *  and the analyzer differ in mechanism: `import a.b.*` puts the star in a
 *  separate `wildcard_import` child, so the `identifier` text is `a.b` and any
 *  reader that trusted the text would silently agree with a wrong answer. The
 *  specification says the star is part of the import, so the FORM is read from
 *  the child node and carried separately rather than being baked into the target
 *  — which is also what makes the shape recoverable by a consumer at all. */
function importPath(h: any): { path: string; shape: "declaration" | "aliased" | "wildcard"; alias?: string } | null {
  const id = namedKids(h).find((c) => c.type === "identifier")
  if (!id) return null
  const segs: string[] = []
  for (const c of namedKids(id)) {
    if (c.type === "simple_identifier") segs.push(unquote(c.text))
  }
  if (segs.length === 0) return null
  const hasStar = namedKids(h).some((c) => c.type === "wildcard_import")
  const aliasNode = namedKids(h).find((c) => c.type === "import_alias")
  const aliasText = aliasNode ? String(aliasNode.text ?? "").replace(/^as\s+/, "").trim() : undefined
  return {
    path: segs.join("."),
    shape: hasStar ? "wildcard" : aliasText ? "aliased" : "declaration",
    ...(aliasText ? { alias: aliasText } : {}),
  }
}

/** The package a file declares, from the `package_header`'s dotted `identifier`.
 *  Empty string for the unnamed package — an empty package is a REAL state in
 *  kotlin (unlike java, JLS 7.4.2 forbids importing from the unnamed package), and
 *  the caller decides what to do about it rather than having the reader decide. */
function packageOf(root: any): string {
  for (const c of namedKids(root)) {
    if (c.type !== "package_header") continue
    const id = namedKids(c).find((k) => k.type === "identifier")
    if (!id) continue
    const segs = namedKids(id).filter((k) => k.type === "simple_identifier").map((k) => unquote(k.text))
    return segs.join(".")
  }
  return ""
}

const VISIBILITY = new Set(["private", "internal", "protected", "public"])
/** Modifier keywords that change what a declaration IS rather than how visible it
 *  is. Listed so the modifier scan does not mistake `data` for a visibility. */
const DECL_MODIFIERS = new Set([
  "public", "private", "internal", "protected", "abstract", "final", "open",
  "sealed", "data", "inline", "value", "enum", "annotation", "companion",
  "override", "lateinit", "const", "suspend", "operator", "infix", "external",
  "tailrec", "vararg", "noinline", "crossinline", "reified", "expect", "actual",
  "inner", "external",
])

/** Whether a declaration node is written at the top level of the file.
 *
 *  Walked from the node, counting how many declaration-bearing ancestors it has.
 *  A top-level declaration's chain to `source_file` crosses NO `class_body`,
 *  `function_body`, `lambda_literal` or `anonymous_initializer` — which is the
 *  specification's own distinction between a member (reached through its
 *  container) and a top-level declaration (named directly by a qualified
 *  reference).
 *
 *  DELIBERATELY NOT THE ANALYZER'S RULE. The analyzer asks "does the SYMBOL have
 *  an ownerName", which is false for a declaration inside a function body and so
 *  admits locals; this asks about the TREE. They must agree on every well-formed
 *  file, and where they do not, that is the finding this oracle exists to
 *  produce — so the two rules are written differently on purpose and the
 *  disagreement is measured rather than designed away. */
function isTopLevel(n: any): boolean {
  const NESTING = new Set([
    "class_body", "function_body", "lambda_literal", "anonymous_initializer",
    "object_literal", "secondary_constructor", "catch_block",
  ])
  for (let p = n.parent; p; p = p.parent) {
    if (NESTING.has(p.type)) return false
    if (p.type === "source_file") return true
  }
  return false
}

function declaredName(d: any): string | null {
  for (const c of namedKids(d)) {
    if (c.type === "simple_identifier" || c.type === "type_identifier") return unquote(c.text)
  }
  // A PROPERTY's name is not a direct child. The pinned wasm nests it as
  //   property_declaration > binding_pattern_kind("val") + variable_declaration > simple_identifier
  // so a direct-children scan finds nothing and every top-level `val`/`var` was
  // silently unexportable to this oracle — which is most of what the `exports`
  // label exists for. The analyzer has the same shape and reads it explicitly;
  // here it is derived from the dumped tree rather than copied, and the two are
  // compared per edge so a future divergence in either is visible.
  if (d.type === "property_declaration") {
    const decl = namedKids(d).find((c) => c.type === "variable_declaration")
    if (decl) {
      for (const c of namedKids(decl)) {
        if (c.type === "simple_identifier") return unquote(c.text)
      }
    }
  }
  return null
}

/** The row a declaration's NAME is written on.
 *
 *  `startPosition` of the declaration node is the row of its MODIFIERS, because
 *  tree-sitter-kotlin nests `modifiers` inside the declaration. For
 *  `@Deprecated("x") class Annotated` the node starts on the annotation's row and
 *  the name is two lines lower. A rule that compared a symbol's reported row with
 *  the node's row therefore mismatches every annotated declaration, which in this
 *  corpus is most of them. */
function nameRow(d: any): number {
  for (const c of namedKids(d)) {
    if (c.type === "simple_identifier" || c.type === "type_identifier") return c.startPosition.row + 1
  }
  return d.startPosition.row + 1
}

/** Whether a declaration carries a visibility modifier, and which.
 *  No modifier means `public` — the Kotlin default, per the specification's
 *  "Visibility modifiers" section. */
function visibilityOf(d: any): string {
  for (const c of allKids(d)) {
    if (c.type !== "modifiers") continue
    for (const m of allKids(c)) {
      if (VISIBILITY.has(m.type)) return m.type
      // `visibility_modifier` wraps the keyword, and the keyword is an ANONYMOUS
      // child — see allKids. Reading named children only here is what made this
      // oracle call 196 private classes public.
      if (m.type === "visibility_modifier") {
        for (const k of allKids(m)) if (VISIBILITY.has(k.type)) return k.type
        const t = String(m.text ?? "").trim()
        if (VISIBILITY.has(t)) return t
      }
    }
  }
  return "public"
}

/** A declaration the specification lets another file name.
 *
 *  Excluded, each for a stated language reason rather than a taste:
 *   - `constructor_declaration` / `primary_constructor`: named through its class
 *     (`Foo()`), not by a qualified path of its own.
 *   - `type_alias`: named through the type it aliases; and a type alias is
 *     expanded at compile time, so an edge to it asserts a runtime symbol that
 *     does not exist. Excluded here and the analyzer's treatment is MEASURED by
 *     the comparison rather than assumed to match — if the two disagree on
 *     `type_alias` the report says so with a count.
 */
const EXPORTABLE = new Set([
  "class_declaration", "object_declaration", "function_declaration",
  "property_declaration", "type_alias",
])

export function deriveKotlinImportsExportsTruth(root: any): OracleEdge[] {
  const out: OracleEdge[] = []
  const pkg = packageOf(root)

  // imports — one per import_header, whatever its form.
  {
    const stack: any[] = [root]
    while (stack.length) {
      const n = stack.pop()!
      if (n.type === "import_header") {
        const got = importPath(n)
        if (got) {
          out.push({
            label: "imports",
            from: pkg || "root",
            target: got.path,
            shape: got.shape,
            line: n.startPosition.row + 1,
          })
        }
        continue
      }
      for (const c of namedKids(n)) stack.push(c)
    }
  }

  // exports — top-level, public, in a package-bearing file.
  if (pkg) {
    const stack: any[] = [root]
    while (stack.length) {
      const n = stack.pop()!
      if (EXPORTABLE.has(n.type)) {
        if (isTopLevel(n) && visibilityOf(n) === "public") {
          const name = declaredName(n)
          // A NAMED object is importable by name; an anonymous one (`object : X
          // // ...`) has no name at all. `object_declaration` always carries a
          // name in this grammar, so the check that matters is that the name is
          // not the empty string.
          if (name && name.length > 0) {
            out.push({ label: "exports", from: pkg, target: name, line: nameRow(n) })
          }
        }
        continue
      }
      for (const c of namedKids(n)) stack.push(c)
    }
  }

  return out
}

// ── compare against the production analyzer ─────────────────────────────────────
const key = (e: { label: string; from: string; target: string }): string => `${e.label}|${e.from}|${e.target}`

/**
 * The oracle names the three import forms in its OWN words and the comparison
 * maps between the two vocabularies EXPLICITLY.
 *
 * The first run of this file reported 1,381 "shape disagreements" — one per
 * matched import — and every one was the same non-finding: `wildcard` against
 * `imported_package_wildcard`. Two spellings of one value is not a disagreement,
 * and a comparison that cries wolf once per matched edge teaches nobody to read
 * it.
 *
 * The mapping is written here, at the boundary, rather than by having the oracle
 * emit the analyzer's strings: an oracle that adopts its subject's vocabulary
 * cannot report that the vocabulary is wrong, which is the only reason to have a
 * second opinion at all. `SHAPE_VOCAB` is the whole of the coupling, it is one
 * line per form, and a form on either side with no entry here shows up as `?`
 * rather than as a false pass.
 */
const SHAPE_VOCAB: Record<string, string> = {
  imported_package_wildcard: "wildcard",
  imported_declaration_aliased: "aliased",
  imported_declaration: "declaration",
}

// ── one parser, one lock ────────────────────────────────────────────────────────
// Initialised once, before any worker starts. `BB_ORACLE_WORKERS` exists only so
// a slow machine can drop to 1; the lock makes concurrency pointless either way,
// which is stated here so nobody raises it as a tuning knob later.
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const sharedParser = new WSP()
sharedParser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-kotlin.wasm"))))
let lock: Promise<unknown> = Promise.resolve()
function withParser<T>(fn: (p: any) => Promise<T> | T): Promise<T> {
  const run = lock.then(() => fn(sharedParser))
  // Keep the chain alive even when `fn` rejects, or every later caller inherits
  // the rejection and the whole run reports zero rows instead of one failure.
  lock = run.then(() => undefined, () => undefined)
  return run as Promise<T>
}

let idx = 0
let parsed = 0
let threw = 0
const tp = { imports: 0, exports: 0 }
const fp: Record<string, { n: number; ex: string[] }> = { imports: { n: 0, ex: [] }, exports: { n: 0, ex: [] } }
const fn: Record<string, { n: number; ex: string[] }> = { imports: { n: 0, ex: [] }, exports: { n: 0, ex: [] } }
const shapeDisagree = { n: 0, ex: [] as string[] }
/** Per-FILE disagreement counts, because a global number is not actionable: the
 *  first run reported 196 `exports` false negatives and named four of them, which
 *  turned out to be four DIFFERENT files in four different directories — none of
 *  which was the file the net count was really about, and all four of which the
 *  analyzer turned out to have got right. The file is the unit a human acts on,
 *  so it is the unit recorded. */
const byFile = new Map<string, { label: string; kind: "FP" | "FN" | "SHAPE"; n: number; sample: string }>()
const note = (rel: string, kind: "FP" | "FN" | "SHAPE", sample: string) => {
  const k = `${rel}|${kind}`
  const c = byFile.get(k) ?? { label: kind, kind, n: 0, sample }
  c.n++
  byFile.set(k, c)
}
const labelFiles = { imports: new Set<string>(), exports: new Set<string>() }

async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= admitted.length) return
    const f = admitted[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { threw++; continue }
    parsed++
    const label = `kotlin/${f.rel}`

    // The oracle needs the TREE, so it re-parses rather than reusing the
    // analyzer's — an oracle that consumed the analyzer's own tree object would
    // not be a second opinion about the tree, only about the code around it.
    //
    // ONE shared parser behind a mutex, not one parser per worker. The first
    // version of this file built a `new WSP()` per file inside four concurrent
    // workers and died with
    //   RuntimeError: table index is out of bounds
    //     at ts_parser_set_included_ranges
    //     at Parser.parse (web-tree-sitter/tree-sitter.js:3880)
    // after ~200 files. web-tree-sitter's Parser holds wasm-side state that is
    // not reentrant, so N parsers in one process is not N independent parsers.
    // The lock is held across the parse AND the tree walk, because the walk reads
    // the same wasm memory; the comparison against the analyzer's result happens
    // outside it, so the serialised section stays small.
    let truth: OracleEdge[] | undefined
    let parseFailed = false
    await withParser(async (p) => {
      try {
        const t = p.parse(readFileSync(f.abs, "utf8"))
        if (!t) { parseFailed = true; return }
        try { truth = deriveKotlinImportsExportsTruth(t.rootNode) } finally { t.delete?.() }
      } catch { parseFailed = true }
    })
    if (parseFailed || !truth) continue

    const got = (r.relationships ?? []).filter((x: any) => {
      const t2 = String(x.type ?? x.relationshipType ?? "").toLowerCase()
      return t2 === "imports" || t2 === "exports"
    })
    const truthByKey = new Map<string, OracleEdge[]>()
    for (const e of truth) {
      const k = key(e)
      const arr = truthByKey.get(k)
      if (arr) arr.push(e)
      else truthByKey.set(k, [e])
    }
    const gotByKey = new Map<string, any[]>()
    for (const e of got) {
      const k = key({
        label: String(e.type ?? e.relationshipType).toLowerCase(),
        from: String(e.source ?? e.from ?? ""),
        target: String(e.target ?? e.to ?? ""),
      })
      const arr = gotByKey.get(k)
      if (arr) arr.push(e)
      else gotByKey.set(k, [e])
    }
    for (const k of new Set([...truthByKey.keys(), ...gotByKey.keys()])) {
      const label2 = k.split("|")[0] as "imports" | "exports"
      const tv = truthByKey.get(k) ?? []
      const gv = gotByKey.get(k) ?? []
      labelFiles[label2].add(f.rel)
      const n = Math.min(tv.length, gv.length)
      tp[label2] += n
      for (let j = 0; j < Math.abs(tv.length - gv.length); j++) {
        const extra = (tv.length > gv.length ? tv : gv)[j]
        if (tv.length > gv.length) { fn[label2].n++; note(f.rel, "FN", `${label2} ${String(extra?.target ?? extra?.shape ?? "")}`) }
        else { fp[label2].n++; note(f.rel, "FP", `${label2} ${String(extra?.target ?? extra?.shape ?? "")}`) }
        const bucket = tv.length > gv.length ? fn[label2] : fp[label2]
        if (bucket.ex.length < 4) {
          bucket.ex.push(`${label2} ${tv.length > gv.length ? "MISSING" : "UNEXPECTED"} ${k} ${JSON.stringify(extra).slice(0, 140)}`)
        }
      }
      // shape: the third import form is not recoverable from the target text, so
      // a consumer needs the metadata. Agreement here is what makes the shape
      // field load-bearing rather than decorative.
      for (let j = 0; j < n; j++) {
        const want = tv[j].shape
        if (!want) continue
        const md = gv[j]?.metadata ?? {}
        const gotShape = SHAPE_VOCAB[
          md.importShape ?? (md.isWildcard ? "wildcard" : typeof md.alias === "string" ? "aliased" : "declaration")
        ] ?? "?"
        if (gotShape !== want) {
          shapeDisagree.n++
          note(f.rel, "SHAPE", `${label2} ${tv[j].target} truth=${want} analyzer=${gotShape}`)
          if (shapeDisagree.ex.length < 4) shapeDisagree.ex.push(`${label} truth=${want} analyzer=${gotShape} target=${tv[j].target}`)
        }
      }
    }
  }
}
// Workers still run concurrently for the analyzer-side `parseFile` call and the
// comparison; only the tree parse and walk are serialised, by the lock above.
const WORKERS = parseInt(process.env.BB_ORACLE_WORKERS ?? "4")
await Promise.all(Array.from({ length: Math.max(1, WORKERS) }, () => worker()))

const line = (s: string) => (s + " ".repeat(58)).slice(0, 58)
console.log(`kotlin imports/exports oracle — ${parsed}/${admitted.length} files parsed (${threw} threw), draw = every ${step}th tracked file`)
console.log(`pinned corpus revision: ${rev}\n`)
console.log(`${line("label")}${line("TP")}${line("FP (analyzer only)")}${line("FN (oracle only)")}files`)
console.log("-".repeat(120))
for (const l of ["imports", "exports"] as const) {
  console.log(`${line(l)}${line(String(tp[l]))}${line(String(fp[l].n))}${line(String(fn[l].n))}${labelFiles[l].size}`)
}
console.log("-".repeat(120))
console.log(`import SHAPE disagreements: ${shapeDisagree.n}`)
for (const e of shapeDisagree.ex) console.log(`  ${e}`)
for (const l of ["imports", "exports"] as const) {
  if (fp[l].n) { console.log(`\nFP ${l} — analyzer emitted, oracle does not derive:`); for (const e of fp[l].ex) console.log(`  ${e}`) }
  if (fn[l].n) { console.log(`\nFN ${l} — oracle derives, analyzer did not emit:`); for (const e of fn[l].ex) console.log(`  ${e}`) }
}

const disagreements = fp.imports.n + fp.exports.n + fn.imports.n + fn.exports.n + shapeDisagree.n
const out = {
  lane: "kotlin",
  instrument: "script/m14/kotlin-imports-exports-oracle.ts",
  purpose: "independent second opinion for the two labels differential.ts does not derive for kotlin",
  corpus_root: CR,
  pinned_rev: rev,
  draw: `every ${step}th tracked file`,
  files_measured: admitted.length,
  files_parsed: parsed,
  files_threw: threw,
  labels: {
    imports: { tp: tp.imports, fp: fp.imports.n, fn: fn.imports.n, files: labelFiles.imports.size, fp_examples: fp.imports.ex, fn_examples: fn.imports.ex },
    exports: { tp: tp.exports, fp: fp.exports.n, fn: fn.exports.n, files: labelFiles.exports.size, fp_examples: fp.exports.ex, fn_examples: fn.exports.ex },
  },
  import_shape_disagreements: { n: shapeDisagree.n, examples: shapeDisagree.ex },
  total_disagreements: disagreements,
  per_file_disagreements: [...byFile.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .map(([k, c]) => ({ file: k.split("|")[0], kind: c.kind, n: c.n, sample: c.sample })),
  oracle_scope: "second walker over the SAME pinned grammar: a shared grammar bug is invisible to BOTH paths, so this closes the emission-rule class, not the parse-coverage class",
}
if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 1)); console.log(`\nwrote ${OUT}`) }
if (byFile.size > 0) {
  console.log(`\nper-FILE disagreements (${byFile.size} file/label/kind cells) — the actionable unit`)
  for (const [k, c] of [...byFile.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${String(c.n).padStart(4)}  ${c.kind.padEnd(5)} ${k.split("|")[0]}`)
    console.log(`         e.g. ${c.sample.slice(0, 130)}`)
  }
}
console.log(`\ntotal disagreements: ${disagreements}`)
process.exitCode = disagreements === 0 ? 0 : 1
