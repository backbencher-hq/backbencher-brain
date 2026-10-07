/**
 * SCALA `imports` / `exports` ORACLE — the second opinion the shared differential
 * cannot currently provide.
 *
 * ## Why this file exists
 *
 * The INCOMING_SCALA lane measured, through the production path on 400 corpus
 * files, that `imports` and `exports` fire **0 times each** while
 * `import_declaration` occurs 2,358 times across 429 files
 * (`script/m14/tmp/scala-grammar-inventory.ts`). Two of the ten ontology types
 * were silent on a corpus where the constructs are everywhere, which is the
 * shape the ontology gate's header describes for bash's `overrides`.
 *
 * It also cannot be settled by the shared differential on this machine:
 * `script/m14/differential.ts` enumerates every active corpus repo before it
 * honours `--lang`, and 40 of the 56 it names are absent here (including
 * `scala3` and `cats-effect`, the corpora this lane's own numbers came from).
 * So the second opinion is built here, over the same grammar, from the language
 * rules.
 *
 * ## WHAT INDEPENDENCE THIS ORACLE HAS, AND WHAT IT DOES NOT
 *
 * It has a separate walker and a separate implementation. The analyzer's
 * `handleImport` loops over the DIRECT children of `import_declaration` and
 * appends to one flat `parts` array — it reads an `arrow_renamed_identifier`'s
 * imported name into the path and ignores a bare `identifier` inside
 * `namespace_selectors`, which is why `import a.b.{C, D => Renamed}` publishes
 * the path `a.b.D` while the Scala specification says the dependency is the
 * package `a.b`. This oracle instead DESCENDS, and when it meets
 * `namespace_selectors` / `namespace_wildcard` it records the bound names and
 * stops descending. Two implementations of one spec rule disagree when either is
 * wrong.
 *
 * It does NOT have an independent grammar: both sides load the same
 * `tree-sitter-scala` v0.26.2 wasm through the engine, so a bug IN the grammar —
 * a node type that never matches, a field that is never populated — is invisible
 * to this oracle exactly as it is to the differential. That is the limit the
 * honesty contract's L3 definition states, and it is stated here rather than
 * papered over.
 *
 * ## WHAT IS DERIVED, FROM WHICH RULE
 *
 *   imports   Scala Language Spec ch. 9 (Import Clauses): an import clause binds
 *             one or more names FROM a path. One dependency per
 *             `import_declaration`, and the dependency is the path — the names
 *             inside a `{...}` selector group are what is BOUND, not where it
 *             comes from.
 *   exports   Scala has no `export` keyword in Scala 2, and its Scala 3
 *             `export a.b.C` clause re-exports a name INTO this unit. So there
 *             are two rules, counted separately:
 *               (a) unit API — a top-level declaration is part of the unit's
 *                   public surface unless it carries `private` / `protected`
 *                   (a qualified `private[pkg]` is package-scoped and is not
 *                   published outside the package). This is the rule the Java
 *                   oracle derives from JLS 7.6, for the same reason: a JVM-family
 *                   language with no module manifest expresses its export surface
 *                   as a visibility rule, not as a declaration.
 *               (b) explicit re-export — one edge per name an
 *                   `export_declaration` binds. Measured 0 on this corpus
 *                   (Scala 2.13 has no `export` clause) and reported as 0 rather
 *                   than claimed.
 *
 * ## NO REGEX
 *
 * Node work goes through the tree-sitter node API. Every string test below is an
 * indexOf / endsWith / char-code comparison. The one `split(".")` is a separator
 * split on a dotted path, not a pattern.
 *
 * ## USAGE
 *   bun run script/m60/scala-imports-exports-oracle.ts [--sample N] [--json out]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { getParser } from "../../src/ast/engine"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO = process.env.BB_SCALA_REPO ?? "scala"
const ROOT = join(CR, REPO)

const argv = process.argv.slice(2)
const SAMPLE = Number(argv[argv.indexOf("--sample") + 1] ?? 400)
const JSON_OUT = argv.includes("--json") ? argv[argv.indexOf("--json") + 1] : ""

/* ------------------------------------------------------------------ corpus */
const files: string[] = (() => {
  let raw: string
  try {
    raw = execFileSync("git", ["-C", ROOT, "ls-files", "-z", "--", "*.scala"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
  } catch (e) {
    console.error(`cannot list ${ROOT}: ${e}`)
    process.exit(2)
  }
  const out: string[] = []
  for (const rel of raw.split("\0")) {
    if (!rel) continue
    try { if (statSync(join(ROOT, rel)).size > 400_000) continue } catch { continue }
    out.push(rel)
  }
  out.sort()
  return out.slice(0, SAMPLE)
})()

/* ------------------------------------------------------------------ the rules */

/** The node types that DECLARE a top-level name in Scala 2 and Scala 3. */
const TOP_LEVEL_DECLS = new Set([
  "class_definition", "trait_definition", "object_definition", "enum_definition",
  "type_definition", "function_definition", "function_declaration",
  "val_definition", "var_definition", "val_declaration", "var_declaration",
  "given_definition",
])
/** Container nodes that make a declaration a MEMBER rather than part of the
 *  unit's surface. This is also the analyzer's `!parent` rule for
 *  `exports`: `class C { def f }` publishes C, never C.f.
 *
 *  A `package_object` and a braced `package_clause` are DELIBERATELY absent, and
 *  the first version of this file got that wrong: it listed `package_object` as
 *  nesting, so it derived 456 `exports` rows against the analyzer's 442 and
 *  reported 26 UNEXPLAINED — every one of them a declaration inside a
 *  `package.scala`, e.g. `src/compiler/scala/tools/nsc/io/package.scala`
 *  (`AbstractFile`, `Directory`, `File`, `Path`, `Streamable`) and
 *  `reflect/reify/package.scala` (`reifyTree`, `reifyType`, …).
 *
 *  The oracle was the wrong side. A `package object io { abstract class File … }`
 *  declares `io.File`: a package member, reachable as `io.File` from anywhere,
 *  and importable as such. It is the package's API, not a nested scope's. The
 *  same holds for `package foo { class Bar }`. So both are TRANSPARENT here and
 *  the descent keeps its depth. */
const NESTING = new Set([
  "class_definition", "trait_definition", "object_definition", "enum_definition",
  "template_body", "enum_body", "extension_definition", "given_definition",
  "function_definition", "function_declaration", "block", "indented_block",
  "lambda_expression",
])

/** Is this declaration private/protected? Read from the `modifiers` child by
 *  NODE TYPE, so a string literal or a comment cannot make a declaration look
 *  private and no name text is pattern-matched. */
function isNonPublic(n: any): boolean {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (!c || c.type !== "modifiers") continue
    for (let j = 0; j < c.childCount; j++) {
      const m = c.child(j)
      if (!m) continue
      if (m.type === "access_modifier") return true // private[x] / protected[x]
      if (m.type === "private" || m.type === "protected") return true
    }
  }
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (!c) continue
    if (c.type === "private" || c.type === "protected") return true
  }
  return false
}

