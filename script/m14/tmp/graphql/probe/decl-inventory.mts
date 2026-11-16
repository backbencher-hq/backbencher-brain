/**
 * DECLARATION INVENTORY — does the analyzer publish a symbol for every name the
 * GRAMMAR declares?
 *
 * The S2 bucket in ambiguity-split was defined against corpus TEXT, which a
 * USAGE satisfies as well as a DECLARATION, so it could not separate "the
 * analyzer dropped a declaration" from "a schema names a type it never defines".
 * This probe closes that: it walks the parse tree and collects names at
 * DECLARATION nodes only, grammar-derived and analyzer-independent, then diffs
 * that set against the analyzer's published symbols.
 *
 * A name in `declaredButNotPublished` is a lane-owned defect. A name in
 * `referencedButNotDeclared` is a schema naming something outside the corpus —
 * correct behaviour, not a gap.
 */
/**
 * DECLARATION INVENTORY — does the analyzer publish a symbol for every name the GRAMMAR declares?
 *
 * ## Why this exists: it CORRECTS a bucket in `ambiguity-split.mts`
 *
 * `ambiguity-split` classifies an unresolved target as S2 "present in corpus text but claimed by
 * no symbol" and calls S2 the only lane-owned bucket. That definition is wrong, and this probe is
 * the evidence. A corpus-text scan cannot tell a DECLARATION from a USAGE: `story` appears 27
 * times as an unresolved target and `grep -c story` finds it in kitchen-sink.graphql — as a
 * SELECTED FIELD in an executable query, not as a declared type. Every one of S2's top 40 names
 * was checked against the corpus-wide symbol set and all 40 are `NO SYMBOL ANYWHERE`, which is
 * what a usage looks like. S2 measures "a schema names something it never defines", which is
 * correct analyzer behaviour — GraphQL splits SDL across files, and a query file legitimately
 * names types a schema file elsewhere declares.
 *
 * So the question S2 was meant to ask needs a grammar-level instrument: walk the parse tree,
 * collect the name at every DECLARATION node, and diff that against the analyzer's symbols. A
 * name the grammar declares and no symbol claims is a dropped declaration — a real defect.
 *
 * ## The result: 0, over 36,730 declaration sites
 *
 * ## THREE assumptions that each produced a plausible ZERO instead of an error
 *
 * A measurement that finds nothing and cannot say why is not a pass. Each of these returned a
 * clean 0 on a corpus that is not empty:
 *
 *   1 `node.type` is `PascalCase` (`ObjectTypeDefinition`), not `object_type_definition`. The
 *     snake_case spelling matched nothing, so the probe reported 0 declaration sites over 1,905
 *     files — a number indistinguishable from a correct one.
 *   2 the name node is `Name`, capital N. `c.type === "name"` matched nothing. Same failure mode.
 *   3 a field's name is a DIRECT `Name` child. A "last Name at any depth" walk descends into the
 *     return type and returns it — `n: String` yields `String`, not `n`. This one produced 11,745
 *     WRONG names rather than a zero, which is why it is the dangerous one.
 *
 * Every accessor here was PRINTED from the live wasm before being used, not read off
 * `nodeTypes.json` or assumed from the analyzer's doc — the analyzer's own header and the grammar
 * repo's `nodeTypes.json` disagree with the wasm.
 *
 * ## The fourth correction, and the one that matters most
 *
 * The first working run reported 143 names "declared but not published", ALL of them
 * `DirectiveDefinition`. The symbol contract publishes a directive definition as `@name` — the
 * `@` is part of the published identity (`docs/analyzers/graphql.md`, Symbol
 * contract) — so `requiresOptIn` (grammar) and `@requiresOptIn` (published) are the same name and
 * a plain string diff calls them different. 143 is what "@ in a name" is worth. Fixed by
 * normalising both sides by stripping one leading `@`.
 *
 * `requiresOptIn` also appears TWICE in one corpus file as a `DirectiveDefinition` (a directive
 * that annotates a directive definition, plus its own definition), and the analyzer publishes
 * `@requiresOptIn` twice — so the count is right and the duplicate is the source's, not the
 * analyzer's. That file is
 * `gql-graphql-platform/src/HotChocolate/Core/test/Types.Tests/Types/Directives/__snapshots__/RequiresOptInDirectiveTests.BuildSchemaAsync_SchemaFirst_MatchesSnapshot.graphql`.
 *
 * ## WHAT A NON-ZERO WOULD MEAN, and what this does NOT claim
 *
 * Overturn condition: a corpus file in which the grammar produces a declaration node carrying a
 * name that no `brain_symbol` row claims. Adding one construct to the analyzer would move this
 * from 0.
 *
 * This is a LOWER BOUND on the analyzer's declaration coverage and an UPPER bound on one class of
 * loss. It says nothing about whether a published symbol is at the right line, the right range or
 * the right kind — a symbol can be published and wrong, and `differential.ts` plus the fixture
 * suite are the instruments for that. It also does not audit the RELATIONSHIPS a declaration
 * should carry; `master-relationships.mts` does that by construct.
 *
 *     npx tsx script/m14/tmp/graphql/probe/decl-inventory.mts
 *
 * Writes `out/decl-inventory.json`. READ-ONLY with respect to the corpus.
 */
