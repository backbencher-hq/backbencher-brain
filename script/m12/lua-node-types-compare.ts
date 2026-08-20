// M12.32: shape safety — Lua analyzer dispatch refs vs emitted grammar types.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { loadWebTreeSitter, resolveWasmAsset } from "../../src/util/wasm"

const analyzer = readFileSync("src/ast/real-lua-analyzer.ts", "utf8")
const refs = new Set<string>()
const refPattern = /(?:\.type|\btype)\s*===\s*"([a-z_]+)"/g
let match: RegExpExecArray | null
while ((match = refPattern.exec(analyzer))) refs.add(match[1])

const root = process.argv[2] || "$HOME/fixtures/repositories/luarocks"
const files = execFileSync("git", ["-C", root, "ls-files", "*.lua", "*.luau"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).map((f) => `${root}/${f}`)
const W: any = await loadWebTreeSitter()
const Parser = W.Parser ?? W.default ?? W
const Language = W.Language ?? W.default?.Language
const init = W.init ?? Parser.init
if (init) await init({ locateFile: () => resolveWasmAsset("tree-sitter.wasm") })
const emitted = new Set<string>()
let parseErrors = 0
const shapeProbe = "local M = {}\nfunction M.new(x, ...) return x end\nfunction M:m(x) if x then for i in x do while i do break end end end end\nlocal function f(x) return x end\nlocal x = require(\"x.y\")\nM.__index = M\nlocal y = setmetatable({}, M)\ncoroutine.create(f)\nreturn M\n"
const wasmBytes = new Uint8Array(await Bun.file(resolveWasmAsset("tree-sitter-lua.wasm")).arrayBuffer())
const sources = [...files.map((file) => Bun.file(file)), new Blob([shapeProbe])]
for (const source of sources) {
  const grammar: any = await Language.load(new Uint8Array(wasmBytes))
  const parser: any = new Parser()
  parser.setLanguage(grammar)
  const tree = parser.parse(await source.text())
  const walk = (node: any) => {
    emitted.add(node.type)
    if (node.type === "ERROR" || node.isMissing) parseErrors++
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child) walk(child)
    }
  }
  walk(tree.rootNode)
  try { tree.delete(); parser.delete(); grammar.delete() } catch {}
}
const missing = [...refs].filter((ref) => !emitted.has(ref)).sort()
console.log(`analyzer refs=${refs.size} emitted=${emitted.size} files=${files.length + 1} parseErrors=${parseErrors}`)
console.log(`missing=${missing.length ? missing.join(",") : "none"}`)
if (missing.length || parseErrors) process.exitCode = 1
