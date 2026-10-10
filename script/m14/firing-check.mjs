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
  //
  // THOSE COUNTS WERE TAKEN UNDER THE BROKEN ADMISSION RULE and four of them are short by
  // the `.github` files it pruned (fixed in pickFiles, 2026-10-09). Re-measured over the
  // same 23 repos with the same extension sets and the same 400 KB cap, exact-name pruning:
  // only `fsharp` 6,611 (+6), `powershell` 506 (+5), `yaml` 2,082 (+5) and `markdown`
  // 2,105 (+4) move; the other nineteen are identical. The per-entry comments are left
  // AS MEASURED rather than rewritten, because a population that changed under a fix is
  // itself evidence — and the instrument PRINTS the population it used on every run, which
  // is the number to quote. See `validation/m14/results/corpus-populations-admission-fix.txt`.
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
  MARKDOWN_B:  ["markdown", "real-markdown-analyzer", "redwood"],       // 2,105 (.md under 400 KB, incl. .github — see the admission fix in pickFiles)
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
 *
 * AND IT MUST NOT TRUNCATE IN SILENCE. `cap` (400 by default) silently clipped BOTH the
 * "population fits" branch and the strided branch, so `NFILES=600` on a 556-file corpus
 * reported `400/400 parsed (sample of the corpus, even stride)` — a full-population request
 * answered with 72% of the files, described as a stride. Measured on bash, 2026-10-09: the
 * difference was `exports` and `overrides` reading SILENT, and they are still silent over the
 * other 156, but nothing in the output said the sample was smaller than asked for. The cap is
 * kept (it bounds wasm memory) and is now DISCLOSED with both numbers.
 */
function pickFiles(dir, exts, want, cap = Number(process.env.BB_PICK_CAP || 400)) {
  const POP_CAP = Number(process.env.BB_SAMPLE_POP || 20000)
  const all = []
  const walk = (d, depth) => {
    if (all.length >= POP_CAP || depth > 20) return
    let ents; try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (all.length >= POP_CAP) return
      const p = join(d, e.name)
      // `.github` IS NOT `.git`. This read `/node_modules|\.git/`, a SUBSTRING test, so it pruned
      // every directory whose NAME contains `.git` — `.github`, `.gitlab`, `.gitbook`. Measured on
      // the markdown lane's corpus: redwood has 2,105 `.md` files and this walk admitted 2,101; the
      // 4 it dropped are `/.github/actions/*/README.md`. The census the lane built replicates this
      // rule exactly and records 2,101, so the loss was invisible in BOTH instruments at once —
      // which is what a shared admission rule buys you when it is wrong.
      //
      // A file inside `.github/` is ordinary project content (CI configs, contribution guides,
      // reusable-action docs) and it belongs in the population. The vendor and VCS directories are
      // excluded by EXACT NAME, so no future `.git*` directory is silently pruned by a substring.
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".git") walk(p, depth + 1) }
      else if (exts.some((x) => e.name.endsWith(x))) {
        try { if (statSync(p).size < 400_000) all.push(p) } catch {}
      }
    }
  }
  walk(dir, 0)
  all.sort()
  // `requested` is what the caller asked for; `all.length` is the admitted population. Both are
  // returned so the report can say when the cap, not the corpus, decided the sample size.
  //
  // A STRIDE, WHATEVER THE ARITHMETIC WORKS OUT TO. This branch used to read `all.slice(0, cap)` —
  // a DIRECTORY-ORDER PREFIX — so the moment the request met or exceeded the population the walk
  // silently reverted to the exact sampling the stride was introduced to end. `bash`'s whole-corpus
  // census recorded the consequence: "export sites @ 0, redefinitions @ 1271 (the instrument reaches
  // index < 120)". The stride must therefore be computed from `min(want, all.length)` and applied on
  // BOTH branches, so `NFILES >= corpus` still walks the corpus instead of its first 400 files.
  const stride = all.length / Math.min(want, all.length)
  const out = []
  for (let i = 0; i < Math.min(want, all.length); i++) out.push(all[Math.floor(i * stride)])
  const picked = [...new Set(out)].slice(0, cap)
  return { files: picked, admitted: all.length, requested: want, capped: picked.length < Math.min(want, all.length) }
}

