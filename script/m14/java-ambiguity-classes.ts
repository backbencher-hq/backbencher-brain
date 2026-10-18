/**
 * JAVA LANE — the AMBIGUITY EVIDENCE classifier (task-17 item 2 / D7).
 *
 * Read-only over a gate `--dump` file. For every non-resolved java edge it asks ONE question:
 * **what static evidence does the EDGE'S OWN FILE carry that could decide it?** — and answers
 * with a class, never a resolution. This is the measurement the D7 rule requires before a wall
 * may be dispositioned: an "instrument gap" must be SIZED, and a "ruled undecidable" must be
 * justified by the absence of evidence, both of which are counts this prints.
 *
 * WHY IT IS NOT A RESOLVER. Re-implementing the gate's key-space model would be a second answer
 * to a question the gate already answers; this classifier only reads the source file again and
 * records which of the resolver's potential inputs exist there:
 *
 *   same-file-declaration   the target name is DECLARED in the edge's own file. Both a calls
 *                           leaf and a type-shaped reference can therefore be decided by the
 *                           file alone — a resolver BOOST (own file first) closes it; production
 *                           already does this for `contains`.
 *   single-type-import      the target (or the dotted target's first segment) is a KNOWN
 *                           SINGLE-TYPE IMPORT of the file, so the imported module names the
 *                           package; joining the declaration's qualified name to it decides the
 *                           row. Needs the import table + qualified names (instrument side).
 *   static-import           the target is brought in by a static import (JLS 7.5.3/7.5.4); the
 *                           member is declared by the imported container, which is not this file
 *                           and usually not this project — a claim/`owner` matter, not a name tie.
 *   no-file-evidence        the file declares nothing of that name and imports nothing that
 *                           contains it: a name tie the file cannot decide (dynamic dispatch,
 *                           library member, inherited member of an unstated type).
 *
 * CLI
 *   bun run script/m14/java-ambiguity-classes.ts <dump-file> [--json]
 * EXIT 0 measured · 2 usage/missing dump
 */
import { readFileSync } from "node:fs"
import { getParser } from "../../src/ast/engine"

const argv = process.argv.slice(2)
const dumpPath = argv.find((a) => !a.startsWith("--"))
const asJson = argv.includes("--json")
if (!dumpPath) {
  console.error("usage: java-ambiguity-classes.ts <dump-file> [--json]")
  process.exit(2)
}

type FileFacts = {
  typeNames: Set<string>
  methodNames: Set<string>
  fieldNames: Set<string>
  singleImports: Map<string, string> // leaf -> module path as written
  staticImportLeaves: Set<string>
  staticOnDemand: boolean
  /** name -> the type AS WRITTEN for every binding the file declares (fields, params, locals,
   *  catch/for variables). Used only by `--shapes` to price a receiver's owner evidence. */
  bindings: Map<string, string>
}
type EdgeRow = { label: string; outcome: string; target: string; file: string; line: number; claimKind: string }

const rows: EdgeRow[] = []
for (const raw of readFileSync(dumpPath, "utf8").split("\n")) {
  if (!raw.startsWith("DUMP\t")) continue
  const p = raw.split("\t")
  if (p.length < 6) continue
  const loc = p[4]
  const colon = loc.lastIndexOf(":")
  rows.push({
    label: p[1], outcome: p[2], target: p[3],
    file: colon > 0 ? loc.slice(0, colon) : loc,
    line: colon > 0 ? Number(loc.slice(colon + 1)) || 0 : 0,
    claimKind: p[5],
  })
}

const parser = await getParser("java" as any)
const fileFactsCache = new Map<string, FileFacts>()
const TYPE_DECL = new Set(["class_declaration", "interface_declaration", "enum_declaration", "record_declaration", "annotation_type_declaration"])

