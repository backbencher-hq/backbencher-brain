// M49 web-closure verification: WHY does svelte/template-attr-shapes emit
// forbidden `uses -> Comp / DynComp @0.6`? Dump every relationship with its
// confidence + metadata, then isolate the shape in minimal controls.
import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"
import { RealSvelteAnalyzer } from "../../../src/ast/real-svelte-analyzer"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
let P: any, LANGS: Record<string, any> = {}

async function parsers() {
  if (P) return
  const wts: any = await import("web-tree-sitter")
  P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  for (const [k, f] of [["svelte", "tree-sitter-svelte.wasm"], ["js", "tree-sitter-javascript.wasm"]] as const)
    LANGS[k] = await L.load(fs.readFileSync(path.join(ROOT, "wasm", f)))
}

function findAll(n: any, pred: (x: any) => boolean, out: any[] = []): any[] {
  if (pred(n)) out.push(n)
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
  return out
}

async function analyzeSvelte(src: string) {
  await parsers()
  const p = new P(); p.setLanguage(LANGS.svelte)
  const root = p.parse(src).rootNode
  const trees: any[] = [], lines: number[] = [], cols: number[] = []
  for (const se of findAll(root, (n) => n.type === "script_element")) {
    const raw = se.namedChildren.find((c: any) => c.type === "raw_text")
    if (!raw || !raw.text.trim()) continue
    const sp = new P(); sp.setLanguage(LANGS.js)
    trees.push(sp.parse(raw.text)); lines.push(raw.startPosition.row + 1); cols.push(raw.startPosition.column)
  }
  const a = new RealSvelteAnalyzer() as any
  return a.analyze(root, src, "template-attr-shapes.svelte", trees.length ? { sfcScriptTrees: trees, sfcScriptLines: lines, sfcScriptCols: cols, sfcScriptLangs: trees.map(() => "") } : {})
}

function dump(tag: string, r: any) {
  console.log(`\n===== ${tag} =====`)
  for (const rel of r.relationships ?? []) {
    const md = rel.metadata ? JSON.stringify(rel.metadata) : ""
    console.log(`  ${rel.type}  ${rel.source} -> ${rel.target}  @${rel.confidence} ${md}`)
  }
}

async function main() {
  const FIXTURE = fs.readFileSync(
    path.join(ROOT, "validation", "m14", "fixtures", "svelte", "template-attr-shapes.svelte"),
    "utf8",
  )
  dump("FIXTURE (as committed)", await analyzeSvelte(FIXTURE))

  // Controls: one shape at a time.
  dump("C1 static <Comp /> only",
    await analyzeSvelte(`<script>\nimport Comp from "./comp";\n</script>\n\n<Comp />\n`))
  dump("C2 shorthand <Comp {value} />",
    await analyzeSvelte(`<script>\nimport Comp from "./comp";\nlet value = 1;\n</script>\n\n<Comp {value} />\n`))
  dump("C3 spread <Comp {...props} />",
    await analyzeSvelte(`<script>\nimport Comp from "./comp";\nlet props = {};\n</script>\n\n<Comp {...props} />\n`))
  dump("C4 plain attr <Comp label={value} />",
    await analyzeSvelte(`<script>\nimport Comp from "./comp";\nlet value = 1;\n</script>\n\n<Comp label={value} />\n`))
  dump("C5 this={DynComp} only",
    await analyzeSvelte(`<script>\nimport DynComp from "./dyn";\n</script>\n\n<svelte:component this={DynComp} />\n`))
}

main()
