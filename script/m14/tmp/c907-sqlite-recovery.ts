// #907 companion: the census finds 44 swallowed definition names across 15
// sqlite files. Does the analyzer's recovery actually emit all of them?
// For each swallowed name: present in parseFile's symbols for that file?
// Run: bun script/m14/tmp/c907-sqlite-recovery.ts
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { parseFile } from "../../../src/ast/pool-worker"

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(lang)

const ROOT = "/home/ishaq2321/bb_tests/repositories/sqlite"
const files = execFileSync("bash", ["-c", `find ${ROOT} -name '*.c' -size +1k -not -path '*/.git/*' | sort`], { encoding: "utf8" }).split("\n").filter(Boolean)
let filesWithSwallow = 0
let names = 0
let missing = 0
const missingRows: string[] = []
for (const f of files) {
  const src = readFileSync(f, "utf8") as unknown as string
  const tree = parser.parse(src)
  if (!tree.rootNode.hasError) continue
  const swallowed: string[] = []
  const walk = (n: any, damagedOwner: any, ownerName: string | null): void => {
    const isFn = n.type === "function_definition"
    const name = isFn ? fnName(n) : null
    if (isFn && damagedOwner && damagedOwner.hasError && name && ownerName) swallowed.push(name)
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) walk(c, isFn ? n : damagedOwner, isFn ? name : ownerName)
    }
  }
  walk(tree.rootNode, null, null)
  if (swallowed.length === 0) continue
  filesWithSwallow++
  const r: any = await parseFile(f, ROOT)
  const have = new Set((r.symbols ?? []).map((s: any) => s.name))
  for (const nm of swallowed) {
    names++
    if (!have.has(nm)) { missing++; missingRows.push(`${f.replace(ROOT + "/", "")}: ${nm}`) }
  }
}
console.log(`sqlite: ${filesWithSwallow} files with swallowed definitions, ${names} swallowed names`)
console.log(`recovered by the analyzer: ${names - missing}/${names} (missing ${missing})`)
for (const m of missingRows.slice(0, 20)) console.log("  MISSING", m)

function fnName(node: any): string | null {
  let cur = node.childForFieldName?.("declarator")
  while (cur) {
    if (cur.type === "identifier") return String(cur.text)
    const next = cur.childForFieldName?.("declarator")
    if (!next) return null
    cur = next
  }
  return null
}
