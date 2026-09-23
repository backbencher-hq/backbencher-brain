// F11's G2 named ONE clean-under-pinned file that candidate B re-shapes
// (fmt/test/posix-mock-test.cc). Before the re-shape can be argued about — is it
// the intended macro-heading statement, or collateral on valid code? — the
// difference itself has to be read. This dumps the first few differing regions.
//
// Run: bun script/m60/probe-macro-heading-theft.ts  (candidate wasm at /tmp/c925-candB.wasm)
import fs from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const FILE = "$HOME/fixtures/repositories/fmt/test/posix-mock-test.cc"

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })

const src = fs.readFileSync(FILE, "utf8")

async function root(wasm: string) {
  const lang = await (L as any).load(fs.readFileSync(wasm))
  const parser = new P()
  parser.setLanguage(lang)
  return parser.parse(src).rootNode
}

const pinned = await root(path.join(ROOT, "wasm/tree-sitter-cpp.wasm"))
const cand = await root("/tmp/c925-candB.wasm")
const a = pinned.toString()
const b = cand.toString()
console.log(`pinned s-expr ${a.length} B · candidate ${b.length} B · identical=${a === b}`)

// Walk both trees in parallel; report the first region where the child sequence differs.
function firstDiff(x: any, y: any, depth = 0): boolean {
  const xs: any[] = []
  const ys: any[] = []
  for (let i = 0; i < x.childCount; i++) xs.push(x.child(i))
  for (let i = 0; i < y.childCount; i++) ys.push(y.child(i))
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    const cx = xs[i]
    const cy = ys[i]
    if (!cx || !cy || cx.type !== cy.type) {
      const line = (cx ?? cy).startPosition.row + 1
      console.log(`\nDIFF at depth ${depth}, child ${i} (line ${line})`)
      console.log(`  pinned   : ${cx ? `${cx.type} [${cx.startPosition.row + 1}..${cx.endPosition.row + 1}] ${JSON.stringify(cx.text.slice(0, 90))}` : "(missing)"}`)
      console.log(`  candidate: ${cy ? `${cy.type} [${cy.startPosition.row + 1}..${cy.endPosition.row + 1}] ${JSON.stringify(cy.text.slice(0, 90))}` : "(missing)"}`)
      if (cx && cy) {
        console.log(`  pinned   s-expr: ${cx.toString().slice(0, 300)}`)
        console.log(`  candidate s-expr: ${cy.toString().slice(0, 300)}`)
      }
      return true
    }
    if (cx.toString() !== cy.toString()) {
      if (firstDiff(cx, cy, depth + 1)) return true
    }
  }
  return false
}

const found = firstDiff(pinned, cand)
if (!found) console.log("no structural difference found by the walk (text-only difference?)")

let count = 0
const st: any[] = [cand]
while (st.length) {
  const n = st.pop()!
  if (n.type === "macro_heading_statement") {
    if (count < 4) console.log(`\nmacro_heading_statement at line ${n.startPosition.row + 1}: ${JSON.stringify(n.text.slice(0, 120))}`)
    count++
  }
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c) st.push(c)
  }
}
console.log(`\ncandidate: ${count} macro_heading_statement node(s) in this file`)
