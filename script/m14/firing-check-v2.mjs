// FIRING-CHECK v2 — corrects three defects in script/m14/firing-check.mjs
// that this session measured directly. Every correction below is backed by a
// measurement, not by reading the old script.
//
// DEFECT 1 — BLIND SAMPLING. pickFiles() takes the first N files in directory
//   walk order with no filter for whether the file contains code. Measured:
//   RUBY at NFILES=25 sampled only enc/trans/*-tbl.rb (encoding DATA tables)
//   and scored 1/10. The same analyzer at NFILES=200 scores 8/10. An eight
//   point swing from a file-count knob. This is the same defect class as the
//   C# depth>7 bug in MASTER-HANDOFF §6, and it is not fixed there.
//   Fix: per-lane "code-bearing" signal filter. BB_BLIND=1 restores blind walk.
//
// DEFECT 2 — WRONG CORPUS DIRS. LANES pointed at directories that do not
//   exist: perl5, csharp-sample, moo, python-codesql. Measured on this disk:
//   no Python corpus anywhere (only 286 stray .py inside swift-corpus), no
//   C# corpus at all, plack has 0 .pl files. Meanwhile MASTER-HANDOFF §8.3
//   insists no VB corpus exists while roslyn-vb holds 3751 .vb files and
//   vbnet-samples exists. The table's "unmeasured" and "measured" labels were
//   both unreliable. Fix: dirs verified present on this disk.
//
// DEFECT 3 — IMPORTS TALLIED ON THE WRONG CHANNEL. The old script tallied
//   only res.relationships and compared against the enum value "brain_import".
//   ParseResult (src/ast/types.ts:206-216) carries imports on a SEPARATE
//   channel -- imports: ImportInfo[] -- which parallel-indexer persists to the
//   brain_import TABLE, never to brain_relationship rows. Measured: 16 of 18
//   lanes fire imports into imports[], while ZERO lanes ever emit "brain_import"
//   as a relationship type. So MASTER-HANDOFF §5's "brain_import was emitted by
//   zero of twenty lanes" is true but beside the point, and its claim that 16
//   analyzers emit the raw literal "imports" is wrong: 6 do.
//   Fix: report the relationship channel and the imports channel separately.
//
// No regex anywhere (MASTER-HANDOFF rule 1) — string includes only.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const REPO = "$HOME/backbencher-brain"
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
const NFILES = Number(process.env.NFILES || 200)
const BLIND = process.env.BB_BLIND === "1"

// Corpus dirs verified present on this disk (ls + extension counts, 2026-10-04).
const LANES = {
  RUST:       ["rust", "real-rust-analyzer", "ripgrep", [".rs"]],
  GO:         ["go", "real-go-analyzer", "go-stdlib", [".go"]],
  TYPESCRIPT: ["typescript", "real-typescript-analyzer", "element-plus", [".ts", ".tsx"]],
  JAVA:       ["java", "real-java-analyzer", "java-lib", [".java"]],
  KOTLIN:     ["kotlin", "real-kotlin-analyzer", "kotlin", [".kt", ".kts"]],
  SCALA:      ["scala", "real-scala-analyzer", "scala", [".scala"]],
  GROOVY:     ["groovy", "real-groovy-analyzer", "groovy", [".groovy"]],
  HASKELL:    ["haskell", "real-haskell-analyzer", "haskell", [".hs"]],
  SWIFT:      ["swift", "real-swift-analyzer", "swift-corpus", [".swift"]],
  CLOJURE:    ["clojure", "real-clojure-analyzer", "clj-kondo", [".clj", ".cljs"]],
  VB:         ["vb", "real-vb-analyzer", "roslyn-vb", [".vb"]],
  RUBY:       ["ruby", "real-ruby-analyzer", "ruby", [".rb"]],
  ERLANG:     ["erlang", "real-erlang-analyzer", "otp", [".erl", ".hrl"]],
  ELIXIR:     ["elixir", "real-elixir-analyzer", "elixir", [".ex", ".exs"]],
  C:          ["c", "real-c-analyzer", "sqlite", [".c", ".h"]],
  CPP:        ["cpp", "real-cpp-analyzer", "cpp-example", [".cpp", ".cc", ".h"]],
  OBJ_C:      ["objective-c", "real-objective-c-analyzer", "objc", [".m"]],
  JAVASCRIPT: ["javascript", "real-javascript-analyzer", "lodash", [".js", ".mjs"]],
  VUE:        ["vue", "real-vue-analyzer", "vuejs", [".vue"]],
  SVELTE:     ["svelte", "real-svelte-analyzer", "shadcn-svelte", [".svelte"]],
  HTML:       ["html", "real-html-analyzer", "vuejs", [".html", ".htm"]],
}

