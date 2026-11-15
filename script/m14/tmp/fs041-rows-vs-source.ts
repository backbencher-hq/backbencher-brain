/**
 * fs041 — residual rows, printed against the SOURCE LINE that produced them.
 *
 * A class name is a hypothesis. `calls / source other` says seven rows disagree; it does not say
 * whether the analyzer is inventing a call, whether truth is missing one, or whether the two are
 * describing the same construct with different names. Those three answers need different fixes,
 * and only one of them is a code change to the analyzer.
 *
 * So this prints, per row: which side had it, the file, the line, and the line's own text. A
 * disagreement about a NAME is usually obvious from the source text; a disagreement about an
 * EXISTENCE is not, and that is the case worth reading carefully.
 *
 * Usage: bun fs041-rows-vs-source.ts <file> <label> [limit]
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const CORPUS = process.env["BB_CORPUS_ROOT"] ?? "/home/sano/ishaq/bb_tests/repositories"
const { deriveFsharpEdges } = await import(path.join(ROOT, "script/m14/fsharp-truth-oracle.ts"))
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

const file = process.argv[2]!
const label = process.argv[3]!
const LIMIT = Number(process.argv[4] ?? 40)

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const src = fs.readFileSync(file, "utf8")
  const lines = src.split("\n")
  const parser = new P()
  parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))
  const tree = parser.parse(src)
  const r: any = await ASTEngine.parseFile(file, src)
  const truth = deriveFsharpEdges(tree.rootNode, r.symbols ?? []).filter((e: any) => e.label === label)
  const mine = (r.relationships ?? []).filter((x: any) => String(x.type) === label)
  const k = (a: string, b: string) => `${a}|${b}`
  const tk = new Map(truth.map((e: any) => [k(e.from, e.target), e]))
  // `new Set(mine.map(x => [k(...), x]))` builds a Set of `[key, value]` TUPLES, so
  // `ak.has(key)` is false for every key and EVERY row prints as MISSING *and* UNEXPLAINED. The
  // truth side uses `new Map`, which is why the header counts looked right — `truth 1 analyzer 1`
  // — while the comparison underneath was comparing nothing. The counts were the only honest
  // part of the output.
  //
  // The map to the KEY. A Set of pairs is the single most quiet way to make a differential lie:
  // it never throws, the totals still print, and it inflates both directions at once, so the
  // residual looks like disagreement everywhere and nowhere specifically.
  const ak = new Set(mine.map((x: any) => k(String(x.source), String(x.target))))
  const show = (side: string, from: string, to: string, line: number) => {
    const text = (lines[line - 1] ?? "").trim().slice(0, 110)
    console.log(`  ${side.padEnd(11)} ${String(from).slice(0, 40).padEnd(40)} -> ${String(to).slice(0, 34).padEnd(34)} L${String(line).padStart(4)}  ${text}`)
  }
  console.log(`\n${path.basename(file)}  label=${label}  truth ${truth.length}  analyzer ${mine.length}`)
  // WHY THIS LINE EXISTS: fs041 reported `MISSING DummyForm -> Form` for a row that fs044 shows
  // BOTH sides emitting, byte-identical (`cat -A` included). The join code below looks correct,
  // so the fault has to be in what is being JOINED. Printing the two key sets is the only way to
  // see it — two identical-looking rows whose keys differ is invisible in aligned columns, and
  // that is exactly the failure this line was written to catch.
  if (process.env["FS041_KEYS"]) {
    console.log("  truth keys:  ", JSON.stringify([...tk.keys()]))
    console.log("  analyzer keys:", JSON.stringify([...ak.keys()]))
    console.log("  analyzer row types:", JSON.stringify(mine.map((x: any) => [String(x.type), String(x.source), String(x.target)])))
  }
  let n = 0
  for (const [key, e] of tk) {
    if (ak.has(key)) continue
    if (n++ >= LIMIT) break
    show("MISSING", e.from, e.target, e.line ?? 0)
  }
  // The other direction iterates the ANALYZER'S ROWS and asks the truth side, rather than
  // destructuring pairs out of a Set of keys. Asking the question from the side that holds the
  // row is what keeps the line, the confidence and the metadata available to print — and the
  // previous version lost all three, which is why it printed `undefined`.
  n = 0
  for (const x of mine) {
    if (tk.has(k(String(x.source), String(x.target)))) continue
    if (n++ >= LIMIT) break
    show("UNEXPLAINED", x.source, x.target, x.line_number ?? 0)
  }
}
await main()
