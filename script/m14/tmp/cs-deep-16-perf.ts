// CS-DEEP-16 — PERF, measured. The one claim this round had no number for.
//
// The M12 complexity envelope in docs/analyzers/csharp.md was measured on 400
// roslyn files in 2026-08. This round added work to three hot paths (the qualified-name
// argument walk, the attribute canonical-name rule, the using-target argument walk), so the
// published envelope is STALE and must be re-measured rather than assumed — "the fix is one
// comparison" is exactly the reasoning that hides a quadratic.
//
// WHAT IT REPORTS, and why each number is the one that matters:
//   wall ms, symbols/s, relationships/s, peak RSS, and files/s — over a caller-supplied
//   corpus, through the PRODUCTION path (`ASTEngine.parseFile`), with a warm parser pool.
//   Plus a SCALING check: the same measurement at 100 / 200 / 400 files, because a per-file
//   cost that is linear in files cannot detect a per-file cost that is linear in NESTING
//   depth or in symbol count. The two are different bugs and only the second one is invisible
//   to a single-size run.
//
// Usage: bun script/m14/tmp/cs-deep-16-perf.ts --list <paths> [sizes...]
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const ROOT = process.cwd()

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

async function main() {
  const listFile = arg("--list")
  if (!listFile) { console.error("usage: cs-deep-16-perf.ts --list <paths> [sizes...]"); process.exit(2) }
  const all = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean)
  const sizes = process.argv.slice(process.argv.indexOf(listFile) + 2).map(Number).filter((n) => n > 0)
  const runs = sizes.length > 0 ? sizes : [100, 200, 400]

  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  console.log(`node ${process.version}   cpus ${os.cpus().length}   bun ${(globalThis as any).Bun?.version ?? "?"}`)
  console.log(`corpus: ${listFile}\n`)
  console.log("files    wall ms   symbols   rels     files/s   symbols/s   rels/s     ms/file   peak RSS MB")

  const results: Array<{ n: number; ms: number; sym: number; rel: number }> = []
  for (const n of runs) {
    const files = all.slice(0, n)
    if (files.length === 0) continue
    // Warm the parser pool first: the FIRST parseFile in a process pays the wasm
    // initialisation, and a cold-start number is not a per-file number.
    await ASTEngine.parseFile(files[0], fs.readFileSync(files[0], "utf8"))
    if (globalThis.gc) (globalThis as any).gc()

    let peakRss = 0
    const rssTimer = setInterval(() => {
      const r = process.memoryUsage().rss
      if (r > peakRss) peakRss = r
    }, 20)

    const t0 = performance.now()
    let sym = 0
    let rel = 0
    for (const f of files) {
      const res: any = await ASTEngine.parseFile(f, fs.readFileSync(f, "utf8"))
      sym += res.symbols?.length ?? 0
      rel += res.relationships?.length ?? 0
    }
    const ms = performance.now() - t0
    clearInterval(rssTimer)
    const rss = Math.max(peakRss, process.memoryUsage().rss)
    results.push({ n: files.length, ms, sym, rel })
    console.log(
      `${String(files.length).padStart(6)} ${ms.toFixed(1).padStart(10)} ${String(sym).padStart(9)} ${String(rel).padStart(7)}` +
      ` ${(files.length / (ms / 1000)).toFixed(1).padStart(10)} ${(sym / (ms / 1000)).toFixed(0).padStart(11)} ${(rel / (ms / 1000)).toFixed(0).padStart(9)}` +
      ` ${(ms / files.length).toFixed(2).padStart(10)} ${(rss / 1048576).toFixed(1).padStart(13)}`,
    )
  }

  // The scaling check, stated as a number rather than a vibe: a linear per-file cost means
  // ms/file is flat across sizes. A drift in ms/file is the signature of a super-linear term,
  // and it is the only thing a single-size run cannot see.
  if (results.length >= 2) {
    const first = results[0]
    const last = results[results.length - 1]
    const perFileFirst = first.ms / first.n
    const perFileLast = last.ms / last.n
    const drift = perFileLast / perFileFirst
    console.log(`\nSCALING: ms/file ${perFileFirst.toFixed(2)} at ${first.n} files -> ${perFileLast.toFixed(2)} at ${last.n} files  (ratio ${drift.toFixed(3)})`)
    console.log(drift < 1.15
      ? "  flat within 15% — no super-linear term visible in file count"
      : `  DRIFT of ${((drift - 1) * 100).toFixed(0)}% — investigate: a per-file cost that grows with the sample is a super-linear term`)
    const perFileRelFirst = first.ms / Math.max(1, first.rel)
    const perFileRelLast = last.ms / Math.max(1, last.rel)
    console.log(`  ms per relationship: ${(perFileRelFirst * 1000).toFixed(1)}us -> ${(perFileRelLast * 1000).toFixed(1)}us (ratio ${(perFileRelLast / perFileRelFirst).toFixed(3)})`)
  }
}

if (import.meta.main) await main()
