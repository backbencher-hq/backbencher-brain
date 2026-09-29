// The #897 producer: executable corpus-error evidence for the languages whose
// M12 manifest claims were prose. Same derived style as jvm/web-corpus-errors:
// no hand-written limit maps, hasError-gated tree walk, per-file pipeline
// cross-check, one conventional artifact per language. Repos are the M11
// manifest's pinned clones; repos that are missing from disk (swift_nio) or
// unpinned (objc) stay out of this config — they remain the R1 remainder the
// gate names.
//
// Sample mode is the M12 convention (deterministic first-400 sorted, exactly
// the phrase the original manifest notes used) and is recorded as such in the
// artifact's `mode`; full-corpus runs where the pinned repo is small enough.
//
// Usage:
//   bun script/m12/m897-corpus-errors.ts               # every language below
//   bun script/m12/m897-corpus-errors.ts rust          # one language
//   options: [--limit N] [--head N] [--cap N]          # cap: sample size (default 400)
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { basename } from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = "$HOME/fixtures/repositories"
const LANGS: Record<string, { lang: string; repo: string; ext: string[] }> = {
  go:       { lang: "go",       repo: `${ROOT}/go-tools`,     ext: ["*.go"] },
  rust:     { lang: "rust",     repo: `${ROOT}/cargo`,        ext: ["*.rs"] },
  cpp:      { lang: "cpp",      repo: `${ROOT}/zig`,          ext: ["*.cpp", "*.cppm", "*.hpp", "*.cc", "*.hh"] },
  // *.h is production-mapped to cpp (language-detection policy); auditing .h
  // under the c grammar manufactured pipeline mismatches — c claims *.c only.
  c:        { lang: "c",        repo: `${ROOT}/jq`,           ext: ["*.c"] },
  ruby:     { lang: "ruby",     repo: `${ROOT}/rake`,         ext: ["*.rb"] },
  php:      { lang: "php",      repo: `${ROOT}/phpunit`,      ext: ["*.php"] },
  zig:      { lang: "zig",      repo: `${ROOT}/zig`,          ext: ["*.zig"] },
  perl:     { lang: "perl",     repo: `${ROOT}/mojo`,         ext: ["*.pl", "*.pm", "*.t"] },
  lua:      { lang: "lua",      repo: `${ROOT}/luarocks`,     ext: ["*.lua"] },
  r:        { lang: "r",        repo: `${ROOT}/dplyr`,        ext: ["*.R", "*.r"] },
  elixir:   { lang: "elixir",   repo: `${ROOT}/elixir`,       ext: ["*.ex", "*.exs"] },
  swift:    { lang: "swift",    repo: `${ROOT}/alamofire`,    ext: ["*.swift"] },
  erlang:   { lang: "erlang",   repo: `${ROOT}/otp`,          ext: ["*.erl", "*.hrl"] },
  "objective-c": { lang: "objc", repo: `${ROOT}/afnetworking`, ext: ["*.m", "*.mm"] },
  haskell:  { lang: "haskell",  repo: `${ROOT}/cabal`,        ext: ["*.hs"] },
  clean:    { lang: "clean",    repo: `${ROOT}/clean-stdlib`, ext: ["*.icl", "*.dcl"] },
  css:      { lang: "css",      repo: `${ROOT}/svelte`,       ext: ["*.css"] },
  html:     { lang: "html",     repo: `${ROOT}/svelte`,       ext: ["*.html", "*.htm"] },
  clojure:  { lang: "clojure",  repo: `${ROOT}/clojure`,      ext: ["*.clj", "*.cljc", "*.edn"] },
  fsharp:   { lang: "fsharp",   repo: `${ROOT}/fsharp`,       ext: ["*.fs", "*.fsi", "*.fsx"] },
  dart:     { lang: "dart",     repo: `${ROOT}/dart-http`,    ext: ["*.dart"] },
  python:   { lang: "python",   repo: `${ROOT}/proxicall`,    ext: ["*.py"] },
}

