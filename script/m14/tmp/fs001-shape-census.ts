// FS001 — the fsharp lane's NODE-TYPE CENSUS over real corpora (F8, the permanent
// blind-spot detector) and the node-type/field literals the analyzer actually
// references.
//
// WHAT IT MEASURES, per node type occurring in the corpus:
//   total occurrences · files · the parent type it occurs under (top 3) · one real
//   example file:line:text.
//
// WHY: F8's rule is that an unclassified node type is an UNMEASURED hole. The
// fsharp lane has no spec/ file at all, so this census is what the spec is derived
// FROM — measuring first, classifying after. It also reports the analyzer's literals
// split into (a) present in the grammar, (b) present in the grammar but never
// occurring in the corpus, (c) absent from the grammar entirely — (c) is a dead
// branch and F1's finding, restated per build.
//
// Run:
//   bun script/m14/tmp/fs001-shape-census.ts --repo fsharp --limit 400
//   bun script/m14/tmp/fs001-shape-census.ts --all            # every local fsharp repo
//   bun script/m14/tmp/fs001-shape-census.ts --all --json out.json
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "../../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const argOf = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined }
const LIMIT = parseInt(argOf("--limit") ?? "400")
const AS_JSON = process.argv.includes("--json")
const ALL = process.argv.includes("--all")
const EXT = (argOf("--ext") ?? "fs,fsi,fsx").split(",")

const REPOS = ALL
  ? fs.readdirSync(CORPUS_ROOT).filter((d) => {
      try { return fs.statSync(path.join(CORPUS_ROOT, d)).isDirectory() } catch { return false }
    }).filter((d) => {
      for (const f of walk(path.join(CORPUS_ROOT, d), EXT, [], 1)) { void f; return true }
      return false
    })
  : [argOf("--repo") ?? "fsharp"]

function walk(dir: string, exts: string[], out: string[], cap: number): string[] {
  if (out.length >= cap) return out
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return out }
  for (const n of names) {
    if (out.length >= cap) return out
    if (n === ".git" || n === "node_modules" || n === "bin" || n === "obj") continue
    const p = path.join(dir, n)
    let st: fs.Stats
    try { st = fs.statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, exts, out, cap)
    else if (exts.includes(path.extname(n).slice(1).toLowerCase())) out.push(p)
  }
  return out
}

interface Shape {
  count: number
  files: number
  parents: Record<string, number>
  example: { file: string; line: number; text: string } | null
  inGrammar: boolean
  analyzerReferences: boolean
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm")))
  const inGrammar = new Set<string>()
  for (let i = 0; i < grammar.nodeTypeCount; i++) { const n = grammar.nodeTypeForId(i); if (n != null) inGrammar.add(n) }

  const shapes = new Map<string, Shape>()
  const perRepo: Record<string, { files: number; nodes: number; errorFiles: number; errorNodes: number; bytes: number }> = {}
  let totalFiles = 0, totalNodes = 0, crashFiles = 0
  const crashes: string[] = []

  for (const repo of REPOS) {
    const repoDir = path.join(CORPUS_ROOT, repo)
    const files = walk(repoDir, EXT, [], LIMIT)
    let nodes = 0, errorFiles = 0, errorNodes = 0, bytes = 0
    for (const file of files) {
      let src: string
      try { src = fs.readFileSync(file, "utf8") } catch { continue }
      bytes += Buffer.byteLength(src)
      const parser = new ParserClass()
      try { parser.setLanguage(grammar) } catch { continue }
      let tree: any
      try { tree = parser.parse(src) } catch (e: any) {
        crashFiles++; crashes.push(`${repo}/${path.relative(repoDir, file)}: ${String(e?.message ?? e).slice(0, 100)}`)
        continue
      }
      const rel = path.relative(CORPUS_ROOT, file)
      let fileErrs = 0
      const stack: any[] = [tree.rootNode]
      while (stack.length) {
        const n = stack.pop()
        nodes++
        const t = n.type
        if (t === "ERROR" || t === "MISSING") { fileErrs++; errorNodes++ }
        let sh = shapes.get(t)
        if (!sh) { sh = { count: 0, files: 0, parents: {}, example: null, inGrammar: inGrammar.has(t), analyzerReferences: false }; shapes.set(t, sh) }
        sh.count++
        const pk = n.parent?.type ?? "(root)"
        sh.parents[pk] = (sh.parents[pk] ?? 0) + 1
        if (!sh.example) {
          sh.example = { file: rel, line: n.startPosition.row + 1, text: n.text.slice(0, 80).replace(/\n/g, "\\n") }
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
      }
      if (fileErrs > 0) errorFiles++
      // file-level file set for the shape
      const seenInFile = new Set<string>()
      const st2: any[] = [tree.rootNode]
      while (st2.length) { const n = st2.pop(); seenInFile.add(n.type); for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st2.push(c) } }
      for (const t of seenInFile) { const sh = shapes.get(t); if (sh) sh.files++ }
      parser.delete()
    }
    perRepo[repo] = { files: files.length, nodes, errorFiles, errorNodes, bytes }
    totalFiles += files.length; totalNodes += nodes
    console.log(`  ${repo}: ${files.length} files, ${nodes} nodes, ${errorFiles} error files (${errorNodes} ERROR/MISSING nodes), ${(bytes / 1024 / 1024).toFixed(1)} MB`)
  }

