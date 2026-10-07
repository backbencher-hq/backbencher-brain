/**
 * TYPESCRIPT CONSTRUCT CENSUS — the instrument that separates "the analyzer
 * does not read this" from "the corpus does not contain this".
 *
 * A firing check tallies what COMES OUT of the analyzer. It cannot distinguish a
 * branch that never matches from a corpus that never exercises it, and that
 * distinction is the whole question for the two types this lane is silent on.
 *
 * This instrument counts the CONSTRUCT, on the parse tree, before the analyzer
 * is consulted at all. That is instrument B in ONTOLOGY-WORKSTREAM.md
 * ("parse-tree semantic count — for a type the language CAN express ... it must
 * be counted on the tree, where a string or a heredoc cannot fake it").
 *
 * Zero regular expressions. Every predicate below is `node.type` equality or
 * string arithmetic on a node's own text. A regex over source text would match
 * `implements` inside a comment or a string literal, which is exactly how the
 * workstream's first two gate probes produced two false positives.
 *
 * READ-ONLY. Writes nothing except the JSON passed with --out.
 *
 * Usage:
 *   bun script/m14/ts-construct-census.ts --repo typescript --out x.json
 */
import fs from "node:fs"
import * as path from "node:path"
import { admittedTypeScriptFiles, isFallbackResult } from "./ts-lane-corpus"

const argv = process.argv.slice(2)
const argOf = (flag: string): string | undefined => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const ROOT = path.resolve(import.meta.dir, "..", "..")
const REPO = argOf("--repo") ?? "element-plus"
const LIMIT = Number(argOf("--limit") ?? "0")
const MAX_BYTES = Number(argOf("--max-bytes") ?? String(512 * 1024))
const OUT = argOf("--out")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

const pop = admittedTypeScriptFiles(CR, REPO, MAX_BYTES, LIMIT)
const files = pop.all

// ------------------------------------------------------------------ parser
// TWO grammars, mirroring engine.ts:775-776. `.tsx` needs the JSX-capable
// tree-sitter-tsx.wasm; the plain typescript grammar carries no JSX. Loading
// only the plain one produced 7,236 ERROR nodes confined to 130 `.test.tsx`
// files in the first run of this probe — a wrong-program result that looked
// like a corpus finding. A damaged tree cannot carry a heritage clause, so it
// would have understated `implements` and `overrides` precisely where the
// verdict is being decided.
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const glTs = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-typescript.wasm")))
const glTsx = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-tsx.wasm")))
const parserTs = new P()
parserTs.setLanguage(glTs)
const parserTsx = new P()
parserTsx.setLanguage(glTsx)
const isTsx = (abs: string): boolean => abs.endsWith(".tsx")
const parserFor = (abs: string): any => (isTsx(abs) ? parserTsx : parserTs)

// ------------------------------------------------------------------ counters
/**
 * One bucket per construct. Every bucket carries BOTH the count and the set of
 * files it occurred in — "0 in 0 files" and "0 in 1,061 files" are different
 * statements and only the second one supports a ruling.
 */
type Bucket = { count: number; files: Set<string>; examples: string[] }
const bucket = (): Bucket => ({ count: 0, files: new Set(), examples: [] })
const B = {
  classDeclaration: bucket(),
  abstractClassDeclaration: bucket(),
  interfaceDeclaration: bucket(),
  classHeritage: bucket(),
  extendsClause: bucket(),
  implementsClause: bucket(),
  interfaceExtendsClause: bucket(),
  /** `override` keyword on a class member — the explicit override marker */
  overrideKeyword: bucket(),
  /** class members a structural override could pair: methods */
  methodDefinition: bucket(),
  publicFieldDefinition: bucket(),
  /** call/new/identifier positions, for the constructs the census also confirms */
  callExpression: bucket(),
  newExpression: bucket(),
  importStatement: bucket(),
  exportStatement: bucket(),
  typeReference: bucket(),
  /** an `implements` clause whose base name is DECLARED IN THE SAME FILE */
  implementsResolvableInFile: bucket(),
  /** an `extends` clause on a class whose base is declared in the same file */
  classExtendsResolvableInFile: bucket(),
  /** an interface `extends` whose base is declared in the same file */
  interfaceExtendsResolvableInFile: bucket(),
  /** a class member named identically in the class and in an in-file base */
  structuralOverrideCandidate: bucket(),
}
const bump = (b: Bucket, file: string, example?: string): void => {
  b.count++
  b.files.add(file)
  if (example !== undefined && b.examples.length < 8) b.examples.push(example)
}

const DECL_TYPES = new Set([
  "class_declaration",
  "abstract_class_declaration",
  "class",
  "interface_declaration",
])

/** Names declared at file scope, so "resolves in-file" is measured not assumed. */
const declaredAtFileScope = (root: any): Set<string> => {
  const names = new Set<string>()
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (DECL_TYPES.has(n.type)) {
      const name = n.childForFieldName?.("name")
      if (name && name.text) names.add(name.text)
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return names
}

/** The base type names inside a heritage clause, via the grammar's own children. */
const heritageNames = (clause: any): string[] => {
  const out: string[] = []
  for (let i = 0; i < clause.namedChildCount; i++) {
    const c = clause.namedChild(i)
    if (!c) continue
    // A heritage entry is a type node: `extends ns.Base`, `implements A, B`,
    // and each may carry type arguments.
    if (c.type === "type_identifier") out.push(c.text)
    else if (c.type === "nested_type_identifier") out.push(c.text)
    else if (c.type === "generic_type") {
      const t = c.namedChild(0)
      if (t && (t.type === "type_identifier" || t.type === "nested_type_identifier")) out.push(t.text)
    } else if (c.type === "member_type") {
      const t = c.namedChild(0)
      if (t && (t.type === "type_identifier" || t.type === "nested_type_identifier")) out.push(t.text)
    }
  }
  return out
}

/**
 * Does this node carry the `override` modifier as a direct child?
 *
 * The grammar's node type is `override_modifier`, NOT `override`. The first
 * version of this probe compared `c.type === "override"`, which can never match,
 * and so reported 0 `override` keywords on every corpus — indistinguishable from
 * a codebase that does not use `noImplicitOverride`. Proved against a fixture
 * whose method_definition children are literally
 *   ["override_modifier","property_identifier","formal_parameters",...]
 * Both spellings are accepted below because the analyzer's own modifier reader
 * carries the same dead `case "override"` and is rescued by a text fallback; the
 * census reports the grammar's spelling and says so.
 */
const OVERRIDE_TOKEN_TYPES = new Set(["override_modifier", "override"])
const hasOverrideKeyword = (n: any): boolean => {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (!c) continue
    if (OVERRIDE_TOKEN_TYPES.has(c.type)) return true
  }
  return false
}

// ------------------------------------------------------------------ walk
let parsed = 0
let failed = 0
let errorNodes = 0
const errorFiles: string[] = []
const perFileErrors = new Map<string, number>()
const fallbackFiles: string[] = []

