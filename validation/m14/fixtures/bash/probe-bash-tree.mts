import { readFileSync } from "node:fs"
import * as path from "node:path"
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-bash.wasm"))))

const file = process.argv[2]
const wantLines = process.argv.slice(3).map(Number)
const text = readFileSync(file, "utf8")
const lines = text.split("\n")
const t = parser.parse(text)

const sexp = (n: any, d = 0): string => {
  if (d > 4) return "…"
  const kids: string[] = []
  for (let i = 0; i < n.childCount; i++) kids.push(sexp(n.child(i), d + 1))
  const flag = n.isMissing ? " MISSING" : n.type === "ERROR" ? " ERROR" : ""
  return `${n.type}${flag}${kids.length ? " [" + kids.join(" ") + "]" : ""}`
}
const visit = (n: any) => {
  const row = n.startPosition.row + 1
  if (wantLines.includes(row)) {
    console.log(`\n### line ${row}: ${JSON.stringify(lines[row - 1])}`)
    console.log(`  ${n.type}  @${n.startPosition.row + 1}-${n.endPosition.row + 1}  MISSING=${!!n.isMissing}`)
    console.log(sexp(n, 0).split(" ").length > 1 ? "  " + sexp(n, 0) : "  " + sexp(n, 0))
  }
  for (let i = 0; i < n.childCount; i++) visit(n.child(i))
}
visit(t.rootNode)
