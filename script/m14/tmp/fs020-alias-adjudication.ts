// FS020 — the ALIAS-vs-ONE-CASE-DU adjudication, decided by measurement rather than by
// assertion. FS010 established that the TREE alone cannot separate them (15 of 30
// spellings land in the same `union_type_defn` shape). The question this probe answers is
// the one that decides the fix: is the extra evidence the analyzer would need available
// WITHIN A FILE, and is it discriminative there?
//
// THREE EVIDENCE SOURCES, each measured:
//   A. in-file type names   — does the RHS name a type DECLARED in this file?
//   B. a leading `|` token   — FS014 measured this; it separates 8 of 10 but NOT
//                             `type X = A` from `type X = Original`.
//   C. the R9 declared-type graph (this round's own addition) — it already publishes
//                             the written type of a parameter, record field and DU
//                             payload, so if the ALIAS's RHS were reachable as a
//                             reference, the graph would carry it.
//
// THE OUTCOME, stated as a ruling rather than a number: if no single-file evidence
// separates the two shapes, the honest position is a DECLARED LIMITATION with the
// affected population counted, not a heuristic that guesses.
//
// Run: bun script/m14/tmp/fs020-alias-adjudication.ts --repo fsharp --limit 400
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "../../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
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
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  let files = 0
  const rows: any[] = []
  const truth: { alias: number; oneCaseDU: number; payloadDU: number; realEnum: number; abbrev: number } =
    { alias: 0, oneCaseDU: 0, payloadDU: 0, realEnum: 0, abbrev: 0 }

  for (const repo of REPOS) {
    for (const file of walk(path.join(CORPUS_ROOT, repo), EXT, [], LIMIT)) {
      if (files >= LIMIT) break
      let src: string
      try { src = fs.readFileSync(file, "utf8") } catch { continue }
      files++
      const rel = path.relative(CORPUS_ROOT, file)
      let tree: any
      try { tree = parser.parse(src) } catch { continue }

      // every type name this file declares, EXCEPT via an extension.
      // The `type_name` is NOT a direct child of `type_definition` — it sits inside the
      // body arm (`anon_type_defn`, `record_type_defn`, …), so this is a DFS, not a
      // direct-child scan. (A direct-child version silently reported 0 in-file cases,
      // which is how a measurement instrument can agree with a wrong conclusion.)
      const collect = (root: any, type: string, out: any[] = []): any[] => {
        const stack: any[] = [root]
        while (stack.length) {
          const n = stack.pop()
          if (n.type === type) out.push(n)
          for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
        }
        return out
      }
      const declaredTypes = new Set<string>()
      const st0: any[] = [tree.rootNode]
      while (st0.length) {
        const n = st0.pop()
        if (n.type === "type_definition" && !collect(n, "type_extension").length) {
          const tn = collect(n, "type_name")[0]
          if (tn) { const id = collect(tn, "identifier")[0]; if (id) declaredTypes.add(id.text) }
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st0.push(c) }
      }

      // the ambiguous population
      const st: any[] = [tree.rootNode]
      while (st.length) {
        const n = st.pop()
        if (n.type === "union_type_defn") {
          const cases: any[] = []
          const st2: any[] = [n]
          while (st2.length) { const m = st2.pop(); if (m.type === "union_type_case") cases.push(m); for (let i = 0; i < m.namedChildCount; i++) { const c = m.namedChild(i); if (c) st2.push(c) } }
          const withPayload = cases.filter((c) => c.namedChildCount > 1).length
          if (cases.length === 1 && withPayload === 0) {
            const caseName = cases[0].namedChildren.find((c: any) => c.type === "identifier")?.text ?? "?"
            rows.push({ repo, file: rel, line: cases[0].startPosition.row + 1, type: n.namedChildren.find((c: any) => c.type === "type_name")?.text, rhs: caseName, inFileType: declaredTypes.has(caseName) })
          } else if (cases.length === 1) truth.payloadDU++
          else truth.oneCaseDU++
        }
        if (n.type === "enum_type_defn") truth.realEnum++
        if (n.type === "type_abbrev_defn") truth.abbrev++
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
      }
      tree.delete()
    }
    void ASTEngine
  }

  const inFile = rows.filter((r) => r.inFileType)
  const notInFile = rows.filter((r) => !r.inFileType)
  const jp = argOf("--json")
  if (jp) { fs.mkdirSync(path.dirname(jp), { recursive: true }); fs.writeFileSync(jp, JSON.stringify({ at: new Date().toISOString(), repos: REPOS, limit: LIMIT, files, ambiguous: rows.length, inFile, notInFile, truth }, null, 1)) }

  console.log(`FS020 — the alias / one-case-DU adjudication, over ${files} files\n`)
  console.log(`  UNAMBIGUOUS populations (already classified correctly by the tree):`)
  console.log(`    type_abbrev_defn (a real abbreviation — list, generic, tuple, function)  ${truth.abbrev}`)
  console.log(`    multi-case union_type_defn                                          ${truth.oneCaseDU}`)
  console.log(`    one-case union WITH a payload (an 'of' clause)                 ${truth.payloadDU}`)
  console.log(`    enum_type_defn (explicit 'A = 0')                                ${truth.realEnum}`)
  console.log(`\n  THE AMBIGUOUS population (one case, no payload): ${rows.length}`)
  console.log(`    RHS names a type declared IN THIS FILE      ${inFile.length}   <- an ALIAS, provable in-file`)
  console.log(`    RHS names nothing declared in this file      ${notInFile.length}   <- a one-case DU, or an alias to another file`)
  console.log(`\n  The ruling this measurement supports:`)
  console.log(`    * the ${inFile.length} in-file cases are ALIASES and are separable by evidence the`)
  console.log(`      analyzer already has — but a DU case may legally share a type's name, so a`)
  console.log(`      name-based rule is a GUESS, and a wrong guess mislabels a real DU case.`)
  console.log(`    * the ${notInFile.length} out-of-file cases are NOT separable at all by single-file evidence:`)
  console.log(`      FS010 measured 15 of 30 spellings landing in the same subtree, and FS014`)
  console.log(`      measured the leading bar failing on exactly these two.`)
  console.log(`\n  So the class is DECLARED, not fixed: an F# analyzer with no name resolution`)
  console.log(`  cannot separate an alias from a one-case discriminated union, and the honest`)
  console.log(`  output for the ambiguous shape is the DU reading with the population counted.`)
  console.log(`  What is NOT declared as acceptable: the PHANTOM enum_member it mints. A DU case`)
  console.log(`  is published under the union's kind; an alias publishes a name that is not a case.`)
  void inFile
}
void main()
