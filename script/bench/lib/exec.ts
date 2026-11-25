// script/bench/lib/exec.ts — run one command and capture its output + timing.
//
// The runner must never inherit a shell's incidental state: a benchmark run that picks
// up the operator's exported BB_EMBEDDING_* would silently measure a different
// configuration than the one recorded. So env is built explicitly and passed whole.

import { spawn } from "node:child_process"

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
  ms: number
  /** Set when the process had to be killed for exceeding its budget. */
  timedOut: boolean
}

export interface ExecOptions {
  cwd: string
  env: Record<string, string>
  /** Hard wall-clock bound; the process is killed and `timedOut` is reported. */
  timeoutMs: number
  /** Cap on retained stdout bytes (the tail is kept, which is what carries the error). */
  maxOutputBytes?: number
}

const enc = new TextEncoder()

export async function exec(cmd: string, args: string[], opts: ExecOptions): Promise<ExecResult> {
  const started = Date.now()
  const cap = opts.maxOutputBytes ?? 8 * 1024 * 1024
  return await new Promise<ExecResult>((resolve) => {
    let out = ""
    let err = ""
    let timedOut = false
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ["ignore", "pipe", "pipe"] })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, opts.timeoutMs)

    const append = (buf: Buffer, which: "out" | "err") => {
      const s = buf.toString("utf8")
      if (which === "out") out = (out + s).slice(-cap)
      else err = (err + s).slice(-cap)
    }
    child.stdout?.on("data", (b: Buffer) => append(b, "out"))
    child.stderr?.on("data", (b: Buffer) => append(b, "err"))
    child.on("error", (e) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout: out, stderr: err + `\nspawn error: ${e.message}`, ms: Date.now() - started, timedOut })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout: out, stderr: err, ms: Date.now() - started, timedOut })
    })
  })
}

/**
 * Stream a command's stdout line-by-line while ALSO stamping each line with its arrival
 * time, producing the trace the evidence is built from.
 *
 * WHY NOT `exec`: the DSH `--json` stream carries no timestamps of its own (verified in
 * @deepseek-ai/dsh-headless/src/json-stream.ts), so the only clock available is arrival.
 * That makes arrival time an UPPER BOUND on the agent's latency -- it includes pipe and
 * scheduling delay -- which is why the report uses tokens as the primary discovery
 * measure and this only for ordering. See docs/benchmarks/HARNESS.md 5a.
 */
export async function streamStamped(
  cmd: string,
  args: string[],
  opts: ExecOptions,
  onLine: (line: string, atMs: number) => void,
): Promise<ExecResult> {
  const started = Date.now()
  const cap = opts.maxOutputBytes ?? 4 * 1024 * 1024
  return await new Promise<ExecResult>((resolve) => {
    let err = ""
    let pending = ""
    let timedOut = false
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ["ignore", "pipe", "pipe"] })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, opts.timeoutMs)

    const flush = (final: boolean) => {
      const parts = pending.split("\n")
      pending = final ? "" : (parts.pop() ?? "")
      for (const line of parts) {
        const t = line.trim()
        if (t.length === 0) continue
        onLine(t, Date.now() - started)
      }
    }
    child.stdout?.on("data", (buf: Buffer) => {
      pending += buf.toString("utf8")
      if (pending.length > cap) pending = pending.slice(-cap)
      flush(false)
    })
    child.stderr?.on("data", (b: Buffer) => {
      err = (err + b.toString("utf8")).slice(-cap)
    })
    child.on("error", (e) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout: "", stderr: err + `\nspawn error: ${e.message}`, ms: Date.now() - started, timedOut })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      flush(true)
      resolve({ code: code ?? -1, stdout: "", stderr: err, ms: Date.now() - started, timedOut })
    })
  })
}