function collectFacts(absPath: string): FileFacts | null {
  const cached = fileFactsCache.get(absPath)
  if (cached) return cached
  let tree: any
  try {
    tree = parser.parse(readFileSync(absPath, "utf8"))
  } catch {
    return null
  }
  const facts: FileFacts = {
    typeNames: new Set(), methodNames: new Set(), fieldNames: new Set(),
    singleImports: new Map(), staticImportLeaves: new Set(), staticOnDemand: false,
    bindings: new Map(),
  }
  const nameOf = (n: any): string => (n?.childForFieldName?.("name")?.text ?? "") as string
  const walk = (n: any): void => {
    if (!n) return
    if (TYPE_DECL.has(n.type)) {
      const nm = nameOf(n)
      if (nm) facts.typeNames.add(nm)
    } else if (n.type === "method_declaration" || n.type === "constructor_declaration" || n.type === "annotation_type_element_declaration") {
      const nm = nameOf(n)
      if (nm) facts.methodNames.add(nm)
    } else if (n.type === "field_declaration" || n.type === "constant_declaration") {
      const typeNode = n.childForFieldName("type")
      const typeText = typeNode?.type === "array_type" ? (typeNode.namedChild(0)?.text ?? "") : (typeNode?.text ?? "")
      for (let i = 0; i < n.namedChildCount; i++) {
        const d = n.namedChild(i)
        if (d && d.type === "variable_declarator") {
          const nm = nameOf(d)
          if (nm) {
            facts.fieldNames.add(nm)
            if (typeText) facts.bindings.set(nm, typeText)
          }
        }
      }
    } else if (n.type === "formal_parameter" || n.type === "spread_parameter" || n.type === "catch_formal_parameter" || n.type === "resource" || n.type === "enhanced_for_statement") {
      const nameNode = n.childForFieldName("name") ?? (() => { for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c?.type === "identifier") return c } return null })()
      const typeNode = n.childForFieldName("type") ?? (() => { for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c?.type === "type_identifier" || c?.type === "generic_type" || c?.type === "scoped_type_identifier") return c } return null })()
      if (nameNode && typeNode) facts.bindings.set(nameNode.text, typeNode.text)
    } else if (n.type === "local_variable_declaration") {
      const typeNode = n.childForFieldName("type")
      const typeText = typeNode?.text ?? ""
      if (typeText) {
        for (let i = 0; i < n.namedChildCount; i++) {
          const d = n.namedChild(i)
          if (!d || d.type !== "variable_declarator") continue
          const nm = nameOf(d)
          if (nm) facts.bindings.set(nm, typeText)
        }
      }
    } else if (n.type === "enum_constant") {
      const nm = nameOf(n)
      if (nm) facts.fieldNames.add(nm)
    } else if (n.type === "import_declaration") {
      let isStatic = false
      for (let i = 0; i < n.childCount; i++) if (n.child(i)?.type === "static") isStatic = true
      const isWildcard = (() => { for (let i = 0; i < n.namedChildCount; i++) if (n.namedChild(i)?.type === "asterisk") return true; return false })()
      let mod = ""
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && (c.type === "scoped_identifier" || c.type === "identifier")) { mod = c.text; break }
      }
      const leaf = mod.slice(mod.lastIndexOf(".") + 1)
      if (isStatic) {
        if (isWildcard) facts.staticOnDemand = true
        else if (leaf) facts.staticImportLeaves.add(leaf)
      } else if (!isWildcard && leaf) {
        facts.singleImports.set(leaf, mod)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(tree.rootNode)
  fileFactsCache.set(absPath, facts)
  return facts
}

type ClassName = "same-file-declaration" | "single-type-import" | "static-import" | "no-file-evidence"
const counts = new Map<string, Map<string, number>>()
const samples = new Map<string, EdgeRow[]>()
function bump(label: string, fam: string, outcome: string, cls: ClassName, row: EdgeRow): void {
  const key = `${label}\u0000${fam}\u0000${outcome}\u0000${cls}`
  const bucket = counts.get(key) ?? new Map<string, number>()
  bucket.set(cls, (bucket.get(cls) ?? 0) + 1)
  counts.set(key, bucket)
  const sk = `${label}\u0000${fam}\u0000${outcome}\u0000${cls}`
  const list = samples.get(sk) ?? []
  if (list.length < 3) { list.push(row); samples.set(sk, list) }
}

