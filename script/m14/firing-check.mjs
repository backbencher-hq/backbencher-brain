// DOES THE TYPE ACTUALLY FIRE?
// For each lane: run the analyzer through the PRODUCTION path
// (getParser -> parseFile -> analyze) on real corpus files and tally the
// relationship types that actually come out. This is question 2 of the six,
// and it is the one source-derivation cannot answer.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
// Resolved from THIS file's location, not hardcoded. It was
// "$HOME/backbencher-brain", which does not exist on this laptop
// ($HOME/mcp/backbencher-brain) — so the instrument the programme mandates for
// coverage claims could not run here at all, and every laptop-B lane number came from
// source derivation instead. 57 scripts in this tree carry the same hardcoded path;
// this one is fixed because it is the arbiter. Override with BB_REPO if ever needed.
const REPO = process.env.BB_REPO || join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"

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
  VISUAL_BASIC:["vb", "real-vb-analyzer", "moo"],
  VUE:         ["vue", "real-vue-analyzer", "vuejs"],
  SVELTE:      ["svelte", "real-svelte-analyzer", "shadcn-svelte"],
  HTML:        ["html", "real-html-analyzer", "vuejs"],

  // ── LAPTOP B — 23 lanes, added 2026-10-09. They were absent from this map entirely,
  // so every B lane's coverage number came from source derivation while this instrument
  // (the only one that answers "does it FIRE") could not run for them at all.
  //
  // Corpus chosen by MEASUREMENT, not by name: one pass over fixtures/repositories
  // (199 repos, 371,015 files) picking the repo holding the most files of the lane's
  // extensions. The number after each entry is that count. `clean` is the one thin lane
  // (109 files in Clyde, 74 in clean-stdlib) — measured, not assumed.
  BASH:        ["bash", "real-bash-analyzer", "bash-completion"],       // 556
  FSHARP_B:    ["fsharp", "real-fsharp-analyzer", "fsharp"],            // 5,057
  ZIG:         ["zig", "real-zig-analyzer", "zig"],                     // 2,946
  LUA:         ["lua", "real-lua-analyzer", "kong"],                    // 1,155
  JULIA:       ["julia", "real-julia-analyzer", "julia"],               // 921
  NIM:         ["nim", "real-nim-analyzer", "nim"],                     // 3,907
  PHP:         ["php", "real-php-analyzer", "phpunit"],                 // 2,535
  POWERSHELL:  ["powershell", "real-powershell-analyzer", "powershell"],// 500
  R_LANG:      ["r", "real-r-analyzer", "ggplot2"],                     // 360
  DART:        ["dart", "real-dart-analyzer", "dart-sdk"],              // 22,348
  SQL:         ["sql", "real-sql-analyzer", "duckdb"],                  // 594
  GRAPHQL:     ["graphql", "real-graphql-analyzer", "gql-gqlgen"],      // 141
  PROTOBUF:    ["protobuf", "real-protobuf-analyzer", "pb-googleapis"], // 128
  JSON_B:      ["json", "real-json-analyzer", "shadcn-svelte"],         // 2,349
  YAML:        ["yaml", "real-yaml-analyzer", "ansible"],               // 1,610
  CSS_B:       ["css", "real-css-analyzer", "pico"],                    // 238
  SCSS:        ["scss", "real-scss-analyzer", "bulma"],                 // 179
  HCL:         ["hcl", "real-hcl-analyzer", "terragrunt"],              // 2,283
  MAKE:        ["make", "real-makefile-analyzer", "otp"],               // 342
  TOML_B:      ["toml", "real-toml-analyzer", "cargo"],                 // 431
  XML_B:       ["xml", "real-xml-analyzer", "libxslt"],                 // 538
  MARKDOWN_B:  ["markdown", "real-markdown-analyzer", "redwood"],       // 2,082
  CLEAN_B:     ["clean", "real-clean-analyzer", "Clyde"],               // 109 (THIN)
}

/**
 * Files to measure: an even STRIDE across the whole population, not the first N.
 *
 * Why this changed: the previous version returned as soon as it had `want` files, i.e. the
 * first N in directory order. Measured on the SQL lane's corpus (duckdb, 594 files): the
 * first 120 are benchmark query files (benchmark/<suite>/queries/) SELECTs, and only **5 of 120 (4.2%)** contain
 * any CREATE/ALTER/DROP, against **108 of 594 (18.2%)** corpus-wide. Every type whose
 * construct lives in DDL therefore COULD NOT FIRE in the default sample — `contains` was
 * reported silent on 120 files while firing 1,070 edges with 1,070 resolved on all 594.
 * A "SILENT" column produced by file order is not a finding about the analyzer.
 *
 * The walk now collects a bounded population, sorts it (deterministic), and strides evenly
 * across it, so the sample is representative by construction and the population size is
 * printed with every row — an instrument must declare its population.
 */
function pickFiles(dir, exts, want, cap = 400) {
  const POP_CAP = Number(process.env.BB_SAMPLE_POP || 20000)
  const all = []
  const walk = (d, depth) => {
    if (all.length >= POP_CAP || depth > 20) return
    let ents; try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (all.length >= POP_CAP) return
      const p = join(d, e.name)
      if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) walk(p, depth + 1) }
      else if (exts.some((x) => e.name.endsWith(x))) {
        try { if (statSync(p).size < 400_000) all.push(p) } catch {}
      }
    }
  }
  walk(dir, 0)
  all.sort()
  if (all.length <= want) return all.slice(0, cap)
  const stride = all.length / want
  const out = []
  for (let i = 0; i < want; i++) out.push(all[Math.floor(i * stride)])
  return [...new Set(out)].slice(0, cap)
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
    vb: [".vb", ".bas", ".frm", ".cls"], vue: [".vue"], svelte: [".svelte"], html: [".html", ".htm"], css: [".css"],
    csharp: [".cs"], java: [".java"], "objective-c": [".m"], typescript: [".ts", ".tsx"], javascript: [".js", ".mjs"],
    bash: [".sh", ".bash"], fsharp: [".fs", ".fsi", ".fsx"], zig: [".zig"], lua: [".lua"],
    julia: [".jl"], nim: [".nim"], php: [".php"], powershell: [".ps1", ".psm1"], r: [".r", ".R"],
    dart: [".dart"], sql: [".sql"], graphql: [".graphql", ".gql"], protobuf: [".proto"], json: [".json"],
    yaml: [".yml", ".yaml"], scss: [".scss"], hcl: [".hcl", ".tf"], make: ["Makefile", ".mk"],
    toml: [".toml"], xml: [".xml"], markdown: [".md"], clean: [".icl", ".dcl"],
    elixir: [".ex", ".exs"], cpp: [".cpp", ".cc", ".h"], ruby: [".rb"], erlang: [".erl", ".hrl"], c: [".c", ".h"] }[lang] || []
  const files = pickFiles(dir, exts, Number(process.env.NFILES||120))
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
  report.push([L, errs.length && !parsed ? `ALL ${files.length} FILES FAILED: ${errs[0]}` : `${parsed}/${files.length} parsed (sample of the corpus, even stride)`, tally.size, fired, tally])
}
for (const [L, note, n, fired, tally] of report) {
  console.log(`${L.padEnd(13)} ${String(n).padStart(2)} types fired   ${note}`)
  if (fired?.length) console.log(`   ${fired.map((t) => `${t}:${tally.get(t)}`).join("  ")}`)
  const silent = ALL.filter((t) => !fired?.includes(t))
  if (silent.length) console.log(`   SILENT (constructible but produced nothing): ${silent.join(" ")}`)
  console.log()
}
