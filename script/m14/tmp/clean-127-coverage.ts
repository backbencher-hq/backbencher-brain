// script/m14/tmp/clean-127-coverage.ts
//
// What text does a tree fail to reach?
//
// The G2 leaf census found 3 files where the CANDIDATE tree's leaves do not concatenate
// back to the source while the PINNED tree's do. That is the one class of finding that is
// unambiguously damage rather than a correction: source text the parser dropped. This probe
// prints the exact uncovered byte ranges (with the source line) so the finding is a
// reproducible citation rather than a count.
//
// Run: bun script/m14/tmp/clean-127-coverage.ts
import { readFileSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"

const ROOT = process.cwd()
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const CANDIDATE = process.env.CLEAN_CANDIDATE ?? "/tmp/tree-sitter-clean-127.wasm"
const PINNED = path.join(ROOT, "wasm/tree-sitter-clean.wasm")
const FILES = (process.env.FILES ?? [
  "Clyde/cleantools/Pm/PmParse.icl",
  "eastwood/src/languageServer/Target.dcl",
  "eastwood/src/languageServer/Compiler.icl",
].join(",")).split(",").filter(Boolean)

async function makeParser(): Promise<any> {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const mk = async (wasm: string) => {
    const language = await L.load(readFileSync(wasm))
    const p = new P()
    p.setLanguage(language)
    return p
  }
  return { pinned: await mk(PINNED), candidate: await mk(CANDIDATE) }
}

interface Cover { min: number; max: number; zeroWidth: number; leaves: number }

function cover(root: any): Cover {
  let min = Number.POSITIVE_INFINITY
  let max = -1
  let zeroWidth = 0
  let leaves = 0
  const visit = (n: any) => {
    const kids = n.children ?? []
    if (!kids.length) {
      leaves++
      if (n.endIndex === n.startIndex) zeroWidth++
      else { min = Math.min(min, n.startIndex); max = Math.max(max, n.endIndex) }
      return
    }
    for (const k of kids) visit(k)
  }
  visit(root)
  return { min, max, zeroWidth, leaves }
}

/** Every leaf with its span, so a gap can be reported against its neighbouring tokens. */
interface Span { start: number; end: number; type: string; text: string; parent: string }
function leafSpans(root: any, src: string): Span[] {
  const spans: Span[] = []
  const visit = (n: any, parent: string) => {
    const kids = n.children ?? []
    if (!kids.length) {
      if (n.endIndex > n.startIndex) {
        spans.push({ start: n.startIndex, end: n.endIndex, type: n.type, text: src.slice(n.startIndex, n.endIndex), parent })
      }
      return
    }
    for (const k of kids) visit(k, n.type)
  }
  visit(root, "<root>")
  return spans.sort((a, b) => a.start - b.start)
}

function gapsFrom(spans: Span[], len: number): [number, number][] {
  const out: [number, number][] = []
  let cur = 0
  for (const s of spans) {
    if (s.start > cur) out.push([cur, s.start])
    cur = Math.max(cur, s.end)
  }
  if (cur < len) out.push([cur, len])
  return out
}

function gaps(root: any, src: string): [number, number][] {
  return gapsFrom(leafSpans(root, src), src.length)
}

function lineOf(src: string, idx: number): number {
  return src.slice(0, idx).split("\n").length
}

async function main() {
  const p = await makeParser()
  for (const entry of FILES) {
    const m = entry.match(/^([^/]+)\/(.+)$/)
    if (!m) continue
    const [, repo, rel] = m
    const src = readFileSync(path.join(CORPUS, repo, rel), "utf8")
    const a = p.pinned.parse(src)
    const b = p.candidate.parse(src)
    const ca = cover(a.rootNode)
    const cb = cover(b.rootNode)
    // `errors=false` on the candidate while text is dropped is the dangerous combination:
    // G1 reads the file as IMPROVED. Report the flag next to the gap so it cannot hide.
    if (!b.rootNode.hasError) console.log(`  !! candidate has NO errors yet drops text — G1 would score this file as improved`)
    const ga = gaps(a.rootNode, src)
    const gb = gaps(b.rootNode, src)
    console.log(`### ${entry}  (${src.length} bytes, ${src.split("\n").length} lines)`)
    console.log(`  pinned:    leaves ${ca.leaves} zeroWidth ${ca.zeroWidth} span [${ca.min},${ca.max}] uncovered ${ga.length}` +
      ` errors=${a.rootNode.hasError}`)
    console.log(`  candidate: leaves ${cb.leaves} zeroWidth ${cb.zeroWidth} span [${cb.min},${cb.max}] uncovered ${gb.length}` +
      ` errors=${b.rootNode.hasError}`)
    // Whitespace-only gaps are not damage: leaves tile TOKENS. Report only non-blank gaps.
    const real = gb.filter(([s, e]) => src.slice(s, e).trim().length > 0)
    const realA = ga.filter(([s, e]) => src.slice(s, e).trim().length > 0)
    console.log(`  non-blank uncovered: pinned ${realA.length}, candidate ${real.length}`)
    const cSpans = leafSpans(b.rootNode, src)
    const pSpans = leafSpans(a.rootNode, src)
    const prevOf = (spans: Span[], at: number) => { let best: Span | null = null; for (const s of spans) if (s.end <= at) best = s; return best }
    const lineStart = (idx: number) => src.lastIndexOf("\n", idx - 1) + 1
    for (const [s, e] of real.slice(0, 12)) {
      const frag = src.slice(s, e)
      const col = s - lineStart(s) + 1
      console.log(`    candidate drops ${e - s}B at line ${lineOf(src, s)} col ${col}: ${JSON.stringify(frag.slice(0, 90))}`)
      const l = lineOf(src, s)
      const srcLine = src.split("\n")[l - 1] ?? ""
      console.log(`      source line: ${JSON.stringify(srcLine.slice(0, 120))}`)
      const pc = prevOf(cSpans, s)
      const pa = prevOf(pSpans, s)
      const nc = cSpans.find((x) => x.start >= e)
      const na = pSpans.find((x) => x.start >= e)
      const fmt = (x?: Span | null) => x ? `${x.type}${x.parent !== "<root>" ? `<${x.parent}>` : ""}:${JSON.stringify(x.text)}@${x.start}-${x.end}` : "(none)"
      console.log(`      candidate before: ${fmt(pc)}   after: ${fmt(nc)}`)
      console.log(`      pinned    before: ${fmt(pa)}   after: ${fmt(na)}`)
    }
    console.log()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
