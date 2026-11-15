import { readFileSync } from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P(); parser.setLanguage(lang)
const R = "/home/ishaq2321/bb_tests/repositories/jq"
const CASES: Array<[string, string, number[]]> = [
  ["src/parser.c", `${R}/src/parser.c`, [2229, 2230]],
  ["src/parser.c YYDPRINTF", `${R}/src/parser.c`, [0]],
  ["src/util.c isleap", `${R}/src/util.c`, [0]],
  ["src/builtin.c CFUNC", `${R}/src/builtin.c`, [0]],
  ["vendor/decNumber/decNumber.c decFinish", `${R}/vendor/decNumber/decNumber.c`, [0]],
]
for (const [label, file, rows] of CASES) {
  const src = readFileSync(file, "utf8")
  const t = parser.parse(src)
  const names = label.includes("isleap") ? ["isleap"] : label.includes("YYDPRINTF") ? ["YYDPRINTF"] : label.includes("CFUNC") ? ["CFUNC"] : label.includes("decFinish") ? ["decFinish"] : ["YY_INITIAL_VALUE"]
  const found: any[] = []
  const walk = (n: any): void => {
    if ((n.type === "identifier" || n.type === "type_identifier") && names.includes(n.text)) {
      if (rows[0] === 0 || rows.includes(n.startPosition.row + 1)) {
        const chain: string[] = []
        let cur = n.parent
        while (cur && chain.length < 6) { chain.push(cur.type); cur = cur.parent }
        found.push({ name: n.text, row: n.startPosition.row + 1, col: n.startPosition.column, chain: chain.join(" < ") })
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
  }
  walk(t.rootNode)
  console.log(`\n=== ${label} ===`)
  for (const f of found.slice(0, 6)) console.log(`  L${f.row}:${f.col} ${f.name} -> ${f.chain}`)
  if (!found.length) console.log("  (no mention found)")
}
