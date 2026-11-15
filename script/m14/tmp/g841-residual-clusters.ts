// The census's `firstLine` is where the parser GAVE UP — tree-sitter's recovery
// wrapper opens at the enclosing declaration (that is why 19 of the 249 cluster
// on their own leading `/*`), so ranking constructs by it orders nothing. This
// walks each failing file's own parse tree and reports the INNERMOST
// ERROR/MISSING node — the smallest failing span, which is the closest thing to
// the construct the parser could not read without running a full reduction.
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

type Hit = { file: string; kind: string; nodeType: string; span: number; text: string; row: number }

async function main() {
  const listFile = process.argv[2]
  const files = readFileSync(listFile, "utf8").split("\n").filter((s) => s.trim())
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-groovy.wasm")))
  const parser = new P()
  parser.setLanguage(lang)

  const hits: Hit[] = []
  let unparsed = 0
  for (const f of files) {
    let src: string
    try { src = readFileSync(f, "utf8") } catch { continue }
    const root = parser.parse(src)?.rootNode
    if (!root?.hasError) { unparsed++; continue }
    // Collect every failing node with a non-empty span; keep the SMALLEST span.
    let best: any = null
    const walk = (n: any): void => {
      if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex) {
        if (!best || n.endIndex - n.startIndex < best.endIndex - best.startIndex) best = n
      }
      for (let i = 0; i < n.childCount; i++) walk(n.child(i))
    }
    walk(root)
    if (!best) continue
    const raw = String(best.text ?? "")
    hits.push({
      file: path.relative("/home/ishaq2321/bb_tests/repositories/grails-core", f),
      kind: best.isMissing ? "MISSING" : "ERROR",
      nodeType: best.type,
      span: best.endIndex - best.startIndex,
      text: raw,
      row: best.startPosition.row + 1,
    })
  }

  // Normalize into a shape signature: strings and identifiers masked, punctuation kept.
  const mask = (s: string): string => {
    let t = s.replace(/\s+/g, " ").trim()
    t = t.replace(/'[^'\n]*'/g, "'S'").replace(/"[^"\n]*"/g, '"S"')
    t = t.replace(/\b[A-Za-z_$][\w$]*\b/g, "ID")
    return t.slice(0, 60)
  }
  const counts = new Map<string, { n: number; sample: string; files: string[] }>()
  for (const h of hits) {
    const key = `${h.kind} ${h.nodeType} :: ${mask(h.text)}`
    const e = counts.get(key) ?? { n: 0, sample: h.file, files: [] }
    e.n++
    if (e.files.length < 5) e.files.push(h.file)
    counts.set(key, e)
  }

  console.log(`files=${files.length}  reported-unparsed-here=${unparsed}  with a failing node=${hits.length}`)
  console.log(`span median=${hits.map((h) => h.span).sort((a, b) => a - b)[Math.floor(hits.length / 2)]}\n`)
  for (const [k, v] of [...counts.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 20)) {
    console.log(`${String(v.n).padStart(4)}  ${k}`)
    for (const f of v.files.slice(0, 3)) console.log(`        ${f}`)
  }
  console.log(`\ndistinct clusters: ${counts.size}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
