// Block-level bisect on the standalone chunk: remove ONE whole top-level
// block at a time. Whole-block removals keep the parse clean.
import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const FILE = "<corpus-root>/bb_tests/repositories/svelte/packages/svelte/types/index.d.ts"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const ts = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-typescript.wasm")))
  const mod: any = await import("../../../script/m14/differential")
  const src = fs.readFileSync(FILE, "utf8")
  const p = new P(); p.setLanguage(ts)
  const lines = src.split("\n")
  const hits = (code: string) => (mod.deriveTreeEdges(p.parse(code).rootNode, "typescript") as any[])
    .filter((x: any) => x.label === "overrides" && String(x.from).includes("Spring"))

  // Extract whole blocks by brace matching from a header line
  const extract = (startLine1: number): string => {
    let depth = 0, started = false
    for (let i = startLine1 - 1; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === "{") { depth++; started = true }
        if (ch === "}") depth--
      }
      if (started && depth === 0) return lines.slice(startLine1 - 1, i + 1).join("\n")
    }
    throw new Error("unbalanced at " + startLine1)
  }
  const removeBlock = (text: string, block: string) => text.replace(block + "\n", "").replace(block, "(removed)")

  const chunk = lines.slice(2000, 2250).join("\n")
  console.log("chunk baseline:", hits(chunk).length)

  const blocks: [string, string][] = [
    ["SpringUpdateOptions", extract(2022)],
    ["Spring class", extract(2085)],
    ["Tweened", extract(2130)],
    ["Readable#1", extract(2140)],
  ]
  for (const [nm, block] of blocks) {
    const h = hits(removeBlock(chunk, block))
    console.log(`chunk minus ${nm}: ${h.length} ${h.length ? JSON.stringify(h) : ""}`)
  }

  // Also: Readable alone + Spring header only (no body)
  const probe = `interface Readable<T> {\n  subscribe(this: void, run: (value: T) => void): () => void;\n}\nexport interface SpringUpdateOptions {\n  hard?: any;\n}\nexport class Spring<T> {\n  constructor(value: T, options?: SpringOptions);\n  set(value: T, options?: SpringUpdateOptions): Promise<void>;\n  target: T;\n  get current(): T;\n}\ndeclare const SpringOptions: any\n`
  console.log("minimal synthetic probe:", JSON.stringify(hits(probe)))
}
main()