let skippedFontFiles = 0
for (const row of rows) {
  const facts = collectFacts(row.file)
  if (!facts) { skippedFontFiles++; continue }
  const target = row.target
  const fam = target.includes(".") ? "dotted" : (target.length > 0 && target[0] >= "A" && target[0] <= "Z" ? "type-shaped" : "member-leaf")
  const first = target.split(".")[0]
  const leaf = target.slice(target.lastIndexOf(".") + 1)
  let cls: ClassName = "no-file-evidence"
  if (row.label === "calls" || row.label === "uses" || row.label === "overrides") {
    if (facts.methodNames.has(leaf) || facts.fieldNames.has(leaf)) cls = "same-file-declaration"
    else if (facts.staticImportLeaves.has(leaf) || facts.staticOnDemand) cls = "static-import"
  } else if (row.label === "references" || row.label === "instantiates" || row.label === "extends" || row.label === "implements") {
    if (fam === "type-shaped") {
      if (facts.typeNames.has(target)) cls = "same-file-declaration"
      else if (facts.singleImports.has(target)) cls = "single-type-import"
      else if (facts.staticImportLeaves.has(target)) cls = "static-import"
    } else if (fam === "dotted") {
      if (facts.typeNames.has(first) || facts.singleImports.has(first)) cls = "same-file-declaration"
      else if (facts.singleImports.has(target)) cls = "single-type-import"
    } else {
      if (facts.methodNames.has(target) || facts.fieldNames.has(target)) cls = "same-file-declaration"
      else if (facts.singleImports.has(target)) cls = "single-type-import"
      else if (facts.staticImportLeaves.has(target) || facts.staticOnDemand) cls = "static-import"
    }
  } else {
    cls = "no-file-evidence"
  }
  bump(row.label, fam, row.outcome, cls, row)
}

const out = [...counts.entries()].map(([key, bucket]) => {
  const [label, fam, outcome] = key.split("\u0000")
  return {
    label, family: fam, outcome,
    classes: Object.fromEntries([...bucket.entries()].sort((a, b) => b[1] - a[1])),
    sample: (samples.get(`${key}\u0000${[...bucket.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]}`) ?? []).slice(0, 2).map((r) => `${r.target} @ ${r.file.split("/.corpus/").pop()}:${r.line}`),
  }
}).sort((a, b) => {
  const sum = (o: typeof a) => Object.values(o.classes).reduce((x, y) => x + y, 0)
  return sum(b) - sum(a)
})

