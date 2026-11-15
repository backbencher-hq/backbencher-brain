// ER3 — the analyzer's cost, measured the way the milestone's envelope claims it
// (parse and analyze separated, per-corpus rows so one heavy file cannot hide in
// an average), AND against the PRE-ER3 analyzer restored from git so the delta is
// a measurement rather than an assertion.
//
// Usage:
//   bun run script/m14/tmp/erlang-perf.ts [--files N] [--corpus a,b] [--ab]
import * as fs from "fs"
import * as path from "path"
import { RealErlangAnalyzer } from "../../../src/ast/real-erlang-analyzer"

const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..", "..")
const REPO_ROOT = "/home/sano/ishaq/bb_tests/repositories"
const OLD = "/home/sano/ishaq/bb_tests/er3-perf/old-erlang-analyzer.ts"

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? (process.argv[i + 1] ?? dflt) : dflt
}
const FILE_LIMIT = parseInt(arg("files", "300"), 10)
const CORPORA = arg("corpus", "rebar3,cowboy,otp").split(",")
const AB = process.argv.includes("--ab")

interface Row {
  corpus: string
  files: number
  bytes: number
  lines: number
  symbols: number
  rels: number
  ms: number
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new P()
  parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm"))))

  const files: string[] = []
  for (const d of CORPORA) {
    const base = path.join(REPO_ROOT, d)
    if (!fs.existsSync(base)) continue
    const stack = [base]
    while (stack.length > 0) {
      const cur = stack.pop()!
      let es: fs.Dirent[]
      try { es = fs.readdirSync(cur, { withFileTypes: true }) } catch { continue }
      for (const e of es) {
        if (e.name === ".git") continue
        const p = path.join(cur, e.name)
        if (e.isDirectory()) stack.push(p)
        else if (e.name.endsWith(".erl")) files.push(p)
      }
    }
  }
  files.sort()
  const stride = Math.max(1, Math.floor(files.length / FILE_LIMIT))
  const sample = files.filter((_, i) => i % stride === 0).slice(0, FILE_LIMIT)
  console.log(`corpus draw: ${sample.length} of ${files.length} .erl files from [${CORPORA.join(", ")}]`)

  const analyzers: { name: string; a: any }[] = [{ name: "ER3", a: new RealErlangAnalyzer() }]
  if (AB && fs.existsSync(OLD)) {
    const mod: any = await import(OLD)
    analyzers.push({ name: "pre-ER3", a: new mod.RealErlangAnalyzer() })
  }

  // Read + parse ONCE: the parse is not what is being compared.
  const parsed: { file: string; content: string; root: any }[] = []
  let parseMs = 0
  for (const f of sample) {
    const content = fs.readFileSync(f, "utf8")
    const t0 = Date.now()
    let tree: any
    try { tree = parser.parse(content) } catch { continue }
    parseMs += Date.now() - t0
    parsed.push({ file: path.relative(REPO_ROOT, f), content, root: tree.rootNode })
  }

  // Scaling: ms per 1k lines by file-size quartile. Flat across quartiles means
  // linear in size; a rising curve means a hidden super-linear term.
  {
    const sized = parsed
      .map(({ file, content }) => ({ file, kb: content.length / 1024 }))
      .sort((a, b) => a.kb - b.kb)
    const q = Math.max(1, Math.floor(sized.length / 4))
    const er3: any = analyzers[0].a
    const warm = "f() -> ok.\n"
    er3.analyze(parser.parse(warm)!.rootNode, warm, "w.erl")
    console.log("")
    console.log("scaling — ms per 1k lines by file-size quartile (linear => flat):")
    for (let i = 0; i < 4; i++) {
      const band = sized.slice(i * q, (i + 1) * q)
      if (band.length === 0) continue
      let ms = 0
      let lines = 0
      for (const { file } of band) {
        const hit = parsed.find((p2) => p2.file === file)!
        const lines0 = hit.content.split("\n").length
        const t0 = Date.now()
        er3.analyze(hit.root, hit.content, file)
        ms += Date.now() - t0
        lines += lines0
      }
      const kbLo = band[0].kb.toFixed(1)
      const kbHi = band[band.length - 1].kb.toFixed(1)
      console.log(`| Q${i + 1} | ${band.length} files | ${kbLo}-${kbHi} KB | ${lines} lines | ${ms} ms | ${((ms / lines) * 1000).toFixed(1)} ms/1k |`)
    }
  }

  for (const { name, a } of analyzers) {
    // warm-up so the first-call wasm/JIT cost is not charged to the measurement
    {
      const c = "f() -> ok.\n"
      a.analyze(parser.parse(c)!.rootNode, c, "warm.erl")
    }
    const byCorpus = new Map<string, Row>()
    let ms = 0
    let slowest = { file: "", ms: 0 }
    for (const { file, content, root } of parsed) {
      const corpus = file.split(path.sep)[0]
      const t0 = Date.now()
      const r: any = a.analyze(root, content, file)
      const dt = Date.now() - t0
      ms += dt
      if (dt > slowest.ms) slowest = { file, ms: dt }
      const cur = byCorpus.get(corpus) ?? { corpus, files: 0, bytes: 0, lines: 0, symbols: 0, rels: 0, ms: 0 }
      const lines = content.split("\n").length
      cur.files++
      cur.bytes += content.length
      cur.lines += lines
      cur.symbols += r.symbols.length
      cur.rels += r.relationships.length
      cur.ms += dt
      byCorpus.set(corpus, cur)
    }
    const rows = [...byCorpus.values()].sort((x, y) => x.corpus.localeCompare(y.corpus))
    const f = parsed.length || 1
    const lines = rows.reduce((s, r) => s + r.lines, 0)
    const syms = rows.reduce((s, r) => s + r.symbols, 0)
    const rels = rows.reduce((s, r) => s + r.rels, 0)
    console.log("")
    console.log(`### ${name}`)
    console.log("| corpus | files | KB | lines | symbols | relationships | analyze ms | ms/file | ms/1k lines |")
    console.log("|---|---|---|---|---|---|---|---|---|")
    for (const r of rows) {
      console.log(
        `| ${r.corpus} | ${r.files} | ${Math.round(r.bytes / 1024)} | ${r.lines} | ${r.symbols} | ${r.rels} | ${r.ms} | ${(r.ms / r.files).toFixed(1)} | ${((r.ms / r.lines) * 1000).toFixed(1)} |`,
      )
    }
    console.log("")
    console.log(`${name}: ${f} files, ${lines} lines, ${syms} symbols, ${rels} relationships`)
    console.log(`${name}: analyze ${ms} ms = ${(ms / f).toFixed(1)} ms/file, ${((ms / lines) * 1000).toFixed(1)} ms per 1k lines`)
    console.log(`${name}: slowest file ${slowest.file} ${slowest.ms} ms`)
    console.log(`${name}: volume ${(rels / f).toFixed(1)} relationships + ${(syms / f).toFixed(1)} symbols per file`)
    console.log(`${name}: parse (shared, not compared) ${parseMs} ms = ${(parseMs / f).toFixed(1)} ms/file`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
