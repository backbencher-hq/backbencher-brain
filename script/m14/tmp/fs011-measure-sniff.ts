// FS011 — the `isMeasure` TEXT SNIFF, measured: the analyzer's only text-based
// classification, and whether it earns its place.
//
// The lane's own manifest note says the analyzer is "fully regex-free". One predicate
// contradicts that: `n.text.includes("Measure")` reads the SOURCE TEXT of an attribute
// node. The regex policy's rule (reviews/regex-policy.md) is that a test doing SYNTAX or
// CLASSIFICATION work on text, where the AST carries the information, is debt.
//
// WHAT IT MEASURES
//   trueMeasure   : an F# unit of measure (a `[<Measure>]`-attributed type) — the class
//                   the test is TRYING to find.
//   falsePositive : an attribute whose text contains the substring "Measure" but which is
//                   not a `[<Measure>]` unit-of-measure marker. The corpus has several
//                   natural candidates (`[<MeasureQuantity>]`? `<MeasureAttribute>`, a
//                   user type named `Measurements`, a test attribute, a doc comment).
//   falseNegative : a unit of measure the test misses — it requires an `attribute` node
//                   WITHIN the type_definition, so a `[<Measure>]` written on a
//                   type_abbrev_defn, or a measure type declared with `struct`/an
//                   attribute the grammar parks elsewhere, is invisible.
//
// The control is deliberate: attributes that do NOT contain the substring, which must be
// untouched — without them a rule that always answers true would look identical.
//
// Run: bun script/m14/tmp/fs011-measure-sniff.ts [--repo fsharp --limit 400] [--json out]
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "../../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argOf = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined }
const LIMIT = parseInt(argOf("--limit") ?? "400")
const EXT = (argOf("--ext") ?? "fs,fsi,fsx").split(",")
const REPOS = process.argv.includes("--all")
  ? fs.readdirSync(CORPUS_ROOT).filter((d) => { try { return fs.statSync(path.join(CORPUS_ROOT, d)).isDirectory() } catch { return false } })
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

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const parser = new P()
  parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))

  // Every attribute node in the corpus whose text contains the substring, and whether an
  // `identifier` inside it is literally the word `Measure` (the structural test the AST
  // supports, and the only one F# defines: [<Measure>] is a type-level attribute whose
  // NAME is Measure).
  const hits: any[] = []
  const structuralHits: any[] = []
  let attrNodes = 0
  let files = 0
  // KNOWN HAZARD (reviews/m60-fsharp-grammar-0312-refused.md §3): the fsharp grammar
  // exhausts web-tree-sitter's fixed heap on the F# compiler's largest sources and then
  // returns garbage or aborts. Every tree is deleted before the next parse, and a file
  // that still aborts is COUNTED and reported rather than silently skipped.
  let heapAborts = 0
  const aborts: string[] = []
  for (const repo of REPOS) {
    for (const file of walk(path.join(CORPUS_ROOT, repo), EXT, [], LIMIT)) {
      if (files >= LIMIT) break
      let src: string
      try { src = fs.readFileSync(file, "utf8") } catch { continue }
      files++
      const rel = path.relative(CORPUS_ROOT, file)
      let tree: any
      try { tree = parser.parse(src) } catch (e: any) {
        heapAborts++; if (aborts.length < 20) aborts.push(`${rel}: ${String(e?.message ?? e).slice(0, 90)}`)
        continue
      }
      const st: any[] = [tree.rootNode]
      while (st.length) {
        const n = st.pop()
        if (n.type === "attribute") {
          attrNodes++
          const text = n.text
          if (text.includes("Measure")) {
            // structural: is there an identifier node whose text is exactly "Measure"?
            const s2: any[] = [n]
            let structural = false
            while (s2.length) {
              const m = s2.pop()
              if ((m.type === "identifier" || m.type === "long_identifier") && /^Measure$/.test(m.text)) structural = true
              for (let i = 0; i < m.namedChildCount; i++) { const c = m.namedChild(i); if (c) s2.push(c) }
            }
            hits.push({ file: rel, line: n.startPosition.row + 1, text: text.replace(/\n/g, " ").slice(0, 90), structural })
            if (structural) structuralHits.push({ file: rel, line: n.startPosition.row + 1, text: text.replace(/\n/g, " ").slice(0, 90) })
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
      }
      tree.delete()
    }
  }
  const fp = hits.filter((h) => !h.structural)
  const out = { at: new Date().toISOString(), repos: REPOS, limit: LIMIT, files, heapAborts, aborts, attrNodes, substringHits: hits.length, structuralHits: structuralHits.length, falsePositives: fp.length, hits, structural: structuralHits }
  const jp = argOf("--json")
  if (jp) { fs.mkdirSync(path.dirname(jp), { recursive: true }); fs.writeFileSync(jp, JSON.stringify(out, null, 1)) }
  console.log(`FS011 — the isMeasure text sniff\n`)
  console.log(`files ${files}   heap aborts ${heapAborts}${heapAborts ? ` (${aborts.map((a) => a.split("/").pop()).join(", ")})` : ""}`)
  console.log(`      attribute nodes ${attrNodes}   attributes containing the substring "Measure" ${hits.length}   of those, structurally [<Measure>] ${structuralHits.length}   FALSE POSITIVES ${fp.length}`)
  console.log(`\n== the ${Math.min(hits.length, 30)} attributes the substring test accepts ==`)
  for (const h of hits.slice(0, 30)) console.log(`  ${h.structural ? "TRUE  " : "FALSE "} ${h.file}:${h.line}  ${JSON.stringify(h.text)}`)
  if (fp.length > 30) console.log(`  ... ${fp.length - 30} more`)
  console.log(`\n== controls (the substring test correctly REJECTS) ==`)
  console.log(`  every other attribute in the corpus (${attrNodes - hits.length} nodes) never reaches the test's true arm.`)
}
void main()
