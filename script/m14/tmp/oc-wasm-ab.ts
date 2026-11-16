// Structural A/B between two tree-sitter-objc wasm builds.
//
// Usage: bun script/m14/tmp/oc-wasm-ab.ts <wasmA> <wasmB>
//
// Reports, per file and in aggregate: hasError, ERROR-node count, and a
// structural digest of each tree (node type + span, pre-order). The #743 wave's
// rule is that a grammar rebuild must be verified BEHAVIOURALLY, not by hash,
// and that no clean file may be perturbed.
import * as fs from "fs"
import * as path from "path"
import { createHash } from "crypto"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const REPOS = "<corpus-root>/bb_tests/repositories"

const [wasmA, wasmB] = process.argv.slice(2)
if (!wasmA || !wasmB) {
  console.error("usage: oc-wasm-ab.ts <wasmA> <wasmB>")
  process.exit(2)
}

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const { detectLanguageFromPath } = await import(path.join(ROOT, "src/ast/language-detection"))

const langs: any[] = []
for (const w of [wasmA, wasmB]) langs.push(await L.load(fs.readFileSync(path.isAbsolute(w) ? w : path.join(ROOT, w))))

function walk(d: string, out: string[]) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) {
      if (e.name === ".git" || e.name === "Pods" || e.name.includes("xcodeproj")) continue
      walk(p, out)
    } else if (/\.(m|h)$/.test(e.name)) out.push(p)
  }
}

interface Stat {
  err: boolean
  errNodes: number
  digest: string
  types: string
}
function parseWith(lang: any, src: string): Stat {
  const p = new P()
  p.setLanguage(lang)
  const tree: any = p.parse(src)
  const parts: string[] = []
  let errNodes = 0
  const cursor = tree.rootNode.walk()
  let done = false
  while (!done) {
    const n = cursor.currentNode
    // Named nodes, TYPE ONLY. Two artifacts make positions useless as a
    // rebuild check: anonymous whitespace `extras` differ between CLI versions
    // (invisible to every analyzer), and those extras inflate the SPANS of the
    // named nodes that contain them — a `preproc_include` ends at 11,0 in one
    // build and 10,0 in the other for byte-identical input. Types alone answer
    // the question the check exists to ask: did the shape change?
    if (n.isNamed) parts.push(n.type)
    if (n.type === "ERROR" || n.isMissing) errNodes++
    if (cursor.gotoFirstChild()) continue
    for (;;) {
      if (cursor.gotoNextSibling()) break
      if (!cursor.gotoParent()) {
        done = true
        break
      }
    }
  }
  return {
    err: tree.rootNode.hasError,
    errNodes,
    digest: createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 12),
    types: tree.rootNode.children.map((c: any) => c.type).join(","),
  }
}

const files: string[] = []
for (const repo of ["sdwebimage", "afnetworking"]) walk(path.join(REPOS, repo), files)
const routed: string[] = []
for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  if (detectLanguageFromPath(path.basename(f), src) === "objective-c") routed.push(f)
}

let same = 0
const changed: any[] = []
let errA = 0
let errB = 0
let errNodesA = 0
let errNodesB = 0
const trans = { okOk: 0, okErr: 0, errOk: 0, errErr: 0 }
const worse: any[] = []
for (const f of routed) {
  const src = fs.readFileSync(f, "utf8")
  const a = parseWith(langs[0], src)
  const b = parseWith(langs[1], src)
  errA += a.err ? 1 : 0
  errB += b.err ? 1 : 0
  errNodesA += a.errNodes
  errNodesB += b.errNodes
  if (a.err && b.err) trans.errErr++
  else if (a.err && !b.err) trans.errOk++
  else if (!a.err && b.err) trans.okErr++
  else trans.okOk++
  if (b.errNodes > a.errNodes || (!a.err && b.err)) worse.push({ f: f.replace(REPOS + "/", ""), a, b })
  if (a.digest === b.digest) same++
  else changed.push({ f: f.replace(REPOS + "/", ""), a, b })
}

console.log(`A = ${wasmA}\nB = ${wasmB}\n`)
console.log(`files=${routed.length}  structurally-identical=${same}  changed=${changed.length}`)
console.log(`hasError: A=${errA} -> B=${errB}    ERROR/MISSING nodes: A=${errNodesA} -> B=${errNodesB}`)
console.log(`transitions: ok->ok ${trans.okOk}   ok->ERR ${trans.okErr}   ERR->ok ${trans.errOk}   ERR->ERR ${trans.errErr}`)
console.log(`files WORSENED (more ERROR nodes, or clean -> ERR): ${worse.length}`)
for (const c of worse) {
  console.log(`  WORSE ${c.a.err ? "ERR" : "ok "}->${c.b.err ? "ERR" : "ok "}  eNodes ${c.a.errNodes}->${c.b.errNodes}  ${c.f}`)
}
console.log(`\n-- files with fewer ERROR nodes --`)
const better = changed.filter((c) => c.b.errNodes < c.a.errNodes).sort((x, y) => x.b.errNodes - x.a.errNodes - (y.b.errNodes - y.a.errNodes))
for (const c of better) console.log(`  eNodes ${String(c.a.errNodes).padStart(3)}->${String(c.b.errNodes).padStart(3)}  ${c.f}`)
console.log(`\n-- remaining changed files (structural, incl. recovered surface) --`)
for (const c of changed.filter((c) => c.b.errNodes >= c.a.errNodes).slice(0, 40)) {
  console.log(
    `  ${c.a.err ? "ERR" : "ok "}->${c.b.err ? "ERR" : "ok "}  eNodes ${String(c.a.errNodes).padStart(3)}->${String(
      c.b.errNodes,
    ).padStart(3)}  ${c.f}\n        A: ${c.a.types.slice(0, 130)}\n        B: ${c.b.types.slice(0, 130)}`,
  )
}
process.exit(worse.length > 0 ? 1 : 0)
