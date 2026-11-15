/**
 * HANG PROBE — which FILE the parser cannot finish, and whether that is a property of the
 * file or of the load. Run as a child process per measurement so a hang is a RECORDED
 * outcome instead of a dead measurement.
 *
 * ## Why this file exists
 *
 * `src/ast/engine.ts:1408` arms `setTimeout(() => process.exit(1), 120000)` immediately
 * before `parser.parse(content)`, because that call is synchronous WASM and a timer cannot
 * interrupt it. When it fires the message is
 *
 *     [BB-HANG] parser stuck 120s on <file> — exiting
 *
 * and the whole process dies. `script/m14/ontology-coverage-gate.ts` has no resume, so one
 * such file means the gate produces NO verdict for a language. This lane has lost three
 * arbiter runs to it:
 *
 *   run 1  Grace/sdk/generated/matrix/openapi-generator/rust/docs/DiffDto.md   (883 bytes)
 *   run 2  FsToolkit.ErrorHandling/gitbook/validation/ofChoice.md             (416 bytes)
 *   run 3  FsToolkit.ErrorHandling/gitbook/validation/ofChoice.md             (416 bytes)
 *
 * **A 416-byte file cannot take 120 seconds to parse.** So the mechanism is not slowness,
 * and "the corpus is big" cannot be the explanation. That leaves exactly two candidates and
 * this probe separates them:
 *
 *   (a) FILE — a construct in that one document sends the grammar into a non-terminating
 *       state, or a trap leaves the parser instance unusable. Reproducible alone.
 *   (b) LOAD — nothing hangs alone; the file only fails when N parsers compete for CPU.
 *
 * They need different fixes and they are different findings, so the lane's earlier
 * measurement of the six `[BB-PARSE-ERR]` files (which are DISJOINT from the hang files, and
 * which do parse alone in 60–2,678 ms) says nothing about this one. This probe parses the
 * HANG files, not the error files.
 *
 * ## What it measures, per (file, mode)
 *
 *   block   the pinned `wasm/tree-sitter-markdown.wasm` alone, which is the parse the
 *           watchdog is armed around
 *   inline  the pinned companion inline grammar alone
 *   prod    production `parseFile` from `src/ast/pool-worker.ts` — the entry point the
 *           arbiter actually calls, carrying the engine's pre-parse and the worker's filters
 *
 * and then the same files through `prod` at concurrency 1 / 8 / 32, because (b) is a claim
 * about concurrency and asserting it without running the higher number would be an argument
 * rather than a measurement.
 *
 * Each measurement is a child process with an external `kill` deadline, so a hang is
 * reported as `HANG after <ms>` — a number — instead of ending the probe.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/markdown/hang-probe.ts
 *   npx tsx validation/m14/fixtures/markdown/hang-probe.ts --one <file> --mode prod
 *   npx tsx validation/m14/fixtures/markdown/hang-probe.ts --concurrency 32
 *   npx tsx validation/m14/fixtures/markdown/hang-probe.ts --out <path.json>
 *
 * READ-ONLY apart from the `--out` artifact. Writes nothing to the repository by default.
 */
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const SELF = path.join(ROOT, "validation/m14/fixtures/markdown/hang-probe.ts")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

/** The deadline is set ABOVE engine's own 120 s, so "engine fired first" is distinguishable. */
const DEADLINE_MS = Number(arg("deadline", "150000"))

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

/** Every file the three arbiter runs named, from `validation/m60/markdown/logs/arbiter-run{1,2}.log`. */
const NAMED: { run: string; rel: string }[] = [
  { run: "run1", rel: "Grace/sdk/generated/matrix/openapi-generator/rust/docs/DiffDto.md" },
  { run: "run2", rel: "FsToolkit.ErrorHandling/gitbook/validation/ofChoice.md" },
  { run: "run3", rel: "FsToolkit.ErrorHandling/gitbook/validation/ofChoice.md" },
]

// ─────────────────────────────────────────────────────────────────────── child mode

