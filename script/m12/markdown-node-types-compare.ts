import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { ASTEngine } from "../../src/ast/engine"
import { loadWebTreeSitter, resolveWasmAsset } from "../../src/util/wasm"

const source = readFileSync("src/ast/real-markdown-analyzer.ts", "utf8")
const refs = new Set<string>()
for (const match of source.matchAll(/(?:\.type\s*===\s*|new Set\(\[|case\s+)(?:["']?)([A-Za-z_]+)(?:["'])?/g)) {
  if (match[1] && match[1].includes("_")) refs.add(match[1])
}
for (const type of [
  // block grammar
  "document", "section", "atx_heading", "atx_h1_marker", "atx_h2_marker",
  "atx_h3_marker", "atx_h4_marker", "atx_h5_marker", "atx_h6_marker",
  "setext_heading", "setext_h1_underline", "setext_h2_underline",
  "paragraph", "inline", "pipe_table", "pipe_table_header", "pipe_table_row",
  "pipe_table_cell", "fenced_code_block", "info_string", "language",
  "minus_metadata", "block_quote", "list", "list_item",
  // inline grammar
  "link_destination", "uri_autolink", "email_autolink",
]) refs.add(type)

const parser = await ASTEngine.getParser("markdown")
const observedBlock = new Set<string>()
const files = readdirSync("validation/m12/fixtures/markdown").filter((file) => /\.md$/i.test(file)).sort()
for (const file of files) {
  const input = readFileSync(`validation/m12/fixtures/markdown/${file}`, "utf8")
  const tree = parser.parse(input)
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const node = stack.pop()!
    observedBlock.add(node.type)
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) stack.push(child)
    }
  }
  tree.delete?.()
}

// Inline grammar: parse all inline blocks across fixtures.
const wts: any = await loadWebTreeSitter()
const ParserCtor: any = wts.Parser ?? wts.default ?? wts
const LanguageCtor: any = wts.Language ?? wts.default?.Language
const initFn = wts.init ?? ParserCtor.init ?? (ParserCtor as any).init
if (initFn) await initFn({ locateFile: () => resolveWasmAsset("tree-sitter.wasm") })
const inlineLang = await LanguageCtor.load(new Uint8Array(await Bun.file(resolveWasmAsset("tree-sitter-markdown_inline.wasm")).arrayBuffer()))
const inlineParser = new ParserCtor()
inlineParser.setLanguage(inlineLang)
const observedInline = new Set<string>()
for (const file of files) {
  const input = readFileSync(`validation/m12/fixtures/markdown/${file}`, "utf8")
  const tree = parser.parse(input)
  const stack: any[] = [tree.rootNode]
  const inlineTexts: string[] = []
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.type === "inline") inlineTexts.push(input.substring(node.startIndex, node.endIndex))
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) stack.push(child)
    }
  }
  for (const text of inlineTexts) {
    const it = inlineParser.parse(text)
    const s2: any[] = [it.rootNode]
    while (s2.length > 0) {
      const n = s2.pop()!
      observedInline.add(n.type)
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) s2.push(c)
      }
    }
    it.delete?.()
  }
  tree.delete?.()
}
const observed = new Set([...observedBlock, ...observedInline])
const live = [...refs].filter((type) => observed.has(type)).sort()
const dead = [...refs].filter((type) => !observed.has(type)).sort()
const result = {
  analyzer: "markdown",
  grammar: "vendored wasm/tree-sitter-markdown.wasm + wasm/tree-sitter-markdown_inline.wasm",
  fixtureFiles: files,
  referencedNodeTypes: [...refs].sort(),
  liveReferencedNodeTypes: live,
  deadDefensiveReferences: dead,
  observedBlockNodeTypeCount: observedBlock.size,
  observedInlineNodeTypeCount: observedInline.size,
  observedNodeTypeCount: observed.size,
  observedNodeTypes: [...observed].sort(),
  passed: dead.length === 0 && live.length > 0,
}
writeFileSync("validation/m12/results/markdown-shape-safety.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
