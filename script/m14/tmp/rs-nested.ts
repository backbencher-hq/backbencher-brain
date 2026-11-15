import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-rust.wasm")))
const p = new P(); p.setLanguage(gl)
const root = p.parse(fs.readFileSync(process.argv[2], "utf8")).rootNode
const target = process.argv[3]
const walk = (n: any, d: number): void => {
  if (n.namedChildren?.some((c: any) => String(c.text).includes(`fn ${target}`))) {
    let cur = n
    const chain: string[] = []
    const find = (x: any, path: any[]): any[] | null => {
      if (x.namedChildren?.some((c: any) => String(c.text).includes(`fn ${target}`))) return path
      for (const c of x.namedChildren ?? []) { const r = find(c, [...path, x]); if (r) return r }
      return null
    }
    const chainNodes = find(root, []) ?? []
    for (const c of chainNodes) {
      const t = c.namedChildren?.find((k: any) => k.type === "identifier" || k.type === "type_identifier")
      chain.push(`${c.type}${t ? `(${t.text})` : ""}`)
    }
    console.log(`path to fn ${target}: ${chain.join(" > ")}`)
    return
  }
  for (const c of n.namedChildren ?? []) walk(c, d + 1)
}
walk(root, 0)
