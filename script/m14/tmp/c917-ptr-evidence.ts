// #917 sibling class evidence: a macro-wrapped heading whose FIRST macro
// argument is a POINTER type (`CMPP__EXPORT(void *, cmpp_mrealloc)(…)`).
// Per site: the isolated snippet's root shape and whether the definition's name
// exists as a symbol (in isolation and in the whole file).
import fs from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(path.resolve("src/ast/engine.ts"))
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const cLang: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
const parser = new P()
parser.setLanguage(cLang)

const FILE = "/home/ishaq2321/bb_tests/repositories/sqlite/ext/wasm/libcmpp.c"
const whole = fs.readFileSync(FILE, "utf8")
const lines = whole.split("\n")

// Every heading site whose macro's first argument ends in `*`.
const SITES: Array<[number, string]> = []
for (let i = 0; i < lines.length; i++) {
  const m = /^([A-Za-z_]\w*)\(([^()\n]*)\)\s*\(/.exec(lines[i])
  if (!m) continue
  const first = (m[2].split(",")[0] ?? "").trim()
  if (!/\*$/.test(first) || first.includes('"')) continue
  const name = (m[2].split(",").pop() ?? "").trim()
  SITES.push([i + 1, name])
}
console.log(`sites: ${SITES.length} (${SITES.map(([l]) => l).join(", ")})`)

const wholeResult: any = await parseFile("ext/wasm/libcmpp.c", whole, { language: "c" } as any)
const wholeNames = new Set((wholeResult.symbols ?? []).map((s: any) => String(s.name ?? "")))

for (const [line, name] of SITES) {
  // Slice the definition: from the site line to the line that closes it at depth 0.
  let depth = 0, end = line - 1
  for (let i = line - 1; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") depth++
      else if (ch === "}") { depth--; if (depth === 0 && i + 1 > line - 1) { end = i; break } }
    }
    if (depth === 0 && i > line - 1) { end = i; break }
  }
  const snippet = lines.slice(line - 1, end + 1).join("\n")
  const root = parser.parse(snippet).rootNode
  const kids: string[] = []
  for (let i = 0; i < root.childCount; i++) kids.push(root.child(i)!.type)
  const isolated: any = await parseFile("snippet.c", snippet, { language: "c" } as any)
  const isolatedNames = new Set((isolated.symbols ?? []).map((s: any) => String(s.name ?? "")))
  console.log(`L${line} ${name}: root=[${kids.join(", ")}] | name-in-file=${wholeNames.has(name)} name-in-snippet=${isolatedNames.has(name)} errors=${isolated.symbols?.length ?? 0} syms`)
}
