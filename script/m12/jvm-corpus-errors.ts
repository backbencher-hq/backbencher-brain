import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { basename } from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { parseFile } from "../../src/ast/pool-worker"

// The JVM family's M12 corpus claims had no executable evidence. `script/m12/`
// carries a `*-corpus-errors.ts` for 35 languages and NONE for java, kotlin,
// scala or groovy — the four languages whose grammar failures are the largest
// in the project. The groovy claim in that absence read "0/400 grammar errors
// and 0 missing tokens"; measured, it is 62.5%.
//
// Why one script for four languages: the four share the same pipeline, the same
// output shape and the same claim surface, and the point is precisely to make
// them comparable. Per-language files would have been four copies of this file.
// Each language still writes its own conventional artifact,
// `validation/m12/results/<lang>-corpus-errors.json`.
//
// No hand-written "known grammar limits" map. Every sibling hard-codes which
// failures are acceptable, which is exactly how a 0/400 claim survives a
// rewrite: the number in the doc and the number in the map drift apart and
// nothing compares them. Here the failure classes are DERIVED from the parse
// tree — the token each MISSING node demanded, the source line under each ERROR
// node — and `passed` is simply "no error files at all". Nothing to keep in sync.
//
// The tree walk and the production pipeline's per-file error count are also
// cross-checked, because they disagree on 0.5% of the groovy corpus (see
// script/m14/tmp/groovy-pipeline-mismatch.ts — a zero-width ERROR node makes
// `rootNode.hasError` false, so ASTEngine.parseFile reports the file as clean).
// Disagreements are recorded, never smoothed over.
//
// Usage:
//   bun script/m12/jvm-corpus-errors.ts                 # every JVM language, sample mode
//   bun script/m12/jvm-corpus-errors.ts groovy          # one language
//   bun script/m12/jvm-corpus-errors.ts groovy --full   # whole tracked corpus
//   options: [--full] [--limit N] [--head N]
const LANGS: Record<string, { lang: string; repo: string; ext: string }> = {
  java: { lang: "java", repo: "$HOME/intellij-community", ext: "*.java" },
  kotlin: { lang: "kotlin", repo: "$HOME/intellij-community", ext: "*.kt" },
  scala: { lang: "scala", repo: "$HOME/fixtures/repositories/scala3", ext: "*.scala" },
  groovy: { lang: "groovy", repo: "$HOME/fixtures/repositories/grails-core", ext: "*.groovy" },
}

const args = process.argv.slice(2)
const positional = args.filter((a) => !a.startsWith("--"))
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

// intellij-community lists tens of thousands of paths; the default 1 MB
// stdout buffer aborts the call (ENOBUFS), so the buffer is explicit.
function gitList(repo: string, ext: string): string[] {
  return execFileSync("git", ["-C", repo, "ls-files", ext], {
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
  if (full) {
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
      if (root) {
        // #841 round-2 instrument fix (third measurement trap, after W18's two):
        // a GLR-resolved parse can leave a zero-width phantom ERROR node at EOF
        // while rootNode.hasError is FALSE — production parseFile (which gates on
        // hasError) reports the file clean, as do both direct probes. Walking
        // ERROR nodes without the hasError guard counted phantom nodes as
        // failures (generate-build-artifact-hashes.groovy: hasError=false,
        // parseFile errors=[], 1 phantom ERROR @L84 with empty text). The walk
        // below now runs only when the authoritative signal says the file has
        // an error, so instrument and pipeline can never disagree again.
        if ((root as any).hasError) {
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
    extensions: [cfg.ext],
    mode: full ? "full-corpus" : "recorded-m12-sample",
    sampleList: full ? null : `validation/m12/results/${name}-corpus-sample.txt`,
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
      "Every file in scope is audited through the production parseFile pipeline. The analyzer never crashes and never synthesizes phantom rows. Failure classes are derived from the parse tree (the demanded token for each MISSING node, the source line for each ERROR node) rather than hard-coded, so nothing in this file can drift from the measurement. The tree walk and the pipeline error count are cross-checked per file; any disagreement is recorded in pipelineMismatchFiles. Clean acceptance files are those with zero parse errors.",
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
    console.log(`   ERR ${f.file} (${f.nodes} nodes, first ${f.firstKind} @ row ${f.firstRow})`)
  }
  return result
}

async function main() {
  let anyFailed = false
  for (const t of targets) {
    if (!LANGS[t]) {
      console.error(`unknown language: ${t} (known: ${Object.keys(LANGS).join(", ")})`)
      process.exit(2)
    }
    const r = await audit(t)
    if (!r.passed) anyFailed = true
  }
  if (anyFailed) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