for (const abs of files) {
  const rel = path.relative(pop.repoDir, abs)
  let content: string
  try {
    content = fs.readFileSync(abs, "utf8")
  } catch {
    failed++
    continue
  }
  let tree: any
  try {
    tree = parserFor(abs).parse(content)
  } catch {
    failed++
    continue
  }
  const root = tree?.rootNode
  if (!root) {
    failed++
    try {
      tree?.delete?.()
    } catch {}
    continue
  }
  parsed++

  const scopeNames = declaredAtFileScope(root)
  // A damaged tree cannot carry a heritage clause, so the ERROR population has
  // to be attributed per file before any construct count is read as an absence.
  {
    let local = 0
    const probe: any[] = [root]
    while (probe.length) {
      const n = probe.pop()!
      if (n.type === "ERROR" || n.isMissing) local++
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) probe.push(c)
      }
    }
    if (local) {
      errorFiles.push(`${rel} (${local})`)
      perFileErrors.set(rel, local)
    }
  }

  // Pass 1 — node census + in-file resolvability of every heritage clause.
  const classMembers = new Map<string, Set<string>>()
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "ERROR" || n.isMissing) errorNodes++

    switch (n.type) {
      case "class_declaration":
        bump(B.classDeclaration, rel)
        break
      case "abstract_class_declaration":
        bump(B.abstractClassDeclaration, rel)
        break
      case "interface_declaration":
        bump(B.interfaceDeclaration, rel)
        break
      case "class_heritage":
        bump(B.classHeritage, rel)
        break
      case "call_expression":
        bump(B.callExpression, rel)
        break
      case "new_expression":
        bump(B.newExpression, rel)
        break
      case "import_statement":
        bump(B.importStatement, rel)
        break
      case "export_statement":
        bump(B.exportStatement, rel)
        break
      case "type_reference":
        bump(B.typeReference, rel)
        break
      case "method_definition": {
        bump(B.methodDefinition, rel)
        if (hasOverrideKeyword(n)) bump(B.overrideKeyword, rel, `${rel} ${n.startPosition.row + 1}`)
        const name = n.childForFieldName?.("name")
        const owner = n.parent
        const ownerName = owner?.childForFieldName?.("name")
        if (name && ownerName) {
          const set = classMembers.get(ownerName.text) ?? new Set<string>()
          set.add(name.text)
          classMembers.set(ownerName.text, set)
        }
        break
      }
      case "public_field_definition": {
        bump(B.publicFieldDefinition, rel)
        if (hasOverrideKeyword(n)) bump(B.overrideKeyword, rel, `${rel} ${n.startPosition.row + 1}`)
        break
      }
      case "extends_clause": {
        // A class `extends` and an interface `extends` are the SAME grammar node,
        // so the PARENT decides which counter it is. Not a regex: a string
        // comparison on the node's own grammar type.
        //
        // tree-sitter-typescript:
        //   class_heritage:      extends_clause | implements_clause | ...
        //   extends_type_clause: extends_clause ...          (interface heritage)
        // so the class case is `parent.type === "class_heritage"`. The first
        // version of this probe read `n.parent?.parent?.type`, which is the
        // DECLARATION, and compared it to "class_heritage" — a test that can
        // never match. Every class-extends was therefore filed as an interface
        // extends, and both class-extends counters read 0 on a corpus with 495
        // class_heritage nodes. Corrected here.
        const ownerType = n.parent?.type ?? ""
        if (ownerType === "class_heritage") {
          bump(B.extendsClause, rel)
          for (const name of heritageNames(n)) {
            if (scopeNames.has(name)) {
              bump(B.classExtendsResolvableInFile, rel, `${rel} ${n.startPosition.row + 1} extends ${name}`)
            }
          }
        } else {
          bump(B.interfaceExtendsClause, rel)
          for (const name of heritageNames(n)) {
            if (scopeNames.has(name)) {
              bump(B.interfaceExtendsResolvableInFile, rel, `${rel} ${n.startPosition.row + 1} extends ${name}`)
            }
          }
        }
        break
      }
      case "implements_clause": {
        bump(B.implementsClause, rel, `${rel} ${n.startPosition.row + 1}`)
        for (const name of heritageNames(n)) {
          if (scopeNames.has(name)) {
            bump(B.implementsResolvableInFile, rel, `${rel} ${n.startPosition.row + 1} implements ${name}`)
          }
        }
        break
      }
      default:
        break
    }

    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }

  // Pass 2 — the STRUCTURAL override condition: a class member sharing a name
  // with a member of an in-file base (by `extends` or `implements`). This is the
  // exact shape the analyzer's third override arm pairs, counted independently of
  // the analyzer, so "0 overrides" can be attributed to the corpus or to the code.
  for (const n of scopeNames) {
    void n
  }
  {
    const stack2: any[] = [root]
    while (stack2.length) {
      const n = stack2.pop()!
      if (n.type === "class_heritage") {
        const owner = n.parent
        const clsName = owner?.childForFieldName?.("name")?.text
        if (!clsName) {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c) stack2.push(c)
          }
          continue
        }
        const own = classMembers.get(clsName) ?? new Set<string>()
        const bases: string[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "extends_clause" || c.type === "implements_clause") bases.push(...heritageNames(c))
        }
        for (const base of bases) {
          const baseMembers = classMembers.get(base)
          if (!baseMembers) continue // external base: no in-file member set
          for (const m of own) {
            if (baseMembers.has(m)) {
              bump(B.structuralOverrideCandidate, rel, `${rel} ${clsName}.${m} -> ${base}.${m}`)
            }
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack2.push(c)
      }
    }
  }

  try {
    tree?.delete?.()
  } catch {}
}

