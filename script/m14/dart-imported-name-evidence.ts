// DART `importedName` CLAIM-KIND EVIDENCE CHECK (charter §18.19) — MEASUREMENT ONLY, no emission.
//
// The Lead's new `metadata.importedName` claim is verified by the gate from the run's own import
// evidence: the ITEM half of `module:item` imports edges, read into a file→module→names map. That
// can only verify what the ANALYZER SPELLS. This probe answers, on a declared population, three
// questions before any claim is emitted:
//   1. how many dart imports edges spell a NAME item (a `module:name` target whose item is not `*`);
//   2. how many ImportInfo entries carry a name list (anything other than the wildcard `["*"]`);
//   3. how many import directives carry a `show`/`hide` combinator (the ONLY place dart source
//      spells imported names), and how many names those spell — i.e. the upper bound of what a
//      future item-level emission could verify.
// Read-only; lane-owned instrument (`script/m14/dart-*.ts`).
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { getParser } from "../../src/ast/engine"
import { RealDartAnalyzer } from "../../src/ast/real-dart-analyzer"

const ROOT = path.resolve(import.meta.dir ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const arg = (name: string, fallback?: string): string | undefined => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.slice(name.length + 3) : fallback
}
const LOG = arg("log", path.join(ROOT, ".tmp-dartwork", "differential-dart-60-HEAD.log"))!
const REPO = arg("repo")
const p = await getParser("dart")
const analyzer = new RealDartAnalyzer()

const lanes: { repo: string; files: string[] }[] = []
{
  let cur: { repo: string; files: string[] } | null = null
  for (const line of readFileSync(LOG!, "utf8").split("\n")) {
    const cp = /\[cold-pool\] ([\w.-]+):dart:/.exec(line)
    if (cp) { cur = { repo: cp[1], files: [] }; lanes.push(cur); continue }
    const fm = /^\s+\[file\] (.+)$/.exec(line)
    if (fm && cur) cur.files.push(fm[1].trim())
  }
}
const want = lanes.filter((l) => (REPO ? l.repo === REPO : true)).filter((l) => l.files.length > 0)
if (want.length === 0) { console.error("no [file] lists in log; rerun the draw with BB_F5_SHOW_FILES=1"); process.exit(2) }

let files = 0, importEdges = 0, itemSpelledEdges = 0, importInfoEntries = 0, nameListEntries = 0
let showHideClauses = 0, showHideNames = 0
const samples: string[] = []
for (const lane of want) {
  const repoRoot = path.join(ROOT, ".tmp-dartwork", "corpus", lane.repo)
  for (const rel of lane.files) {
    let src = ""
    try { src = readFileSync(path.join(repoRoot, rel), "utf8") } catch { continue }
    const tree = p.parse(src)
    if (!tree?.rootNode) continue
    const result: any = analyzer.analyze(tree.rootNode, src, rel)
    files++
    for (const r of result?.relationships ?? []) {
      if (r.type !== "imports") continue
      importEdges++
      const t = String(r.target ?? "")
      // A NAME item is a colon-bearing target whose item half is not the wildcard `*`
      // (`package:x/y.dart:Thing` / `dart:core:Object`). A resolved project path has no colon.
      const c = t.lastIndexOf(":")
      if (c > 0 && t.slice(c + 1) !== "*" && t.slice(c + 1).length > 0) {
        itemSpelledEdges++
        if (samples.length < 4) samples.push(`edge ${lane.repo}/${rel}: ${t}`)
      }
    }
    for (const imp of result?.imports ?? []) {
      importInfoEntries++
      const list = Array.isArray(imp?.imported) ? imp.imported : []
      if (list.some((x: any) => x !== "*")) { nameListEntries++; if (samples.length < 6) samples.push(`importInfo ${lane.repo}/${rel}: ${JSON.stringify(list)}`) }
    }
    // show/hide combinators: count at the grammar level, and the names they spell.
    const st: any[] = [tree.rootNode]
    while (st.length > 0) {
      const n = st.pop()!
      if (n.type === "import_specification") {
        for (const c of n.namedChildren ?? []) {
          if (c && (c.type === "show_combinator" || c.type === "hide_combinator")) {
            showHideClauses++
            for (const id of c.namedChildren ?? []) if (id?.type === "identifier" || id?.type === "dotted_identifier_list") showHideNames++
          }
        }
      }
      for (const c of n.namedChildren ?? []) if (c) st.push(c)
    }
  }
}
const scope = want.map((l) => `${l.repo}(${l.files.length} drawn)`).join(" + ")
console.log(`dart importedName EVIDENCE CHECK — scope: ${scope}, ${files} file(s) analyzed`)
console.log(`  imports edges                         ${importEdges}`)
console.log(`  edges spelling a NAME item            ${itemSpelledEdges}   (target shape module:item, item != '*')`)
console.log(`  ImportInfo entries                    ${importInfoEntries}`)
console.log(`  ImportInfo entries with a name list   ${nameListEntries}   (anything other than ["*"])`)
console.log(`  show/hide clauses in imports          ${showHideClauses}   (the only per-file spelling of imported names)`)
console.log(`  names spelled in show/hide clauses    ${showHideNames}`)
for (const s of samples) console.log("  sample:", s)
// VERDICT: the claim's verification source is the ITEM half of module:item imports edges.
if (itemSpelledEdges === 0) console.log("  VERDICT: NO NAME-LEVEL IMPORT EVIDENCE exists for dart's imports edges -> the importedName claim kind can verify 0 rows from the current emission")
else console.log(`  VERDICT: ${itemSpelledEdges} name-item edges exist -> claimable rows must be counted against them`)