/** The name a declaration introduces.
 *
 *  Field first. `class_definition` / `trait_definition` / `object_definition` /
 *  `enum_definition` / `type_definition` / `function_definition` carry `name:`,
 *  and a `val_definition` / `var_definition` does NOT — measured, not assumed:
 *  `src/compiler/scala/tools/nsc/io/package.scala` has
 *  `compilation_unit > package_object > template_body` whose children alternate
 *  `type_definition` (name=AbstractFile) and `val_definition` (name=**none**),
 *  because a value's name is its `pattern`, not its name. The first version of
 *  this function read `name:` and then a bare `identifier` child, so it derived
 *  the type aliases and MISSED every val forwarder — 5 of the 26 UNEXPLAINED rows
 *  it first reported were the analyzer being RIGHT about a `val` the oracle could
 *  not see.
 *
 *  An anonymous `given` has neither, which is why the caller requires a field
 *  name for that one form only: a name nothing can spell is not part of an
 *  importable surface. */
/** Quoting is not part of a NAME.
 *
 *  Measured: `src/compiler/scala/tools/nsc/package.scala:40` declares
 *  ``type `strip margin` = … `` and this function's first version published the
 *  target "`strip margin`" — a spelling no reference uses, because the only other
 *  way to write that identifier is without the backticks (it is backticked
 *  precisely because `strip margin` is not a legal Scala identifier). A target
 *  nothing can spell is not resolvable, so the export edge would have joined
 *  nothing. Char scan, no pattern. */
function stripQuoting(text: string): string {
  if (!text.includes("`")) return text
  let out = ""
  let i = 0
  while (i < text.length) {
    if (text.charCodeAt(i) === 96) {
      const close = text.indexOf("`", i + 1)
      if (close === -1) { out += text.slice(i); break }
      out += text.slice(i + 1, close)
      i = close + 1
    } else {
      out += text[i]
      i++
    }
  }
  return out
}

