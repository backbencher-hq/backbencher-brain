import * as fs from "fs"
import * as path from "path"
import { RealRustAnalyzer } from "../../../src/ast/real-rust-analyzer"
async function parseSrc(f: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-rust.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(fs.readFileSync(f, "utf8")).rootNode
}
async function main() {
  const mod: any = await import("../../../script/m14/differential")
  for (const f of [
    "<corpus-root>/bb_tests/repositories/cargo/src/compiler/rustdoc.rs",
    "<corpus-root>/bb_tests/repositories/cargo/crates/cargo-util-schemas/src/manifest/mod.rs",
    "<corpus-root>/bb_tests/repositories/cargo/src/compiler/custom_build.rs",
  ]) {
    const src = fs.readFileSync(f, "utf8")
    const root = await parseSrc(f)
    const r: any = await new RealRustAnalyzer().analyze(root, src, "x.rs")
    const norm = (t: string) => t.split("::").filter(Boolean).pop() ?? t
    const ana = new Set((r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "instantiates").map((x: any) => norm(x.target)))
    const tru = new Set(mod.deriveRustEdges(root).filter((x: any) => x.label === "instantiates").map((x: any) => norm(x.target)))
    const miss = [...tru].filter((t) => ![...ana].some((a) => a === t || (a as string).includes(t) || (t as string).includes(a as string)))
    const unexpl = [...ana].filter((a) => ![...tru].some((t) => a === t || (a as string).includes(t as string) || (t as string).includes(a as string)))
    console.log(path.basename(f), "missing:", JSON.stringify(miss), "unexplained:", JSON.stringify(unexpl))
  }
}
main()
