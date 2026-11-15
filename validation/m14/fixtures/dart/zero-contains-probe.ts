/**
 * M14 ONTOLOGY LANE — DART: what the files that carry NO `contains` edge contain.
 *
 * ## The question this exists to answer
 *
 * `contains` is the one label in this lane that does not approach its ceiling:
 * 1,696 of the census's 2,735 sampled files, 62.0%. A first draft of the doc
 * explained the missing 1,039 as "scripts, `part` fragments and generated files
 * with no declaration of their own" — which was a plausible sentence and NOT a
 * measurement, and the contract treats an unmeasured causal claim about a corpus
 * as the defect it is trying to prevent. So the population is characterized here
 * instead, by walking the parse tree.
 *
 * ## The instrument
 *
 * Reads the file list the census emits (`filesWithoutContains`), parses each with
 * the SAME pinned wasm the analyzer uses (`wasm/tree-sitter-dart.wasm`), and
 * reports the composition of each file from NODE TYPES:
 *
 *   - the top-level named node types, so a file that is one bare directive is
 *     distinguishable from a file full of declarations;
 *   - whether the file carries a `library`/`part`/`part of` directive
 *     (`library_definition`, `part_directive`, `part_of_directive`);
 *   - whether the file has any ERROR node, since a parse that failed is a
 *     different population from a file that genuinely declares nothing;
 *   - the node-type CENSUS of every declaration-bearing node the grammar offers,
 *     so "declares nothing" can be checked against what the grammar could have
 *     expressed here rather than against a list of names someone remembered.
 *
 * There is no text pattern and no regex in this file: a `part of 'foo.dart';`
 * inside a comment or a string literal would otherwise be indistinguishable from
 * the directive, which is the same blindness `regex-census.ts` measures.
 *
 * CLI:
 *   BB_DART_CENSUS=/tmp/c.json npx tsx validation/m14/fixtures/dart/zero-contains-probe.ts
 *   BB_DART_OUT=/tmp/z.json npx tsx validation/m14/fixtures/dart/zero-contains-probe.ts
 */
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const CENSUS = process.env.BB_DART_CENSUS ?? "/tmp/opencode/dart-census3.json"
const OUT = process.env.BB_DART_OUT ?? ""

const census = JSON.parse(readFileSync(CENSUS, "utf8"))
const files: string[] = census.filesWithoutContains ?? []
if (!Array.isArray(files) || files.length === 0) {
  console.error(`no filesWithoutContains in ${CENSUS} — run census.ts with BB_DART_OUT first`)
  process.exit(1)
}

// ---------------------------------------------------------------- parser
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-dart.wasm"))))

/** Every node type the Dart grammar uses to introduce a NAMED declaration. A file
 *  whose tree contains none of these has nothing for `contains` to point at. */
const DECLARATION_NODES = new Set([
  "class_definition",
  "mixin_declaration",
  "extension_declaration",
  "extension_type_declaration",
  "enum_declaration",
  "type_alias",
])

const bump = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by)

/** The member node type is DERIVED from the corpus, not named here. A first
 *  version hardcoded `class_member` and measured 0 of 923 declarations having a
 *  member — which is not a fact about Dart, it is a fact about a name nobody had
 *  checked, and it would have been published as "these files declare nothing".
 *  `declChildTypes` below is the real histogram; the member set is whatever node
 *  types a `contains` edge could name a member through, read off that. */
const declChildTypes = new Map<string, number>()
/** Filled from the histogram once the walk is done, then used to re-classify. */
const seenDecls: { type: string; children: string[]; bodies: string[][] }[] = []
/** Node types that live in a body but are not members of it. */
const NOT_A_MEMBER = new Set(["comment", "documentation_comment", "annotation", "metadata"])
/** Body node types, from the measured histogram below (`class_body`, `extension_body`,
 *  `enum_body`, `representation_declaration`). Declared before the walk because the
 *  walk reads them. */
const BODY_NODES = ["class_body", "extension_body", "enum_body", "representation_declaration", "mixin_body"]

const topLevel = new Map<string, number>()
const declNodes = new Map<string, number>()
const directiveFiles = new Map<string, number>()
const shape = new Map<string, number>()
let parsed = 0
let failed = 0
let withErrorNode = 0
let withDeclarationNode = 0
let withDirective = 0
let emptyRoot = 0
let declWithMember = 0
let declWithoutMember = 0
const declArity = new Map<string, number>()
/** Files whose declarations DO have members, so a `contains` edge would be expected
 *  from them if the label fired on what the grammar offers. Written out so the
 *  population can be re-checked file by file instead of trusted as a count. */
const filesWithMemberDecls: { file: string; decls: string[] }[] = []

