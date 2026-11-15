// FS005 — bisect a real F# file down to the smallest source that still breaks the
// grammar, so a grammar gap is reported with a MINIMAL REPRODUCER and not a filename.
//
// The ranking is by the number of ERROR/MISSING nodes, and the winner is the smallest
// contiguous line window that still produces them, found by a delta-debugging descent
// (shrink from the front, then the back, then halve) — so the answer does not depend on
// where the damage happens to start.
//
// Run:
//   bun script/m14/tmp/fs005-bisect.ts --file <path> [--max-nodes 40] [--from 1] [--to 99999]
//   bun script/m14/tmp/fs005-bisect.ts --file <path> --contiguous
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "../../..")
const argOf = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined }

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const parser = new P()
  parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))

  const file = argOf("--file")!
  const contiguous = process.argv.includes("--contiguous")
  const maxNodes = parseInt(argOf("--max-nodes") ?? "40")
  const all = fs.readFileSync(file, "utf8").split("\n")
  const from = parseInt(argOf("--from") ?? "1")
  const to = parseInt(argOf("--to") ?? String(all.length))
  const lines = all.slice(from - 1, to)
  console.log(`# ${file} lines ${from}..${to} (${lines.length} lines)`)

  const errCount = (text: string): number => {
    const tree = parser.parse(text)
    let n = 0
    const st: any[] = [tree.rootNode]
    while (st.length) { const x = st.pop(); if (x.type === "ERROR" || x.isMissing) n++; for (let i = 0; i < x.namedChildCount; i++) { const c = x.namedChild(i); if (c) st.push(c) } }
    return n
  }

  const base = errCount(lines.join("\n"))
  console.log(`# baseline: ${base} ERROR/MISSING nodes`)

  if (contiguous) {
    // smallest contiguous window that still errs
    let best: [number, number] = [1, lines.length]
    let changed = true
    while (changed) {
      changed = false
      const [a, b] = best
      if (errCount(lines.slice(a + 1, b).join("\n")) >= base && b - 1 > a) { best = [a + 1, b]; changed = true; continue }
      if (errCount(lines.slice(a, b - 1).join("\n")) >= base && b - 1 > a) { best = [a, b - 1]; changed = true; continue }
    }
    console.log(`\n== smallest contiguous window still erring: lines ${best[0]}..${best[1]} ==`)
    console.log(lines.slice(best[0] - 1, best[1]).map((l, i) => `${String(best[0] + i).padStart(5)}| ${l}`).join("\n"))
    const tree = parser.parse(lines.slice(best[0] - 1, best[1]).join("\n"))
    console.log(`\n== tree ==\n${tree.rootNode.toString().slice(0, 2000)}`)
    return
  }

  // delta-debug: drop lines one at a time from both ends while the error count holds
  let keep = lines.map((_, i) => i)
  const baseIdx = new Set(keep)
  const text = () => keep.map((i) => lines[i]).join("\n")
  const cur = () => errCount(text())
  const target = Math.min(base, maxNodes)
  void target
  let guard = 0
  let improved = true
  while (improved && guard++ < 500) {
    improved = false
    for (const dir of ["front", "back"]) {
      while (keep.length > 1) {
        const next = dir === "front" ? keep.slice(1) : keep.slice(0, -1)
        const t = next.map((i) => lines[i]).join("\n")
        if (errCount(t) >= base) { keep = next; improved = true } else break
      }
    }
  }
  void baseIdx
  console.log(`\n== minimal (whole-line removal, ${keep.length} of ${lines.length} lines) — ${cur()} ERROR nodes ==`)
  console.log(keep.map((i) => `${String(i + from).padStart(5)}| ${lines[i]}`).join("\n"))
  const tree = parser.parse(text())
  console.log(`\n== tree ==\n${tree.rootNode.toString().slice(0, 1500)}`)
}
void main()
