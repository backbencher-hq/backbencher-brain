// DOES THE TYPE ACTUALLY FIRE?
// For each lane: run the analyzer through the PRODUCTION path
// (getParser -> parseFile -> analyze) on real corpus files and tally the
// relationship types that actually come out. This is question 2 of the six,
// and it is the one source-derivation cannot answer.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
const REPO = "$HOME/backbencher-brain"
const CORPUS = "$HOME/fixtures/repositories"

const LANES = {
  RUST:        ["rust", "real-rust-analyzer", "ripgrep"],
  PYTHON:      ["python", "real-python-analyzer", "python-codesql"],
  GO:          ["go", "real-go-analyzer", "go-stdlib"],
  KOTLIN:      ["kotlin", "real-kotlin-analyzer", "kotlin"],
  SCALA:       ["scala", "real-scala-analyzer", "scala"],
  GROOVY:      ["groovy", "real-groovy-analyzer", "groovy"],
  HASKELL:     ["haskell", "real-haskell-analyzer", "haskell"],
  SWIFT:       ["swift", "real-swift-analyzer", "swift-corpus"],
  PERL:        ["perl",         "real-perl-analyzer",         "perl5"],
  CLOJURE:     ["clojure", "real-clojure-analyzer", "clj-kondo"],
  CSHARP:      ["csharp", "real-csharp-analyzer", "csharp-sample"],
  JAVA:        ["java", "real-java-analyzer", "java-lib"],
  OBJECTIVE_C: ["objective-c", "real-objective-c-analyzer", "objc"],
  TYPESCRIPT:  ["typescript", "real-typescript-analyzer", "typescript"],
  JAVASCRIPT:  ["javascript", "real-javascript-analyzer", "lodash"],
  ELIXIR:      ["elixir", "real-elixir-analyzer", "elixir"],
  CPP:         ["cpp", "real-cpp-analyzer", "cpp-example"],
  RUBY:        ["ruby", "real-ruby-analyzer", "ruby"],
  ERLANG:      ["erlang", "real-erlang-analyzer", "otp"],
  C:           ["c", "real-c-analyzer", "sqlite"],
}

function pickFiles(dir, exts, want, cap = 40) {
  const out = []
  const walk = (d, depth) => {
    if (out.length >= want || depth > 4) return
    let ents; try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (out.length >= want) return
      const p = join(d, e.name)
      if (e.isDirectory()) { if (!/node_modules|\.git|testdata|fixtures/.test(e.name)) walk(p, depth + 1) }
      else if (exts.some((x) => e.name.endsWith(x))) {
        try { if (statSync(p).size < 400_000) out.push(p) } catch {}
      }
    }
  }
  walk(dir, 0); return out.slice(0, cap)
}

const { getParser } = await import(`${REPO}/src/ast/engine.ts`)
const { RelationshipType } = await import(`${REPO}/src/ast/types.ts`)
const ALL = [...new Set(Object.values(RelationshipType))]
console.log(`enum has ${ALL.length} types: ${ALL.join(" ")}\n`)

const lane = process.argv[2]
const targets = lane && lane !== "all" ? [lane] : Object.keys(LANES)
const report = []
for (const L of targets) {
  const [lang, mod, corpusDir] = LANES[L]
  let modPath, Cls
  try {
    modPath = `${REPO}/src/ast/${mod}.ts`
    const m = await import(modPath)
    Cls = Object.values(m).find((v) => typeof v === "function" && /Analyzer$/.test(v.name))
  } catch (e) { report.push([L, `IMPORT FAIL ${String(e).slice(0, 60)}`, 0, []]); continue }
  if (!Cls) { report.push([L, "NO ANALYZER CLASS EXPORTED", 0, []]); continue }

  const dir = join(CORPUS, corpusDir)
  const exts = { rust: [".rs"], python: [".py"], go: [".go"], kotlin: [".kt", ".kts"], scala: [".scala"],
    groovy: [".groovy"], haskell: [".hs"], swift: [".swift"], perl: [".pl", ".pm"], clojure: [".clj", ".cljs"],
    csharp: [".cs"], java: [".java"], "objective-c": [".m"], typescript: [".ts", ".tsx"], javascript: [".js", ".mjs"],
    elixir: [".ex", ".exs"], cpp: [".cpp", ".cc", ".h"], ruby: [".rb"], erlang: [".erl", ".hrl"], c: [".c", ".h"] }[lang] || []
  const files = pickFiles(dir, exts, 12)
  if (!files.length) { report.push([L, `NO CORPUS under ${corpusDir}`, 0, []]); continue }

  const tally = new Map(), errs = []
  let parsed = 0
  for (const f of files) {
    try {
      const content = readFileSync(f, "utf8")
      const parser = await getParser(lang)
      const pr = await parser.parse(content, f)   // tree-sitter parse
      const res = new Cls().analyze(pr.rootNode, content, f)
      parsed++
      for (const r of res.relationships || []) {
        const t = r.relationshipType ?? r.type
        if (!t) continue
        tally.set(t, (tally.get(t) || 0) + 1)
      }
    } catch (e) { errs.push(String(e).slice(0, 40)) }
  }
  const fired = [...tally.entries()].filter(([, n]) => n > 0).map(([t]) => t).sort()
  report.push([L, errs.length && !parsed ? `ALL ${files.length} FILES FAILED: ${errs[0]}` : `${parsed}/${files.length} parsed`, tally.size, fired, tally])
}
for (const [L, note, n, fired, tally] of report) {
  console.log(`${L.padEnd(13)} ${String(n).padStart(2)} types fired   ${note}`)
  if (fired?.length) console.log(`   ${fired.map((t) => `${t}:${tally.get(t)}`).join("  ")}`)
  const silent = ALL.filter((t) => !fired?.includes(t))
  if (silent.length) console.log(`   SILENT (constructible but produced nothing): ${silent.join(" ")}`)
  console.log()
}
