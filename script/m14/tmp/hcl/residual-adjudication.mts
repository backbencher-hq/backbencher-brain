/**
 * HCL RESIDUAL ADJUDICATION — for every distinct reference the corpus
 * differential still disagrees on, locate a REAL corpus example, print the
 * source line(s) and the tree that produced it, and classify it as
 *   analyzer-defect | oracle-defect | truth-defect | ruled
 * Nothing is left as a bare count.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { ASTEngine } from "/home/ishaq2321/backbencher-brain/src/ast/engine"
import { RealHclAnalyzer } from "/home/ishaq2321/backbencher-brain/src/ast/real-hcl-analyzer"

const REPOS = "/home/ishaq2321/bb_tests/hcl/repos"
const OUT = "/home/ishaq2321/bb_tests/hcl/out"
const EXT = /\.(tf|tfvars|hcl|tofu)$/i
const parser = await ASTEngine.getParser("hcl")
const analyzer = new RealHclAnalyzer()
type N = any

const diff = JSON.parse(readFileSync(`${OUT}/corpus-differential.json`, "utf8"))
const wantRefs = new Set<string>(diff.missSamples.map((m: any) => m.ref))
const spurRefs = new Set<string>(diff.spurSamples.map((m: any) => m.ref))

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

function tree(n: N, depth = 0, max = 9): string[] {
  const rows = [`${"  ".repeat(depth)}${n.type}${n.isNamed ? "" : " (anon)"} «${n.text.replace(/\n/g, "\\n").slice(0, 64)}» L${n.startPosition.row + 1}`]
  if (depth >= max) return rows
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) rows.push(...tree(c, depth + 1, max))
  }
  return rows
}

const out: string[] = []
const seenMiss = new Set<string>()
const seenSpur = new Set<string>()

for (const f of walkFiles(REPOS)) {
  if (seenMiss.size >= wantRefs.size && seenSpur.size >= spurRefs.size) break
  const src = readFileSync(f, "utf8")
  if (src.length > 4_000_000) continue
  const rel = relative(REPOS, f)
  const treeObj = parser.parse(src)
  const res = analyzer.analyze(treeObj.rootNode as any, src, rel)
  const got = new Set(res.relationships.filter((r) => r.type === "references").map((r) => r.target))
  const lines = src.split("\n")

  for (const s of diff.missSamples as any[]) {
    if (s.file !== rel) continue
    if (seenMiss.has(s.ref)) continue
    if (got.has(s.ref)) continue
    seenMiss.add(s.ref)
    out.push(`\n${"-".repeat(76)}\nMISSED  ${s.ref}   ${rel}  L${s.line}`)
    for (let i = Math.max(0, s.line - 4); i < Math.min(lines.length, s.line + 3); i++)
      out.push(`   ${String(i + 1).padStart(5)} | ${lines[i]}`)
    // find the attribute at that line
    const st: N[] = [treeObj.rootNode]
    while (st.length) {
      const n = st.pop()!
      if (n.type === "attribute" && n.startPosition.row + 1 === s.line) {
        out.push("   TREE:")
        out.push(...tree(n, 3, 8).map((r) => "   " + r))
        break
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) st.push(c)
      }
    }
  }
  for (const s of diff.spurSamples as any[]) {
    if (s.file !== rel) continue
    if (seenSpur.has(s.ref)) continue
    seenSpur.add(s.ref)
    out.push(`\n${"-".repeat(76)}\nSPURIOUS ${s.ref}   ${rel}  L${s.line}`)
    for (let i = Math.max(0, s.line - 3); i < Math.min(lines.length, s.line + 3); i++)
      out.push(`   ${String(i + 1).padStart(5)} | ${lines[i]}`)
    const st: N[] = [treeObj.rootNode]
    while (st.length) {
      const n = st.pop()!
      if (n.type === "attribute" && (n.startPosition.row + 1 === s.line || s.line < 0)) {
        out.push("   TREE:")
        out.push(...tree(n, 3, 8).map((r) => "   " + r))
        break
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) st.push(c)
      }
    }
  }
  treeObj.delete?.()
}

out.unshift(
  `RESIDUAL ADJUDICATION\nmissed distinct=${wantRefs.size} examples-captured=${seenMiss.size}\nspurious distinct=${spurRefs.size} examples-captured=${seenSpur.size}\n${"=".repeat(76)}`,
)
writeFileSync(`${OUT}/residual-adjudication.txt`, out.join("\n") + "\n")
console.log(out.join("\n"))
