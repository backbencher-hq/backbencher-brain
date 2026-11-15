// script/m14/tmp/clean-127-name-field.ts
//
// `processFunction` reads the declared name as `findChild(node, n => n.type === "identifier")`
// — the FIRST identifier child. Both grammars expose the name as a FIELD
// (`function_declaration name: (identifier) pattern: ... body: ...`), so the heuristic is
// both unnecessary and, where another identifier precedes the name in child order, wrong.
//
// This census asks the question the heuristic cannot: for every function_declaration /
// type_signature in the corpus, does "first identifier child" equal the `name:` field? Where
// it disagrees, the analyzer published a name the source does not declare there.
//
// Run: bun script/m14/tmp/clean-127-name-field.ts
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"

const ROOT = process.cwd()
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const REPOS = ["Clyde", "clean-stdlib", "Prelude", "cloogle.org", "eastwood"]
const WASMS = [
  ["pinned", path.join(ROOT, "wasm/tree-sitter-clean.wasm")],
  ["candidate", process.env.CLEAN_CANDIDATE ?? "/tmp/tree-sitter-clean-127.wasm"],
] as const

async function makeParser(wasm: string) {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(readFileSync(wasm))
  const p = new P()
  p.setLanguage(lang)
  return p
}

function walkClean(dir: string, out: string[]): void {
  for (const ent of readdirSync(dir)) {
    const abs = path.join(dir, ent)
    let st: ReturnType<typeof statSync>
    try { st = statSync(abs) } catch { continue }
    if (st.isDirectory()) { if (ent !== ".git") walkClean(abs, out); continue }
    if (/\.(icl|dcl)$/.test(ent)) out.push(abs)
  }
}

const files: string[] = []
for (const r of REPOS) {
  const base = path.join(CORPUS, r)
  try { statSync(base) } catch { continue }
  const found: string[] = []
  walkClean(base, found)
  for (const f of found) files.push(`${r}/${path.relative(base, f)}`)
}

for (const [label, wasm] of WASMS) {
  const parser = await makeParser(wasm)
  let fnTotal = 0, fnMismatch = 0, sigTotal = 0, sigMismatch = 0
  // The split that decides whether the fix is additive or a rename:
  //   fieldOnly  — the heuristic finds NO identifier child, so the analyzer publishes nothing
  //                today; using the field would ADD this definition as a symbol
  //   wrongName  — the heuristic finds a DIFFERENT identifier, so the analyzer publishes the
  //                wrong name today; using the field would RENAME an existing symbol
  let fieldOnly = 0, wrongName = 0
  const wrongExamples: string[] = []
  const examples: string[] = []
  for (const rel of files) {
    let src: string
    try { src = readFileSync(path.join(CORPUS, rel), "utf8") } catch { continue }
    const root = parser.parse(src).rootNode
    const stack: any[] = [root]
    while (stack.length) {
      const n = stack.pop()
      if (n.type === "function_declaration") {
        const byField = n.childForFieldName?.("name") ?? null
        let firstId: any = null
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c?.type === "identifier") { firstId = c; break } }
        if (byField?.text) {
          fnTotal++
          if ((firstId?.text ?? null) !== byField.text) {
            fnMismatch++
            if (!firstId) fieldOnly++
            else { wrongName++; if (wrongExamples.length < 15) wrongExamples.push(`${rel}:${n.startPosition.row + 1}  field=${JSON.stringify(byField.text)} heuristic=${JSON.stringify(firstId.text)}  head=${JSON.stringify(src.slice(n.startIndex, n.startIndex + 60).replace(/\s+/g, " "))}`) }
            if (examples.length < 12) examples.push(`${rel}:${n.startPosition.row + 1}  field=${JSON.stringify(byField.text)} first-identifier=${JSON.stringify(firstId?.text ?? null)}  head=${JSON.stringify(src.slice(n.startIndex, n.startIndex + 46).replace(/\s+/g, " "))}`)
          }
        }
      } else if (n.type === "type_signature") {
        const byField = n.childForFieldName?.("name") ?? null
        let firstId: any = null
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c?.type === "signature_name") { firstId = c; break } }
        if (byField?.text) {
          sigTotal++
          if ((firstId?.text ?? null) !== byField.text) {
            sigMismatch++
            if (examples.length < 12) examples.push(`${rel}:${n.startPosition.row + 1}  field=${JSON.stringify(byField.text)} first-signature_name=${JSON.stringify(firstId?.text ?? null)}`)
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
  }
  console.log(`### ${label}  (${files.length} files)`)
  console.log(`  function_declaration with a name field: ${fnTotal}; heuristic disagrees with the field: ${fnMismatch}`)
  console.log(`     heuristic finds no identifier at all (definition is DROPPED today): ${fieldOnly}`)
  console.log(`     heuristic finds a DIFFERENT identifier (wrong name published):      ${wrongName}`)
  console.log(`  type_signature with a name field:       ${sigTotal}; heuristic disagrees with the field: ${sigMismatch}`)
  for (const e of examples.slice(0, 6)) console.log(`    ${e}`)
  for (const e of wrongExamples) console.log(`    WRONG-NAME ${e}`)
  console.log()
}
