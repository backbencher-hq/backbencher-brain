// script/m14/tmp/clean-127-decl-probe.ts
//
// Why did the pair-retirement rule fire on only 2 of 12 rows?
// It retires a lost `calls` pair when either endpoint is absent from the file's
// module-level declaration set. This prints that set's membership for the exact names
// involved, so a rule that fails to fire is diagnosed rather than assumed.
//
// Run: bun script/m14/tmp/clean-127-decl-probe.ts
import { readFileSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"

const ROOT = process.cwd()
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const CAND = process.env.CLEAN_CANDIDATE ?? "/tmp/tree-sitter-clean-127.wasm"

const wts: any = WTS
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang = await L.load(readFileSync(CAND))
const parser = new P()
parser.setLanguage(lang)

const FILES: [string, string[]][] = [
  ["Clyde/cleantools/Pm/PmDriver.icl", ["paths", "name", "_", "step", "check_dependant_dates", "check_module_options"]],
  ["clean-stdlib/_SystemArray.icl", ["a", "createArray", "select", "update", "size"]],
  ["Clyde/cleantools/Pm/PmPath.icl", ["determine_dir_and_filename", "GetModuleName", "RemoveFilename"]],
  ["eastwood/test/LanguageServerTests.icl", ["goToTestExpectError", "goToErrorResponseFor", "singleMessageResponse"]],
]

for (const [rel, names] of FILES) {
  const src = readFileSync(path.join(CORPUS, rel), "utf8")
  const root = parser.parse(src).rootNode
  const out = new Set<string>()
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "function_declaration" || n.type === "type_signature") {
      let nm: string | undefined
      const bf = n.childForFieldName?.("name") ?? null
      if (bf?.text) nm = bf.text
      if (!nm) for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (n.type === "function_declaration" && c.type === "identifier") { nm = c.text; break }
        if (n.type === "type_signature" && c.type === "signature_name") { nm = c.text; break }
      }
      if (nm) {
        let cur = n.parent
        let local = false
        while (cur) { if (cur.type === "where_block") { local = true; break } cur = cur.parent }
        if (!local) out.add(nm)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  console.log(`### ${rel}  (module-level decls: ${out.size}, root errors=${root.hasError})`)
  for (const nm of names) console.log(`   ${nm.padEnd(28)} ${out.has(nm) ? "IN decls" : "absent"}`)
}
