// Review instrument (NOT a gate): a CONTENT DIGEST of the CSS analyzer's whole
// corpus output, so a "behaviour-preserving" claim is a measurement.
//
//   bun script/m14/tmp/css-edge-digest.ts --out <path> [--label <name>]
//   bun script/m14/tmp/css-edge-digest.ts --compare <a.json> <b.json>
//
// Why this exists. `reviews/m49-w9-fixture-coverage-adjudication.md` sets the
// standard for removing a dead branch: "Every one of the 21 removals/re-pointings
// is provably behaviour-preserving — and that is not an argument, it is a
// measurement: the zig edge set over all 90 `.zig` files of the zls corpus is
// byte-identical before and after." An aggregate count cannot carry that claim —
// 5,000 relationships before and after is equally consistent with "identical" and
// with "500 removed and 500 added". So this digests the SET.
//
// The digest covers, per file: every symbol (name|kind|scope|line) and every
// relationship (type|source|target|line|confidence), sorted, plus the file list.
// `--compare` reports the exact added/removed lines rather than a boolean, so a
// difference is a work list and not a mystery.

import { ASTEngine } from "../../../src/ast/engine"
import { readFileSync, readdirSync, statSync, writeFileSync } from "fs"
import { join } from "path"
import { createHash } from "crypto"

const ROOT = "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)

function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}

const COMPARE_A = flag("compare-a")
const COMPARE_B = flag("compare-b")
const OUT = flag("out")
const LABEL = flag("label") ?? "unnamed"

const REPOS = ["svelte", "grails-core", "scala3", "cython", "go-tools", "mojo", "zig", "cloogle.org", "element-plus", "vue-core", "cargo", "fsharp", "graphql-js"]

function walk(dir: string, out: string[], d = 0): void {
  if (d > 10) return
  let es: string[]
  try { es = readdirSync(dir) } catch { return }
  for (const e of es) {
    if (e === "node_modules" || e === ".git" || e === "target" || e === "dist") continue
    const p = join(dir, e)
    let st: import("fs").Stats
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out, d + 1)
    else if (e.endsWith(".css") && st.size > 0) out.push(p)
  }
}

async function collect(): Promise<{ files: string[]; lines: string[]; symbols: number; relationships: number }> {
  const files: string[] = []
  for (const repo of REPOS) walk(join(ROOT, repo), files)
  files.sort()
  const lines: string[] = []
  let symbols = 0, relationships = 0
  for (const f of files) {
    const content = readFileSync(f, "utf8")
    let res: any
    try { res = await ASTEngine.parseFile(f, content) } catch { lines.push(`${f}\tCRASH`); continue }
    for (const s of res.symbols ?? []) {
      symbols++
      lines.push(`${f}\tS\t${s.kind}\t${s.name}\t${s.scope ?? ""}\t${s.range?.startLine ?? 0}`)
    }
    for (const r of res.relationships ?? []) {
      relationships++
      lines.push(`${f}\tR\t${r.type}\t${r.source}\t${r.target}\t${r.line_number ?? ""}\t${r.confidence ?? ""}`)
    }
    for (const m of res.metadata?.patterns ?? []) lines.push(`${f}\tP\t${m}`)
    for (const m of res.metadata?.detectedFrameworks ?? []) lines.push(`${f}\tF\t${m}`)
  }
  lines.sort()
  return { files, lines, symbols, relationships }
}

function digestOf(lines: string[]): string {
  return createHash("sha256").update(lines.join("\n")).digest("hex")
}

async function main() {
  if (COMPARE_A && COMPARE_B) {
    const a = JSON.parse(readFileSync(COMPARE_A, "utf8"))
    const b = JSON.parse(readFileSync(COMPARE_B, "utf8"))
    const A = new Set(a.lines as string[])
    const B = new Set(b.lines as string[])
    const removed = [...A].filter((l) => !B.has(l))
    const added = [...B].filter((l) => !A.has(l))
    console.log(JSON.stringify({
      compare: `${a.label}  ->  ${b.label}`,
      files: { before: a.files.length, after: b.files.length, same: JSON.stringify(a.files) === JSON.stringify(b.files) },
      symbols: { before: a.symbols, after: b.symbols, delta: b.symbols - a.symbols },
      relationships: { before: a.relationships, after: b.relationships, delta: b.relationships - a.relationships },
      digest: { before: a.digest, after: b.digest, identical: a.digest === b.digest },
      linesRemoved: removed.length,
      linesAdded: added.length,
      verdict: a.digest === b.digest
        ? "BEHAVIOUR-PRESERVING: the entire corpus output is byte-identical."
        : `CHANGED: ${removed.length} line(s) removed, ${added.length} added — a work list, not a boolean.`,
      removedSample: removed.slice(0, 40),
      addedSample: added.slice(0, 40),
    }, null, 2))
    return
  }

  await ASTEngine.init?.()
  const { files, lines, symbols, relationships } = await collect()
  const artifact = {
    label: LABEL,
    corpora: REPOS,
    files: files.length,
    symbols,
    relationships,
    lineCount: lines.length,
    digest: digestOf(lines),
    method: "Per file: every symbol (kind|name|scope|startLine), every relationship (type|source|target|line|confidence), every detected pattern, every detected framework. All lines sorted, then sha256 over the joined text. An aggregate count cannot distinguish 'identical' from '500 removed and 500 added'; the SET can.",
    lines,
  }
  if (OUT && OUT !== "undefined") { writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n"); process.stderr.write(`wrote ${OUT}  digest ${artifact.digest.slice(0, 16)}  ${symbols} sym / ${relationships} rel / ${lines.length} lines\n`) }
  console.log(JSON.stringify({ label: LABEL, files: files.length, symbols, relationships, lineCount: lines.length, digest: artifact.digest }, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