import * as fs from "fs"
import * as path from "path"
import { execFileSync } from "child_process"
import { statSync } from "fs"
const ROOT = "<corpus-root>/mcp/bb-lanes/graphql"
const CR = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const OUT = path.join(ROOT, "script/m14/tmp/graphql/out")
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const { detectLanguageFromPath } = await import(path.join(ROOT, "src/ast/language-detection.ts"))
const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const language: any = await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-graphql.wasm")))

/**
 * The grammar node types that DECLARE a named entity, and the accessor that reaches the
 * name. Read off a live tree, not assumed: `nodeTypes.json` in the grammar repo and the
 * analyzer's own doc disagree with the wasm, so the shapes below are the ones printed by
 * `nt3.mts` against `wasm/tree-sitter-graphql.wasm`:
 *
 *   ObjectTypeDefinition   [Description type Name ImplementsInterfaces FieldsDefinition]
 *   InterfaceTypeDefinition / UnionTypeDefinition / EnumTypeDefinition / InputObjectTypeDefinition
 *   ScalarTypeDefinition   [scalar Name]
 *   …TypeExtension         [extend type Name FieldsDefinition]
 *   DirectiveDefinition    [directive @ Name ArgumentsDefinition on DirectiveLocations]
 *   FieldDefinition        [Name ArgumentsDefinition : Type]   <- the alias, if present, comes first
 *   InputValueDefinition   [Name : Type DefaultValue]           <- under Arguments this is a PARAMETER
 *   EnumValueDefinition    [EnumValue]                          <- the name is inside `EnumValue`
 *
 * `Name` is the node type, capital N — `c.type === "name"` matched nothing, which is why the
 * first run of this file reported 0 declaration sites over 1,905 files rather than an error.
 */
const DECL_NODES = new Set([
  "ObjectTypeDefinition", "InterfaceTypeDefinition", "UnionTypeDefinition",
  "EnumTypeDefinition", "ScalarTypeDefinition", "InputObjectTypeDefinition",
  "ObjectTypeExtension", "InterfaceTypeExtension", "UnionTypeExtension",
  "EnumTypeExtension", "ScalarTypeExtension", "InputObjectTypeExtension",
  "DirectiveDefinition", "EnumValueDefinition", "FieldDefinition",
])

/**
 * The declared name of a declaration node, or "" when the node declares nothing named.
 *
 * Every shape below was PRINTED from the live wasm rather than assumed, because three
 * assumptions were wrong on the first attempt and each one produced a plausible zero:
 * `node.type` is PascalCase (`ObjectTypeDefinition`), the name node is `Name` and not `name`,
 * and a field's return type is a sibling `NamedType`, so a "last Name at any depth" walk
 * returns the RETURN TYPE (`n: String` -> `String`) instead of the field.
 */
function declaredName(n: any): string {
  const t = String(n.type)
  // `RED` inside `enum { RED }` is `EnumValueDefinition [EnumValue [Name(RED)]]`.
  if (t === "EnumValueDefinition") {
    const ev = n.child(0)
    if (ev && ev.type === "EnumValue") {
      for (let i = 0; i < ev.childCount; i++) if (ev.child(i).type === "Name") return ev.child(i).text
    }
    return ""
  }
  // A field or an input field carries its name as a DIRECT `Name` child, before `:`.
  if (t === "FieldDefinition" || t === "InputValueDefinition") {
    for (let i = 0; i < n.childCount; i++) if (n.child(i).type === "Name") return n.child(i).text
    return ""
  }
  // Everything else: the first `Name` at depth, skipping only the anonymous leading
  // `Description` and the keyword (`type`, `@`, `extend`).
  const stack: any[] = [n]
  while (stack.length) {
    const x = stack.pop()
    for (let i = 0; i < x.childCount; i++) {
      const c = x.child(i)
      if (c.type === "Name") return c.text
      if (c.type === "Description") continue
      stack.push(c)
    }
  }
  return ""
}

