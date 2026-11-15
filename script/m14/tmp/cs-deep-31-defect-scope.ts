// CS-DEEP-31 — size the two defects the bare-uses oracle found, and decide the label question.
//
// D8: a primary-constructor PARAMETER TYPE is published as a bare member read of the class.
//     Site: `UpdateExpressionState.cs:25` -> `SemanticModel semanticModel,` (parent=parameter,
//     in the type field, class scope). D7's fix covers a `variable_declaration`'s type field
//     and the entity-name field; the primary-constructor parameter list is neither, because it
//     lives on the TYPE DECLARATION, not in a method body. Line 450 -- the same shape as a
//     METHOD parameter type -- is correctly excluded, which is the control that makes this a
//     gap rather than a rule.
//
// D9: `this.SemanticMap` is published as `identifier_usage` (BARE) at
//     `UpdateExpressionState.cs:419`. The site is `this.SemanticModel` -- a FIELD ACCESS, which
//     the `csharp_field_access` oracle already covers at confidence 0.7. So either the analyzer
//     emits BOTH rows for one read (a double count), or it emits this one and not that one (a
//     mislabel). Those are different defects with different fixes, so the question is asked here
//     rather than assumed.
import * as fs from "fs"; import * as path from "path"
const ROOT = process.cwd()
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts; const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
const p = new P(); p.setLanguage(g)
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

const files = fs.readFileSync(process.argv[2], "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, Number(process.argv[3] ?? 200))
let d8 = 0, d8Rows: string[] = [], d9 = 0, d9Both = 0, d9Only = 0, d9Rows: string[] = []
for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  let res: any, root: any
  try { res = await ASTEngine.parseFile(f, src); root = p.parse(src).rootNode } catch { continue }
  const rels = res.relationships ?? []
  const bare = new Set<string>(), fld = new Set<string>()
  for (const r of rels) {
    if ((r.type ?? r.relationshipType) !== "uses") continue
    const k = `${r.source}|${r.target}`
    if (String((r.metadata ?? {}).relationshipType) === "identifier_usage") bare.add(k); else fld.add(k)
  }
  // D8 sites: an identifier that is a `parameter`'s TYPE field, inside a type declaration's own
  // parameter list (primary constructor), whose enclosing class also has a member of that name.
  const w = (n: any, inPrimaryCtor: boolean, cls: string | null): void => {
    let ic = inPrimaryCtor, c = cls
    if (/^(class|struct|record|interface)_declaration$/.test(n.type)) { ic = false; c = n.childForFieldName?.("name")?.text ?? c }
    if (n.type === "parameter_list" && n.parent && /^(class|struct|record)_declaration$/.test(n.parent.type)) ic = true
    if (n.type === "identifier" && ic && n.parent?.type === "parameter") {
      const tf = n.parent.childForFieldName?.("type")
      if (tf && n.startIndex >= tf.startIndex && n.endIndex <= tf.endIndex) {
        const k = `${c ?? "?"}|${n.text}`
        if (bare.has(k)) { d8++; if (d8Rows.length < 10) d8Rows.push(`${path.basename(f)}  ${k}  (${tf.type})`) }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const ch = n.namedChild(i); if (ch) w(ch, ic, c) }
  }
  w(root, false, null)
  // D9 sites: a `member_leaf` after an explicit `this` receiver, published as identifier_usage
  const w2 = (n: any, fn: string | null): void => {
    let f2 = fn
    if (n.type === "method_declaration" || n.type === "constructor_declaration" || n.type === "local_function_statement")
      f2 = n.childForFieldName?.("name")?.text ?? (n.type === "constructor_declaration" ? "constructor" : null)
    if (n.type === "member_access_expression") {
      const expr = n.childForFieldName?.("expression"), nm = n.childForFieldName?.("name")
      if (expr?.type === "this" && nm?.type === "identifier") {
        const k = `${f2 ?? "?"}|${nm.text}`
        if (bare.has(k)) { d9++; const hasFld = fld.has(k); if (hasFld) d9Both++; else d9Only++; if (d9Rows.length < 10) d9Rows.push(`${path.basename(f)}  ${k}  fieldAccessRow=${hasFld}`) }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const ch = n.namedChild(i); if (ch) w2(ch, f2) }
  }
  w2(root, null)
}
console.log(`files: ${files.length}\n`)
console.log(`D8  primary-constructor parameter TYPE published as a bare member read: ${d8}`)
for (const r of d8Rows) console.log(`      ${r}`)
console.log(`\nD9  \`this.X\` published as identifier_usage (bare): ${d9}`)
console.log(`      of which the field-access oracle ALSO covers the same read: ${d9Both}   <-- a DOUBLE COUNT`)
console.log(`      of which there is NO field-access row at all:               ${d9Only}   <-- a MISLABEL`)
for (const r of d9Rows) console.log(`      ${r}`)