// ------------------------------------------------------------------ report
const rows: [string, Bucket][] = [
  ["class_declaration", B.classDeclaration],
  ["abstract_class_declaration", B.abstractClassDeclaration],
  ["interface_declaration", B.interfaceDeclaration],
  ["class_heritage", B.classHeritage],
  ["extends_clause (class)", B.extendsClause],
  ["implements_clause", B.implementsClause],
  ["extends_clause (interface)", B.interfaceExtendsClause],
  ["`override` keyword on member", B.overrideKeyword],
  ["method_definition", B.methodDefinition],
  ["public_field_definition", B.publicFieldDefinition],
  ["class extends -> in-file base", B.classExtendsResolvableInFile],
  ["interface extends -> in-file base", B.interfaceExtendsResolvableInFile],
  ["implements -> in-file base", B.implementsResolvableInFile],
  ["structural override candidate", B.structuralOverrideCandidate],
  ["call_expression", B.callExpression],
  ["new_expression", B.newExpression],
  ["import_statement", B.importStatement],
  ["export_statement", B.exportStatement],
  ["type_reference", B.typeReference],
]

const out: any = {
  at: new Date().toISOString(),
  repo: REPO,
  rev: pop.rev,
  corpusRoot: CR,
  population: {
    trackedTypescriptPaths: pop.trackedTs,
    trackedAmbientDeclaration: pop.trackedDeclaration,
    admitted: files.length,
    sizeCapBytes: MAX_BYTES,
    derivedFrom: "git ls-files via ts-lane-corpus.admittedTypeScriptFiles",
  },
  filesParsed: parsed,
  filesFailed: failed,
  errorNodes,
  errorFiles: errorFiles.slice(0, 20),
  constructs: {},
}
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`typescript construct census — repo ${REPO}@${pop.rev.slice(0, 8)}`)
console.log(`POPULATION  tracked .ts/.tsx/.mts/.cts ${pop.trackedTs.toLocaleString()} (ambient .d.ts ${pop.trackedDeclaration.toLocaleString()})`)
console.log(`            admitted ${files.length.toLocaleString()} under ${MAX_BYTES.toLocaleString()} B cap, ${LIMIT || "no"} limit`)
console.log(`parsed ${parsed.toLocaleString()}  failed ${failed}  ERROR nodes ${errorNodes}\n`)
console.log(`${w("construct", 34)}${w("count", 12)}${w("files", 9)}examples`)
console.log("-".repeat(140))
for (const [name, b] of rows) {
  out.constructs[name] = { count: b.count, files: b.files.size, fileSample: [...b.files].slice(0, 8), examples: b.examples }
  console.log(`${w(name, 34)}${w(b.count.toLocaleString(), 12)}${w(String(b.files.size), 9)}${b.examples.slice(0, 2).join("  |  ")}`)
}
if (errorFiles.length) {
  const ranked = [...perFileErrors.entries()].sort((a, b) => b[1] - a[1])
  console.log(`\nfiles with ERROR nodes: ${errorFiles.length.toLocaleString()} of ${parsed.toLocaleString()}; worst 15 by count:`)
  for (const [f, n] of ranked.slice(0, 15)) console.log(`   ${String(n).padStart(6)}  ${f}`)
}
if (OUT) {
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(`\nwrote ${OUT}`)
}
void isFallbackResult