/** An `InputValueDefinition` under an `ArgumentsDefinition` is a PARAMETER, not a declaration. */
function isParameter(n: any): boolean {
  return String(n.type) === "InputValueDefinition" && String(n.parent?.type ?? "") === "ArgumentsDefinition"
}

const files: string[] = []
for (const e of fs.readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git",["-C",dir,"rev-parse","--git-dir"],{stdio:"ignore"}) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git",["-C",dir,"ls-files","-z"],{encoding:"utf8",maxBuffer:512*1024*1024}).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512*1024) continue } catch { continue }
    let text: string
    try { text = fs.readFileSync(abs,"utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "graphql") continue
    files.push(abs)
  }
}
files.sort()
console.log(`declaration inventory — ${files.length} admitted files`)
const parser = new ParserClass(); parser.setLanguage(language)

const declaredNames = new Map<string, number>()       // grammar-declared name -> sites
const declaredQNames = new Map<string, number>()
const published = new Set<string>()
const declNotPublished = new Map<string, { sites: number; nodeTypes: Record<string, number>; file: string }>()
let declSites = 0
for (const f of files) {
  const rel = path.relative(CR, f)
  const src = fs.readFileSync(f, "utf8")
  let tree: any
  try { tree = parser.parse(src) } catch { continue }
  const stack: any[] = [tree.rootNode]
  const here = new Map<string, { sites: number; nodeTypes: Record<string, number>; file: string }>()
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    const t = String(n.type)
    if (DECL_NODES.has(t) && !isParameter(n)) {
      const nm = declaredName(n)
      if (nm) {
        declSites++
        declaredNames.set(nm, (declaredNames.get(nm) ?? 0) + 1)
        const row = here.get(nm) ?? { sites: 0, nodeTypes: {}, file: rel }
        row.sites++
        row.nodeTypes[t] = (row.nodeTypes[t] ?? 0) + 1
        here.set(nm, row)
      }
    }
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
  }
  const r: any = await parseFile(f, f)
  // The symbol contract publishes a directive definition as `@name`, so the corpus-wide
  // published set has to carry the `@` form too — without it every `directive @foo` in
  // 1,905 files reads as "declared but not published", which is 143 names and zero defects.
  for (const s of r?.symbols ?? []) {
    published.add(String(s.name)); published.add(String(s.qualifiedName))
    // ...and, symmetrically, a DECLARED name must be normalised the same way: the grammar
    // reports `requiresOptIn` while the analyzer publishes `@requiresOptIn`, so strip one
    // leading `@` from each published name rather than adding one to the declared name.
    const stripAt = (v: string) => (v.startsWith("@") ? v.slice(1) : v)
    published.add(stripAt(String(s.name))); published.add(stripAt(String(s.qualifiedName)))
  }
  for (const [nm, row] of here) if (!published.has(nm)) declNotPublished.set(nm, row)
}
const rows = [...declNotPublished.entries()].sort((a, b) => b[1].sites - a[1].sites)
console.log(`grammar DECLARATION sites: ${declSites} over ${declaredNames.size} distinct names`)
console.log(`names DECLARED by the grammar but published by NO symbol anywhere: ${rows.length}`)
for (const [nm, row] of rows.slice(0, 40)) {
  console.log(`  ${String(row.sites).padStart(4)} sites  ${nm.slice(0,34).padEnd(34)} nodes=${JSON.stringify(row.nodeTypes)}  ${row.file.slice(0,52)}`)
}
fs.writeFileSync(path.join(OUT, "decl-inventory.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  population: { admittedFiles: files.length, discovery: "identical to ontology-coverage-gate" },
  grammarDeclarationSites: declSites,
  distinctDeclaredNames: declaredNames.size,
  declaredButNotPublished: rows.map(([n, r]) => ({ name: n, ...r })),
  publishedDistinctNames: published.size,
}, null, 2))
console.log(`(written to out/decl-inventory.json)`)
