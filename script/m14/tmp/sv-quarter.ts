// Quarter down to minimal lines.
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
    .filter((x: any) => x.label === "overrides" && String(x.from).includes("Spring")).length

  let lo = 2000, hi = 2250 // 0-based slice bounds of the hit chunk
  while (hi - lo > 6) {
    const mid = Math.floor((lo + hi) / 2)
    // try removing [lo,mid) — if edge survives, source is in [mid,hi); else [lo,mid)
    const withoutFirst = lines.slice(0, lo).concat(lines.slice(mid)).join("\n")
    if (hits(withoutFirst) > 0) lo = mid
    else hi = mid
  }
  console.log("minimal culprit lines (1-based):", lo + 1, "to", hi)
  for (let i = lo; i < hi; i++) console.log((i + 1) + ": " + lines[i])
}
main()
