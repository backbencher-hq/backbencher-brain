// The web family's M12 corpus claims had no executable evidence. `script/m12/`
// carried print-only M12.09 probes for typescript/javascript/vue/svelte that
// wrote NO artifact (the gap #834 charged: "prose, not evidence, nothing
// gates the gap"), and the vue probe measured element-plus while the manifest
// pins vue_core — the sample paths do not exist in the pinned repo, so that
// measurement was not evidence-grade either.
//
// This producer is the web twin of script/m12/jvm-corpus-errors.ts, and it
// carries the same two non-negotiables:
//
// 1. No hand-written "known grammar limits" map. Failure classes are DERIVED
//    from the parse tree — the token each MISSING node demanded, the source
//    line under each ERROR node — and `passed` is simply "no error files at
//    all". Nothing here can drift from the measurement.
// 2. The tree walk runs only under the same hasError guard the #841 round-2
//    instrument fix gave the JVM producer: a GLR-resolved parse can leave a
//    zero-width phantom ERROR node at EOF while rootNode.hasError is FALSE,
//    and the production pipeline gates on hasError. Without the guard the
//    instrument invents failures the pipeline does not see.
//
// The tree walk and the production pipeline's per-file error count are
// cross-checked per file; disagreements are recorded, never smoothed over.
//
// Usage:
//   bun script/m12/web-corpus-errors.ts                 # every web language
//   bun script/m12/web-corpus-errors.ts typescript      # one language
//   bun script/m12/web-corpus-errors.ts svelte --full   # whole tracked corpus
//   options: [--full] [--limit N] [--head N]
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { basename } from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { parseFile } from "../../src/ast/pool-worker"

// Repos are the M11 manifest's pinned web corpora (validation/m11/
// corpus-manifest.json): typescript -> TypeScript, javascript -> svelte (its
// JS payload; same file set the M12 sample was taken from), vue -> vue_core,
// svelte -> svelte. vue's default mode is full-corpus because the pinned
// vue_core repo tracks only 11 .vue files — full corpus beats any sample.
const LANGS: Record<string, { lang: string; repo: string; ext: string[]; fullByDefault?: boolean }> = {
  typescript: { lang: "typescript", repo: "$HOME/TypeScript", ext: ["*.ts"] },
  javascript: { lang: "javascript", repo: "$HOME/fixtures/repositories/svelte", ext: ["*.js", "*.mjs", "*.cjs"] },
  vue: { lang: "vue", repo: "$HOME/fixtures/repositories/vue-core", ext: ["*.vue"], fullByDefault: true },
  svelte: { lang: "svelte", repo: "$HOME/fixtures/repositories/svelte", ext: ["*.svelte"] },
}

const args = process.argv.slice(2)
const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--limit" && args[i - 1] !== "--head")
const full = args.includes("--full")
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

