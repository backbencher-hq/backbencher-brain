// script/bench/lib/scrub.ts — the publish guard for run evidence.
//
// WHY. A published trace is the benchmark's proof, which makes it the one artifact that
// must never carry a credential. The trace is written by a process that had the operator's
// DSH home on its DSH_HOME: an agent that cats a config file, or a tool result that echoes
// an env var, can put a secret into evidence that is then committed to a public repo.
//
// TWO JOBS, in this order:
//   1. DETECT -- if any credential-shaped string is in the evidence, the run REFUSES to
//      publish. Not redacted, not "sanitised": refused. A trace you had to edit to make
//      safe is no longer the trace of what happened.
//   2. NORMALISE PATHS -- absolute paths that embed an operator's home or workspace are
//      rewritten to `~` / `$WS`. This is safe because paths are not the evidence; the
//      tool calls, payloads and token counts are. Path normalisation is recorded so the
//      reader knows the text was touched.
//
// The detector is deliberately broad and errs toward refusing. A false refusal costs one
// re-run; a false pass costs a leaked key in a permanent git object.

import { readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"

export interface ScrubFinding {
  /** What kind of secret-shaped thing was found. Never the value itself. */
  kind: string
  /** Where it was found (file + approximate line), so a re-run can be diagnosed. */
  where: string
}

export interface ScrubResult {
  ok: boolean
  findings: ScrubFinding[]
  /** Paths that were normalised, if normalisation was requested. */
  normalised: { from: string; to: string }[]
  /** The normalised text (only when ok and normalisation ran). */
  text: string
}

/** Shapes that must never appear in published evidence. Ordered most-specific first so a
 *  finding names the narrowest kind that matched. */
const SECRET_PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "freepi-install-secret", re: /\bfpi_[A-Za-z0-9_-]{16,}\b/ },
  { kind: "bearer-token", re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/i },
  { kind: "openai-style-key", re: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
  { kind: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { kind: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: "private-key-block", re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  { kind: "credentials-file", re: /\.credentials\.yaml/ },
  { kind: "freepi-install-file", re: /freepi-install\.json/ },
  { kind: "api-key-assignment", re: /\b(api[_-]?key|secret|password|token)\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{24,}["']?/i },
]

/** Scan one file's text. `label` is what the caller wants shown in a finding. */
export function scanText(text: string, label: string): ScrubFinding[] {
  const out: ScrubFinding[] = []
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    for (const { kind, re } of SECRET_PATTERNS) {
      if (re.test(lines[i])) {
        out.push({ kind, where: `${label}:${i + 1}` })
        break // one finding per line is enough to refuse; duplicates add noise
      }
    }
  }
  return out
}

/**
 * Path normalisation. `$WS` first (workspace paths are the most common), then `~`, so a
 * home-prefixed workspace collapses to `~/$WS` rather than a half-rewritten path.
 */
export function normalisePaths(text: string, workspace?: string): { text: string; normalised: { from: string; to: string }[] } {
  const done: { from: string; to: string }[] = []
  let out = text
  if (workspace && workspace.length > 1) {
    const before = out
    out = out.split(workspace).join("$WS")
    if (out !== before) done.push({ from: workspace, to: "$WS" })
  }
  const home = homedir()
  if (home && home.length > 1) {
    const before = out
    out = out.split(home).join("~")
    if (out !== before) done.push({ from: home, to: "~" })
  }
  return { text: out, normalised: done }
}

/** The publish guard for one evidence file. Refuses on any finding. */
export function scrubFile(filePath: string, opts: { workspace?: string; write?: boolean; label?: string } = {}): ScrubResult {
  const raw = readFileSync(filePath, "utf8")
  const findings = scanText(raw, opts.label ?? filePath)
  if (findings.length > 0) {
    return { ok: false, findings, normalised: [], text: "" }
  }
  const { text, normalised } = normalisePaths(raw, opts.workspace)
  if (opts.write && normalised.length > 0) writeFileSync(filePath, text)
  return { ok: true, findings: [], normalised, text }
}
