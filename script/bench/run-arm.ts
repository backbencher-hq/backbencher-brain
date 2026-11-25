#!/usr/bin/env node
// script/bench/run-arm.ts — execute ONE task in ONE arm and write a complete run record.
//
// WHAT THIS IS. The runner is the only place an arm's conditions are applied, so it is
// the only place a violation can be caught. It does six things in a fixed order, and the
// order is the safety:
//
//   1. build the arm's disposable DSH home (bb server present only for C/D, bb CLI shimmed
//      for A/B)                                            -> lib/profile.ts
//   2. copy the pinned project into a fresh workspace       (never mutate the pin)
//   3. index (arms C/D only -- A/B have no bb at all)
//   4. PROBE TURN: assert the arm is the arm               <- closes the silent no-tools hole
//   5. run the task, stamping arrival times on the NDJSON  -> lib/trace.ts
//   6. write run-record.json + trace.ndjson + patch + checksums
//
// WHY THE PROBE. A C arm whose `mcp-bb` row fails to load COMPLETES, and the agent
// answers confidently with no bb tools. That run looks exactly like "bb does not help".
// The probe is one cheap turn whose only job is to make that impossible to score.
//
// WHAT IT REFUSES TO DO. It will not record a run that cannot be published: a missing
// trace, an unrecorded embedder, a successful bb invocation in a no-bb arm, or a
// keyword-fallback semantic answer in a C2 run are all `invalid` with a named reason,
// never a quietly-scored zero.

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync, readdirSync, statSync, appendFileSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { buildProfile, runEnv, ARM_SPECS, ARMS, type Arm } from "./lib/profile.ts"
import { exec, streamStamped } from "./lib/exec.ts"
import { readTrace, summarize, discoveryTax, tokenTotals } from "./lib/trace.ts"
import { scrubFile } from "./lib/scrub.ts"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../..")

// ── args ───────────────────────────────────────────────────────────────────────
interface Args {
  task: string
  arm: Arm
  wave: string
  embeddingArm: "C0" | "C1" | "C2"
  rep: number
  provider: string
  model: string
  concurrency: number
  fixture: boolean
  probeOnly: boolean
  keepWork: boolean
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
  }
  const task = get("task")
  const arm = get("arm") as Arm | undefined
  if (!task) throw new Error("--task <path to task.json> is required")
  if (!arm || !ARMS.includes(arm)) throw new Error(`--arm must be one of ${ARMS.join(",")}`)
  return {
    task: path.resolve(task),
    arm,
    wave: get("wave") ?? "W0",
    embeddingArm: (get("embedding-arm") as "C0" | "C1" | "C2") ?? "C0",
    rep: Number(get("rep") ?? 1),
    provider: get("provider") ?? "freepi",
    model: get("model") ?? "deepseek-v4.1-flash",
    concurrency: Number(get("concurrency") ?? 1),
    fixture: argv.includes("--fixture"),
    probeOnly: argv.includes("--probe-only"),
    keepWork: argv.includes("--keep-work"),
  }
}

// ── small helpers ──────────────────────────────────────────────────────────────
const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex")

function copyDir(from: string, to: string): void {
  cpSync(from, to, { recursive: true })
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === "node_modules") continue
    const p = path.join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walkFiles(p, out)
    else out.push(p)
  }
  return out
}

/** Peak RSS of a child process, from /proc if it outlived the wait. Best-effort by
 *  design: `null` is honest, an invented number is not. */
function peakRssMbOfSelf(): number | null {
  try {
    const status = readFileSync("/proc/self/status", "utf8")
    const m = /VmHWM:\s+(\d+)\s+kB/.exec(status)
    return m ? Math.round(Number(m[1]) / 1024) : null
  } catch {
    return null
  }
}

interface TaskDef {
  id: string
  track: string
  project: string
  prompt: string
  golden: { files: string[]; patch: string; needle: string | null }
  budget: { max_steps: number; max_tokens: number; max_wall_s: number }
  grade: { must_pass: string[]; must_not_break: string[] }
}

interface ProjectDef {
  id: string
  source: string
  test: string[]
  languages_indexed: string[]
}