// ── RECEIVER-SHAPE PRICING (`--shapes`) ─────────────────────────────────────────────────────
// For calls/uses rows the classifier above only says whether a NAME is declared/imported. This
// second pass re-parses the edge's file and reads the RECEIVER EXPRESSION the row was written
// with, which is what the owner channel needs and what the depth wave's guard prices: it tells
//  - shapes that SHOULD already carry an owner under the current emission (a miss is a lane bug),
//  - receivers whose type is an EXTERNAL/imported type (owner known but unresolvable here: the
//    classpath-member-model instrument gap), and
//  - receivers whose type the file never states (chained calls, unknown bindings: undecidable
//    until signatures exist).
let shapeReport: Record<string, number> | null = null
if (argv.includes("--shapes")) {
  const treeCache = new Map<string, any>()
  const parseTree = (f: string): any => {
    const hit = treeCache.get(f)
    if (hit) return hit
    let tree: any = null
    try { tree = parser.parse(readFileSync(f, "utf8")) } catch { tree = null }
    treeCache.set(f, tree)
    return tree
  }
  const shapes = new Map<string, number>()
  const bumpShape = (k: string) => shapes.set(k, (shapes.get(k) ?? 0) + 1)
  const unwrap = (n: any): any => {
    let expr = n
    for (let g = 0; g < 8 && expr && expr.type === "parenthesized_expression"; g++) expr = expr.namedChild(0)
    return expr
  }
  const bindingKind = (facts: FileFacts, name: string): string => {
    const written = facts.bindings.get(name)
    if (!written) return "unknown-binding"
    const base = written.replace(/<.*$/, "").replace(/\[\]/g, "").replace(/^.*\./, "")
    if (facts.typeNames.has(base)) return "project-binding"
    const importedPath = facts.singleImports.get(base)
    if (importedPath) return importedPath.startsWith("java.") || importedPath.startsWith("javax.") || importedPath.startsWith("jdk.") || importedPath.startsWith("sun.") || importedPath.startsWith("com.sun.") || importedPath.startsWith("jakarta.") ? "external-binding" : "imported-project-binding"
    return "other-binding"
  }
  for (const row of rows) {
    if (row.label !== "calls" && row.label !== "uses") continue
    if (row.outcome !== "ambDeclOnly" && row.outcome !== "ambBoth" && row.outcome !== "unresolved") continue
    const tree = parseTree(row.file)
    const facts = fileFactsCache.get(row.file)
    if (!tree || !facts) { bumpShape("unparsed"); continue }
    const wantCall = row.label === "calls"
    const wanted = wantCall ? "method_invocation" : "field_access"
    let found: any = null
    const walk = (n: any): void => {
      if (!n || found) return
      if (n.type === wanted && n.startPosition.row + 1 === row.line) {
        const nameNode = wantCall ? n.childForFieldName("name") : n.childForFieldName("field")
        if (nameNode && nameNode.text === row.target) { found = n; return }
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    walk(tree.rootNode)
    if (!found) { bumpShape("not-located"); continue }
    const objectNode = unwrap(found.childForFieldName("object"))
    if (!objectNode) {
      // a call with no receiver: implicit this (uses always have an object expression)
      bumpShape(wantCall ? "implicit-this" : "no-object")
      continue
    }
    const ot = objectNode.type
    if (ot === "this") { bumpShape("this"); continue }
    if (ot === "super") { bumpShape("super"); continue }
    if (ot === "identifier") {
      bumpShape(`identifier:${bindingKind(facts, objectNode.text)}`)
      continue
    }
    if (ot === "field_access") {
      const parts = objectNode.text.split(".")
      if (parts.length === 2 && parts[0] === "this") { bumpShape("this-field"); continue }
      if (parts.length === 2 && facts.typeNames.has(parts[0])) { bumpShape("type-qualified"); continue }
      bumpShape("field-access-other")
      continue
    }
    if (ot === "method_invocation") { bumpShape("chained-method-call"); continue }
    if (ot === "object_creation_expression") { bumpShape("new-expression(SHOULD-BE-RESOLVED)"); continue }
    if (ot === "cast_expression") { bumpShape("cast-expression(SHOULD-BE-RESOLVED)"); continue }
    if (ot === "array_access") { bumpShape("array-element(SHOULD-BE-RESOLVED)"); continue }
    bumpShape(`other:${ot}`)
  }
  shapeReport = Object.fromEntries([...shapes.entries()].sort((a, b) => b[1] - a[1]))
}

if (asJson) {
  console.log(JSON.stringify({ dump: dumpPath, rows: rows.length, fileFacts: fileFactsCache.size, skippedFiles: skippedFontFiles, groups: out, ...(shapeReport ? { shapes: shapeReport } : {}) }, null, 2))
} else {
  console.log(`dump: ${dumpPath}`)
  console.log(`non-resolved rows: ${rows.length} · files parsed: ${fileFactsCache.size} · files unreadable: ${skippedFontFiles}`)
  console.log("")
  for (const g of out.slice(0, 30)) {
    const total = Object.values(g.classes).reduce((x, y) => x + y, 0)
    console.log(`${g.label.padEnd(12)} ${g.family.padEnd(12)} ${g.outcome.padEnd(11)} n=${String(total).padStart(6)}  ${JSON.stringify(g.classes)}`)
  }
}
