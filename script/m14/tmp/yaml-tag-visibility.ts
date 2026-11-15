// Is the `tag` node zero-width? If it carries no text and no children, the inline property
// tag (`!!str`, `!include`) is STRUCTURALLY INVISIBLE to any AST-only analyzer, and Y1/Y2/Y14
// are a grammar-bug finding (Matrix 4 sub-check 9) rather than analyzer work.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-yaml.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)

  const CASES: Array<[string, string]> = [
    ["local tag", "tagged: !!str 7\n"],
    ["global tag", "tagged: !include other.yml\n"],
    ["verbatim tag", "tagged: !<tag:yaml.org,2002:str> 7\n"],
    ["custom tag", "tagged: !Foo bar\n"],
    ["anchor + tag", "k: &a !!str 7\n"],
    ["seq item tag", "- !include other.yml\n"],
    ["%TAG directive", "%TAG !e! tag:example.com,2000:\n---\nx: !e!thing 1\n"],
    ["timestamp plain", "at: 2001-12-14t21:59:43.10-05:00\n"],
    ["timestamp date", "at: 2001-12-14\n"],
    ["valid dollar", 're: "a$"\n'],
    ["comment only", "# c\n"],
    ["directive only", "%YAML 1.2\n---\na: 1\n"],
  ]

  for (const [name, src] of CASES) {
    const tree = parser.parse(src)
    console.log(`\n=== ${name} ===  src=${JSON.stringify(src)}`)
    const stack: any[] = [tree.rootNode]
    while (stack.length) {
      const n = stack.pop()
      if (n.type === "tag" || n.type.startsWith("tag_") || n.type.endsWith("_directive") || n.type === "yaml_version" || n.type === "comment" || n.type === "timestamp_scalar") {
        const w = n.endIndex - n.startIndex
        console.log(`   ${n.type.padEnd(20)} width=${String(w).padStart(3)} text=${JSON.stringify(n.text)} range=[${n.startIndex},${n.endIndex}) named=${n.isNamed} childCount=${n.childCount} srcSlice=${JSON.stringify(src.slice(n.startIndex, n.endIndex))}`)
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }
    console.log(`   tree: ${tree.rootNode.toString()}`)
  }

  // Aggregate: across a real corpus, how wide is `tag` and does its text ever carry the tag name?
  const walkDir = (dir: string, out: string[], depth = 0): void => {
    if (depth > 12) return
    let entries: fs.Dirent[] = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name === ".git" || e.name === "node_modules") continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walkDir(p, out, depth + 1)
      else if (/\.(ya?ml)$/i.test(e.name)) out.push(p)
    }
  }
  const files: string[] = []
  for (const r of ["ansible", "docker", "kubernetes", "grails-core", "terraform"]) walkDir(path.join("/home/ishaq2321/bb_tests/repositories", r), files)
  files.sort()
  let tagNodes = 0, tagZeroWidth = 0, tagNonEmpty = 0, directiveNodes = 0, commentNodes = 0
  const tagTexts: string[] = []
  let scanned = 0
  for (const f of files) {
    if (scanned >= 400) break
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    scanned++
    const t = parser.parse(content)
    if (!t?.rootNode) continue
    const st: any[] = [t.rootNode]
    while (st.length) {
      const n = st.pop()
      if (n.type === "tag") {
        tagNodes++
        if (n.endIndex - n.startIndex === 0) tagZeroWidth++
        else { tagNonEmpty++; if (tagTexts.length < 10) tagTexts.push(n.text) }
      } else if (n.type === "yaml_directive" || n.type === "tag_directive" || n.type === "reserved_directive") directiveNodes++
      else if (n.type === "comment") commentNodes++
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) st.push(c) }
    }
  }
  console.log(`\n=== corpus aggregate over ${scanned} files ===`)
  console.log(`tag nodes=${tagNodes}  zeroWidth=${tagZeroWidth}  nonEmpty=${tagNonEmpty}  sampleTexts=${JSON.stringify(tagTexts)}`)
  console.log(`directive nodes=${directiveNodes}   comment nodes=${commentNodes}`)
}
main()