if (flag("one")) {
  const file = arg("file", "")
  const mode = arg("mode", "prod")
  // In-process repetitions. `npx tsx` startup costs 8–25 s on this box at loadavg ~27, which is
  // longer than the parse itself, so a per-measurement child would spend all its budget on
  // process startup and a hang would be indistinguishable from a slow start. One child does
  // all repetitions; progress goes to stderr unbuffered so a kill still shows how far it got.
  const reps = Math.max(1, Number(arg("reps-inproc", "1")))
  const out: Record<string, unknown>[] = []
  try {
    let parse: (text: string) => any
    let release: () => void = () => {}
    if (mode === "block" || mode === "inline") {
      const wts: any = await import("web-tree-sitter")
      const WSP = wts.Parser ?? wts.default
      const WSL = wts.Language ?? wts.default?.Language
      await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
      const lang = await WSL.load(readFileSync(path.join(ROOT, "wasm", mode === "block" ? "tree-sitter-markdown.wasm" : "tree-sitter-markdown_inline.wasm")))
      const p = new WSP()
      p.setLanguage(lang)
      parse = (text: string) => p.parse(text)
      release = () => p.delete?.()
    } else {
      const { parseFile } = await import("../../../../src/ast/pool-worker")
      // parseFile is not reusable for a raw-grammar mode, so a `prod` rep is one whole call.
      parse = (() => {
        let queued: Promise<any> | null = null
        return (_text: string) => {
          if (!queued) queued = parseFile(file, path.dirname(file))
          const p = queued
          queued = null
          return p
        }
      })()
    }
    const text = readFileSync(file, "utf8")
    for (let i = 1; i <= reps; i++) {
      const t0 = Date.now()
      const r: any = await parse(text)
      const ms = Date.now() - t0
      process.stderr.write(`rep ${i}/${reps} ${ms}ms\n`)
      out.push({ rep: i, ms, rootType: r?.rootNode?.type ?? null, childCount: r?.rootNode?.childCount ?? null, symbols: r?.symbols?.length, relationships: r?.relationships?.length })
    }
    release()
    process.stdout.write(JSON.stringify({ ok: true, bytes: text.length, reps: out }))
    process.exit(0)
  } catch (e: any) {
    process.stdout.write(JSON.stringify({ ok: false, error: String(e?.message ?? e), reps: out }))
    process.exit(0)
  }
}

// ───────────────────────────────────────────────────── concurrent prod, one process

if (flag("concurrency")) {
  const n = Number(arg("concurrency", "8"))
  const { parseFile } = await import("../../../../src/ast/pool-worker")
  const files = NAMED.map((x) => path.join(CR, x.rel)).filter((f) => existsSync(f))
  const t0 = Date.now()
  let i = 0
  const perFile: Record<string, { ms: number; symbols?: number; relationships?: number; error?: string }> = {}
  const worker = async () => {
    while (true) {
      const k = i++
      if (k >= files.length) return
      const f = files[k]
      const s = Date.now()
      try {
        const r: any = await parseFile(f, path.dirname(f))
        perFile[f] = { ms: Date.now() - s, symbols: r?.symbols?.length ?? 0, relationships: r?.relationships?.length ?? 0 }
      } catch (e: any) {
        perFile[f] = { ms: Date.now() - s, error: String(e?.message ?? e) }
      }
    }
  }
  await Promise.all(Array.from({ length: n }, () => worker()))
  const out = { mode: `prod-concurrency-${n}`, files: files.length, wallMs: Date.now() - t0, perFile }
  const outPath = arg("out", "")
  if (outPath) {
    mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
    writeFileSync(path.resolve(outPath), JSON.stringify(out, null, 2))
  }
  console.log(`concurrency ${n}: ${files.length} files in ${Date.now() - t0}ms`)
  for (const [f, v] of Object.entries(perFile)) console.log(`  ${v.ms}ms ${path.relative(CR, f)} ${v.error ?? `${v.symbols} symbols ${v.relationships} rel`}`)
  process.exit(0)
}

// ───────────────────────────────────────────── trap sweep: is the WASM trap a race?

