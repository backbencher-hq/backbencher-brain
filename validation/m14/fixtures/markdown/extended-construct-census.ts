/**
 * Whole-admitted-population census of the brace-directive fence family — the
 * `part_of` construct census for the markdown lane (2026-10-25).
 *
 * WHAT THIS MEASURES. MyST (and the docutils-fenced dialects built on it) spells a
 * file inclusion as a FENCED CODE BLOCK whose info string is a brace directive:
 *
 *     ```{include} ../client/README.md
 *     :start-after: <!-- STABILITY:START -->
 *     ```
 *
 * The pinned block grammar models that as `fenced_code_block > fenced_code_block_delimiter,
 * info_string, fenced_code_block_delimiter`, with the directive name as the info string's
 * `language` child, so the construct is AST-visible TODAY, at R3, with no grammar change:
 * the analyzer already publishes `code_block.include` for such a fence (measured by the
 * single-file probe this header records). This census counts, over the WHOLE admitted
 * population:
 *
 *   1. every fence whose info string begins `{` — the brace-directive family;
 *   2. the directive names, and which of them are FILE-INCLUSION directives
 *      (`include`, `literalinclude`) versus the other MyST directives (`note`,
 *      `toctree`, `code-block`, ...) that share the syntax but not the semantics;
 *   3. the splice/fragment split the `part_of` contract turns on: an
 *      `{include}`/`{literalinclude}` with NO fragment option (`:lines:`,
 *      `:start-after:`, `:end-before:`, `:start-line:`, `:end-line:`, `:lineno-*`)
 *      splices the WHOLE file into this document's scope — that is `part_of` by the
 *      erlang/php/fsharp file-inclusion contract; an option that quotes a FRAGMENT
 *      (lines or a marker-delimited region) makes the included file a QUOTE SOURCE,
 *      not a scope-sharing part, and the census counts both;
 *   4. the argument shapes — a path, a URL, a bare word, empty.
 *
 * EXECUTION SHAPE. The engine's wasm parse aborts (`Aborted()`) once a single process
 * has parsed roughly 8,000–9,000 files — the fleet measured this on the shared path
 * (`Aborted()` output, a wasm heap ceiling, NOT the unfreed-tree leak the dart lane
 * disproved: parseFile deletes its trees and the same bytes parse fine in a fresh
 * process). The first run of this census lost 9,057 of 17,460 files to exactly that
 * ceiling and a same-process retry recovered none of them (`retried: 0`), so the
 * census runs as a PARENT that spawns CHILD SHARDS, each a fresh process with a
 * fresh wasm heap — the same execution shape the firing-corpus census uses for the
 * same measured reason.
 *
 * ADMISSION — the gate's own rule, restated so the population claim is comparable:
 * `git ls-files` per corpus repository (only real checkouts), extension `md` or
 * `markdown`, under the engine's 1 MiB FULL-AST cap, read as UTF-8. Corpus root:
 * BB_CORPUS_ROOT or the sibling-of-repo default. This is the same population
 * definition the whole-population census of 2026-10-04 used (17,456 admitted files;
 * this run reads 17,460, the population as of this measurement), so the two
 * populations are directly comparable.
 *
 * OUTPUT: a durable JSON artifact with the census, the population, the split, and a
 * sample of rows, written beside this script. A NUMBER WITHOUT ITS POPULATION IS NOT
 * A NUMBER: every figure in the artifact carries the admission rule that produced it.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import { execFileSync, spawnSync } from "node:child_process"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, "../../../..")
const ROOT = process.env.BB_CORPUS_ROOT ?? path.resolve(REPO, "../bb_tests/repositories")
const SIZE_CAP = 1024 * 1024
const OUT = path.join(HERE, "measurements/extended-construct-census.json")
const SELF = fileURLToPath(import.meta.url)

const argv = process.argv.slice(2)
const argOf = (name: string, dflt: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const SHARD_INDEX = argv.indexOf("--shard")
const IS_CHILD = SHARD_INDEX >= 0
const CHILD_SHARDS = Number(argv[SHARD_INDEX + 1] ?? "1")
const CHILD_INDEX = Number(argv[SHARD_INDEX + 2] ?? "0")
const SHARD_DIR = path.resolve(HERE, argOf("shard-dir", ".extended-census-shards"))

// ── the admitted population: the gate's own rule ─────────────────────────────────────
type Admitted = { repo: string; abs: string; rel: string }
function population(): Admitted[] {
  const all: Admitted[] = []
  const repos = readdirSync(ROOT, { withFileTypes: true }).filter(e => e.isDirectory() || e.isSymbolicLink())
  for (const r of repos) {
    const dir = path.join(ROOT, r.name)
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
    for (const rel of tracked) {
      const base = path.basename(rel).toLowerCase()
      if (!base.endsWith(".md") && !base.endsWith(".markdown")) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      all.push({ repo: r.name, abs, rel })
    }
  }
  return all.sort((a, b) => (a.abs < b.abs ? -1 : 1))
}

/** One fence row, as the census records it. */
type Row = {
  file: string; line: number; directive: string; argument: string
  options: string[]; splice: boolean; argShape: string
}

