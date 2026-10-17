/**
 * java-ownerless-probe.ts — DERIV_EXPORTS_JAVA3.
 *
 * ONE question: which symbols lose their owner, in which files, and why.
 *
 * EXPORTS_JAVA2 counted 60 owner-less non-type symbols in 2 of java-lib's 3,275
 * files and recorded that it could NOT isolate the cause. Its recorded attempts
 * included a window bisect in which emptying any window moved the count in BOTH
 * directions, and it inferred an unbalanced push/pop in the walk's scope stack
 * from that bidirectionality.
 *
 * This probe does not start from that inference. It starts from the tree: for
 * every file that produces an owner-less non-type symbol, it re-parses the file
 * and records, for each such symbol, the node type, the declared line, the name,
 * and — the part the census did not print — WHERE IN THE FILE THE OWNER TYPE
 * IS. If a method has no owner while its enclosing class does, the defect is
 * about scope bookkeeping. If the owner type itself is absent from the symbol
 * list, the defect is upstream of the method.
 *
 * NO REGEX. Every step is a tree walk over node.type / namedChildren /
 * childForFieldName, or a character walk. The corpus population is derived by
 * directory walk (readdirSync), never a hand-written list.
 *
 * USAGE (from the lane worktree root):
 *   bun script/m14/lanes/java-ownerless-probe.ts
 *   LANE_NFILES=200 bun script/m14/lanes/java-ownerless-probe.ts
 */
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join, relative } from "node:path"
import { getParser } from "../../../src/ast/engine"
import { RealJavaAnalyzer } from "../../../src/ast/real-java-analyzer"

import { createRequire } from "node:module"
const require = createRequire(import.meta.url)

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO_DIR = process.env.BB_REPO ?? "java-lib"
const LANE_NFILES = Number(process.env.LANE_NFILES ?? 0)

const TOP_LEVEL_TYPE_DECLS = new Set([
  "class_declaration", "interface_declaration", "enum_declaration",
  "record_declaration", "annotation_type_declaration",
])

function isTopLevelTypeDecl(s: any): boolean {
  return TOP_LEVEL_TYPE_DECLS.has(String(s?.metadata?.nodeType ?? ""))
}

// ---- derived population: every .java file on disk, walk order -------------
function walkJava(dir: string, out: string[]): string[] {
  let ents: string[] = []
  try { ents = readdirSync(dir) } catch { return out }
  for (const e of ents) {
    const p = join(dir, e)
    let st: any
    try { st = require("node:fs").statSync(p) } catch { continue }
    if (st.isDirectory()) walkJava(p, out)
    else if (st.isSymbolicLink && st.isSymbolicLink()) { /* statSync followed it */ }
    else if (e.endsWith(".java")) out.push(p)
  }
  return out
}

interface Rec { file: string; name: string; nodeType: string; line: number; kind: string }

async function main() {
  const repoDir = join(CORPUS_ROOT, REPO_DIR)
  if (!existsSync(repoDir)) { console.error(`corpus missing: ${repoDir}`); process.exit(2) }
  let files = walkJava(repoDir, []).sort()
  const allCount = files.length
  if (LANE_NFILES > 0) files = files.slice(0, LANE_NFILES)

  const parser = await getParser("java")
  const analyzer = new RealJavaAnalyzer()
  const records: Rec[] = []
  const fileRecs = new Map<string, Rec[]>()
  let failures = 0

  for (const abs of files) {
    const rel = relative(repoDir, abs)
    const src = readFileSync(abs, "utf8")
    try {
      const tree = parser.parse(src)
      if (!tree) throw new Error("parser.parse returned no tree (null result)")
      const res: any = analyzer.analyze(tree.rootNode, src, rel, { filePath: rel } as any)
      const syms: any[] = res.symbols ?? []
      const hits: Rec[] = []
      for (const s of syms) {
        if (s.ownerName || isTopLevelTypeDecl(s)) continue
        const r: Rec = {
          file: rel,
          name: String(s.name ?? ""),
          nodeType: String(s.metadata?.nodeType ?? ""),
          line: Number(s.range?.startLine ?? 0),
          kind: String(s.kind ?? ""),
        }
        hits.push(r); records.push(r)
      }
      if (hits.length) fileRecs.set(rel, hits)
    } catch (e) {
      failures++
    }
  }

  console.log(`population: ${allCount} .java files on disk under ${REPO_DIR}; analyzed ${files.length}`)
  console.log(`parse/analyze failures: ${failures}`)
  console.log(`owner-less NON-TYPE symbols: ${records.length} in ${fileRecs.size} file(s)`)
  for (const [f, hits] of [...fileRecs.entries()].sort()) {
    console.log(`\nFILE ${f}`)
    console.log(`  ${hits.length} owner-less symbols; nodeTypes: ${JSON.stringify([...new Set(hits.map(h => h.nodeType))])}`)
    const lines = hits.map(h => h.line).sort((a, b) => a - b)
    console.log(`  lines: ${lines.join(", ")}`)
    // How many symbols does this file produce in total, and where are its types?
    const abs = join(repoDir, f)
    const src = readFileSync(abs, "utf8")
    const tree = parser.parse(src)
    if (!tree) throw new Error("parser.parse returned no tree (null result)")
    const res: any = analyzer.analyze(tree.rootNode, src, f, { filePath: f } as any)
    const syms: any[] = res.symbols ?? []
    const types = syms.filter(isTopLevelTypeDecl)
    console.log(`  file symbols total: ${syms.length}; top-level type decls: ${types.length}`)
    for (const t of types) console.log(`    TYPE ${t.name} kind=${t.kind} nodeType=${t.metadata?.nodeType} line=${t.range?.startLine}`)
    // Every declared method, with and without an owner, ordered by line.
    const methods = syms.filter(s => s.metadata?.nodeType === "method_declaration" || s.metadata?.nodeType === "constructor_declaration")
    const ownerlessSet = new Set(hits.map(h => `${h.line}:${h.name}`))
    console.log(`  declared methods/ctors: ${methods.length}; owner-less of them: ${hits.length}`)
    const firstOwnerless = lines.length ? lines[0] : -1
    const lastOwner = methods.filter(m => m.ownerName).map(m => Number(m.range?.startLine ?? 0)).sort((a,b)=>b-a)[0] ?? -1
    console.log(`  first owner-less line: ${firstOwnerless}; last OWNED method line: ${lastOwner}`)
    // method-level view around the boundary
    const seq = methods.map(m => ({ n: String(m.name ?? ""), l: Number(m.range?.startLine ?? 0), own: m.ownerName ?? null }))
      .sort((a, b) => a.l - b.l)
    let printed = 0
    for (let i = 0; i < seq.length; i++) {
      const isHit = ownerlessSet.has(`${seq[i].l}:${seq[i].n}`)
      if (isHit && printed < 4) {
        console.log(`    ctx[${i - 2}..${i + 2}] around ${seq[i].n}@${seq[i].l}:`)
        for (let j = Math.max(0, i - 2); j <= Math.min(seq.length - 1, i + 2); j++) {
          console.log(`      #${j} ${seq[j].n}@${seq[j].l} owner=${seq[j].own === null ? "(NONE)" : seq[j].own}${ownerlessSet.has(`${seq[j].l}:${seq[j].n}`) ? "   <== OWNERLESS" : ""}`)
        }
        printed++
      }
    }
  }

  if (records.length === 0) {
    console.log("\nVERDICT: no owner-less non-type symbol on this population — nothing to fix here.")
  } else {
    console.log(`\nVERDICT: DEFECT REPRODUCES — ${records.length} symbols in ${fileRecs.size} file(s). Not yet a cause.`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })