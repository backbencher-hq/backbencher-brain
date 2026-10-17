/**
 * M14.0.F8 — Corpus-Census Gate
 *
 * The haskell wave proved that F5 can read 100%/0/0 while four defect
 * classes are live — because the differential oracle MIRRORS the analyzer,
 * shared holes stay green. The census (every parse-tree node type occurring
 * in real corpus code vs. every type the spec classified) is what exposed
 * them. This gate makes that census permanent and mandatory.
 *
 * Per gated language:
 *   - parse up to CENSUS_FILES real files from the language's F5 corpus repo
 *   - collect every node type occurring in those parse trees (named types)
 *   - classify each against spec.handled_verified / internal_silent / gap /
 *     design_decision (grammar-internal `_`-prefixed types excluded)
 *   - any occurring-but-unclassified type is a BLIND SPOT: the analyzer and
 *     oracle may both silently skip real code shapes — exactly the haskell
 *     failure mode. Gate fails until the type is classified (or genuinely
 *     handled).
 *
 * Usage:
 *   bun run script/m14/verify-corpus-census.ts               # all gated langs
 *   bun run script/m14/verify-corpus-census.ts --lang python
 *   bun run script/m14/verify-corpus-census.ts --files 100
 *
 * Evidence: validation/m14/results/M14.0.F8.json
 */

import * as fs from "fs"
import * as path from "path"
import { resolveCorpusRoot } from "../lib/corpus-root.ts"
import { fileURLToPath } from "node:url"

// `__dirname` / `__filename` do not exist in an ES module, and package.json
//  declares "type": "module". Reaching for one here means this file dies at LOAD
//  with a ReferenceError, prints a stack trace, and runs no check at all — while
//  `tsc` stays silent, because @types/node declares both.
//  The repo already has the idiom (script/m14/html-ontology-census.ts):
//    const SELF = fileURLToPath(import.meta.url)
//  which is correct under tsx, bun and plain node alike.
const SELF_PATH = fileURLToPath(import.meta.url)
const HERE = path.dirname(SELF_PATH)
const ROOT = path.resolve(HERE, "..", "..")
const SPEC_DIR = path.join(ROOT, "script", "m14", "spec")
const WASM_DIR = path.join(ROOT, "wasm")
// Was: the literal foreign corpus root "$HOME/fixtures/repositories" — see script/lib/corpus-root.ts.
const CORPUS_ROOT = resolveCorpusRoot(process.cwd()) ?? "CORPUS_ROOT_UNRESOLVED"
const EVIDENCE = path.join(ROOT, "validation", "m14", "results", "M14.0.F8.json")
const CENSUS_FILES = process.argv.includes("--files") ? parseInt(process.argv[process.argv.indexOf("--files") + 1]) : 60