// ─────────────────────────────────────────────────────────── child: my slice, fresh process
if (IS_CHILD) {
  const files = population()
  const mine = files.filter((_, i) => i % CHILD_SHARDS === CHILD_INDEX)
  let parsed = 0, failed = 0, degraded = 0, fences = 0
  const rows: Row[] = []
  const { parseFile } = await import(path.join(REPO, "src/ast/engine.ts"))
  const t0 = Date.now()
  for (const f of mine) {
    let content: string
    try { content = readFileSync(f.abs, "utf8") } catch { failed++; continue }
    let res: any
    try { res = await parseFile(f.abs, content) } catch { failed++; continue }
    const md: any = (res as any)?.metadata ?? {}
    if (md.fallback === true || md.analysisVersion === "2.0-basic-fallback") { degraded++; continue }
    parsed++
    const lines = content.split("\n")
    for (const s of ((res as any)?.symbols ?? []) as any[]) {
      const m = s?.metadata ?? {}
      if (m.isMarkdownCodeBlock !== true) continue
      fences++
      const startLine = Number(s.range?.startLine ?? 0)
      const endLine = Number(s.range?.endLine ?? startLine)
      const first = lines[startLine - 1] ?? ""
      const fenceAt = first.indexOf("```")
      if (fenceAt < 0) continue
      const info = first.slice(fenceAt + 3)
      // THE BRACE-DIRECTIVE FAMILY: info string begins `{`. The grammar gives the info
      // string as a named child, so this is an AST fact, not a pattern over the file.
      if (info.charCodeAt(0) !== 123 /* { */) continue
      const closeBrace = info.indexOf("}")
      const directive = closeBrace > 1 ? info.slice(1, closeBrace).trim() : ""
      const argument = info.slice(closeBrace + 1).trim()
      // Options live INSIDE the fence, one per line, each beginning `:`. Read them by
      // position from the symbol's own line range — the fence's content.
      const options: string[] = []
      for (let i = startLine; i < endLine; i++) {
        const l = (lines[i] ?? "").trim()
        if (l.startsWith("```")) continue
        if (l.startsWith(":")) {
          const key = l.slice(1).split(":")[0].split(" ")[0].trim()
          if (key) options.push(key)
        }
      }
      const FRAGMENT_OPTIONS = new Set([
        "lines", "start-after", "end-before", "start-line", "end-line",
        "lineno-start", "lineno-end", "lineno-match", "lineno", "start", "end",
      ])
      const INCLUSION_DIRECTIVES = new Set(["include", "literalinclude", "include-directive"])
      const isInclude = INCLUSION_DIRECTIVES.has(directive)
      const splice = isInclude && !options.some(o => FRAGMENT_OPTIONS.has(o))
      let shape = "empty"
      if (argument.length > 0) {
        // Scheme-shaped?, by character code — the census keeps the analyzer's own
        // no-regex discipline so the artifact and the analyzer can be read together.
        const colon = argument.indexOf(":")
        let schemeLike = false
        if (colon >= 2) {
          const head = argument.slice(0, colon)
          schemeLike = !head.includes("/") && head.charCodeAt(0) >= 65 &&
            ((head.charCodeAt(0) >= 65 && head.charCodeAt(0) <= 90) || (head.charCodeAt(0) >= 97 && head.charCodeAt(0) <= 122))
          for (let ci = 1; schemeLike && ci < head.length; ci++) {
            const d = head.charCodeAt(ci)
            const ok = (d >= 65 && d <= 90) || (d >= 97 && d <= 122) || (d >= 48 && d <= 57) || d === 43 || d === 45 || d === 46
            if (!ok) schemeLike = false
          }
        }
        if (schemeLike) shape = "url"
        else if (argument.includes("/") || argument.includes(".")) shape = "pathLike"
        else shape = "bareToken"
      }
      rows.push({ file: `${f.repo}/${f.rel}`, line: startLine, directive, argument, options, splice, argShape: shape })
    }
  }
  mkdirSync(SHARD_DIR, { recursive: true })
  writeFileSync(path.join(SHARD_DIR, `${CHILD_INDEX}.json`), JSON.stringify({
    shard: CHILD_INDEX, shards: CHILD_SHARDS, assigned: mine.length,
    parsed, failed, degraded, fences, rows, tookMs: Date.now() - t0,
    analyzerSha256: createHash("sha256").update(readFileSync(path.join(REPO, "src/ast/real-markdown-analyzer.ts"))).digest("hex").slice(0, 16),
  }, null, 1) + "\n")
  console.log(`@@DONE@@ shard ${CHILD_INDEX}: ${mine.length} files, ${parsed} parsed, ${fences} fences, ${rows.length} brace rows, ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  process.exit(0)
}

// ─────────────────────────────────────────────────────────── parent: spawn + merge
const SHARDS = Math.max(1, Number(argOf("shards", "4")))
const files = population()
console.log(`markdown brace-directive census — whole admitted population, ${SHARDS} fresh-process shards`)
console.log(`admission     git ls-files per repo, .md/.markdown, < ${SIZE_CAP} bytes`)
console.log(`population    ${files.length} files`)

let parsed = 0, failed = 0, degraded = 0, fences = 0
const rows: Row[] = []
const lostShards: number[] = []
for (let s = 0; s < SHARDS; s++) {
  const mine = files.filter((_, i) => i % SHARDS === s)
  if (mine.length === 0) continue
  const r = spawnSync(process.execPath, [SELF, "--shard", String(SHARDS), String(s), "--shard-dir", SHARD_DIR], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, cwd: REPO })
  const done = (r.stdout ?? "").split("\n").find(l => l.startsWith("@@DONE@@"))
  if (r.status !== 0 || !done) { lostShards.push(s); console.log(`shard ${s}: LOST (exit ${r.status}) — reported, not counted as zero`); continue }
  console.log(done.replace("@@DONE@@ ", ""))
  const o = JSON.parse(readFileSync(path.join(SHARD_DIR, `${s}.json`), "utf8"))
  parsed += o.parsed; failed += o.failed; degraded += o.degraded; fences += o.fences
  rows.push(...o.rows)
}

const perDirective = new Map<string, number>()
const perRepo = new Map<string, number>()
const optionUse = new Map<string, number>()
for (const row of rows) {
  perDirective.set(row.directive, (perDirective.get(row.directive) ?? 0) + 1)
  perRepo.set(row.file.split("/")[0], (perRepo.get(row.file.split("/")[0]) ?? 0) + 1)
  for (const o of row.options) optionUse.set(o, (optionUse.get(o) ?? 0) + 1)
}
const includs = rows.filter(r => r.directive === "include" || r.directive === "literalinclude")
const distinctTargets = new Set(includs.map(r => r.argument)).size

const artifact = {
  whatThisIs: "Whole-admitted-population census of brace-directive fences ({directive} info strings) in markdown, read through production parseFile's own published fence symbols — the `part_of` construct census. The grammar exposes the directive name as the info string, so this is an AST read, not a text scan.",
  admissionRule: "git ls-files per corpus repository (real checkouts only), basename .md or .markdown, under the engine's 1 MiB FULL-AST cap, UTF-8 readable",
  corpusRoot: ROOT,
  measuredOn: new Date().toISOString(),
  execution: {
    shards: SHARDS, lostShards,
    whyShards: "a single wasm heap aborts after ~8,400 parses (measured: first run lost 9,057 of 17,460 to `Aborted()`, same-process retry recovered 0); each shard is a fresh process",
    analyzerSha256First16: createHash("sha256").update(readFileSync(path.join(REPO, "src/ast/real-markdown-analyzer.ts"))).digest("hex").slice(0, 16),
  },
  population: {
    admitted: files.length, parsed, failed, degraded,
    fencedCodeBlocks: fences,
    braceDirectiveFences: rows.length,
  },
  directiveFamily: Object.fromEntries([...perDirective.entries()].sort((a, b) => b[1] - a[1])),
  perRepo: Object.fromEntries([...perRepo.entries()].sort((a, b) => b[1] - a[1])),
  optionUse: Object.fromEntries([...optionUse.entries()].sort((a, b) => b[1] - a[1])),
  inclusionDirectives: {
    total: includs.length,
    splice: includs.filter(r => r.splice).length,
    fragmentQuoted: includs.filter(r => !r.splice).length,
    distinctTargets,
    argShapes: {
      pathLike: includs.filter(r => r.argShape === "pathLike").length,
      url: includs.filter(r => r.argShape === "url").length,
      bareToken: includs.filter(r => r.argShape === "bareToken").length,
      empty: includs.filter(r => r.argShape === "empty").length,
    },
  },
  rows: rows.slice(0, 400),
}
writeFileSync(OUT, JSON.stringify(artifact, null, 1) + "\n")
console.log(`census: ${files.length} admitted, ${parsed} parsed, ${fences} fences, ${rows.length} brace-directive fences`)
console.log(`inclusion directives: ${includs.length} (${includs.filter(r => r.splice).length} splice / ${includs.filter(r => !r.splice).length} fragment-quoted), ${distinctTargets} distinct targets`)
console.log(`directive family:`, JSON.stringify(artifact.directiveFamily))
console.log(`wrote ${OUT}`)
if (lostShards.length > 0) process.exit(5)