// intellij-community taught this lesson on the JVM side: big `git ls-files`
// output aborts on the default 1 MB stdout buffer, so the buffer is explicit.
function gitList(repo: string, exts: string[]): string[] {
  return execFileSync("git", ["-C", repo, "ls-files", ...exts], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort()
}

async function audit(name: string): Promise<Record<string, any>> {
  const cfg = LANGS[name]
  const revision = execFileSync("git", ["-C", cfg.repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const trackedInCorpus = gitList(cfg.repo, cfg.ext)

  let files: string[]
  const isFull = full || (cfg.fullByDefault === true && !args.includes("--sample"))
  if (isFull) {
    files = trackedInCorpus
  } else {
    files = readFileSync(`validation/m12/results/${name}-corpus-sample.txt`, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
  }
  if (Number.isFinite(limit)) files = files.slice(0, limit)

  const errorFiles: FileErr[] = []
  const crashes: { file: string; error: string }[] = []
  const missingTokenCounts = new Map<string, number>()
  const errorSignatureCounts = new Map<string, number>()
  const firstErrorLineCounts = new Map<string, number>()
  const pipelineMismatchList: { file: string; treeNodes: boolean; pipelineErrors: number }[] = []
  let absent = 0

  const started = Date.now()
  for (const file of files) {
    const abs = `${cfg.repo}/${file}`
    let src: string
    try {
      src = readFileSync(abs, "utf8")
    } catch {
      absent++
      continue
    }
    const lines = src.split("\n")

    let missingTokens: string[] = []
    let missingNodes = 0
    let errorNodes = 0
    let first: { row: number; kind: string } | null = null
    try {
      const parser = await ASTEngine.getParser(cfg.lang as any)
      const tree = parser.parse(src)
      const root = tree?.rootNode
      if (root && (root as any).hasError) {
        // hasError-guarded walk — see header. Production parseFile gates on
        // hasError; this walk only runs when that gate opens.
        const stack: any[] = [root]
        const missing = new Set<string>()
        while (stack.length > 0) {
          const n = stack.pop()
          if (n.isMissing) {
            missing.add(n.type)
            missingNodes++
            missingTokenCounts.set(n.type, (missingTokenCounts.get(n.type) ?? 0) + 1)
            if (!first) first = { row: n.startPosition.row + 1, kind: `MISSING ${n.type}` }
          } else if (n.type === "ERROR") {
            errorNodes++
            const row = n.startPosition.row + 1
            const sig = signature((lines[row - 1] ?? "").trim())
            errorSignatureCounts.set(sig, (errorSignatureCounts.get(sig) ?? 0) + 1)
            if (!first) {
              first = { row, kind: "ERROR" }
              firstErrorLineCounts.set(sig, (firstErrorLineCounts.get(sig) ?? 0) + 1)
            }
          }
          for (let i = 0; i < n.childCount; i++) {
            const c = n.child(i)
            if (c) stack.push(c)
          }
        }
        missingTokens = [...missing]
      }
    } catch (error: any) {
      crashes.push({ file, error: String(error?.message ?? error).slice(0, 300) })
      continue
    }

    let pipelineErrors = 0
    try {
      const parsed = await parseFile(abs, process.cwd())
      pipelineErrors = (parsed.errors ?? []).length
    } catch (error: any) {
      crashes.push({ file, error: "parseFile: " + String(error?.message ?? error).slice(0, 260) })
      continue
    }

    const treeNodes = missingNodes > 0 || errorNodes > 0
    if (treeNodes !== pipelineErrors > 0) pipelineMismatchList.push({ file, treeNodes, pipelineErrors })
    if (!treeNodes) continue

    errorFiles.push({
      file,
      nodes: missingNodes + errorNodes,
      missingTokens,
      errorNodes,
      firstRow: first?.row ?? 0,
      firstKind: first?.kind ?? "",
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
    mode: isFull ? "full-corpus" : "recorded-m12-sample",
    sampleList: isFull ? null : `validation/m12/results/${name}-corpus-sample.txt`,
    trackedFilesInCorpus: trackedInCorpus.length,
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
      "Every file in scope is audited through the production parseFile pipeline. The analyzer never crashes and never synthesizes phantom rows. Failure classes are derived from the parse tree (the demanded token for each MISSING node, the source line for each ERROR node) rather than hard-coded, so nothing in this file can drift from the measurement. The tree walk runs only under the same rootNode.hasError gate the production pipeline uses (the #841 round-2 instrument fix), and the two signals are cross-checked per file; any disagreement is recorded in pipelineMismatchFiles. Clean acceptance files are those with zero parse errors.",
  }

  const out = `validation/m12/results/${name}-corpus-errors.json`
  writeFileSync(out, JSON.stringify(result, null, 2) + "\n")

  console.log(
    `\n=== ${name} (${result.mode}) — ${errorFiles.length}/${measured} files with parse errors (${pct(errorFiles.length)}%) ===`,
  )
  console.log(`   ERROR nodes ${result.errorRates.error}% | MISSING tokens ${result.errorRates.missing}% | crashes ${crashes.length} | pipeline mismatches ${pipelineMismatchList.length}`)
  console.log(`   top missing tokens: ${[...missingTokenCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, n]) => `MISSING ${t} x${n}`).join(", ") || "(none)"}`)
  console.log(`   wrote ${out}`)
  for (const f of errorFiles.slice(0, head)) {
    console.log(`   ${f.file}:${f.firstRow} ${f.firstKind} ${(f.missingTokens.length ? f.missingTokens.join("/") : f.firstLine).slice(0, 90)}`)
  }
}

for (const name of targets) {
  if (!LANGS[name]) {
    console.error(`unknown language ${name}; expected one of ${Object.keys(LANGS).join(", ")}`)
    process.exit(1)
  }
  await audit(name)
}
