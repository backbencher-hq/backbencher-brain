// tmp-ex2-corpus.ts — EX2 corpus metrics, run BEFORE and AFTER the fixes.
// Walks the pinned elixir + phoenix corpora, runs the RAW analyzer, and
// counts exactly the classes the EX2 fixes must move:
//   danglingAliasTargets  — instantiates/implements edge whose bare target
//                           matches the tail of a dotted symbol in the file
//                           (the U1 dangling-edge class) — must drop to ~0.
//   bareFnCallSources     — calls edge sourced by a bare non-module name
//                           (the U2 collision class) — must drop to ~0.
//   singleLetterTypePhantoms — Type symbols named one lowercase letter
//                           (the U4 fabrication class) — must drop to ~0.
//   fakeOtpPatternFiles   — OTP pattern set without an exact `use
//                           GenServer/Supervisor` reference (U3 class).
// Usage: bun run script/tmp-ex2-corpus.ts <before|after>
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const MODE = process.argv[2] ?? "run"
const REPOS: Record<string, string> = {
  elixir: "$HOME/fixtures/repositories/elixir",
  phoenix: "$HOME/fixtures/repositories/phoenix",
}
const CAP = 250

const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm")))
const parser = new ParserClass()
parser.setLanguage(g)
const mod: any = await import("../src/ast/real-elixir-analyzer")
const analyzer = new mod.RealElixirAnalyzer()

function walk(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return acc }
  for (const e of entries) {
    const fp = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === ".git" || e.name === "_build" || e.name === "deps") continue
      walk(fp, acc)
    } else if (e.name.endsWith(".ex") || e.name.endsWith(".exs")) acc.push(fp)
  }
  return acc
}

const out: any = { mode: MODE, at: new Date().toISOString(), repos: {} }
for (const [name, repo] of Object.entries(REPOS)) {
  const files = walk(repo).sort().slice(0, CAP)
  const m: any = {
    files: files.length, ms: 0, symbols: 0, relationships: 0, linedRels: 0,
    danglingAliasTargets: 0, danglingSamples: [] as string[],
    bareFnCallSources: 0, bareSamples: [] as string[],
    singleLetterTypePhantoms: 0, phantomSamples: [] as string[],
    fakeOtpPatternFiles: 0, fakeSamples: [] as string[],
  }
  const t0 = performance.now()
  for (const f of files) {
    let res: any
    try {
      const src = fs.readFileSync(f, "utf8")
      res = analyzer.analyze(parser.parse(src).rootNode, src, f)
    } catch { continue }
    m.symbols += res.symbols.length
    m.relationships += res.relationships.length
    for (const r of res.relationships) if (typeof r.line_number === "number") m.linedRels++
    const rel = f.replace(/^.*repositories\//, "")
    const names: string[] = res.symbols.map((s: any) => s.name)
    const nameSet = new Set(names)
    const moduleNames = new Set(names.filter((n: string) => n.indexOf(".") !== -1 || /^[A-Z]/.test(n)))
    // U1: bare instantiates/implements targets whose full form exists in-file
    for (const r of res.relationships) {
      if ((r.type === "instantiates" || r.type === "implements") && typeof r.target === "string" &&
          r.target.indexOf(".") === -1 && /^[A-Z]/.test(r.target)) {
        const full = names.some((n) => n.endsWith("." + r.target))
        if (full) {
          m.danglingAliasTargets++
          if (m.danglingSamples.length < 8) m.danglingSamples.push(`${rel}: ${r.source} -[${r.type}]-> ${r.target}`)
        }
      }
    }
    // U2: calls edges sourced by a bare name that is not a declared module
    for (const r of res.relationships) {
      if (r.type === "calls" && typeof r.source === "string" && r.source.indexOf(".") === -1 && r.source !== "Global" && !moduleNames.has(r.source)) {
        m.bareFnCallSources++
        if (m.bareSamples.length < 8) m.bareSamples.push(`${rel}: ${r.source} -> ${r.target}`)
      }
    }
    // U4: single-lowercase-letter Type symbols (the fabrication class)
    for (const s of res.symbols) {
      if (s.kind === "type" && /^[a-z]$/.test(s.name)) {
        m.singleLetterTypePhantoms++
        if (m.phantomSamples.length < 8) m.phantomSamples.push(`${rel}: type ${s.name}`)
      }
    }
    // U3: OTP patterns without an exact `use GenServer/Supervisor`
    const targets = new Set(res.relationships.map((r: any) => r.target))
    const pats: string[] = res.metadata?.patterns ?? []
    if (pats.includes("Supervision Trees") && !targets.has("Supervisor")) {
      m.fakeOtpPatternFiles++
      if (m.fakeSamples.length < 8) m.fakeSamples.push(`${rel}: Supervision Trees w/o use Supervisor`)
    }
  }
  m.ms = Math.round(performance.now() - t0)
  out.repos[name] = m
}
const dest = path.join("/tmp/bb-ex2", `corpus-${MODE}.json`)
fs.writeFileSync(dest, JSON.stringify(out, null, 1))
console.log(JSON.stringify(out, null, 1))
console.log(`\n(written to ${dest})`)
process.exit(0)
