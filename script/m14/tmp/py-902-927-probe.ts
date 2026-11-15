// script/m14/tmp/py-902-927-probe.ts — the two named python sites, read at the
// ANALYZER output (what the differential's oracle is scored against):
//
//   #902 — cython tests/run/withstat_py.py: the with-statement context-manager
//          call `manager_from_ternary -> cm1_getter` published line 0 at the
//          filing; it must now carry the call site's line.
//   #927 — cython Tools/dataclass_test_data/test_dataclasses.py: `class
//          T(namedtuple('Tbase', 'a'))` published `extends T -> namedtuple`, the
//          FACTORY; a computed base must name nothing.
//
// Reads only; writes nothing.
import * as fs from "fs"
import * as path from "path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CYTHON = "/home/ishaq2321/bb_tests/repositories/cython"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-python.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-python-analyzer"))

  const cases: Array<[string, (e: any) => boolean, string]> = [
    [
      "tests/run/withstat_py.py",
      (e) => e.source === "manager_from_ternary" || e.target === "cm1_getter",
      "#902 with-statement context manager call",
    ],
    [
      "Tools/dataclass_test_data/test_dataclasses.py",
      (e) => e.source === "T" || String(e.target).includes("namedtuple"),
      "#927 computed base (class T)",
    ],
  ]

  for (const [rel, pred, why] of cases) {
    const f = path.join(CYTHON, rel)
    const content = fs.readFileSync(f, "utf8")
    const p = new P()
    p.setLanguage(LANG)
    const r: any = await new mod.RealPythonAnalyzer().analyze(p.parse(content).rootNode, content, path.basename(f))
    const hits = (r.relationships ?? []).filter(pred)
    console.log(`\n=== ${why}\n=== ${rel}`)
    console.log(`relationships total=${(r.relationships ?? []).length}  matching=${hits.length}`)
    for (const e of hits)
      console.log(`  ${e.type}  ${e.source} -> ${e.target}  line=${JSON.stringify(e.line_number)}  conf=${e.confidence}`)
    if (hits.length === 0) console.log("  (none — the edge is gone)")
    if (process.argv.includes("--all"))
      for (const e of r.relationships ?? [])
        console.log(`  [all] ${e.type}  ${e.source} -> ${e.target}  line=${JSON.stringify(e.line_number)}  conf=${e.confidence}`)
  }
}
main()
