/**
 * WHAT THE ORACLE DERIVES FOR SCSS — the measurement that decides whether the
 * analyzer may emit a type the oracle does not audit.
 *
 * The question this file answers is NOT "can the analyzer emit imports". It is
 * "does `differential.ts`'s oracle derive an `imports` row for a `@use`". If it
 * does, an analyzer edge of that label is AUDITED and closing the recall gap
 * costs nothing. If it does not, the same edge is counted `unexplained` —
 * indistinguishable, to the differential, from a fabrication.
 *
 * So the census is the oracle alone, no analyzer: `deriveCssEdges` +
 * `deriveScssEdges` over the corpus sample, labelled by what they emit.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import * as wts from "web-tree-sitter"
import { deriveScssEdges, deriveCssEdges } from "../../../../script/m14/differential"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const listFile = process.argv[2] ?? "/tmp/opencode/scss/files.txt"
const WSP: any = (wts as any).Parser ?? (wts as any).default
const WSL: any = (wts as any).Language ?? (wts as any).default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const p = new WSP()
p.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-scss.wasm"))))

const files = readFileSync(listFile, "utf8").split("\n").filter(Boolean)
const counts = new Map<string, number>()
const samples = new Map<string, string[]>()
let admitted = 0
for (const f of files) {
  let text: string
  try { text = readFileSync(f, "utf8") } catch { continue }
  if (detectLanguageFromPath(f, text) !== "scss") continue
  admitted++
  const t = p.parse(text)
  if (!t) continue
  const mod = f.split("/").pop()!
  for (const e of [...deriveCssEdges(t.rootNode, mod), ...deriveScssEdges(t.rootNode)]) {
    counts.set(e.label, (counts.get(e.label) ?? 0) + 1)
    const a = samples.get(e.label) ?? []
    if (a.length < 4) a.push(`${e.from} -[${e.label}]-> ${e.target}`)
    samples.set(e.label, a)
  }
  t.delete?.()
}
console.log(`admitted ${admitted} of ${files.length} listed\n`)
for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`${k.padEnd(12)} ${String(v).padStart(7)}   ${JSON.stringify(samples.get(k))}`)
