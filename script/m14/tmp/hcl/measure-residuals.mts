/**
 * Two measurements before deciding:
 *   M1  how many corpus files have the swallow shape (an ERROR node that
 *       decomposed a real `block` into identifier + label + collection_value,
 *       so no `block` node exists to find)?
 *   M2  how many corpus files have a top-level block whose Terraform address
 *       EQUALS the file stem (so the root module symbol and the block collide
 *       in `scope`)?
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { ASTEngine } from "<corpus-root>/backbencher-brain/src/ast/engine"
import { RealHclAnalyzer } from "<corpus-root>/backbencher-brain/src/ast/real-hcl-analyzer"

const REPOS = "<corpus-root>/bb_tests/hcl/repos"
const EXT = /\.(tf|tfvars|hcl|tofu)$/i
const parser = await ASTEngine.getParser("hcl")
const analyzer = new RealHclAnalyzer()
type N = any

function* walkFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    if (e === ".git" || e === "node_modules") continue
    const p = join(dir, e)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) yield* walkFiles(p)
    else if (EXT.test(e)) yield p
  }
}

/** An ERROR node that holds a decomposed block: identifier, a label literal,
 *  and a collection_value/object carrying the block's former attributes. */
function swallowSites(root: N): { line: number; detail: string }[] {
  const out: { line: number; detail: string }[] = []
  const stack: N[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.isError || n.type === "ERROR") {
      const kinds = new Set<string>()
      let id: string | null = null
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        kinds.add(c.type)
        if (c.type === "identifier" && !id) id = c.text
        if (c.type === "literal_value" && c.namedChild(0)?.type === "string_lit") {
          const lit = c.namedChild(0)!.namedChildren.find((x: N) => x.type === "template_literal")
          if (lit) kinds.add("LABEL:" + lit.text)
        }
      }
      const hasCollection = [...kinds].some((k) => k === "collection_value" || k === "object" || k === "expression")
      const hasLabel = [...kinds].some((k) => k.startsWith("LABEL:"))
      if (id && hasLabel && hasCollection) {
        out.push({ line: n.startPosition.row + 1, detail: `id=${id} kinds=${[...kinds].join(",")}` })
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

const swallowFiles: string[] = []
const rootCollisionFiles: { file: string; root: string; block: string; line: number }[] = []
let files = 0

for (const f of walkFiles(REPOS)) {
  const src = readFileSync(f, "utf8")
  if (src.length > 4_000_000) continue
  files++
  const rel = relative(REPOS, f)
  const t = parser.parse(src)
  const s = swallowSites(t.rootNode)
  if (s.length) swallowFiles.push(`${rel}  ${JSON.stringify(s.slice(0, 2))}`)
  const res = analyzer.analyze(t.rootNode as any, src, rel)
  const root = res.symbols.find((x) => x.metadata?.hclRoot)
  if (root) {
    // The real collision: a TOP-LEVEL block whose own leaf name equals the root
    // name, so the file and the block occupy one identity in `scope`. (A
    // top-level block having the root as its `scope` is the design, not a bug.)
    for (const sym of res.symbols) {
      if (sym.metadata?.hclRoot) continue
      if (sym.scope === root.name && sym.name === root.name) {
        rootCollisionFiles.push({ file: rel, root: root.name, block: sym.name, line: sym.range.startLine })
      }
    }
  }
  t.delete?.()
}

console.log(`files scanned: ${files}`)
console.log(`\nM1 swallow-shaped ERROR sites: ${swallowFiles.length} file(s)`)
for (const s of swallowFiles.slice(0, 30)) console.log(`   ${s}`)
console.log(`\nM2 root-name / top-level-block address collisions: ${rootCollisionFiles.length}`)
for (const c of rootCollisionFiles.slice(0, 40)) console.log(`   ${c.file}  root=${c.root}  block=${c.block} L${c.line}`)
