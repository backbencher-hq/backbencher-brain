// script/m60/objc-error-dump.ts — what exactly is the grammar failing on?
//
// A count of ERROR nodes says the grammar is broken 50 times. It does not say WHY, and the
// reason matters: some of these are shapes the vendored grammar can be taught (and then the
// fix is a few lines of grammar.js plus a rebuild), and some are the same shape as a
// construct upstream tree-sitter genuinely cannot disambiguate (and then the honest answer is
// a documented bound, not a patch). Guessing which from reading source is how a lane ends up
// patching the wrong thing.
//
// So this prints, for every ERROR/MISSING node in the router's universe, the node's byte span,
// its line, the source text it covers, and the IMMEDIATE context — enough to name the shape
// without a tree-sitter playground.
//
// Usage: bun run script/m60/objc-error-dump.ts [--limit=N] [--file=<substring>]
// Writes: validation/m60/results/objc-error-dump.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS_ROOT = "$HOME/fixtures/repositories"
const outArg = (() => { const a = process.argv.find((x) => x.startsWith("--out=")); return a ? a.slice(6) : null })()
  const OUT = outArg ?? path.join(ROOT, "validation/m60/results/objc-error-dump.json")
const REPOS = ["sdwebimage", "afnetworking", "Clyde"]

const argNum = (f: string, d: number) => {
  const a = process.argv.find((x) => x.startsWith(`--${f}=`))
  return a ? Number(a.slice(f.length + 3)) : d
}
const LIMIT = argNum("limit", 120)
const ONLY = (() => {
  const a = process.argv.find((x) => x.startsWith("--file="))
  return a ? a.slice("--file=".length) : null
})()

function admitted(abs: string): boolean {
  const ext = path.extname(abs).toLowerCase()
  if (ext === ".m" || ext === ".mm") return true
  if (ext !== ".h") return false
  try {
    const fd = fs.openSync(abs, "r")
    const buf = Buffer.alloc(65536)
    const n = fs.readSync(fd, buf, 0, 65536, 0)
    fs.closeSync(fd)
    return /@(?:interface|protocol|implementation)\s+[A-Za-z_]/.test(buf.toString("utf8", 0, n))
  } catch { return false }
}