/**
 * The `[BB-PARSE-ERR] … memory access out of bounds` lines and the `[BB-HANG]` lines are
 * the SAME FILES, and the hang lands exactly 120 s after the trap:
 *
 *   run 1  trap DiffDto.md 18:51:20  ->  [BB-HANG] DiffDto.md 18:53:23   (+123 s)
 *   run 2  trap ofChoice.md 19:01:51 ->  [BB-HANG] ofChoice.md 19:04:03  (+132 s)
 *
 * `src/ast/engine.ts:1410` arms `setTimeout(…, 120000)` and `:1416` calls `clearTimeout`
 * AFTER `parser.parse(content)`. When `parse` THROWS — a WASM trap does — the throw skips
 * `clearTimeout`, so the timer stays armed and fires 120 s later naming a file whose parse
 * already failed fast, then `process.exit(1)` kills the gate. No parse takes 120 s.
 *
 * So what makes `parse` throw, given the same file parses 10/10 alone (the parent mode
 * above)? The candidates are a property of the FILE and a property of the CONCURRENCY.
 * The file half is already excluded. This mode is the concurrency half: the SAME admitted
 * file list, the SAME production `parseFile`, ONE process, at concurrency 1 and 8 — the two
 * numbers `script/m14/ontology-coverage-gate.ts:234` uses. If only the 8 traps, the trap is
 * a race on the single cached `markdown` Parser (`ASTEngine.getParser` returns one Parser
 * per language to every caller, and `:711` `delete()`s it every 500 parses while other
 * async callers still hold Trees carved out of it).
 *
 * Each concurrency runs in its OWN child process, because the parser cache and its 500-parse
 * recycle counter are exactly the state under test and must not carry across the two runs.
 */