// ── THE PRODUCTION PATH IS `parseFile`, NOT `parse` + `analyze` (corrected 2026-10-09)
//
// This instrument's header has always said it runs "the PRODUCTION path
// (getParser -> parseFile -> analyze)". It did not. Until this commit the loop called
// `getParser(lang)`, `parser.parse(content, f)` and `new Cls().analyze(rootNode, content, f)`
// directly — which is the ANALYZER path, not the production path. `ASTEngine.parseFile`
// does four things that loop never did:
//
//   1. builds the AnalyzeContext (vue/svelte SFC script trees, html embedded blocks,
//      markdown's companion INLINE grammar trees);
//   2. detects the language from the path instead of trusting the caller;
//   3. runs the analyzer under a timeout and, on a WASM trap, falls back to REGEX
//      extraction with `metadata.fallback === true`;
//   4. reports the second silent crash path (`metadata.analysisVersion === "2.0-basic-fallback"`).
//
// The consequence was measured, not argued, on the markdown lane (`.tmp-probe/md-path-probe.mts`,
// 60 files drawn by the same even stride, both paths over the SAME files in one process):
//
//   BARE (this instrument, before)  contains:2070
//   PROD (engine.parseFile)         contains:2070   uses:759   references:31
//
// `uses` is the ONLY edge type by which a markdown document declares where it points, it is
// emitted by the inline-companion half of the analyzer, and this instrument could not see it at
// all — so the board read markdown as `1 types fired` against its own lane doc's `uses` evidence.
// A context-dependent lane measured on this path is under-measured BY CONSTRUCTION.
//
// The fix is to call `parseFile` and take the relationships it returns. The tally stays
// relationship-type-keyed, and a file the engine DEGRADED (regex fallback, or the basic-fallback
// crash path) is now counted and disclosed instead of silently becoming evidence that the
// analyzer emits nothing.
const { parseFile } = await import(`${REPO}/src/ast/engine.ts`)
const { RelationshipType } = await import(`${REPO}/src/ast/types.ts`)
const ALL = [...new Set(Object.values(RelationshipType))]
console.log(`enum has ${ALL.length} types: ${ALL.join(" ")}\n`)

// ── THE INSTRUMENT'S OWN CONTROL ──────────────────────────────────────────────
// Rule-book §7: a guard with no live hits must be shown firing on a planted case, and
// §"a gate that cannot fail is not a gate". The defect corrected above was invisible for
// exactly one reason: nothing here could tell the two paths apart. This control parses a
// PLANTED document — a markdown heading plus a link, whose `uses` edge exists only when
// the engine has built the companion inline context — through `parseFile`, and REFUSES TO
// REPORT if that edge does not come out. It gives the same answer on every machine because
// it needs no corpus, and it fails loudly rather than printing a table no one can trust.
if (process.env.BB_FIRING_SKIP_CONTROL !== "1") {
  const planted = "# Probe\n\nSee [the target](./target.md) and <https://example.invalid/x>.\n"
  let ok = false, got = ""
  try {
    const r = await parseFile(`${REPO}/.firing-check-control.md`, planted)
    const types = (r.relationships ?? []).map((x) => x.relationshipType ?? x.type).filter(Boolean)
    got = [...new Set(types)].sort().join(" ")
    ok = types.includes("uses")
  } catch (e) { got = `THREW ${String(e).slice(0, 60)}` }
  console.log(`instrument self-test: ${ok ? "PASS" : "FAIL"} — planted markdown link through parseFile: uses ${ok ? "FIRED" : "DID NOT FIRE"} (types seen: ${got || "(none)"})`)
  console.log(`instrument self-test: population is the corpus sample below; a SILENT type is a claim about THESE files, not the language\n`)
  if (!ok) { console.error("firing-check CONTROL FAILED — the parseFile path did not surface a markdown `uses` edge, so this run's SILENT column cannot be trusted. Refusing to report."); process.exit(3) }
}