  // analyzer literals
  const srcText = fs.readFileSync(path.join(ROOT, "src/ast/real-fsharp-analyzer.ts"), "utf8")
  const literals = new Set<string>()
  for (const m of srcText.matchAll(/(?:\.type|nodeType|type)\s*(?:===|!==|==|!=)\s*"([a-z_0-9]+)"/g)) literals.add(m[1])
  for (const m of srcText.matchAll(/"(type_definition|anon_type_defn)"/g)) literals.add(m[1])
  for (const sh of shapes.values()) sh.analyzerReferences = literals.has(sh.type)

  const rows = [...shapes.entries()]
    .map(([type, sh]) => ({
      type, count: sh.count, files: sh.files, inGrammar: sh.inGrammar,
      analyzerReferences: sh.analyzerReferences,
      topParents: Object.entries(sh.parents).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}:${v}`).join(" "),
      example: sh.example,
    }))
    .sort((a, b) => b.count - a.count)

  const notInGrammar = rows.filter((r) => !r.inGrammar)
  const inGrammarNeverSeen = [...inGrammar].filter((t) => !shapes.has(t)).sort()
  const analyzerLiteralsNotInGrammar = [...literals].filter((t) => !inGrammar.has(t)).sort()
  const analyzerLiteralsNeverSeen = [...literals].filter((t) => inGrammar.has(t) && !shapes.has(t)).sort()

  if (AS_JSON) {
    const outPath = argOf("--json")!
    fs.writeFileSync(outPath, JSON.stringify({
      at: new Date().toISOString(), repos: REPOS, limit: LIMIT, ext: EXT,
      perRepo, totalFiles, totalNodes, crashFiles, crashes,
      shapes: rows, notInGrammar, inGrammarNeverSeen, analyzerLiteralsNotInGrammar, analyzerLiteralsNeverSeen,
    }, null, 1))
    console.log(`wrote ${outPath}`)
  } else {
    console.log(`\n== ${rows.length} distinct named node types over ${totalFiles} files / ${totalNodes} nodes ==`)
    console.log(`crash files: ${crashFiles}`)
    for (const r of rows) {
      const flags = `${r.inGrammar ? "" : " NOT-IN-GRAMMAR"}${r.analyzerReferences ? " *analyzer*" : ""}`
      console.log(`${String(r.count).padStart(8)}  ${String(r.files).padStart(5)}f  ${r.type}${flags}`)
      console.log(`            parents: ${r.topParents}`)
      console.log(`            eg ${r.example?.file}:${r.example?.line}  ${r.example?.text}`)
    }
    console.log(`\n== analyzer node-type literals (${literals.size}) ==`)
    console.log(`  not in grammar (dead branches): ${analyzerLiteralsNotInGrammar.length ? analyzerLiteralsNotInGrammar.join(", ") : "none"}`)
    console.log(`  in grammar but never in corpus: ${analyzerLiteralsNeverSeen.length ? analyzerLiteralsNeverSeen.join(", ") : "none"}`)
    console.log(`\n== grammar node types never seen in the corpus (${inGrammarNeverSeen.length}) ==`)
    console.log(`  ${inGrammarNeverSeen.join(", ")}`)
    console.log(`\n== corpus node types not in the grammar (${notInGrammar.length}) ==`)
    console.log(`  ${notInGrammar.map((r) => `${r.type}×${r.count}`).join(", ")}`)
  }
}
void main()
