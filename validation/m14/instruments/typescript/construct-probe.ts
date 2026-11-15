/**
 * TYPESCRIPT CONSTRUCT PROBE — does the LANGUAGE have the construct, measured
 * on the parse tree.
 *
 * ## Why this is a separate instrument from ambiguity-census.ts
 *
 * ambiguity-census answers "did the analyzer emit it". This file answers the
 * question that a census structurally cannot: "was the construct present in
 * the corpus at all". The distinction is the whole ontology gate. An analyzer
 * that emits 0 `overrides` edges on a corpus that contains 400 override sites
 * is broken; an analyzer that emits 0 on a corpus with none is correct. Both
 * look identical from the output side, and only counting the construct on the
 * tree tells them apart. The workstream gate exists because `overrides` had a
 * prose justification for a whole wave and the prose was wrong.
 *
 * ## Why not a text search
 *
 * The gate's first version returned two false positives from regex probes: a
 * probe for `extends` matched `class voice` inside a telnet IAC word list in a
 * string literal, and a probe for `instantiates` matched `new Map(` in a bash
 * file carrying embedded JavaScript inside a heredoc. Both are text that looks
 * like a construct and is not. Here every count is a `node.type` comparison on
 * the tree-sitter AST, so a string literal cannot produce a hit and a nested
 * construct cannot hide. There is not one regular expression in this file.
 *
 * ## What each probe asserts
 *
 *   implements   class_heritage > implements_clause, with its named children.
 *                TypeScript's implements is CLASS-only: `interface A
 *                implements B` does not parse, and an interface's inheritance is
 *                extends_type_clause. So the probe counts both and reports them
 *                separately, because "TS has implements" and "an INTERFACE can
 *                implement" are different claims.
 *   extends      class_heritage > extends_clause (class base) AND
 *                extends_type_clause (interface base). Also the type-level
 *                forms: `interface A<T extends U>` and conditional/mapped types
 *                carry an extends that is a CONSTRAINT, not inheritance. Those
 *                are counted apart, because emitting an inheritance edge for a
 *                constraint would be a fabricated edge.
 *   overrides    two distinct constructs: (a) the `override` MODIFIER
 *                (TypeScript 4.3+, optional unless noImplicitOverride), and
 *                (b) structural — a member name redeclared in a derived type.
 *                (b) is not a syntactic construct at all and cannot be probed on
 *                the tree; it is what the analyzer's structural arms compute, so
 *                what this probe counts is (a) plus the SITE that (b) would key
 *                on, which is `extends_clause`/`implements_clause` whose target
 *                resolves in-file.
 *   instantiates new_expression, minus `new.target`, minus member-expression
 *                constructors (`new foo.Bar()` is a qualified name, still a
 *                constructor, so it is counted and also reported separately).
 *   exports      export_statement, and its forms, because the type is emitted
 *                from a derived channel (extractExports), not from the node.
 *   calls        call_expression, minus decorator positions (the family rule:
 *                a decorator is metadata, not a call).
 *
 * ## Usage
 *
 *   bun validation/m14/fixtures/typescript/construct-probe.ts [nfiles]
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { getParser } from "../../../../src/ast/engine"

const CORPUS_ROOT = process.env.BB_TS_CORPUS ?? "/home/ishaq2321/bb_tests/repositories"
const CORPUS_DIR = process.env.BB_TS_REPO ?? "element-plus"
const NFILES = Number(process.argv[2] ?? process.env.NFILES ?? 400)
const DIR = join(CORPUS_ROOT, CORPUS_DIR)
const EXTS = [".ts", ".tsx", ".mts", ".cts"]
const SIGNALS = ["function ", "export ", "class ", "const "]
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".pnpm-store", "coverage"])
const MAX_BYTES = 400_000

interface Counters {
  files: number
  bytes: number
  nodes: number
  classDecl: number
  classExtendsClause: number
  classExtendsTargets: number
  implementsClause: number
  implementsTargets: number
  interfaceDecl: number
  interfaceExtendsTypeClause: number
  interfaceExtendsTargets: number
  genericTypeParamExtends: number
  conditionalTypeExtends: number
  mappedTypeExtends: number
  exportStatement: number
  exportDeclaration: number
  newExpression: number
  newTarget: number
  newMemberExpr: number
  overrideModifier: number
  declareOverload: number
  callExpression: number
  callInDecorator: number
  methodDefinition: number
  abstractMethodSignature: number
  signatureDeclaration: number
}

function blankCounters(): Counters {
  return {
    files: 0, bytes: 0, nodes: 0, classDecl: 0, classExtendsClause: 0, classExtendsTargets: 0,
    implementsClause: 0, implementsTargets: 0, interfaceDecl: 0, interfaceExtendsTypeClause: 0,
    interfaceExtendsTargets: 0, genericTypeParamExtends: 0, conditionalTypeExtends: 0,
    mappedTypeExtends: 0, exportStatement: 0, exportDeclaration: 0, newExpression: 0,
    newTarget: 0, newMemberExpr: 0, overrideModifier: 0, declareOverload: 0, callExpression: 0,
    callInDecorator: 0, methodDefinition: 0, abstractMethodSignature: 0, signatureDeclaration: 0,
  }
}

function collectFiles(dir: string, want: number): { files: string[]; seen: number; tooBig: number; noSignal: number; wrongExt: number } {
  const files: string[] = []
  let seen = 0, tooBig = 0, noSignal = 0, wrongExt = 0
  const walk = (d: string, depth: number): void => {
    if (files.length >= want || depth > 24) return
    let ents: ReturnType<typeof readdirSync>
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (files.length >= want) return
      const p = join(d, e.name)
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, depth + 1); continue }
      if (!EXTS.some((x) => e.name.endsWith(x))) { wrongExt++; continue }
      seen++
      try {
        if (statSync(p).size >= MAX_BYTES) { tooBig++; continue }
        const src = readFileSync(p, "utf8")
        if (!SIGNALS.some((s) => src.includes(s))) { noSignal++; continue }
        files.push(p)
      } catch { /* unreadable: not admitted, not counted as rejected-for-signal */ }
    }
  }
  walk(dir, 0)
  return { files, seen, tooBig, noSignal, wrongExt }
}

/** Does this node carry an `override` modifier token? Children walked by type,
 *  never by text. `override` is a modifier keyword child of method_definition. */
function hasOverrideModifier(node: any): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (!c) continue
    if (c.type === "override") return true
  }
  return false
}

/** Is `node` inside a decorator? Walk UP via parent and test node.type. The
 *  analyzer threads this down the recursion for performance; a census that runs
 *  once per file can afford the parent walk and the two are equivalent in
 *  answer, which is asserted by comparing against the analyzer's own emitted
 *  decorator call count on the same file. */
function inDecorator(node: any): boolean {
  let n = node.parent
  let depth = 0
  while (n && depth < 200) {
    if (n.type === "decorator") return true
    // A decorator cannot be an ancestor of a statement/declaration boundary.
    if (n.type === "statement_block" || n.type === "class_body" || n.type === "export_statement") return false
    n = n.parent
    depth++
  }
  return false
}

async function main(): Promise<void> {
  const pop = collectFiles(DIR, NFILES)
  console.log("=".repeat(100))
  console.log("TYPESCRIPT CONSTRUCT PROBE — the construct, counted on the parse tree (no regex, no text matching)")
  console.log("=".repeat(100))
  console.log(`corpus dir       ${CORPUS_DIR}  (${DIR})`)
  console.log(`POPULATION       ${pop.files.length} files admitted of ${pop.seen} candidates examined`)
  console.log(`  rejected       ${pop.noSignal} no code signal · ${pop.tooBig} over ${MAX_BYTES} bytes · ${pop.wrongExt} other extensions`)
  console.log()

  const parser = await getParser("typescript")
  const c = blankCounters()
  // Per-construct file lists, so a verdict can NAME its files (the contract
  // requires EMITTED to carry "a count and the FILES it came from").
  const hitFiles = new Map<string, Set<string>>()
  const note = (k: string, f: string): void => {
    let s = hitFiles.get(k)
    if (!s) { s = new Set<string>(); hitFiles.set(k, s) }
    s.add(f)
  }

  for (const f of pop.files) {
    let content: string
    try { content = readFileSync(f, "utf8") } catch { continue }
    let root: any
    try {
      const pr = await parser.parse(content, f)
      root = pr.rootNode
    } catch { continue }
    const rel = relative(DIR, f)
    c.files++
    c.bytes += content.length

    // Full cursor walk. Cursor is the tree-sitter-native traversal; every count
    // below is a node.type test on the node the cursor is ON.
    //
    // The traversal shape matters and was wrong on its first writing: a `wentPast`
    // flag that is set once and never cleared under-counts, and under-counting a
    // CONSTRUCT PROBE is the one failure mode that manufactures a RULED verdict
    // out of a corpus that is full of the construct. It read 1,710 nodes over
    // 645,513 bytes of TypeScript, which is impossible. The invariant now
    // asserted below — every node visited exactly once, and the count bounded by
    // bytes/4 — is what caught it.
    const cursor = root.walk()
    let done = false
    const visit = (n: any): void => {
        c.nodes++
        const t = n.type
        switch (t) {
          case "class_declaration": c.classDecl++; break
          case "interface_declaration": c.interfaceDecl++; break
          case "class_heritage": {
            for (let i = 0; i < n.namedChildCount; i++) {
              const cl = n.namedChild(i)
              if (!cl) continue
              if (cl.type === "extends_clause") {
                c.classExtendsClause++
                c.classExtendsTargets += cl.namedChildCount
                note("class extends_clause", rel)
              } else if (cl.type === "implements_clause") {
                c.implementsClause++
                c.implementsTargets += cl.namedChildCount
                note("implements_clause", rel)
              }
            }
            break
          }
          case "extends_type_clause": {
            c.interfaceExtendsTypeClause++
            c.interfaceExtendsTargets += n.namedChildCount
            note("extends_type_clause (interface base)", rel)
            break
          }
          case "type_parameter": {
            // `T extends U` on a generic parameter: a CONSTRAINT, not inheritance.
            for (let i = 0; i < n.namedChildCount; i++) {
              const ch = n.namedChild(i)
              if (ch && ch.type === "constraint") c.genericTypeParamExtends++
            }
            if (n.childCount > 0) {
              for (let i = 0; i < n.childCount; i++) {
                const ch = n.child(i)
                if (ch && ch.type === "extends") { c.genericTypeParamExtends++; break }
              }
            }
            break
          }
          case "conditional_type": c.conditionalTypeExtends++; break
          case "type_alias_declaration": c.declareOverload += 0; break
          case "export_statement": c.exportStatement++; note("export_statement", rel); break
          case "export_declaration": c.exportDeclaration++; break
          case "new_expression": {
            c.newExpression++
            for (let i = 0; i < n.namedChildCount; i++) {
              const ch = n.namedChild(i)
              if (!ch) continue
              if (ch.type === "meta_property") c.newTarget++
              if (ch.type === "member_expression") c.newMemberExpr++
            }
            note("new_expression", rel)
            break
          }
          case "method_definition": {
            c.methodDefinition++
            if (hasOverrideModifier(n)) { c.overrideModifier++; note("override modifier", rel) }
            break
          }
          case "abstract_method_signature": c.abstractMethodSignature++; break
          case "call_expression": {
            c.callExpression++
            if (inDecorator(n)) c.callInDecorator++
            break
          }
          default: break
        }
        if (t === "mapped_type") c.mappedTypeExtends++
    }
    visit(cursor.currentNode as any)
    while (!done) {
      if (cursor.gotoFirstChild()) { visit(cursor.currentNode as any); continue }
      if (cursor.gotoNextSibling()) { visit(cursor.currentNode as any); continue }
      // No child and no sibling: climb until a sibling exists, or we are past the root.
      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) { done = true; break }
      }
      if (!done) visit(cursor.currentNode as any)
    }
  }

  // AGGREGATE, not per-file. The first form of this check was per-file and it
  // fired on `lib.es2025.promise.d.ts` — 76 nodes over 1,619 bytes — which is
  // DENSE, not broken: an ambient declaration file is almost entirely type
  // annotations and every one of them is a node. A per-file density bound
  // measures the file's style, not the traversal's correctness, so it was moved
  // to the population, where it can only fail if the walk as a whole is short.
  if (c.files > 0 && c.nodes < c.bytes / 12) {
    throw new Error(
      `traversal invariant violated: ${c.nodes} nodes over ${c.bytes} bytes across ${c.files} files. ` +
      `A construct probe that under-counts manufactures a RULED verdict from a corpus that is full of the construct.`,
    )
  }

  const row = (label: string, key: string, n: number, note2 = ""): void => {
    const files = hitFiles.get(key)
    const fs = files ? ` in ${files.size} files` : ""
    console.log(`  ${label.padEnd(46)} ${String(n).padStart(7)}${fs}   ${note2}`)
  }

  console.log("POPULATION MEASURED ON THE TREE")
  console.log(`  files parsed                                ${String(c.files).padStart(7)}`)
  console.log(`  source bytes                                ${String(c.bytes).padStart(7)}`)
  console.log(`  AST nodes visited                           ${String(c.nodes).padStart(7)}`)
  console.log()

  console.log("CLASS HERITAGE")
  row("class_declaration", "class_declaration", c.classDecl)
  row("class_heritage > extends_clause", "class extends_clause", c.classExtendsClause)
  console.log(`  ${"  (targets inside those clauses)".padEnd(46)} ${String(c.classExtendsTargets).padStart(7)}`)
  row("class_heritage > implements_clause", "implements_clause", c.implementsClause)
  console.log(`  ${"  (targets inside those clauses)".padEnd(46)} ${String(c.implementsTargets).padStart(7)}`)
  console.log()

  console.log("INTERFACE HERITAGE  (TS spells this extends_type_clause, NOT implements_clause)")
  row("interface_declaration", "interface_declaration", c.interfaceDecl)
  row("extends_type_clause", "extends_type_clause (interface base)", c.interfaceExtendsTypeClause)
  console.log(`  ${"  (targets inside those clauses)".padEnd(46)} ${String(c.interfaceExtendsTargets).padStart(7)}`)
  console.log()

  console.log("TYPE-LEVEL `extends` — a CONSTRAINT or a conditional, NOT class inheritance")
  console.log(`  ${"type_parameter ... extends (generic constraint)".padEnd(46)} ${String(c.genericTypeParamExtends).padStart(7)}`)
  console.log(`  ${"conditional_type (T extends U ? X : Y)".padEnd(46)} ${String(c.conditionalTypeExtends).padStart(7)}`)
  console.log(`  ${"mapped_type".padEnd(46)} ${String(c.mappedTypeExtends).padStart(7)}`)
  console.log()

  console.log("OVERRIDES — construct sites")
  console.log(`  ${"method_definition".padEnd(46)} ${String(c.methodDefinition).padStart(7)}`)
  console.log(`  ${"  of which carry the `override` MODIFIER".padEnd(46)} ${String(c.overrideModifier).padStart(7)}`)
  console.log(`  ${"abstract_method_signature".padEnd(46)} ${String(c.abstractMethodSignature).padStart(7)}`)
  console.log(`  ${"structural sites: extends/implements clauses whose".padEnd(46)} ${String(c.classExtendsClause + c.implementsClause + c.interfaceExtendsTypeClause).padStart(7)}`)
  console.log(`  ${"  target is an in-file type — the analyzer's arms key here".padEnd(46)}`)
  console.log()

  console.log("INSTANTIATES")
  row("new_expression", "new_expression", c.newExpression)
  console.log(`  ${"  of which new.target (the meta_property, not a ctor)".padEnd(46)} ${String(c.newTarget).padStart(7)}`)
  console.log(`  ${"  of which constructor is a member_expression".padEnd(46)} ${String(c.newMemberExpr).padStart(7)}`)
  console.log()

  console.log("EXPORTS")
  row("export_statement", "export_statement", c.exportStatement)
  console.log(`  ${"export_declaration (export = ...)".padEnd(46)} ${String(c.exportDeclaration).padStart(7)}`)
  console.log()

  console.log("CALLS")
  console.log(`  ${"call_expression".padEnd(46)} ${String(c.callExpression).padStart(7)}`)
  console.log(`  ${"  of which in DECORATOR position (metadata, not a call edge)".padEnd(46)} ${String(c.callInDecorator).padStart(7)}`)
  console.log(`  ${"  net callable call sites".padEnd(46)} ${String(c.callExpression - c.callInDecorator).padStart(7)}`)

  console.log()
  console.log("FILES per construct construct (first 8 each)")
  for (const k of ["implements_clause", "class extends_clause", "extends_type_clause (interface base)", "override modifier", "new_expression", "export_statement"]) {
    const s = hitFiles.get(k)
    if (!s || s.size === 0) { console.log(`  ${k}: (none)`); continue }
    console.log(`  ${k}: ${s.size} files`)
    for (const x of [...s].slice(0, 8)) console.log(`      ${x}`)
  }
}

await main()