function declaredName(n: any): string {
  const f = n.childForFieldName?.("name")
  if (f) return stripQuoting(f.text)
  const pat = n.childForFieldName?.("pattern")
  if (pat && (pat.type === "identifier" || pat.type === "identifiers" || pat.type === "operator_identifier")) return stripQuoting(pat.text)
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && (c.type === "identifier" || c.type === "type_identifier")) return stripQuoting(c.text)
  }
  return ""
}

/** The Scala-spec path an import clause imports FROM.
 *
 *  RECURSIVE, and it stops at a selector group: `namespace_selectors` and
 *  `namespace_wildcard` carry the names being BOUND, which are not part of the
 *  path. `as_renamed_identifier` contributes its ORIGINAL name (`x.y.Z as W`
 *  imports `Z`). Returns the path plus the bound names, so a caller can report
 *  both. */
function importClause(n: any, path: string[], bound: string[], renamed: Array<{ local: string; imported: string }>): void {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (!c) continue
    if (c.type === "identifier") {
      path.push(c.text)
      continue
    }
    if (c.type === "namespace_wildcard") {
      bound.push("*")
      continue
    }
    if (c.type === "namespace_selectors") {
      for (let j = 0; j < c.childCount; j++) {
        const s = c.child(j)
        if (!s) continue
        if (s.type === "identifier") { bound.push(s.text); continue }
        if (s.type === "arrow_renamed_identifier") {
          const imported = s.namedChild(0)
          const local = s.namedChild(1)
          if (imported) { bound.push(imported.text); renamed.push({ local: local?.text ?? imported.text, imported: imported.text }) }
        }
      }
      continue
    }
    if (c.type === "as_renamed_identifier") {
      const original = c.namedChild(0)
      const alias = c.namedChild(1)
      if (original) {
        path.push(original.text)
        renamed.push({ local: alias?.text ?? original.text, imported: original.text })
      }
      continue
    }
  }
}

/** The names an `export_declaration` re-exports. Scala 3:
 *  `export a.b.C`, `export a.b.{C, D => E}`, `export a.b.*`. Same walk as an
 *  import clause, with the path/bound roles SWAPPED — here the selectors are
 *  the names this unit publishes. */
function exportClause(n: any, out: string[]): void {
  const path: string[] = []
  const bound: string[] = []
  importClause(n, path, bound, [])
  if (bound.length > 0) {
    for (const b of bound) if (b !== "*") out.push(b)
    // `export a.b.*` names a PATH, not its members. One edge per member would be
    // fabricating declarations this unit does not contain, so the path itself is
    // the published target and `exportKind: reexport_wildcard` says why. The
    // first version of this function emitted nothing for the wildcard form, and
    // the fixture `scala/incoming-scala-export-surface` shows that is the form
    // real Scala 3 code writes.
    if (bound.includes("*") && path.length > 0) out.push(path.join("."))
    return
  }
  const joined = path.join(".")
  if (joined.length > 0) {
    const segs = joined.split(".")
    out.push(segs[segs.length - 1])
  }
}

type OracleRow = { file: string; type: "imports" | "exports"; target: string; rule: string; line: number }
type ObservedRow = { file: string; type: string; target: string; source: string; line?: number; metaRelType: string; confidence: number; evidenceClass: string }

const oracle: OracleRow[] = []
const observed: ObservedRow[] = []
let parseFail = 0
let damaged = 0