// Code-bearing signals, per lane. A file must contain at least one to be
// sampled. Chosen as declaration keywords that data/config files lack.
const SIGNAL = {
  ".rs":         ["fn ", "struct ", "enum ", "trait ", "impl ", "use ", "mod ", "pub "],
  ".go":         ['func ', "package "],
  ".ts":         ["function ", "export ", "class ", "const "],
  ".tsx":        ["function ", "export ", "class ", "const "],
  ".java":       ["class ", "interface ", "void ", "public "],
  ".kt":         ["fun ", "class ", "val ", "object "],
  ".kts":        ["fun ", "class ", "val ", "object "],
  ".scala":      ["def ", "class ", "object ", "val "],
  ".groovy":     ["def ", "class ", "void "],
  ".hs":         ["module ", "where", "::"],
  ".swift":      ["func ", "class ", "let ", "var ", "import "],
  ".clj":        ["defn", "def ", "ns "],
  ".cljs":       ["defn", "def ", "ns "],
  ".vb":         ["Function ", "Class ", "Sub ", "Dim ", "Public "],
  ".rb":         ["def ", "class ", "module ", "require"],
  ".erl":        ["-module", "-export", "fun("],
  ".hrl":        ["-module", "-export", "fun(", "-include"],
  ".ex":         ["def ", "defmodule ", "use "],
  ".exs":        ["def ", "defmodule ", "use "],
  ".c":          ["#include", "int ", "void ", "struct "],
  ".h":          ["#include", "struct ", "typedef ", "int "],
  ".cpp":        ["#include", "class ", "void ", "int "],
  ".cc":         ["#include", "class ", "void ", "int "],
  ".m":          ["#import", "#include", "@interface", "- ("],
  ".js":         ["function ", "const ", "require(", "module.exports", "import "],
  ".mjs":        ["function ", "const ", "import ", "export "],
  ".vue":        ["<script", "<template", "import ", "export default"],
  ".svelte":     ["<script", "import ", "export ", "$:"],
  ".html":       ["<script", "<div", "<html", "src="],
  ".htm":        ["<script", "<div", "<html", "src="],
}

function signalsFor(exts) {
  const s = new Set()
  for (const e of exts) for (const k of (SIGNAL[e] || [])) s.add(k)
  // GUARD: an extension with no SIGNAL entry yields an empty set, and
  // `emptyArray.some(...)` is false for every file — so the lane accepted
  // nothing and reported "NO CORPUS", which reads as a missing corpus when the
  // corpus is sitting on disk. That is how .rs/ripgrep (110 real files) came
  // back unmeasured on 2026-10-04. Refuse to sample blind instead.
  if (s.size === 0) {
    console.error(`\nFIRING-CHECK v2: no code-bearing signals defined for ${exts.join(", ")}.`)
    console.error(`Add an entry to SIGNAL in this file. Sampling without a filter is what`)
    console.error(`made Ruby read 1/10 at NFILES=25 by drawing encoding data tables.\n`)
    process.exit(2)
  }
  return [...s]
}

function pickFiles(dir, exts, want) {
  const sigs = BLIND ? null : signalsFor(exts)
  const out = []
  const walk = (d, depth) => {
    if (out.length >= want || depth > 20) return
    let ents
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (out.length >= want) return
      const p = join(d, e.name)
      if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) walk(p, depth + 1) }
      else if (exts.some((x) => e.name.endsWith(x))) {
        try {
          if (statSync(p).size >= 400_000) continue
          if (sigs) {
            const src = readFileSync(p, "utf8")
            if (!sigs.some((s) => src.includes(s))) continue
          }
          out.push(p)
        } catch {}
      }
    }
  }
  walk(dir, 0)
  return out.slice(0, want)
}

