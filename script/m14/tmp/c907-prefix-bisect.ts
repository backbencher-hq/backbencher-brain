// script/m14/tmp/c907-prefix-bisect.ts — the smallest self-contained source that
// still exhibits the #907 glue.
//
// The jq-shaped snippets I tried did not reproduce the grammar's behaviour, so the
// fixture has to come from the real file. This bisects the FILE PREFIX: the glue is
// caused by the brace/#ifdef split inside jv_dump_term's switch case (L254-L279) and
// the swallowed definitions sit at L389/L393, so a prefix a little past 395 should
// keep it — and a much shorter prefix may too.
//
// Run: bun script/m14/tmp/c907-prefix-bisect.ts <lines> [file]
import { readFileSync } from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(lang)

const arg = process.argv[2] ?? "396"
const FILE = process.argv[3] ?? "<corpus-root>/bb_tests/repositories/jq/src/jv_print.c"
const lines = readFileSync(FILE, "utf8").split("\n")
// "a-b,c-d" = keep the 1-based line ranges, concatenated (compaction test).
const src = /^[\d,\-]+$/.test(arg) && arg.includes("-")
  ? arg
      .split(",")
      .flatMap((r) => {
        const [a, b] = r.split("-").map(Number)
        return lines.slice(a - 1, b)
      })
      .join("\n")
  : lines.slice(0, parseInt(arg)).join("\n")
const N = src === undefined ? 0 : src.split("\n").length
const root = parser.parse(src).rootNode

type Hit = { name: string; line: number; wrapper: string }
const hits: Hit[] = []
const walk = (n: any, insideBody: boolean) => {
  const nowInside = insideBody || n.type === "compound_statement"
  if (n.type === "function_declarator") {
    const par = n.parent
    const isFdOfFn = par && par.type === "function_definition" && par.childForFieldName?.("declarator")?.startIndex === n.startIndex
    if (!isFdOfFn) {
      let j = n.endIndex
      while (j < src.length && " \t\n\r".includes(src[j])) j++
      if (src[j] === "{") {
        hits.push({ name: n.childForFieldName?.("declarator")?.text ?? n.text, line: n.startPosition.row + 1, wrapper: `${par?.type}${nowInside ? " inBody" : " top"}` })
      }
    }
  }
  for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i), nowInside)
}
walk(root, false)
const swallowed = hits.filter((h) => h.wrapper.includes("inBody"))
console.log(`${N} lines: hasError=${root.hasError} gluedDefs=${hits.length} swallowedBodyDefs=${swallowed.length} ${swallowed.map((h) => `${h.name}@L${h.line}(${h.wrapper})`).join(", ")}`)