for (const rel of files) {
  const abs = join(ROOT, rel)
  let prod: any
  try {
    prod = await parseFile(abs, ROOT)
  } catch {
    parseFail++
    continue
  }
  for (const x of prod.relationships ?? []) {
    const t = String(x.type ?? x.relationshipType ?? "")
    if (t !== "imports" && t !== "exports") continue
    observed.push({
      file: rel, type: t, target: String(x.target ?? ""), source: String(x.source ?? ""),
      line: x.line_number, metaRelType: String((x.metadata ?? {}).relationshipType ?? "(none)"),
      confidence: typeof x.confidence === "number" ? x.confidence : 1,
      evidenceClass: String((x.metadata ?? {}).evidenceClass ?? "(none)"),
    })
  }

  const text = readFileSync(abs, "utf8")
  // The parser is fetched PER FILE, not hoisted. `getParser` deletes and
  // recreates the cached parser every 500 parses (`engine.ts`, the fix for WASM
  // accumulation on large projects), so a hoisted reference goes stale and the
  // next parse dies with `RuntimeError: Out of bounds memory access` in
  // `_ts_parser_parse_wasm`. It is not a leak and not a corpus property: this run
  // parsed 1,200 times (once through `parseFile`, once here), so the
  // recreation happened mid-run. Hoisting the parser made the oracle pass at 300
  // files and crash at 600, which is the kind of scale limit that looks like a
  // finding until you read the engine.
  const parser = await getParser("scala")
  const tree = await parser.parse(text, abs)
  if (!tree) { parseFail++; continue }
  if (tree.rootNode.hasError) damaged++
  const root = tree.rootNode

  // ── imports: one dependency per import clause ──────────────────────────
  const walkImports = (n: any): void => {
    if (n.type === "import_declaration") {
      const path: string[] = []
      const bound: string[] = []
      const renamed: Array<{ local: string; imported: string }> = []
      importClause(n, path, bound, renamed)
      const joined = path.join(".")
      // SDJ-11: a clause whose path is unnameable (error recovery — `import`,
      // `import}}`) publishes NO edge on either side. The oracle asserts the
      // absence rather than passing, so a rule that invented an edge here would
      // have to invent it on both sides to agree.
      if (joined.length > 0) {
        oracle.push({
          file: rel, type: "imports", target: joined,
          rule: bound.length > 0 ? "SLS ch.9 import clause — path only, `{...}` names are BOUND" : "SLS ch.9 import clause — direct path",
          line: n.startPosition.row + 1,
        })
      }
      return
    }
    if (n.type === "export_declaration") {
      const names: string[] = []
      exportClause(n, names)
      for (const nm of names) {
        if (nm.length > 0) {
          oracle.push({
            file: rel, type: "exports", target: nm,
            rule: "Scala 3 export clause — a name this unit re-exports",
            line: n.startPosition.row + 1,
          })
        }
      }
      return
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) walkImports(c)
    }
  }
  walkImports(root)

  // ── exports (a): the unit's public top-level surface ────────────────────
  // A `template_body` is a MEMBER container when its parent is a type, and a
  // TRANSPARENT one when its parent is a `package_object` or a braced
  // `package_clause` — measured, not assumed: in
  // `src/compiler/scala/tools/nsc/io/package.scala` the shape is
  // `compilation_unit > package_object > template_body > val_definition`, and a
  // `val File = …` there declares `io.File`, a package member.
  const isPackageBody = (n: any): boolean => {
    const pt = n.parent?.type
    return pt === "package_object" || pt === "package_clause"
  }
  const walkDecls = (n: any, depth: number): void => {
    if (TOP_LEVEL_DECLS.has(n.type) && depth === 0) {
      if (!isNonPublic(n)) {
        const nm = declaredName(n)
        // An anonymous `given` has no declared name; a name nothing can spell is
        // not part of an importable surface, so it is not published. Scoped to
        // the one form that can be anonymous — every other declaration in
        // TOP_LEVEL_DECLS is named by `name:` or by `pattern:`.
        if (nm.length > 0 && (n.type !== "given_definition" || n.childForFieldName?.("name"))) {
          oracle.push({
            file: rel, type: "exports", target: nm,
            rule: "SLS §2 — a top-level declaration is public unless private/protected",
            line: n.startPosition.row + 1,
          })
        }
      }
      // A declaration's own children are its MEMBERS: `class C { def f }`
      // publishes C, never C.f.
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && NESTING.has(c.type)) walkDecls(c, depth + 1)
      }
      return
    }
    if (NESTING.has(n.type)) {
      // A package body is not a nesting level: its declarations belong to the
      // package, which is the surface being derived.
      const next = n.type === "template_body" && isPackageBody(n) ? depth : depth + 1
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walkDecls(c, next)
      }
      return
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) walkDecls(c, depth)
    }
  }
  walkDecls(root, 0)
  tree.delete?.()
}

/* ------------------------------------------------------------------ adjudicate */
const byFile = new Map<string, { oracle: Map<string, OracleRow>; observed: Map<string, ObservedRow> }>()
const bucket = (f: string) => {
  let b = byFile.get(f)
  if (!b) { b = { oracle: new Map(), observed: new Map() }; byFile.set(f, b) }
  return b
}
for (const r of oracle) bucket(r.file).oracle.set(`${r.type}|${r.target}`, r)
for (const r of observed) bucket(r.file).observed.set(`${r.type}|${r.target}`, r)