const lane = process.argv[2]
const targets = lane && lane !== "all" ? [lane] : Object.keys(LANES)
const report = []
for (const L of targets) {
  const [lang, mod, corpusDir] = LANES[L]
  // The ANALYZER still has to exist and export a class — that check is kept, because
  // "NO ANALYZER CLASS EXPORTED" is a different finding from "the engine fell back".
  let Cls
  try {
    const m = await import(`${REPO}/src/ast/${mod}.ts`)
    Cls = Object.values(m).find((v) => typeof v === "function" && /Analyzer$/.test(v.name))
  } catch (e) { report.push([L, `IMPORT FAIL ${String(e).slice(0, 60)}`, 0, [], new Map(), 0, 0]); continue }
  if (!Cls) { report.push([L, "NO ANALYZER CLASS EXPORTED", 0, [], new Map(), 0, 0]); continue }

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
  const picked = pickFiles(dir, exts, Number(process.env.NFILES||120))
  const files = picked.files
  if (!files.length) { report.push([L, `NO CORPUS under ${corpusDir}`, 0, [], new Map(), 0, 0]); continue }

  const tally = new Map(), errs = []
  let parsed = 0, degraded = 0
  for (const f of files) {
    try {
      const content = readFileSync(f, "utf8")
      // THE PRODUCTION PATH. `parseFile` detects the language from the path, builds the
      // AnalyzeContext, and returns the analyzer's own relationships.
      const res = await parseFile(f, content)
      const md = res?.metadata ?? {}
      // A DEGRADED file is not analyzer evidence. `fallback` is set by the regex
      // extraction path in parseFile's catch; "2.0-basic-fallback" is the signature of
      // the analyzer timing out or blowing the JS stack (0 symbols, no `fallback`).
      const isDegraded = md.fallback === true || md.analysisVersion === "2.0-basic-fallback"
      if (isDegraded) { degraded++; errs.push(`degraded:${String(md.fallbackReason ?? md.analysisVersion).slice(0, 30)}`); continue }
      parsed++
      for (const r of res.relationships || []) {
        const t = r.relationshipType ?? r.type
        if (!t) continue
        tally.set(t, (tally.get(t) || 0) + 1)
      }
    } catch (e) { errs.push(String(e).slice(0, 40)) }
  }
  const fired = [...tally.entries()].filter(([, n]) => n > 0).map(([t]) => t).sort()
  const shape = picked.capped
    ? `${parsed}/${files.length} parsed — CAPPED: asked for ${picked.requested} of ${picked.admitted} admitted, the 400-file cap decided the sample`
    : `${parsed}/${files.length} parsed (sample of the corpus, even stride)`
  const note = errs.length && !parsed ? `ALL ${files.length} FILES FAILED: ${errs[0]}`
    : shape
      + (degraded > 0 ? `  [${degraded} DEGRADED — regex fallback / basic-fallback, excluded, not analyzer evidence]` : "")
  report.push([L, note, tally.size, fired, tally, degraded, files.length])
}
for (const [L, note, n, fired, tally, degraded] of report) {
  console.log(`${L.padEnd(13)} ${String(n).padStart(2)} types fired   ${note}`)
  if (fired?.length) console.log(`   ${fired.map((t) => `${t}:${tally.get(t)}`).join("  ")}`)
  const silent = ALL.filter((t) => !fired?.includes(t))
  if (silent.length) console.log(`   SILENT (constructible but produced nothing): ${silent.join(" ")}`)
  console.log()
}