// ── main ───────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2))
  const spec = ARM_SPECS[a.arm]

  const taskDir = path.dirname(a.task)
  const task = JSON.parse(readFileSync(a.task, "utf8")) as TaskDef
  const fixtureRoot = path.resolve(taskDir, "..")
  const projectFile = a.fixture ? path.join(fixtureRoot, "project.json") : path.join(fixtureRoot, "..", "project.json")
  if (!existsSync(projectFile)) throw new Error(`no project.json at ${projectFile}`)
  const project = JSON.parse(readFileSync(projectFile, "utf8")) as ProjectDef
  // `source` is REPO-relative (it is a pin: one path, shared by every wave). Resolving it
  // against the fixture root instead would silently work for the fixture and break for
  // every real project, so it is resolved once, here, against the repo.
  const projectSrc = path.isAbsolute(project.source)
    ? project.source
    : path.resolve(REPO_ROOT, project.source)

  const runId = `${a.wave}-${task.id}-arm${a.arm}-${a.embeddingArm}-r${a.rep}`
  const waveRoot = path.join(REPO_ROOT, "benchmarks", ".work", a.wave)
  const runDir = path.join(waveRoot, "runs", runId)
  rmSync(runDir, { recursive: true, force: true })
  mkdirSync(runDir, { recursive: true })
  const workDir = path.join(runDir, "workspace")
  copyDir(projectSrc, workDir)

  const record: Record<string, unknown> = {
    schemaVersion: 1,
    wave: a.wave,
    runId,
    task_id: task.id,
    arm: a.arm,
    embedding_arm: a.embeddingArm,
    repetition: a.rep,
    status: "valid",
    invalid_reason: null,
    model: { provider: a.provider, model: a.model, temperature: 0, context_window: null, quantization: null },
    harness: { kind: "dsh-headless", version: null, commit: null },
    bb: {
      version: null,
      index_health: null,
      index_health_verbatim: null,
      embedding_config: a.embeddingArm === "C0" ? "local-word-vectors-v3:50" : null,
      embedding_endpoint: null,
      embedding_warmup: false,
    },
    arm_enforcement: {
      bb_mcp_mounted: spec.bbMcp,
      bb_cli_shimmed: false,
      bb_cli_invocations: 0,
      absolute_path_invocations: 0,
    },
    memory: { ram_total_gb: Math.round(os.totalmem() / 1024 ** 3 * 10) / 10, ram_available_gb_at_start: null, peak_rss_index_mb: null, peak_rss_agent_mb: null },
    concurrency: a.concurrency,
    cost: { wall_s: 0, tokens_in: 0, tokens_out: 0, tool_calls: 0, tool_call_bytes: 0, tool_call_ms: 0 },
    discovery: {
      // Populated after the measured turn. Tokens are primary; ms is arrival (upper bound).
      static_prefix_tokens: null,
      tokens_before_first_edit: null,
      tokens_before_first_edit_complete: false,
      first_edit_step: null,
      first_edit_ms: null,
      measured_on: "tokens-primary; ms is runner-arrival (upper bound)",
    },
    bb_usage: { calls: 0, by_tool: {}, refusals: 0, fallback_answers: 0, fallback_rate: 0 },
    submission: { diff_path: null, files_changed: 0, lines_added: 0, lines_removed: 0 },
    grade: { grade_path: null, success: false, score: 0 },
    evidence: null,
    timing: { source: "runner-arrival", resolution_ms: 1 },
  }

  const finish = (status: string, reason: string | null): void => {
    record.status = status
    record.invalid_reason = reason
    writeFileSync(path.join(runDir, "run-record.json"), JSON.stringify(record, null, 2) + "\n")
  }

  // ── 1. the arm's home ────────────────────────────────────────────────────────
  const profile = buildProfile({
    waveRoot,
    arm: a.arm,
    projectDir: workDir,
    provider: a.provider,
    model: a.model,
  })
  ;(record.arm_enforcement as Record<string, unknown>).bb_cli_shimmed = profile.cliShimmed
  ;(record.arm_enforcement as Record<string, unknown>).bb_mcp_mounted = profile.bbMcpMounted

  const dshBin = process.env.BENCH_DSH_BIN ?? "dsh"
  const bbDir = path.join(waveRoot, "bbdata")
  const env = runEnv(profile, {
    BB_DATA_DIR: bbDir,
    ...(a.embeddingArm === "C0" ? { BB_EMBEDDING_DISABLED: "1" } : {}),
  })

  // ── 2/3. index (only arms with bb) ──────────────────────────────────────────
  if (spec.bbMcp) {
    const idx = await exec(process.env.BENCH_BB_BIN ?? path.join(REPO_ROOT, "bin", "bb"), ["index", ".", "--no-setup"], {
      cwd: workDir,
      env,
      timeoutMs: 10 * 60 * 1000,
    })
    ;(record.memory as Record<string, unknown>).peak_rss_index_mb = peakRssMbOfSelf()
    if (idx.code !== 0) {
      finish("invalid", `index-failed: ${idx.stderr.split("\n").slice(-3).join(" ").slice(0, 400)}`)
      return
    }
    // bb version + verbatim health, for the publication header.
    const ver = await exec(process.env.BENCH_BB_BIN ?? path.join(REPO_ROOT, "bin", "bb"), ["--version"], { cwd: workDir, env, timeoutMs: 60_000 })
    ;(record.bb as Record<string, unknown>).version = ver.stdout.trim() || null
    const health = await exec(process.env.BENCH_BB_BIN ?? path.join(REPO_ROOT, "bin", "bb"), ["health"], { cwd: workDir, env, timeoutMs: 120_000 })
    const hv = (health.stdout || "").trim()
    ;(record.bb as Record<string, unknown>).index_health_verbatim = hv.slice(0, 4000) || null
    const healthy = /freshness:/.test(hv) && !/MODEL_MISMATCH|Model mismatch/i.test(hv)
    ;(record.bb as Record<string, unknown>).index_health = healthy ? "green" : "degraded"
  }

  // ── 4. the probe turn: is the arm the arm? ──────────────────────────────────
  // Task-relative paths (prompt, golden patch) resolve against the FIXTURE/PROJECT root,
  // which is where they live: tasks/ and prompts/ are siblings in every project slot.
  const promptPath = path.join(fixtureRoot, task.prompt)
  const promptBody = readFileSync(promptPath, "utf8")
  const probePrompt = spec.bbMcp
    ? "Use the bb_search tool to look up the symbol `subtotal`. Answer with only the file path it reports. Do not use any other tool."
    : "Answer with only the word: READY. Do not use any tool."

  const runTurn = async (prompt: string, label: string) => {
    const tracePath = path.join(runDir, `${label}.ndjson`)
    writeFileSync(tracePath, "")
    const res = await streamStamped(
      dshBin,
      ["--profile", "headless", "--json", "--permission-mode", "workspace-write", "--add-dir", workDir, prompt],
      { cwd: workDir, env, timeoutMs: Math.max(120_000, task.budget.max_wall_s * 1000) },
      (line, atMs) => {
        let stamped = line
        try {
          const obj = JSON.parse(line) as Record<string, unknown>
          obj._t_ms = atMs
          stamped = JSON.stringify(obj)
        } catch {
          stamped = JSON.stringify({ type: "unparsed", raw: line, _t_ms: atMs })
        }
        appendFileSync(tracePath, stamped + "\n")
      },
    )
    return { tracePath, res }
  }

  const probe = await runTurn(probePrompt, "probe")
  {
    const events = readTrace(probe.tracePath)
    const s = summarize(events)
    if (spec.bbMcp) {
      // C/D must have CALLED a bb tool and got a non-error answer.
      const ok = s.bbCallCount > 0 && s.bbRefusals === 0
      if (!ok) {
        finish("invalid", `probe: arm ${a.arm} has bb mounted but made ${s.bbCallCount} bb call(s) with ${s.bbRefusals} refusal(s) — the server did not load, so this run would measure an agent WITHOUT the tools`)
        return
      }
    } else {
      // A/B must have touched no bb tool.
      if (s.bbCallCount > 0) {
        finish("invalid", `probe: arm ${a.arm} is a no-bb arm but called ${s.bbCallCount} bb tool(s)`)
        return
      }
    }
  }

  if (a.probeOnly) {
    finish("valid", null)
    console.log(`probe ok: arm ${a.arm} (bb mounted=${spec.bbMcp})`)
    return
  }

  // ── 5. the measured turn ────────────────────────────────────────────────────
  const measured = await runTurn(promptBody, "trace")
  const events = readTrace(measured.tracePath)
  const s = summarize(events)

  // ── 6. evidence ─────────────────────────────────────────────────────────────
  // The submission is whatever the agent left in the tree: diff against the pin.
  const diff = await exec("git", ["--no-pager", "diff", "--no-index", "--no-color", "--", projectSrc, workDir], {
    cwd: REPO_ROOT,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } as Record<string, string>,
    timeoutMs: 120_000,
  })
  const patchPath = path.join(runDir, "submission.patch")
  writeFileSync(patchPath, diff.stdout)
  const filesChanged = new Set<string>()
  let linesAdded = 0
  let linesRemoved = 0
  for (const line of diff.stdout.split("\n")) {
    if (line.startsWith("+++ b/") || line.startsWith("+++ ")) {
      const f = line.replace(/^\+\+\+ (b\/)?/, "").replace(/\t.*$/, "")
      if (f && f !== "/dev/null") filesChanged.add(f)
    } else if (line.startsWith("+") && !line.startsWith("+++")) linesAdded++
    else if (line.startsWith("-") && !line.startsWith("---")) linesRemoved++
  }

  // bb-leak scan: a no-bb arm that reached the CLI (by any path) is invalid.
  const enforcement = record.arm_enforcement as Record<string, unknown>
  const absBb = profile.shadowedBb ? path.resolve(profile.shadowedBb) : null
  let bbCliInvocations = 0
  let absInvocations = 0
  if (!spec.bbMcp) {
    for (const c of s.toolCalls) {
      const text = JSON.stringify(c.input ?? "")
      if (/(^|[\s"'=;&|(])bb\s+(mcp|index|tool|setup|health|stats|status|search|ask|--version|-v)\b/.test(text)) bbCliInvocations++
      if (absBb && text.includes(absBb)) absInvocations++
    }
  }
  enforcement.bb_cli_invocations = bbCliInvocations
  enforcement.absolute_path_invocations = absInvocations

  const bbUsage = record.bb_usage as Record<string, unknown>
  bbUsage.calls = s.bbCallCount
  bbUsage.by_tool = s.toolCounts
  bbUsage.refusals = s.bbRefusals
  bbUsage.fallback_answers = s.bbFallbackAnswers
  bbUsage.fallback_rate = s.bbCallCount > 0 ? Math.round((s.bbFallbackAnswers / s.bbCallCount) * 1000) / 1000 : 0

  const cost = record.cost as Record<string, unknown>
  cost.wall_s = Math.round(measured.res.ms / 100) / 10
  cost.tool_calls = s.toolCalls.length
  cost.tool_call_bytes = s.toolResultBytes

  // DISCOVERY TAX. Tokens are the primary measure (the trace has no harness timestamps);
  // ms is an arrival-time UPPER BOUND used only for ordering. Nulls are explicit about
  // WHICH part was unmeasurable -- "unknown" must never read as zero.
  const tax = discoveryTax(events, task.golden.files)
  const totals = tokenTotals(events)
  const disc = record.discovery as Record<string, unknown>
  disc.static_prefix_tokens = tax.staticPrefixTokens
  disc.tokens_before_first_edit = tax.tokensBeforeFirstEdit
  disc.tokens_before_first_edit_complete = tax.complete
  disc.first_edit_step = tax.firstGoldenEditStep
  disc.first_edit_ms = tax.firstGoldenEditMs
  disc.measured_on = "tokens-primary; ms is runner-arrival (upper bound)"
  ;(record.cost as Record<string, unknown>).tokens_in = totals.input ?? 0
  ;(record.cost as Record<string, unknown>).tokens_out = totals.output ?? 0
  ;(record.cost as Record<string, unknown>).tokens_cached = totals.cacheRead ?? 0
  ;(record.cost as Record<string, unknown>).usage_complete = totals.complete

  const sub = record.submission as Record<string, unknown>
  sub.diff_path = path.relative(runDir, patchPath)
  sub.files_changed = filesChanged.size
  sub.lines_added = linesAdded
  sub.lines_removed = linesRemoved

  // ── invalidity gates, in the order they must be checked ─────────────────────
  if (measured.res.timedOut) { finish("invalid", "budget: wall clock exceeded"); return }
  if (!spec.bbMcp && (bbCliInvocations > 0 || absInvocations > 0)) {
    finish("invalid", `bb-leak: arm ${a.arm} invoked the bb CLI ${bbCliInvocations} time(s) (${absInvocations} by absolute path); the control arm was not a control`)
    return
  }
  if (s.suspiciousCalls.length > 0) {
    finish("invalid", `network/install: ${s.suspiciousCalls.map((c) => c.why).join("; ").slice(0, 300)}`)
    return
  }
  if (a.embeddingArm === "C2" && spec.bbMcp && s.bbCallCount > 0 && s.bbFallbackAnswers > 0) {
    finish("invalid", `embedding: ${s.bbFallbackAnswers} bb answer(s) declared a lexical/keyword fallback; a C2 run must measure the semantic path`)
    return
  }

  // ── evidence block + checksums ──────────────────────────────────────────────
  const traceText = readFileSync(measured.tracePath, "utf8")
  const sessionDir = path.join(profile.home, "sessions")
  let sessionPath: string | null = null
  if (existsSync(sessionDir)) {
    for (const slug of readdirSync(sessionDir)) {
      const sd = path.join(sessionDir, slug)
      if (!statSync(sd).isDirectory()) continue
      for (const id of readdirSync(sd)) {
        const f = path.join(sd, id, "session.v4.jsonl.zstd")
        if (existsSync(f)) sessionPath = f
      }
    }
  }
  // The harness's independent session record is COPIED into the run directory. Leaving it
  // in the disposable DSH home would make the evidence path point at a directory that is
  // wiped between waves -- a citation that resolves today and 404s tomorrow is not
  // evidence.
  let sessionRel: string | null = null
  if (sessionPath) {
    const dest = path.join(runDir, "session.v4.jsonl.zstd")
    cpSync(sessionPath, dest)
    sessionRel = "session.v4.jsonl.zstd"
  }
  const files: Record<string, string> = {
    [path.basename(measured.tracePath)]: sha256(traceText),
    "submission.patch": sha256(diff.stdout),
  }
  if (sessionRel) files["session.v4.jsonl.zstd"] = sha256(readFileSync(path.join(runDir, sessionRel)))
  // PUBLISH GUARD. The trace is written by a process that had the operator's DSH home on
  // DSH_HOME, so it can contain a credential a tool result echoed. If it does, this run
  // REFUSES to publish -- it is not sanitised, because an edited trace is no longer the
  // trace of what happened. Path normalisation is separate and recorded.
  const scrubbed = scrubFile(measured.tracePath, { workspace: workDir, write: false })
  if (!scrubbed.ok) {
    finish("invalid", `secret: evidence contains ${scrubbed.findings.map((f) => `${f.kind} at ${f.where}`).join("; ").slice(0, 300)}; refusing to publish a trace with a credential`)
    return
  }
  if (scrubbed.normalised.length > 0) {
    writeFileSync(measured.tracePath, scrubbed.text)
  }
  const finalTrace = readFileSync(measured.tracePath, "utf8")
  record.evidence = {
    trace_path: path.relative(runDir, measured.tracePath),
    session_path: sessionRel,
    trace_lines: finalTrace.split("\n").filter((l) => l.trim()).length,
    trace_sha256: sha256(finalTrace),
    session_sha256: sessionRel ? sha256(readFileSync(path.join(runDir, sessionRel))) : null,
    scrubbed: true,
    scrape_findings: scrubbed.normalised.map((n) => `normalised ${n.from} -> ${n.to}`),
  }
  writeFileSync(
    path.join(runDir, "checksums.txt"),
    Object.entries(files).map(([f, h]) => `${h}  ${f}`).join("\n") + "\n",
  )

  finish("valid", null)
  if (!a.keepWork) rmSync(workDir, { recursive: true, force: true })
  console.log(`valid: ${runId}  status=valid tokens_in=${cost.tokens_in} tools=${cost.tool_calls} changed=${filesChanged.size}`)
}

main().catch((e: unknown) => {
  console.error(`run-arm: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