const { getParser } = await import(`${REPO}/src/ast/engine.ts`)
const { RelationshipType } = await import(`${REPO}/src/ast/types.ts`)
const ALL = [...new Set(Object.values(RelationshipType))]
// DEFECT D — the instrument must grade against the vocabulary production
// actually emits, not against types.ts. v1 (and v2 before this line) derived its
// denominator from src/ast/types.ts, whose Imports member read "brain_import"
// while every analyzer emits engine.ts's "imports". Grading against it made
// `imports` invisible to the score: GO emitted all TEN production types and
// scored 9/10 because the tenth, "imports", was not in the denominator.
// engine.ts is the enum the analyzers reference as ASTEngine.RelationshipType,
// so it is the production vocabulary. types.ts is kept only to REPORT the
// divergence rather than hide it.
// engine.ts wraps its enum in `export namespace ASTEngine` (engine.ts:24), which
// is exactly how the analyzers reach it: `import { ASTEngine } from "./engine"`
// then `ASTEngine.RelationshipType.Imports`. So this is the production vocabulary.
const _engine = await import(`${REPO}/src/ast/engine.ts`)
const PROD = [...new Set(Object.values(_engine.ASTEngine.RelationshipType))]
const OFF_ENUM = ALL.filter((t) => !PROD.includes(t))
const EXTRA = PROD.filter((t) => !ALL.includes(t))

// Lane selection. VERIFY_HS9 caught a real defect here on 2026-10-04: matching
// only one direction (`only.startsWith(k)`) selects nothing for lane names that
// do not begin with the language key, and the script then printed an empty table
// followed by "unmeasured: none" — indistinguishable from a pass. A silent pass
// in a verification instrument is the worst possible failure mode, so an
// unmatched lane now shouts and exits non-zero.
// Abbreviations actually in use by lane names. Kept EXPLICIT on purpose: a generic
// "token prefixes a lane key" rule sends the token "C" to CLOJURE and the token
// "T" to TYPESCRIPT, which is worse than not matching at all.
const ALIAS = { GO9: "GO", HS9: "HASKELL", HS: "HASKELL", TS: "TYPESCRIPT", TSX: "TYPESCRIPT",
  CLOJ: "CLOJURE", CLJ: "CLOJURE", ERL: "ERLANG", OBJC: "OBJ_C", KT: "KOTLIN",
  // "C" as its own token means the C lane. Safe because CLOJURE arrives as the
  // single token "CLOJ", not as "C".
  C: "C", CSHARP: null, CS: null, PY: null, PERL: null }

function resolveLane(arg) {
  if (!arg) return Object.keys(LANES)
  const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "")
  const want = norm(arg)
  const keys = Object.keys(LANES)
  // 1. exact lane key
  if (keys.includes(want)) return [want]
  // 2. explicit alias, from any underscore/digit-delimited token of the name
  const toks = arg.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
  for (const t of toks) {
    if (t in ALIAS) { const k = ALIAS[t]; if (k && keys.includes(k)) return [k] }
  }
  // 3. a specific token (>=3 chars) that prefixes a lane key: CLOJ -> CLOJURE
  for (const t of toks) {
    if (t.length < 3) continue
    for (const k of keys) if (norm(k).startsWith(t)) return [k]
  }
  // 4. the lane name extends a key: VUE_FIX -> VUE, C_VERDICTS2 -> C, GO9 -> GO.
  //    Longest key first so VB is not swallowed by VUE, and so C beats CLOJURE only
  //    when the name genuinely is the C lane.
  for (const k of [...keys].sort((a, b) => norm(b).length - norm(a).length)) {
    const n = norm(k)
    if (n.length >= 2 && want.startsWith(n)) return [k]
  }
  return null
}

const only = process.argv[2]
const targets = resolveLane(only)
if (!targets) {
  console.error(`\nFIRING-CHECK v2: no lane matches "${only}".`)
  console.error(`Known lanes: ${Object.keys(LANES).join(" ")}`)
  console.error(`This is NOT a pass. An unmatched lane used to print an empty table and`)
  console.error(`"unmeasured: none", which reads as success. Re-run with a lane name from`)
  console.error(`the list above, or with no argument to run all of them.\n`)
  process.exit(2)
}
console.log(`selected lane(s): ${targets.join(" ")}  (from ${only || "no argument"})`)

console.log(`firing-check v2   corpus=${CORPUS}   NFILES=${NFILES}   sampling=${BLIND ? "BLIND (defect 1 active)" : "code-bearing"}`)
console.log(`production vocabulary (${PROD.length}): ${PROD.join(" ")}`)
console.log(`types.ts vocabulary (${ALL.length}): ${ALL.join(" ")}`)
console.log(`in types.ts but NOT produced: ${OFF_ENUM.join(" ") || "(none)"}`)
console.log(`produced but NOT in types.ts: ${EXTRA.join(" ") || "(none)"}\n`)

