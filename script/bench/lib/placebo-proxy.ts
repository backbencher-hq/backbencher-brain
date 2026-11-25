#!/usr/bin/env node
// script/bench/lib/placebo-proxy.ts — the PRESENTATION CONTROL for arm E.
//
// WHY THIS EXISTS. The four-arm matrix (A no-bb, B manual-block, C mounted, D +skills) can
// show that mounting bb changes the outcome. It CANNOT show that the change comes from the
// CONTENT bb returns. A model handed 16 tools may simply try harder, or restructure its
// search, or spend its budget differently -- none of which is bb being useful.
//
// Published evidence makes this concrete: arXiv:2610.33958 ran a placebo arm whose
// structural tools returned *random entities* and found (a) the gain came from what the
// tools returned, not from having them, and (b) random output actively HARMED two small
// models. Without that arm, "C beats A" is equally consistent with "having tools helps".
//
// THE DESIGN, and its one honest limitation.
//
// This proxy sits between the harness and the real bb MCP server. It forwards every request
// and response verbatim, EXCEPT that it replaces the task-bearing argument (`query`,
// `symbol`, `target`, `filePath`) with a fixed, task-independent string. So:
//
//   * the model still sees REAL bb output, in the real schema, with real freshness blocks,
//     real bounds and real "not found" declarations -- the response SHAPE is authentic;
//   * the output is no longer ABOUT the task, so any benefit it produces is the benefit of
//     context presence rather than of retrieval quality.
//
// LIMITATION, declared rather than hidden: this is an ARGUMENT-randomizing placebo, not the
// random-entity placebo of arXiv:2610.33958. Random entities would break the per-tool
// response schema (bb_graph returns edges, bb_doc returns prose), and a proxy that fabricates
// those shapes would itself be a second implementation of bb whose fidelity we cannot claim.
// Randomizing the argument keeps the schema real and the content irrelevant, which is the
// contrast the arm needs. `placebo_mode` is recorded on every run so the two are never
// confused in a report.
//
// A tool whose arguments are not rewritten (bb_index, bb_health, bb_annotate, bb_edit) is
// passed through untouched: those are not retrieval tools, and scrambling their arguments
// would make them fail rather than return unrelated results.

import { spawn } from "node:child_process"

/** The task-bearing argument on each retrieval tool. Rewritten to `PLACEBO_VALUE`. */
const QUERY_ARG: Record<string, string> = {
  bb_search: "query",
  bb_ask: "query",
  bb_graph: "symbol",
  bb_impact: "symbol",
  bb_analyze: "target",
  bb_patterns: "target",
  bb_security: "target",
  bb_doc: "target",
  bb_visualize: "target",
  bb_migrate: "symbolName",
  bb_cross_language: "symbol",
  bb_annotations: "symbol",
}

/**
 * A fixed, reserved-looking token. It must be:
 *   * stable across runs (so E is reproducible, per DESIGN.md §2),
 *   * very unlikely to be a real identifier in any project (so it returns nothing useful),
 *   * a legal value for every tool's schema (a string).
 * `__bench_placebo__` is all three.
 */
export const PLACEBO_VALUE = "__bench_placebo__"

export interface ProxyOptions {
  bbBin: string
  projectDir: string
}

/** Rewrite one JSON-RPC `tools/call` params object. Pure, so it is testable. */
export function placeboRewrite(params: unknown): { params: unknown; injected: boolean; tool: string | null } {
  if (typeof params !== "object" || params === null) return { params, injected: false, tool: null }
  const p = params as { name?: unknown; arguments?: unknown }
  const tool = typeof p.name === "string" ? p.name : null
  if (tool === null) return { params, injected: false, tool: null }
  // MCP tool names arrive as `mcp__<server>__<tool>`; accept both shapes.
  const bare = tool.includes("__") ? tool.slice(tool.lastIndexOf("__") + 2) : tool
  const argKey = QUERY_ARG[bare]
  if (!argKey) return { params, injected: false, tool: bare }
  const args = typeof p.arguments === "object" && p.arguments !== null ? { ...(p.arguments as Record<string, unknown>) } : {}
  args[argKey] = PLACEBO_VALUE
  return { params: { ...p, arguments: args }, injected: true, tool: bare }
}

/** Run the proxy. stdout is the MCP channel; stderr is ours for diagnostics. */
export function startProxy(opts: ProxyOptions): void {
  const child = spawn(opts.bbBin, ["mcp", "--dir", opts.projectDir], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env },
  })

  let buf = ""
  let injected = 0
  let passed = 0

  process.stdin.setEncoding("utf8")
  process.stdin.on("data", (chunk: string) => {
    buf += chunk
    let nl: number
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (line.trim().length === 0) continue
      let out = line
      try {
        const msg = JSON.parse(line) as { method?: string; params?: unknown }
        if (msg.method === "tools/call") {
          const r = placeboRewrite(msg.params)
          if (r.injected) {
            injected++
            out = JSON.stringify({ ...(msg as object), params: r.params })
          } else {
            passed++
          }
        }
      } catch {
        // Not JSON we understand: forward verbatim. A proxy that drops frames is worse than
        // one that passes them, and the server will reject anything malformed itself.
      }
      child.stdin.write(out + "\n")
    }
  })

  child.stdout.on("data", (b: Buffer) => process.stdout.write(b))
  process.stdin.on("end", () => child.stdin.end())
  child.on("exit", (code) => {
    // The counts go to stderr so the harness can assert the placebo actually fired. An arm
    // labelled E whose proxy injected nothing is an arm C wearing a label, and the runner
    // treats it as invalid.
    process.stderr.write(`placebo-proxy: injected=${injected} passed=${passed}\n`)
    process.exit(code ?? 0)
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bbBin = process.argv[2]
  const projectDir = process.argv[3]
  if (!bbBin || !projectDir) {
    process.stderr.write("placebo-proxy: usage: placebo-proxy.ts <bb-binary> <project-dir>\n")
    process.exit(2)
  }
  startProxy({ bbBin, projectDir })
}