for (const rel of files) {
  const slash = rel.indexOf("/")
  const repo = rel.slice(0, slash)
  const abs = path.join(CR, repo, rel.slice(slash + 1))
  let text: string
  try { text = readFileSync(abs, "utf8") } catch { failed++; continue }
  let tree: any
  try { tree = parser.parse(text) } catch { failed++; continue }
  if (!tree) { failed++; continue }
  parsed++
  const root = tree.rootNode

  if (root.hasError) withErrorNode++

  const tops: string[] = []
  let sawDecl = false
  let sawDirective = false
  /** Per FILE, not global: `seenDecls` accumulates across the whole corpus, so
   *  classifying from it per file would make every file after the first
   *  declaration-bearing one look declaration-bearing. */
  const declsThisFile: { type: string; children: string[]; bodies: string[][] }[] = []
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "library_definition" || n.type === "part_directive" || n.type === "part_of_directive") sawDirective = true
    if (DECLARATION_NODES.has(n.type)) {
      sawDecl = true
      bump(declNodes, n.type)
      const kids: string[] = []
      for (let i = 0; i < n.namedChildCount; i++) {
        const k = n.namedChild(i).type
        kids.push(k)
        bump(declChildTypes, k)
      }
      seenDecls.push({ type: n.type, children: kids, bodies: [] })
      declsThisFile.push(seenDecls[seenDecls.length - 1])
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!BODY_NODES.includes(c.type)) continue
        const inner: string[] = []
        for (let j = 0; j < c.namedChildCount; j++) inner.push(c.namedChild(j).type)
        bump(declChildTypes, `${c.type}>{${inner.join(",") || "EMPTY"}}`)
        declsThisFile[declsThisFile.length - 1].bodies.push(inner)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
  }
  for (let i = 0; i < root.namedChildCount; i++) {
    const t = root.namedChild(i).type
    bump(topLevel, t)
    tops.push(t)
  }
  if (sawDecl) withDeclarationNode++
  if (sawDirective) withDirective++
  if (tops.length === 0) emptyRoot++
  if (sawDecl) {
    const memberDecls = declsThisFile.filter(d => d.bodies.some(b => b.filter(c => !NOT_A_MEMBER.has(c)).length > 0))
    if (memberDecls.length > 0) {
      filesWithMemberDecls.push({
        file: rel,
        decls: memberDecls.map(d => `${d.type}[${d.bodies.flat().join(",")}]`).slice(0, 3),
      })
    }
  }

  // The shape a reader needs: does the file hold a declaration, and is it all directive?
  bump(shape, sawDecl ? "has-declaration-node" : sawDirective ? "directives-only" : root.hasError ? "error-no-declaration" : "no-declaration-no-directive")
}

const top = (m: Map<string, number>, n: number) =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}=${v}`).join("  ")

/**
 * The member-bearing node types, read off the histogram rather than asserted.
 *
 * Two earlier versions of this probe were wrong here and both would have printed a
 * confident number: the first hardcoded `class_member`, the second hardcoded
 * `method_signature`/`field_declaration`/etc. as children of the DECLARATION. The
 * histogram shows the grammar puts members one level down, inside a BODY node —
 * `class_body`, `extension_body`, `enum_body`, `representation_declaration` — and
 * that a declaration's own named children are only its name, heritage clauses,
 * type parameters and annotations. Neither guess was a fact about Dart; both were
 * facts about a name nobody checked. So the body node types come from the measured
 * histogram and the member count is taken from INSIDE the body.
 */
for (const d of seenDecls) {
  let members = 0
  for (const body of d.bodies) {
    for (const c of body) if (!NOT_A_MEMBER.has(c)) members++
  }
  bump(declArity, `${d.type}:${members === 0 ? "no-member" : "has-member"}`)
  if (members > 0) declWithMember++
  else declWithoutMember++
}

console.log(`dart zero-contains composition — ${files.length} files from ${CENSUS}`)
console.log(`  parsed ${parsed}   unreadable/unparseable ${failed}   empty root ${emptyRoot}`)
console.log("")
console.log(`CARRY a declaration node : ${withDeclarationNode}  (${(100 * withDeclarationNode / parsed).toFixed(1)}%)`)
console.log(`CARRY a library/part directive : ${withDirective}  (${(100 * withDirective / parsed).toFixed(1)}%)`)
console.log(`CARRY an ERROR node     : ${withErrorNode}  (${(100 * withErrorNode / parsed).toFixed(1)}%)`)
console.log("")
console.log("SHAPE (mutually exclusive, in funnel order):")
for (const [k, v] of [...shape.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(32)} ${String(v).padStart(5)}  ${(100 * v / parsed).toFixed(1)}%`)
}
console.log("")
console.log("DECLARATION NODES PRESENT (a file can hold several):")
console.log(`  ${declNodes.size ? top(declNodes, 20) : "none"}`)
console.log("")
console.log("DECLARATION ARITY — does the declaration have a member to contain?")
console.log(`  declarations WITH a member child : ${declWithMember}`)
console.log(`  declarations WITHOUT one          : ${declWithoutMember}`)
console.log(`  ${top(declArity, 20)}`)
console.log("")
console.log("HISTOGRAM OF DECLARATION NODES' OWN NAMED CHILDREN (the derived member set):")
console.log(`  ${top(declChildTypes, 20)}`)
console.log("")
console.log("TOP-LEVEL NODE TYPES (top 20):")
console.log(`  ${top(topLevel, 20)}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    source: CENSUS, files: files.length, parsed, failed, emptyRoot,
    withDeclarationNode, withDirective, withErrorNode,
    declWithMember, declWithoutMember,
    shape: Object.fromEntries(shape), declarationNodes: Object.fromEntries(declNodes),
    declarationArity: Object.fromEntries(declArity),
    declarationChildTypes: Object.fromEntries(declChildTypes),
    filesWithMemberDecls,
    topLevel: Object.fromEntries(topLevel),
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}