async function main() {
  const { ASTEngine } = await import("../../src/ast/engine")
  await ASTEngine.getParser("objective-c")
  const { loadWebTreeSitter } = await import("../../src/util/wasm")
  const mod = await loadWebTreeSitter()
  const wasmArg = (() => { const a = process.argv.find((x) => x.startsWith("--wasm=")); return a ? a.slice(7) : path.join(ROOT, "wasm/tree-sitter-objc.wasm") })()
  const lang = await mod.Language.load(wasmArg)

  const files: string[] = []
  for (const repo of REPOS) {
    const dir = path.join(CORPUS_ROOT, repo)
    if (!fs.existsSync(dir)) continue
    let out = ""
    try {
      out = execSync("git ls-files '*.m' '*.mm' '*.h'", { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    } catch { continue }
    for (const f of out.split("\n").filter((x) => x.trim())) {
      const abs = path.join(dir, f)
      if (admitted(abs)) files.push(abs)
    }
  }

  const findings: any[] = []
  for (const abs of files) {
    if (ONLY && !abs.includes(ONLY)) continue
    let src: string
    try { src = readFileSync(abs, "utf8") } catch { continue }
    const parser = new mod.Parser()
    parser.setLanguage(lang)
    const tree = parser.parse(src)
    const lines = src.split("\n")
    const cur = tree.walk()
    const stack: any[] = []
    const scan = () => {
      if (cur.nodeType === "ERROR" || cur.nodeType === "MISSING") {
        const sRow = cur.startPosition.row, eRow = cur.endPosition.row
        const own = src.slice(cur.startIndex, cur.endIndex)
        // the parent chain, so a shape can be named rather than guessed
        const parentChain: string[] = []
        let up = cur.parent
        for (let i = 0; i < 3 && up; i++, up = up.parent) parentChain.push(up.type)
        findings.push({
          file: path.relative(CORPUS_ROOT, abs),
          kind: cur.nodeType,
          line: sRow + 1,
          spanLines: eRow - sRow + 1,
          bytes: cur.endIndex - cur.startIndex,
          // the error's own text, trimmed — for a wide ERROR this is the whole wrecked region
          text: own.length > 400 ? own.slice(0, 400) + `…[+${own.length - 400}B]` : own,
          textFirstLine: (own.split("\n")[0] ?? "").slice(0, 160),
          parents: parentChain,
          contextBefore: lines.slice(Math.max(0, sRow - 2), sRow).map((l) => l.slice(0, 120)),
          contextAfter: lines.slice(eRow, eRow + 2).map((l) => l.slice(0, 120)),
        })
      }
      if (cur.gotoFirstChild()) { do { scan() } while (cur.gotoNextSibling()); cur.gotoParent() }
    }
    scan(); cur.delete()
  }

  // ---- name the shapes, because "470 ERROR nodes" is a number, not a review ----
  const shape = (f: any) => {
    const t = f.textFirstLine.trim()
    if (/^typedef\s+NS_(ENUM|OPTIONS)\s*\(/.test(t) || /NS_(ENUM|OPTIONS)\s*\(/.test(t)) return "ns-enum/options-macro-with-brace-body"
    if (/^(API_|NS_|CF_)[A-Z_]*\s*\(/.test(t)) return "availability-macro-call"
    if (/^(API_|NS_|CF_)[A-Z_]*$/.test(t)) return "bare-macro-line"
    if (/^#(if|ifdef|ifndef|elif|else|endif)/.test(t)) return "preprocessor-conditional"
    if (/^@\w+/.test(t)) return "objc-at-declaration"
    if (/^[A-Z_][A-Z0-9_]*(\(|$)/.test(t)) return "bare-macro-line"
    if (/^\s*"/.test(t)) return "string-literal"
    if (/^\s*\{/.test(t)) return "brace-body"
    if (/^#/.test(t)) return "preprocessor-directive"
    if (/^[a-z_]+:/.test(t)) return "label-or-selector"
    if (/^(case|default)\b/.test(t)) return "switch-case"
    return "unclassified"
  }
  const byShape = new Map<string, { nodes: number; files: Set<string>; examples: any[] }>()
  for (const f of findings) {
    const k = shape(f)
    if (!byShape.has(k)) byShape.set(k, { nodes: 0, files: new Set(), examples: [] })
    const g = byShape.get(k)!
    g.nodes++
    g.files.add(f.file)
    if (g.examples.length < 4) g.examples.push({ file: f.file, line: f.line, text: f.textFirstLine.slice(0, 110), parents: f.parents })
  }
  const shapes = [...byShape.entries()]
    .map(([shape, g]) => ({ shape, errorNodes: g.nodes, files: g.files.size, examples: g.examples }))
    .sort((a, b) => b.errorNodes - a.errorNodes)

  const payload = {
    schemaVersion: 1,
    milestone: "M60",
    rule: "Objective-C ERROR/MISSING node shape census",
    generatedAt: new Date().toISOString(),
    method: `walk the wired tree-sitter-objc wasm over the router universe (${files.length} files) and record every ERROR/MISSING node with its span, own text, parent chain and source context`,
    why: "470 ERROR nodes is a count, not a diagnosis. A shape that the vendored grammar can be taught is a fix; a shape upstream cannot disambiguate is a documented bound. Only the node text tells them apart.",
    totalErrorNodes: findings.length,
    distinctShapes: shapes.length,
    shapes,
    nodes: findings.slice(0, LIMIT),
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n")

  console.log(`files ${files.length}   ERROR/MISSING nodes ${findings.length}   distinct shapes ${shapes.length}\n`)
  for (const s of shapes) {
    console.log(`${String(s.errorNodes).padStart(4)} nodes  ${String(s.files).padStart(3)} files  ${s.shape}`)
    for (const e of s.examples.slice(0, 2)) console.log(`         e.g. ${e.file}:${e.line}  ${e.text}`)
  }
  console.log(`\n-> ${path.relative(ROOT, OUT)}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
