// M59.A7 (c): before adopting line_number, measure the two facts Tier A will
// check — (a) does a symbol's name appear on its `range.startLine`? (b) does a
// call edge's callee name appear on the line of its callee-name NODE rather
// than the call_expression's start (the receiver/scala defect)?
// Run: bun script/m14/tmp/c-audit-symbol-name-lines.ts
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

const corpora = process.env.BB_CORPUS === "jq"
  ? [["jq", "/home/ishaq2321/bb_tests/repositories/jq"]]
  : [["sqlite", "/home/ishaq2321/bb_tests/repositories/sqlite"], ["jq", "/home/ishaq2321/bb_tests/repositories/jq"]]

for (const [name, root] of corpora) {
  const files = execFileSync("bash", ["-c", `find ${root} -name '*.c' -not -path '*/.git/*' | sort | head -60`], { encoding: "utf8" }).split("\n").filter(Boolean)
  let syms = 0
  let nameOffLine = 0
  let calls = 0
  let callStartDiffers = 0
  const samples: string[] = []
  for (const f of files) {
    const src = readFileSync(f, "utf8")
    const lines = src.split("\n")
    const r: any = await parseFile(f, root)
    for (const s of (r.symbols ?? [])) {
      syms++
      const ln = s.range?.startLine
      if (!ln) continue
      const text = lines[ln - 1] ?? ""
      const re = new RegExp(`(^|[^\\w$])${String(s.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w$])`)
      if (!re.test(text)) {
        nameOffLine++
        if (samples.length < 6) samples.push(`SYM ${f.split("/").pop()}:${ln} name=${s.name} :: ${text.trim().slice(0, 70)}`)
      }
    }
    // call-edge check: for each call_expression, compare the call start line with the callee-name line
    const tree = parser.parse(src)
    const walk = (n: any): void => {
      if (n.type === "call_expression") {
        const fn = n.childForFieldName("function")
        if (fn) {
          let nameNode = fn
          if (fn.type === "field_expression") nameNode = fn.childForFieldName("field") ?? fn
          if (["identifier", "field_identifier"].includes(nameNode.type)) {
            calls++
            if (nameNode.startPosition.row !== n.startPosition.row) {
              callStartDiffers++
              if (samples.length < 12) samples.push(`CALL ${f.split("/").pop()} start=${n.startPosition.row + 1} name=${nameNode.startPosition.row + 1} ${nameNode.text}`)
            }
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    walk(tree.rootNode)
  }
  console.log(`\n=== ${name}: ${files.length} files ===`)
  console.log(`  symbols ${syms}, name NOT on its range.startLine: ${nameOffLine}`)
  console.log(`  resolvable call sites ${calls}, callee-name line != call_expression start line: ${callStartDiffers}`)
  for (const s of samples) console.log("   ", s)
}
