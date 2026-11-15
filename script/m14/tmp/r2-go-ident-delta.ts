/**
 * M49.R2 wave, the ONE semantic delta of the four conversions.
 *
 * `real-go-analyzer.ts` tested a leaf with `/^[A-Za-z_][A-Za-z0-9_]*$/`, and in
 * JavaScript `$` without `m` ALSO matches before a final newline: the regex accepted
 * `"Name\n"` where the char-scan conversion (`isBareGoIdentifier`) rejects it. The
 * conversion is therefore a deliberate tightening, and a tightening is only honest if
 * it is MEASURED on the lane it touches rather than assumed empty.
 *
 * This counts, over every `.go` file of the lane's pinned corpora, the nodes whose leaf
 * would be accepted by the regex and rejected by the scan — i.e. exactly the inputs on
 * which the two rules differ. A zero count means the conversion is behaviour-preserving
 * on this lane's corpora; a non-zero count names the sites, and the lane's numbers must
 * be re-derived with the delta disclosed.
 *
 * The walk is a SUPERSET of the analyzer's call sites (it visits every `type_identifier`
 * and `qualified_type` node in every file, not only the ones reached from a declaration),
 * so a zero here is stronger than the call-site census would be.
 *
 * Run: bun script/m14/tmp/r2-go-ident-delta.ts
 */
import * as fs from "node:fs"
import * as path from "node:path"

const REPOS = [
  "/home/ishaq2321/bb_tests/repositories/go-tools",
  "/home/ishaq2321/bb_tests/repositories/terraform",
]

const RE = /^[A-Za-z_][A-Za-z0-9_]*$/
function isBareGoIdentifier(s: string): boolean {
  if (s.length === 0) return false
  const c0 = s.charCodeAt(0)
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 95)) return false
  for (let i = 1; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95)) return false
  }
  return true
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === ".git" || e.name === "testdata" || e.name === "vendor") continue
      walkFiles(p, out)
    } else if (e.name.endsWith(".go")) out.push(p)
  }
  return out
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-go.wasm"))
  const parser = new P()
  parser.setLanguage(lang)

  let files = 0
  let nodes = 0
  let leafUnaccepted = 0 // leaf the scan rejects outright (not a word-shape at all)
  const delta: string[] = []
  for (const repo of REPOS) {
    if (!fs.existsSync(repo)) {
      console.log(`(missing corpus: ${repo})`)
      continue
    }
    for (const f of walkFiles(repo)) {
      files++
      const src = fs.readFileSync(f, "utf8")
      const root = parser.parse(src).rootNode
      const stack = [root]
      while (stack.length) {
        const n: any = stack.pop()
        if (n.type === "type_identifier" || n.type === "qualified_type") {
          nodes++
          const raw: string = n.text
          const dot = raw.lastIndexOf(".")
          const leaf = dot !== -1 ? raw.slice(dot + 1) : raw
          const byRe = RE.test(leaf)
          const byScan = isBareGoIdentifier(leaf)
          if (byRe && !byScan) delta.push(`${path.relative(repo, f)}:${n.startPosition.row + 1}  ${JSON.stringify(leaf)}`)
          if (!byScan) leafUnaccepted++
        }
        for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i))
      }
    }
  }
  console.log(`files scanned: ${files} | type_identifier/qualified_type nodes: ${nodes}`)
  console.log(`leaves the CONVERTED scan rejects: ${leafUnaccepted}`)
  console.log(`leaves where the regex accepted and the scan rejects (the tightening's exact set): ${delta.length}`)
  for (const d of delta.slice(0, 20)) console.log(`  ${d}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