if (flag("trap-sweep") && flag("child")) {
  const { detectLanguageFromPath } = await import("../../../../src/ast/language-detection")
  const { execFileSync: ex } = await import("node:child_process")
  const { statSync: st } = await import("node:fs")
  const admitted: { abs: string; dir: string; rel: string }[] = []
  for (const e of readdirSync(CR)) {
    const dir = path.join(CR, e)
    try {
      if (!st(dir).isDirectory()) continue
      ex("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[]
    try {
      tracked = ex("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      try {
        if (st(abs).size > 512 * 1024) continue
        const text = readFileSync(abs, "utf8")
        if (detectLanguageFromPath(abs, text) !== "markdown") continue
      } catch {
        continue
      }
      admitted.push({ abs, dir, rel })
    }
  }
  // Deterministic stride sample over the ADMITTED order the gate itself builds (readdir +
  // git ls-files), so the two concurrencies see byte-identical input sets.
  const LIMIT = Math.max(1, Number(arg("files", "800")))
  const stride = Math.max(1, Math.floor(admitted.length / LIMIT))
  const sample = admitted.filter((_, i) => i % stride === 0).slice(0, LIMIT)
  const conc = Math.max(1, Number(arg("conc", "8")))
  const { parseFile } = await import("../../../../src/ast/pool-worker")
  /**
   * The metric is `fallback: true`, NOT a thrown exception.
   *
   * `parseFile` catches the trap: `src/ast/pool-worker.ts:1136` writes `[BB-PARSE-ERR]` and
   * returns `extractFallback(...)`, so it never rethrows and an exception counter reads 0 by
   * construction. An earlier version of this probe counted throws and reported `traps: 0`
   * next to 1,114 `[BB-PARSE-ERR]` lines in the same run, which is the artifact lying and not
   * the measurement. `fallback: true` is the production-visible signal of the same event —
   * it is what `whole-corpus-census.ts` counts as `degradedParse`, and it is what
   * `extractFallback`'s `errors: []` hides from anything reading the return value.
   */
  const degraded: { index: number; file: string; bytes: number; cumBytes: number; ms: number; symbols: number; relationships: number }[] = []
  let ok = 0
  let i = 0
  /** Bytes fed to the parser so far, in the order the workers took them. Approximate under
   *  concurrency, exact at concurrency 1 — which is the run that identifies the threshold. */
  let cumBytes = 0
  const worker = async () => {
    while (true) {
      const k = i++
      if (k >= sample.length) return
      const f = sample[k]
      const s = Date.now()
      const bytes = readFileSync(f.abs).length
      cumBytes += bytes
      try {
        const r: any = await parseFile(f.abs, f.dir)
        if (r?.fallback === true) {
          degraded.push({
            index: k,
            file: path.relative(CR, f.abs),
            bytes,
            cumBytes,
            ms: Date.now() - s,
            symbols: r?.symbols?.length ?? 0,
            relationships: r?.relationships?.length ?? 0,
          })
        } else ok++
      } catch (e: any) {
        degraded.push({ index: k, file: path.relative(CR, f.abs), bytes, cumBytes, ms: Date.now() - s, symbols: -1, relationships: -1 })
      }
    }
  }
  const t0 = Date.now()
  await Promise.all(Array.from({ length: conc }, () => worker()))
  const first = degraded.find((d) => d.symbols >= 0) ?? degraded[0] ?? null
  process.stdout.write(
    JSON.stringify({
      ok: true,
      concurrency: conc,
      admitted: admitted.length,
      sample: sample.length,
      stride,
      parsedByTheRealAnalyzer: ok,
      degraded: degraded.length,
      /** The threshold measurement: the first file in THIS process that degraded, by position
       *  in the sample and by the bytes fed to the parser before it. Concurrency 1 makes both
       *  exact. Compare against a clean run at a smaller sample size to bracket it. */
      firstDegraded: first,
      totalBytesFed: cumBytes,
      degradedFiles: degraded,
      wallMs: Date.now() - t0,
    }),
  )
  process.exit(0)
}

// Parent for the trap sweep: one fresh child per concurrency, so the parser cache and its
// 500-parse recycle counter cannot leak from one run into the other.
if (flag("trap-sweep")) {
  const concs = arg("concurrencies", "1,8").split(",").map((x) => Number(x.trim()))
  const files = arg("files", "800")
  const runs: Record<string, unknown>[] = []
  for (const c of concs) {
    const r = spawnSync("npx", ["tsx", SELF, "--trap-sweep", "--child", "--conc", String(c), "--files", files], {
      encoding: "utf8",
      // Above 120 s so a genuine leaked-timer `process.exit(1)` is distinguishable from the
      // external kill: engine's own exit is status 1, an external kill is a signal.
      timeout: Number(arg("sweep-deadline", "900000")),
      maxBuffer: 64 * 1024 * 1024,
    })
    let parsed: any
    try {
      parsed = JSON.parse(r.stdout || "{}")
    } catch {
      parsed = { unparsed: true, status: r.status, signal: r.signal, stderr: (r.stderr ?? "").slice(-600) }
    }
    runs.push({ requestedConcurrency: c, status: r.status, signal: r.signal, stderrTail: (r.stderr ?? "").split("\n").filter((l) => l.includes("BB-PARSE-ERR") || l.includes("BB-HANG")).length, ...parsed })
    const p: any = parsed
    const errLines = (r.stderr ?? "").split("\n").filter((l) => l.includes("BB-PARSE-ERR")).length
    const hangLine = (r.stderr ?? "").split("\n").find((l) => l.includes("BB-HANG")) ?? null
    console.log(
      `concurrency ${String(c).padStart(2)}  sample ${p.sample ?? "?"}  real-analyzer ${p.parsedByTheRealAnalyzer ?? "?"}  DEGRADED ${p.degraded ?? "?"}  BB-PARSE-ERR ${errLines}  ${p.wallMs ? `${(p.wallMs / 1000).toFixed(1)}s` : `exit=${r.status} signal=${r.signal}`}${hangLine ? `  LEAKED-TIMER EXIT: ${hangLine.slice(0, 110)}` : ""}`,
    )
    for (const t of (p.degradedFiles ?? []).slice(0, 4)) console.log(`    degraded #${t.index} ${t.file} — ${t.symbols} symbols ${t.relationships} rel`)
    if (p.firstDegraded) console.log(`    FIRST degraded at sample index ${p.firstDegraded.index} after ${p.firstDegraded.cumBytes} bytes fed`)
    if ((p.degradedFiles ?? []).length > 6) console.log(`    … ${p.degradedFiles.length - 6} more degraded files in the artifact`)
  }
  const summary = {
    generatedBy: "validation/m14/fixtures/markdown/hang-probe.ts --trap-sweep",
    corpusRoot: CR,
    sampleMethod: "admitted markdown files in the gate's own order (readdirSync + git ls-files), then every `stride`-th file, stride = floor(admitted/limit) — identical byte-for-byte in both runs",
    note: "src/ast/engine.ts:1410 arms the 120s parse bomb, :1416 clearTimeout runs only when parse RETURNS; a WASM trap throws past it and the leaked timer later exits the process naming a file that already failed fast",
    runs,
  }
  const outPath = arg("out", "")
  if (outPath) {
    mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
    writeFileSync(path.resolve(outPath), JSON.stringify(summary, null, 2))
    console.log(`\nwrote ${path.resolve(outPath)}`)
  }
  process.exit(0)
}

// ─────────────────────────────────────────────────────────────────────── parent mode

type Row = {
  run: string
  rel: string
  abs: string
  bytes: number
  mode: string
  outcome: "ok" | "ERROR" | "HANG"
  ms: number
  detail: Record<string, unknown>
}

const rows: Row[] = []
function measure(run: string, rel: string, mode: string, reps: number): Row {
  const abs = path.join(CR, rel)
  if (!existsSync(abs)) {
    return { run, rel, abs, bytes: -1, mode, outcome: "ERROR", ms: 0, detail: { error: "file absent from the corpus" } }
  }
  const bytes = readFileSync(abs).length
  const t0 = Date.now()
  const r = spawnSync("npx", ["tsx", SELF, "--one", "--file", abs, "--mode", mode, "--reps-inproc", String(reps)], {
    encoding: "utf8",
    timeout: DEADLINE_MS,
    killSignal: "SIGKILL",
    maxBuffer: 64 * 1024 * 1024,
  })
  const ms = Date.now() - t0
  // How many repetitions finished before the kill. stderr is written unbuffered after each rep,
  // so this count survives a kill that prevents the stdout write.
  const completed = [...(r.stderr ?? "").matchAll(/^rep (\d+)\/(\d+) (\d+)ms$/gm)].map((m) => ({ rep: Number(m[1]), ms: Number(m[3]) }))
  if (r.signal === "SIGKILL") {
    return {
      run, rel, abs, bytes, mode, outcome: "HANG", ms,
      detail: {
        killedBy: `external deadline ${DEADLINE_MS}ms`,
        repsRequested: reps,
        repsCompleted: completed.length,
        completedTimings: completed,
        lastStderr: (r.stderr ?? "").trim().split("\n").slice(-3),
        note: "engine.ts:1408 arms its own 120s process.exit; this deadline is above it, so a child dying near 120000ms had engine fire first",
      },
    }
  }
  let parsed: any = {}
  try {
    parsed = JSON.parse(r.stdout || "{}")
  } catch {
    parsed = { raw: (r.stdout ?? "").slice(0, 400), stderr: (r.stderr ?? "").slice(0, 400) }
  }
  if (parsed.ok === false) return { run, rel, abs, bytes, mode, outcome: "ERROR", ms, detail: parsed }
  return { run, rel, abs, bytes, mode, outcome: "ok", ms, detail: { wallMs: ms, bytes: parsed.bytes, repsDone: parsed.reps?.length ?? 0, perRep: parsed.reps ?? [] } }
}

const REPS = Math.max(1, Number(arg("reps", "1")))
const INPROC = Math.max(1, Number(arg("reps-inproc", "10")))
const seen = new Set<string>()
for (const n of NAMED) {
  if (seen.has(n.rel)) continue
  seen.add(n.rel)
  for (const mode of ["block", "inline", "prod"]) {
    const row = measure(n.run, n.rel, mode, INPROC)
    rows.push(row)
    const d = row.detail as any
    console.log(
      `${row.outcome.padEnd(5)} wall ${String(row.ms).padStart(7)}ms ${mode.padEnd(6)} ${String(row.bytes).padStart(5)}B ${n.rel}` +
        (row.outcome === "ok"
          ? `  reps ok ${d.repsDone}/${INPROC}  ${(d.perRep ?? []).map((x: any) => x.ms).join(",")}ms`
          : `  reps ${d.repsCompleted}/${d.repsRequested} then hung`),
    )
  }
}

const summary = {
  generatedBy: "validation/m14/fixtures/markdown/hang-probe.ts",
  deadlineMs: DEADLINE_MS,
  engineWatchdogMs: 120000,
  corpusRoot: CR,
  namedBy: "the [BB-HANG] lines of arbiter-run1.log, arbiter-run2.log and the run-3 commit message",
  rows,
  hangs: rows.filter((r) => r.outcome === "HANG").length,
  errors: rows.filter((r) => r.outcome === "ERROR").length,
  ok: rows.filter((r) => r.outcome === "ok").length,
}
const outPath = arg("out", "")
if (outPath) {
  mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
  writeFileSync(path.resolve(outPath), JSON.stringify(summary, null, 2))
  console.log(`\nwrote ${path.resolve(outPath)}`)
}
console.log(`\nok ${summary.ok}  ERROR ${summary.errors}  HANG ${summary.hangs}`)