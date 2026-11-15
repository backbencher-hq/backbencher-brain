// rust lane audit: does the analyzer ever publish the literal parameter name
// "unknown" (or a blank name / blank type) on a real corpus? If yes, how many
// sites, and what are the node shapes that produce it? A name surface a
// consumer can search for must never be a sentinel the source never wrote
// (c lane ruling, real-c-analyzer.ts:2850: "honest state is absence, never the
// literal \"unknown\"").
//
// Run: bun script/m14/tmp/rust-002-param-names.ts <repoRoot> [ext]
import * as fs from "node:fs"
import * as path from "node:path"

const { parseFile } = await import("../../../src/ast/engine")

const root = process.argv[2]
const ext = process.argv[3] ?? ".rs"
const files: string[] = []
const walk = (dir: string, depth = 0) => {
  if (depth > 12) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "target" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, depth + 1)
    else if (e.name.endsWith(ext)) files.push(p)
  }
}
walk(root)
files.sort()

let unknownName = 0
let blankName = 0
let unknownType = 0
let params = 0
const sites: string[] = []
for (const f of files) {
  let r: any
  try { r = await parseFile(f, fs.readFileSync(f, "utf8")) } catch { continue }
  for (const s of r.symbols ?? []) {
    for (const p of s.parameters ?? []) {
      params++
      const nm = String(p.name ?? "")
      if (nm === "unknown") { unknownName++; if (sites.length < 12) sites.push(`${path.relative(root, f)}:${s.name}`) }
      else if (nm.trim() === "") blankName++
      if (String(p.type ?? "").trim() === "unknown") unknownType++
    }
  }
}
console.log(JSON.stringify({ root, files: files.length, params, unknownName, blankName, unknownType, sites }, null, 1))
