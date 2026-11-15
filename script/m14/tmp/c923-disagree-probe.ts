// C923 diagnostic (v2): the disagreements. Prints every EXPLICIT interface member's tree shape
// (what the `name` field holds, what the specifier holds) next to the verifier's derived set and
// the lane's published set for the same file, so a disagreement can be attributed to a side.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const { localEdgeLabel } = await import(path.join(ROOT, "src/ast/override-context.ts"))

const FILES = process.argv.slice(2)
const MEMBER_DECLS = new Set(["method_declaration", "property_declaration", "event_declaration", "event_field_declaration", "indexer_declaration"])
const TYPE_DECLS = new Set(["class_declaration", "struct_declaration", "record_declaration", "interface_declaration"])

const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
const parser = new ParserClass()
parser.setLanguage(language)

for (const file of FILES) {
  const src = fs.readFileSync(file, "utf8")
  const tree = parser.parse(src)
  console.log(`\n#### ${path.basename(file)}`)
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (TYPE_DECLS.has(node.type)) {
      const body = node.namedChildren?.find?.((c: any) => c.type === "declaration_list")
      for (const m of body?.namedChildren ?? []) {
        if (!MEMBER_DECLS.has(m.type)) continue
        const spec = (m.namedChildren ?? []).find((c: any) => c.type === "explicit_interface_specifier")
        if (!spec) continue
        const nameField = m.childForFieldName?.("name")?.text ?? null
        console.log(`  L${m.startPosition.row + 1} ${m.type}: name=${JSON.stringify(nameField)} spec=${JSON.stringify(spec.text)} children=[${(m.namedChildren ?? []).map((c: any) => c.type).join(",")}]`)
      }
    }
    for (const c of node.namedChildren ?? []) stack.push(c)
  }
  const res: any = await (await import(path.join(ROOT, "src/ast/engine.ts"))).ASTEngine.parseFile(file, src)
  const lane = (res.relationships ?? [])
    .filter((r: any) => r?.metadata?.relationshipType === "interface_member_implementation")
    .map((r: any) => `${r.source}->${r.target}`)
  console.log(`  LANE (${lane.length}): ${JSON.stringify(lane.slice(0, 12))}`)
}
