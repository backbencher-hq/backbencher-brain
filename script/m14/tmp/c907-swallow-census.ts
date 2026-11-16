// #907 census: how many REAL top-level C definitions are swallowed into an
// enclosing function's body when the pinned grammar's brace balance is broken
// (preprocessor-conditional bodies)? Definition = a function_definition node
// that is a descendant of another function_definition's body, in a file where
// an enclosing function hasError. jq's src/jv_print.c is the measured case:
// `void jv_dumpf(...)` / `void jv_dump(...)` are top-level definitions the
// analyzer never emits, because the whole 219-395 region parses as ONE
// function_definition (jv_dump_term's body absorbing the rest).
//
// Run: bun script/m14/tmp/c907-swallow-census.ts
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

const REPOS = ["jq", "sqlite", "zig"]
for (const repo of REPOS) {
  const files = execFileSync("bash", ["-c", `find <corpus-root>/bb_tests/repositories/${repo} -name '*.c' -size +1k -not -path '*/.git/*' | sort`], { encoding: "utf8" })
    .split("\n").filter(Boolean).slice(0, 400)
  let filesWith = 0
  let totalSwallowed = 0
  const rows: Array<{ file: string; swallowed: string[]; owner: string | null }> = []
  for (const f of files) {
    let src = ""
    try { src = readFileSync(f, "utf8") } catch { continue }
    const tree = parser.parse(src)
    if (!tree.rootNode.hasError) continue
    const swallowed: string[] = []
    let owner: string | null = null
    const walk = (n: any, inDamagedFn: any, ownerName: string | null): void => {
      const isFn = n.type === "function_definition"
      const name = isFn ? fnName(n) : null
      if (isFn && inDamagedFn && inDamagedFn.hasError && name) {
        swallowed.push(name)
        if (!owner) owner = ownerName
      }
      const nextDamaged = isFn ? (isFn ? n : inDamagedFn) : inDamagedFn
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c, nextDamaged, isFn ? name : ownerName)
      }
    }
    walk(tree.rootNode, null, null)
    if (swallowed.length > 0) {
      filesWith++
      totalSwallowed += swallowed.length
      rows.push({ file: f.replace("<corpus-root>/bb_tests/repositories/", ""), swallowed, owner })
    }
  }
  console.log(`\n=== ${repo}: ${files.length} .c files scanned, ${filesWith} with swallowed definitions, ${totalSwallowed} swallowed names ===`)
  for (const r of rows.slice(0, 20)) {
    console.log(`  ${r.file}: ${r.swallowed.length}  [${r.swallowed.slice(0, 8).join(", ")}${r.swallowed.length > 8 ? ", ..." : ""}]  owner=${r.owner ?? "?"}`)
  }
  if (rows.length > 20) console.log(`  ... and ${rows.length - 20} more files`)
}
void parseFile