// `repo` is a LIST of accepted spellings, because the spelling is a property of the
// corpus ROOT and not of this file. Go is the language that proves it: the corpus on
// the root this repo resolves is `go-tools` WITH A HYPHEN, and `go_tools` does not
// exist there — which is why script/m14/differential.ts (the sibling that hit the same
// directory) already carries the measured ruling. A single hardcoded name made this
// gate print `SKIP (corpus repo missing: go_tools)` and count go as a blind spot while
// the corpus sat on disk the whole time. The first spelling that EXISTS wins, and the
// one that was measured is printed and recorded.
const GATED: Record<string, { wasm: string; ext: string[]; repo: string | string[] }> = {
  // M14 (#288): html joins the census. This gate is the one that finds a node type
  // the CORPUS actually produces which the analyzer AND the oracle both skip — the
  // blind-spot class no fixture can see, because a fixture is written from what its
  // author already knew to write. html's census is what found the five
  // internal_silent rows and confirmed the twelve handled ones are the whole real
  // surface. `otp` is the same corpus the F5 lane uses, and both spellings are
  // declared because `language-detection.ts` routes `.htm` to the same analyzer.
  html: { wasm: "tree-sitter-html.wasm", ext: [".html", ".htm"], repo: "otp" },
  java: { wasm: "tree-sitter-java.wasm", ext: [".java"], repo: "grails-core" },
  groovy: { wasm: "tree-sitter-groovy.wasm", ext: [".groovy"], repo: "grails-core" },
  kotlin: { wasm: "tree-sitter-kotlin.wasm", ext: [".kt"], repo: "Exposed" },
  scala: { wasm: "tree-sitter-scala.wasm", ext: [".scala"], repo: "scala3" },
  typescript: { wasm: "tree-sitter-typescript.wasm", ext: [".ts"], repo: "vue-core" },
  javascript: { wasm: "tree-sitter-javascript.wasm", ext: [".js"], repo: "grails-core" },
  vue: { wasm: "tree-sitter-vue.wasm", ext: [".vue"], repo: "element-plus" },
  svelte: { wasm: "tree-sitter-svelte.wasm", ext: [".svelte"], repo: "svelte" },
  // CSS is measured against the svelte repo for the same reason svelte is: the
  // .css files are tracked, non-empty except for one named file, and — unlike a
  // synthetic sample — they are the corpus the M12 lane and the M59 line oracle
  // already run on, so a census finding can be checked against those artifacts
  // instead of needing a new corpus. This is the gate that finds a node type the
  // CORPUS produces which the analyzer AND the oracle both skip: a fixture is
  // written from what its author already knew to write, so only the corpus can see
  // that shape. For CSS it confirms all 94 distinct types the corpus produces are
  // covered by script/m14/spec/css-completeness.json.
  css: { wasm: "tree-sitter-css.wasm", ext: [".css"], repo: "svelte" },
  // scss joins the census on `element-plus`, NOT on svelte. That is deliberate and it
  // is the opposite choice from css: `.scss` files exist in 4 corpora and 170 of the
  // 254 are element-plus, which is also the HARD one — 90 of 160 parse clean after
  // the two grammar patches, against 52 of 74 for phpmyadmin. Pointing the census at
  // an easy corpus would confirm the lane against the shapes it already handles.
  //
  // F8 is the gate that finds a node type the CORPUS produces which the analyzer AND
  // the oracle both skip — a fixture is written from what its author already knew to
  // write, so only the corpus can see a shape nobody thought to pin.
  scss: { wasm: "tree-sitter-scss.wasm", ext: [".scss"], repo: "element-plus" },
  c: { wasm: "tree-sitter-c.wasm", ext: [".c", ".h"], repo: "sqlite" },
  cpp: { wasm: "tree-sitter-cpp.wasm", ext: [".cc", ".cpp", ".h", ".hpp"], repo: "fmt" },
  rust: { wasm: "tree-sitter-rust.wasm", ext: [".rs"], repo: "ripgrep" },
  // The corpus directory is go_tools (underscore), not go-tools. Every gate that
  //  asked for the hyphen form was reading a directory that has never existed on any
  //  machine, so the corpus leg passed VACUOUSLY — no error, no finding, nothing
  //  measured. script/m13/verify-analyze-e2e-corpus.ts reported exactly this once the
  //  corpus root was fixed: "corpus go-tools/go/analysis/passes (Go): present … missing".
  //  Verified against the corpus on disk, which lists go_tools.
  //
  // MEASURED on this root, 2026-10-16, and the note above is FALSE here: `ls
  // fixtures/repositories | grep -i go` lists `go-tools` (hyphen) and `go_tools` does
  // not exist, so the underscore form this entry asked for made the leg print
  // `SKIP (corpus repo missing: go_tools)` and count go as a blind spot while the
  // corpus sat on disk. script/m14/differential.ts already ruled it — "THE CORRECT
  // SPELLING IS A PROPERTY OF THE CORPUS ROOT, NOT OF THE FILE". With the hyphen this
  // leg reads 60 files, 0 parse errors, 93 occurring node types, 0 blind spots. Both
  // spellings are declared; the first that exists is the one measured and recorded.
  go: { wasm: "tree-sitter-go.wasm", ext: [".go"], repo: ["go-tools", "go_tools"] },
  zig: { wasm: "tree-sitter-zig.wasm", ext: [".zig"], repo: "zig" },
  csharp: { wasm: "tree-sitter-c_sharp.wasm", ext: [".cs"], repo: "powershell" },
  dart: { wasm: "tree-sitter-dart.wasm", ext: [".dart"], repo: "proxicall" },
  swift: { wasm: "tree-sitter-swift.wasm", ext: [".swift"], repo: "swift-nio" },
  objc: { wasm: "tree-sitter-objc.wasm", ext: [".m", ".h"], repo: "sdwebimage" },
  php: { wasm: "tree-sitter-php.wasm", ext: [".php"], repo: "phpunit" },
  ruby: { wasm: "tree-sitter-ruby.wasm", ext: [".rb"], repo: "rake" },
  python: { wasm: "tree-sitter-python.wasm", ext: [".py"], repo: "cython" },
  haskell: { wasm: "tree-sitter-haskell.wasm", ext: [".hs"], repo: "cabal" },
  erlang: { wasm: "tree-sitter-erlang.wasm", ext: [".erl"], repo: "rebar3" },
  // EX waves: elixir was never enrolled in the census gate — the haskell
  // blind-spot instrument has been blind to the whole elixir lane. Enrolled
  // with the F5 primary corpus; the spec's classification is what the EX
  // probes verified behaviour against.
  elixir: { wasm: "tree-sitter-elixir.wasm", ext: [".ex", ".exs"], repo: "elixir" },
  // CLJ1 wave: clojure was never enrolled either — the corpus census (34
  // occurring types / 142 files / 0 parse errors) was run as a one-off probe
  // during the deep review; this enrollment makes it a permanent gate. The
  // spec classifies all 34 (15 analyzer-referenced + 19 traversal-transparent
  // + 7 RULED design decisions).
  clojure: { wasm: "tree-sitter-clojure.wasm", ext: [".clj", ".cljc", ".cljs"], repo: "clojure" },
}