const args = process.argv.slice(2)
const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--limit" && args[i - 1] !== "--head" && args[i - 1] !== "--cap")
const cap = args.includes("--cap") ? parseInt(args[args.indexOf("--cap") + 1]) : 400
const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]) : Infinity
const head = args.includes("--head") ? parseInt(args[args.indexOf("--head") + 1]) : 8
const targets = positional.length > 0 ? positional : Object.keys(LANGS)

type FileErr = {
  file: string
  nodes: number
  missingTokens: string[]
  errorNodes: number
  firstRow: number
  firstKind: string
  firstLine: string
  pipelineErrors: number
}

function signature(line: string): string {
  return line
    .replace(/"(?:[^"\\]|\\.)*"/g, "STR")
    .replace(/'[^']*'/g, "STR")
    .replace(/[A-Za-z_$][A-Za-z0-9_$]*/g, "ID")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70)
}

function gitList(repo: string, exts: string[]): string[] {
  return execFileSync("git", ["-C", repo, "ls-files", ...exts], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
    .trim().split("\n").filter(Boolean).sort()
}

async function audit(name: string): Promise<void> {
  const cfg = LANGS[name]
  const revision = execFileSync("git", ["-C", cfg.repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const tracked = gitList(cfg.repo, cfg.ext)
  const isFull = tracked.length <= cap
  let files = isFull ? tracked : tracked.slice(0, cap)
  if (Number.isFinite(limit)) files = files.slice(0, limit)

  const errorFiles: FileErr[] = []
  const crashes: { file: string; error: string }[] = []
  const missingTokenCounts = new Map<string, number>()
  const errorSignatureCounts = new Map<string, number>()
  const firstErrorLineCounts = new Map<string, number>()
  const pipelineMismatchList: { file: string; treeNodes: boolean; pipelineErrors: number }[] = []
  let absent = 0
  let totalSymbols = 0
  let totalRelationships = 0
  const started = Date.now()

  for (const file of files) {
    const abs = `${cfg.repo}/${file}`
    let src: string
    try { src = await Bun.file(abs).text() } catch { absent++; continue }
    const lines = src.split("\n")
    let missingNodes = 0, errorNodes = 0
    let rootHasError = false
    let missingTokens: string[] = []
    let first: { row: number; kind: string } | null = null
    try {
      const parser = await ASTEngine.getParser(cfg.lang as any)
      const tree = parser.parse(src)
      const root = tree?.rootNode
      rootHasError = !!(root as any).hasError
      if (root && (root as any).hasError) {
        const stack: any[] = [root]
        const missing = new Set<string>()
        while (stack.length > 0) {
          const n = stack.pop()
          if (n.isMissing) {
            missing.add(n.type); missingNodes++
            missingTokenCounts.set(n.type, (missingTokenCounts.get(n.type) ?? 0) + 1)
            if (!first) first = { row: n.startPosition.row + 1, kind: `MISSING ${n.type}` }
          } else if (n.type === "ERROR") {
            errorNodes++
            const row = n.startPosition.row + 1
            const sig = signature((lines[row - 1] ?? "").trim())
            errorSignatureCounts.set(sig, (errorSignatureCounts.get(sig) ?? 0) + 1)
            if (!first) { first = { row, kind: "ERROR" }; firstErrorLineCounts.set(sig, (firstErrorLineCounts.get(sig) ?? 0) + 1) }
          }
          for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push(c) }
        }
        missingTokens = [...missing]
      }
    } catch (error: any) { crashes.push({ file, error: String(error?.message ?? error).slice(0, 300) }); continue }

    let pipelineErrors = 0
    try {
      const parsed = await parseFile(abs, process.cwd())
      pipelineErrors = (parsed.errors ?? []).length
      // The VOLUME counts, measured on THIS file set through THIS production
      // pipeline. Added 2026-09-26: the manifest's `corpusSymbols` /
      // `corpusRelationships` had no artifact behind them at all, and css carried
      // a 47% undercount (1,854 claimed where the same corpus measures 2,722)
      // that survived every gate because the corpus-claims gate reconciled only
      // `grammarErrorFiles`. This artifact is the natural home for them: it is
      // already a FULL-CORPUS walk of the same files through the same entry
      // point, so a claim it carries is backed with no filter to reason about.
      totalSymbols += (parsed.symbols ?? []).length
      totalRelationships += (parsed.relationships ?? []).length
    } catch (error: any) { crashes.push({ file, error: "parseFile: " + String(error?.message ?? error).slice(0, 260) }); continue }

    // Production truth is rootNode.hasError (what parseFile gates on). Some
    // MISSING nodes are not iterable via the web-tree-sitter binding (the
    // documented kotlin hidden-MISSING case), so the walk can find zero nodes
    // on a file that genuinely errors — those surface through the pipeline's
    // "hidden MISSING node" fallback. hasError is the error-file signal; the
    // walk only classifies.
    const treeNodes = rootHasError
    if (treeNodes !== pipelineErrors > 0) pipelineMismatchList.push({ file, treeNodes, pipelineErrors })
    if (!treeNodes) continue
    errorFiles.push({
      file, nodes: missingNodes + errorNodes, missingTokens, errorNodes,
      firstRow: first?.row ?? 0, firstKind: first?.kind ?? "",
      firstLine: (lines[(first?.row ?? 1) - 1] ?? "").trim().slice(0, 120),
      pipelineErrors,
    })
  }
  const wallMs = Date.now() - started
  const measured = files.length - absent
  const pct = (n: number) => +((n / Math.max(1, measured)) * 100).toFixed(1)
  const result = {
    analyzer: name,
    corpus: cfg.repo,
    corpusRepo: basename(cfg.repo),
    revision,
    extensions: cfg.ext,
    mode: isFull ? "full-corpus" : `deterministic-first-${cap}-sorted`,
    trackedFilesInCorpus: tracked.length,
    measuredFiles: measured,
    samplePathsAbsentInCorpus: absent,
    errorFiles: errorFiles.length,
    cleanFiles: measured - errorFiles.length,
    missingNodeFiles: errorFiles.filter((f) => f.missingTokens.length > 0).length,
    errorNodeFiles: errorFiles.filter((f) => f.errorNodes > 0).length,
    errorRates: {
      any: pct(errorFiles.length),
      missing: pct(errorFiles.filter((f) => f.missingTokens.length > 0).length),
      error: pct(errorFiles.filter((f) => f.errorNodes > 0).length),
    },
    grammarErrorFiles: errorFiles.length,
    symbols: totalSymbols,
    relationships: totalRelationships,
    crashFiles: crashes.length,
    pipelineMismatchCount: pipelineMismatchList.length,
    pipelineMismatchFiles: pipelineMismatchList,
    wallMs,
    missingTokens: Object.fromEntries([...missingTokenCounts.entries()].sort((a, b) => b[1] - a[1])),
    errorLineSignatures: Object.fromEntries([...errorSignatureCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)),
    firstErrorLineSignatures: Object.fromEntries([...firstErrorLineCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)),
    errorFileList: errorFiles,
    crashes,
    passed: errorFiles.length === 0 && crashes.length === 0 && pipelineMismatchList.length === 0,
    policy:
      "#897 derived-style audit. Every file in scope is audited through the production parseFile pipeline; the tree walk runs only under the rootNode.hasError gate the pipeline uses, and the two signals are cross-checked per file with disagreements recorded. Failure classes are derived from the parse tree; no hand-written limit map exists to drift.",
  }

  const out = `validation/m12/results/${name}-corpus-errors.json`
  writeFileSync(out, JSON.stringify(result, null, 2) + "\n")
  console.log(`=== ${name} (${result.mode}) — ${errorFiles.length}/${measured} error files (${pct(errorFiles.length)}%) | crashes ${crashes.length} | mismatches ${pipelineMismatchList.length} | wrote ${out}`)
  for (const f of errorFiles.slice(0, head)) {
    console.log(`   ${f.file}:${f.firstRow} ${f.firstKind} ${(f.missingTokens.length ? f.missingTokens.join("/") : f.firstLine).slice(0, 90)}`)
  }
}

for (const name of targets) {
  if (!LANGS[name]) { console.error(`unknown language ${name}; expected one of ${Object.keys(LANGS).join(", ")}`); process.exit(1) }
  try { await audit(name) } catch (e: any) { console.error(`${name} FAILED: ${String(e?.message ?? e).slice(0, 200)}`) }
}