let matched = 0
let missing = 0
let unexplained = 0
const missingByType = new Map<string, number>()
const unexplainedByType = new Map<string, number>()
const missingSamples: string[] = []
const unexplainedSamples: string[] = []
for (const [f, b] of byFile) {
  for (const [k, r] of b.oracle) {
    if (b.observed.has(k)) matched++
    else {
      missing++
      missingByType.set(r.type, (missingByType.get(r.type) ?? 0) + 1)
      if (missingSamples.length < 25) missingSamples.push(`${f}: MISSING ${r.type} -> ${r.target} (${r.rule}, line ${r.line})`)
    }
  }
  for (const [k, r] of b.observed) {
    if (!b.oracle.has(k)) {
      unexplained++
      unexplainedByType.set(r.type, (unexplainedByType.get(r.type) ?? 0) + 1)
      if (unexplainedSamples.length < 25) {
        unexplainedSamples.push(`${f}: UNEXPLAINED ${r.type} ${r.source} -> ${r.target} @${r.line ?? "?"} conf ${r.confidence} ${r.evidenceClass} ${r.metaRelType}`)
      }
    }
  }
}

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
/** The adjudication is per (file, type, target) — the key the differential's
 *  matcher uses — so the recall/precision figures must be computed over the
 *  DEDUPED population. Reported over the raw array the first version of this
 *  file claimed 94.62% recall while MISSING was 0, because a package object's
 *  `type File` and `val File` are two rows and one key: the denominator carried
 *  rows that cannot be individually missing. Both numbers are printed, and the
 *  deduplicated one is the verdict. */
const oracleKeys = new Set<string>()
for (const r of oracle) oracleKeys.add(`${r.file}|${r.type}|${r.target}`)
const observedKeys = new Set<string>()
for (const r of observed) observedKeys.add(`${r.file}|${r.type}|${r.target}`)
console.log(`scala imports/exports oracle — corpus ${REPO}`)
console.log(`files ${files.length} (parse failures ${parseFail}, carrying ERROR nodes ${damaged})`)
console.log(`oracle rows ${oracle.length} (${oracleKeys.size} distinct file|type|target keys)`)
console.log(`observed rows ${observed.length} (${observedKeys.size} distinct keys)`)
console.log(`  imports  oracle ${oracle.filter((r) => r.type === "imports").length}  observed ${observed.filter((r) => r.type === "imports").length}`)
console.log(`  exports  oracle ${oracle.filter((r) => r.type === "exports").length}  observed ${observed.filter((r) => r.type === "exports").length}`)
console.log("")
console.log(`${pad("type", 10)}${pad("oracle", 9)}${pad("observed", 11)}${pad("matched", 9)}${pad("MISSING", 9)}${pad("UNEXPL", 8)}`)
console.log("-".repeat(70))
for (const t of ["imports", "exports"]) {
  const o = new Set([...oracleKeys].filter((k) => k.includes(`|${t}|`))).size
  const ob = new Set([...observedKeys].filter((k) => k.includes(`|${t}|`))).size
  console.log(`${pad(t, 10)}${pad(String(o), 9)}${pad(String(ob), 11)}${pad(String(matched), 9)}${pad(String(missingByType.get(t) ?? 0), 9)}${pad(String(unexplainedByType.get(t) ?? 0), 8)}`)
}
console.log("-".repeat(70))
console.log(`total: matched ${matched}  MISSING ${missing}  UNEXPLAINED ${unexplained}`)
console.log(`oracle recall    ${oracleKeys.size === 0 ? "n/a" : ((100 * matched) / oracleKeys.size).toFixed(2)}%  (matched / distinct oracle keys)`)
console.log(`observed precision ${observedKeys.size === 0 ? "n/a" : ((100 * matched) / observedKeys.size).toFixed(2)}%  (matched / distinct observed keys)`)
if (missingSamples.length) { console.log(`\nMISSING samples (analyzer did not emit what the rule requires):`); for (const s of missingSamples) console.log(`  ${s}`) }
if (unexplainedSamples.length) { console.log(`\nUNEXPLAINED samples (emitted, and the rule does not require it):`); for (const s of unexplainedSamples) console.log(`  ${s}`) }

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({
    corpus: { repo: REPO, files: files.length, parseFail, damaged },
    oracleRows: oracle.length, observedRows: observed.length,
    oracleKeys: oracleKeys.size, observedKeys: observedKeys.size,
    recall: oracleKeys.size === 0 ? null : matched / oracleKeys.size,
    precision: observedKeys.size === 0 ? null : matched / observedKeys.size,
    matched, missing, unexplained,
    missingByType: Object.fromEntries(missingByType), unexplainedByType: Object.fromEntries(unexplainedByType),
    oracle, observed,
  }, null, 0))
  console.log(`\nevidence: ${JSON_OUT}`)
}

// A lane that emits nothing for a type the oracle derives is the failure this
// file exists to catch, so the exit code says so rather than reporting a pass.
process.exitCode = missing + unexplained === 0 ? 0 : 1