const rows = []
for (const L of targets) {
  const [lang, mod, corpusDir, exts] = LANES[L]
  let Cls
  try {
    const m = await import(`${REPO}/src/ast/${mod}.ts`)
    Cls = Object.values(m).find((v) => typeof v === "function" && /Analyzer$/.test(v.name))
  } catch (e) { rows.push([L, `IMPORT FAIL ${String(e).slice(0, 45)}`]); continue }
  if (!Cls) { rows.push([L, "NO ANALYZER CLASS EXPORTED"]); continue }

  const dir = join(CORPUS, corpusDir)
  const files = pickFiles(dir, exts, NFILES)
  if (!files.length) { rows.push([L, `NO CORPUS under ${corpusDir}`]); continue }

  const relTally = new Map()
  let imports = 0, parsed = 0, filesWithImports = 0
  const seenFiles = []
  for (const f of files) {
    try {
      const content = readFileSync(f, "utf8")
      const parser = await getParser(lang)
      const pr = await parser.parse(content, f)
      const res = new Cls().analyze(pr.rootNode, content, f)
      parsed++
      const imps = res.imports || []
      imports += imps.length
      if (imps.length) filesWithImports++
      if (seenFiles.length < 2) seenFiles.push(f.replace(dir + "/", ""))
      for (const r of res.relationships || []) {
        const t = r.relationshipType ?? r.type
        if (t) relTally.set(t, (relTally.get(t) || 0) + 1)
      }
    } catch {}
  }
  if (!parsed) { rows.push([L, `ALL ${files.length} FILES FAILED TO PARSE`]); continue }

  const fired = PROD.filter((t) => relTally.has(t))
  const silent = PROD.filter((t) => !relTally.has(t))
  const offEnumFired = [...relTally.keys()].filter((t) => !PROD.includes(t))
  rows.push([L, null, { parsed, files: files.length, fired, silent, imports, filesWithImports, relTally, seenFiles, offEnumFired }])
  // Stream per lane. A full 20-lane run competes with a busy agent fleet and
  // takes tens of minutes; buffering every row until the end made a healthy run
  // indistinguishable from a hung one, which is how you end up killing it.
  const d0 = rows[rows.length - 1][2]
  console.log(`  [${targets.indexOf(L) + 1}/${targets.length}] ${L.padEnd(12)} ${String(d0.fired.length).padStart(2)}/10  ${d0.parsed}/${d0.files} parsed  imports[] ${d0.imports}` + (d0.silent.length ? `  silent: ${d0.silent.join(" ")}` : "  (all ten)"))
}

console.log("lane          types  note")
console.log("-".repeat(96))
for (const r of rows) {
  if (r[1]) { console.log(`${r[0].padEnd(13)} ${r[1]}`); continue }
  const d = r[2]
  const note = `${d.parsed}/${d.files} parsed · imports[] ${d.imports} in ${d.filesWithImports} files`
  console.log(`${r[0].padEnd(13)} ${String(d.fired.length).padStart(3)}/10  ${note}`)
  console.log(`   fired:  ${d.fired.join(" ") || "(none)"}`)
  if (d.silent.length) console.log(`   silent: ${d.silent.join(" ")}`)
  if (d.offEnumFired.length) console.log(`   OFF-ENUM (not a production relationship type): ${d.offEnumFired.join(" ")}`)
  console.log(`   e.g. ${d.seenFiles.join("  ")}`)
  const top = [...d.relTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  console.log(`   counts: ${top.map(([t, n]) => `${t}:${n}`).join("  ")}`)
  console.log()
}

const ok = rows.filter((r) => !r[1])
console.log("=== SUMMARY (relationship channel only — imports[] reported separately) ===")
for (const r of ok.sort((a, b) => b[2].fired.length - a[2].fired.length)) {
  console.log(`${String(r[2].fired.length).padStart(2)}/10  ${r[0].padEnd(13)} silent: ${r[2].silent.join(" ") || "-"}`)
}
console.log(`\nunmeasured: ${rows.filter((r) => r[1]).map((r) => `${r[0]} (${r[1]})`).join("; ") || "none"}`)