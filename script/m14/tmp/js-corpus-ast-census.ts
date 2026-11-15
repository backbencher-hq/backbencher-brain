// AST census of the JavaScript lane's F5 corpora (2026-09-26)
// Formula §4 requires a language-dominant corpus; §10 requires classification
// from the AST, not from regex. This counts the construct classes the JS lane's
// emission paths exist for, using the pinned grammar.
import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"

const ROOT = "/home/ishaq2321/bb_tests/repositories"

function walkFiles(dir: string, out: string[], depth = 0): void {
  if (depth > 12) return
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out, depth + 1)
    else if (e.name.endsWith(".js")) out.push(p)
  }
}

async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load("wasm/tree-sitter-javascript.wasm")
  const p = new P(); p.setLanguage(lang)

  // Construct classes the JS analyzer's emission paths exist for, keyed by the
  // AST shape that triggers them.
  const want: Record<string, (n: any) => boolean> = {
    "class_declaration (class symbol + contains)": (n) => n.type === "class_declaration",
    "class expression (no class symbol today)": (n) => n.type === "class",
    "class_heritage (extends edge)": (n) => n.type === "class_heritage",
    "getter (accessor Property)": (n) => n.type === "method_definition" && has(n, "get"),
    "setter (accessor Property)": (n) => n.type === "method_definition" && has(n, "set"),
    "field_definition (data member)": (n) => n.type === "field_definition",
    "import_statement (imports edge)": (n) => n.type === "import_statement",
    "namespace_import": (n) => n.type === "namespace_import",
    "import_specifier (alias shape)": (n) => n.type === "import_specifier",
    "export_statement": (n) => n.type === "export_statement",
    "export_specifier (alias shape)": (n) => n.type === "export_specifier",
    "module.exports assignment": (n) =>
      n.type === "assignment_expression" && /\bmodule\s*\.\s*exports\b/.test(n.text.slice(0, 60)),
    "prototype assignment (X.prototype.m)": (n) =>
      n.type === "assignment_expression" && /\.prototype\s*\./.test(n.text.slice(0, 60)),
    "object-literal method (needs owner/contains)": (n) =>
      n.type === "method_definition" && n.parent?.type === "object",
    "decorator": (n) => n.type === "decorator",
    "class_static_block": (n) => n.type === "class_static_block",
    "optional_chain (a?.b)": (n) => n.type === "optional_chain",
    "template_substitution": (n) => n.type === "template_substitution",
    "new_expression (instantiates)": (n) => n.type === "new_expression",
    "jsx_element": (n) => n.type === "jsx_element" || n.type === "jsx_self_closing_element",
  }
  function has(n: any, tok: string): boolean {
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && !c.isNamed && c.type === tok) return true }
    return false
  }
  const keys = Object.keys(want)

  for (const repo of ["grails-core", "lodash", "svelte", "element-plus"]) {
    const files: string[] = []
    walkFiles(path.join(ROOT, repo), files)
    const counts: Record<string, number> = {}
    for (const k of keys) counts[k] = 0
    let parsed = 0, errFiles = 0, lines = 0
    for (const f of files) {
      let src: string
      try { src = fs.readFileSync(f, "utf8") } catch { continue }
      if (src.length > 400000) continue
      let tree: any
      try { tree = p.parse(src) } catch { continue }
      parsed++; lines += src.split("\n").length
      if (tree.rootNode.hasError) errFiles++
      const st = [tree.rootNode]
      while (st.length) {
        const n: any = st.pop()
        for (const k of keys) if (want[k](n)) counts[k]++
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
      }
    }
    console.log(`\n=== ${repo}: ${files.length} .js files, ${parsed} parsed, ${lines} lines, ${errFiles} with parse errors`)
    for (const k of keys) console.log(`   ${counts[k] === 0 ? "ZERO " : "     "} ${String(counts[k]).padStart(6)}  ${k}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