interface LangResult {
  language: string
  /** The directory actually read, so the record names what was measured. */
  repo: string | null
  filesScanned: number
  parseErrors: number
  occurring: number
  classified: number
  blindSpots: string[]
  pass: boolean
}

function collectFiles(repoPath: string, exts: string[], limit: number): string[] {
  const out: string[] = []
  const stack = [repoPath]
  while (stack.length > 0 && out.length < limit) {
    const d = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === "obj" || e.name === "bin") continue
        stack.push(p)
      } else if (exts.some((x) => e.name.endsWith(x))) {
        out.push(p)
        if (out.length >= limit) break
      }
    }
  }
  return out
}

async function main() {
  const langArgIdx = process.argv.indexOf("--lang")
  const langArg = langArgIdx >= 0 ? process.argv[langArgIdx + 1] : undefined

  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

  const results: LangResult[] = []
  const langs = langArg ? [langArg] : Object.keys(GATED)

  for (const lang of langs) {
    const cfg = GATED[lang]
    if (!cfg) {
      console.error(`unknown language: ${lang}`)
      process.exit(2)
    }
    const specPath = path.join(SPEC_DIR, `${lang}-completeness.json`)
    if (!fs.existsSync(specPath)) {
      console.log(`${lang.padEnd(12)} SKIP (no spec)`)
      continue
    }
    const spec = JSON.parse(fs.readFileSync(specPath, "utf8"))
    // Spec-classified types: every category counts as "known" — the census
    // demands a RULING, not a specific verdict.
    const classified = new Set<string>()
    // `types` is a LIST in the css/jvm-family specs and a keyed OBJECT in the scss
    // one, which carries per-type evidence (`inCorpus`, `note`, `reachedBy`). The
    // first version assumed the list shape and threw `TypeError: {} is not iterable`
    // on the scss spec — so the lane could not be registered at all, which is the gate
    // refusing a format rather than a lane.
    //
    // Both shapes are read here rather than by normalising the scss spec down to a
    // list, because the per-type evidence is the part that makes the spec worth having:
    // a list of names cannot say which types the corpus has never exercised, and that
    // distinction is the one this gate exists to surface.
    const addTypes = (v: any): void => {
      if (Array.isArray(v)) for (const t of v) classified.add(String(t))
      else if (v && typeof v === "object") for (const k of Object.keys(v)) classified.add(k)
    }
    addTypes(spec.handled_verified?.types)
    addTypes(spec.internal_silent?.types)
    addTypes(spec.gap?.types)
    for (const t of spec.design_decision?.types ?? []) classified.add(t)
    for (const d of spec.design_decision?.decisions ?? []) {
      for (const t of String(d.node_type ?? "").split(",")) {
        const tt = t.trim()
        if (tt) classified.add(tt)
      }
    }
    // The JVM-family spec format declares gap rulings as `gap.gaps[]`
    // entries with comma-separated node_type lists (K1..K8 etc). A ruled
    // gap entry — OPEN or CLOSED — is a classification; the census demands
    // exactly that.
    for (const g of spec.gap?.gaps ?? []) {
      for (const t of String(g.node_type ?? "").split(",")) {
        const tt = t.trim()
        if (tt) classified.add(tt)
      }
    }

    const spellings = Array.isArray(cfg.repo) ? cfg.repo : [cfg.repo]
    const repoUsed = spellings.find((s) => fs.existsSync(path.join(CORPUS_ROOT, s))) ?? null
    if (repoUsed === null) {
      const named = spellings.join(" or ")
      console.log(`${lang.padEnd(12)} SKIP (corpus repo missing: ${named})`)
      results.push({ language: lang, repo: null, filesScanned: 0, parseErrors: 0, occurring: 0, classified: 0, blindSpots: [`corpus missing: ${named}`], pass: false })
      continue
    }
    const repoPath = path.join(CORPUS_ROOT, repoUsed)
    const files = collectFiles(repoPath, cfg.ext, CENSUS_FILES)
    const langWasm = await L.load(fs.readFileSync(path.join(WASM_DIR, cfg.wasm)))
    const parser = new P()
    parser.setLanguage(langWasm)

    const occurring = new Set<string>()
    let parseErrors = 0
    for (const f of files) {
      let src: string
      try {
        src = fs.readFileSync(f, "utf8")
      } catch {
        continue
      }
      if (src.length > 800_000) continue
      const tree = parser.parse(src)
      if (tree.rootNode.hasError) parseErrors++
      const stack = [tree.rootNode]
      while (stack.length > 0) {
        const n = stack.pop()!
        if (n.type && !n.type.startsWith("_")) occurring.add(n.type)
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) stack.push(c)
        }
      }
    }

    // ERROR is the parse-error node type, not a grammar type to classify —
    // it is already reported per-language as `err=N` above. Excluding it
    // keeps the blind-spot list about spec classification, which is what
    // this gate governs.
    const blindSpots = [...occurring].filter((t) => !classified.has(t) && t !== "ERROR").sort()
    const pass = blindSpots.length === 0 && files.length > 0
    results.push({ language: lang, repo: repoUsed, filesScanned: files.length, parseErrors, occurring: occurring.size, classified: classified.size, blindSpots, pass })
    const status = pass ? "PASS" : "FAIL"
    console.log(`${lang.padEnd(12)} ${status}  files=${files.length} err=${parseErrors} types=${occurring.size} blind=${blindSpots.length} repo=${repoUsed}`)
    if (blindSpots.length > 0) {
      for (const b of blindSpots.slice(0, 12)) console.log(`             BLIND: ${b}`)
      if (blindSpots.length > 12) console.log(`             ... +${blindSpots.length - 12} more`)
    }
  }

  // #886-class guard (EX wave, 2026-09-19): a FILTERED run (`--lang` /
  // `--files`) covers a subset of the gated languages and must NEVER
  // overwrite the canonical M14.0.F8.json — doing so silently shrinks the
  // milestone's claim to whichever languages happened to be selected. That
  // exact defect had already left the canonical artifact holding a single
  // erlang check; this guard is the census runner's counterpart of the F4
  // runner's "filtered runs write nothing" fix.
  const isFilteredRun = !!langArg || process.argv.includes("--files")
  if (isFilteredRun) {
    console.log(`\nSCOPED run (${langArg ?? `${CENSUS_FILES}-file sample`}) — results printed above, NO evidence written; run without --lang/--files to emit the canonical M14.0.F8.json`)
  } else {
  const { emitEvidence } = await import("./evidence-harness")
  // Two fields beyond the harness's `Check` ride on each row, and the committed artifact
  // records both per language (24 of each in M14.0.F8.json) — so they are declared here
  // rather than dropped by typing the array as `Check[]`.
  const checks: Array<{ id: string; description: string; status: "pass" | "fail"; filesScanned: number; blindSpots: number; repo: string | null }> = results.map((r) => ({
    id: `corpus-census-${r.language}`,
    // The directory read rides in the claim as well as in the row, because the go leg's
    // history is exactly a directory-name disagreement: a record that names the corpus it
    // measured cannot silently measure a different one on the next root.
    description: `every parse-tree node type occurring in ${r.filesScanned} real corpus files is classified in the spec (blind spots: ${r.blindSpots.length}; corpus: ${r.repo ?? "missing"})`,
    status: r.pass ? "pass" : "fail",
    filesScanned: r.filesScanned,
    blindSpots: r.blindSpots.length,
    repo: r.repo,
  }))
  emitEvidence({
    issueId: "M14.0.F8",
    title: "Corpus-census gate: real-corpus parse-tree types must be classified in the spec (haskell blind-spot detector, permanent)",
    claimLevel: "L1",
    layers: ["census"],
    checks,
    limitations: [
      {
        description: `Census samples up to ${CENSUS_FILES} files per language from the F5 corpus repo; rare shapes outside the sample are caught by future corpus rotations and F9 probes`,
      },
    ],
  })
  }

  const failed = results.filter((r) => !r.pass)
  if (failed.length > 0) {
    console.log(`\ncorpus-census gate: ${failed.length} language(s) with blind spots — release blocked`)
    process.exit(1)
  }
  console.log(`\ncorpus-census gate: all ${results.length} language(s) pass`)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
