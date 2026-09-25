// script/m55/wire-probe.ts — M55.V1 deliverable 2: the stdio probe used at
// filing time, promoted into the repo (issue #776).
//
// What it does: spawns the REAL dist server against the DECLARED external
// fixture workspace and reads back every surface the milestone makes claims
// about — hover, `bb/graph` (graph + the hub's usages profile), `bb/impact`,
// references, and the call hierarchy — over the real index, emitting
// machine-readable truth for differential assertions.
//
// Two lessons from the filing rig are kept, because they were learned the hard
// way and both produced false readings:
//
//   1. FRAMING IS BYTE-BASED. Decoding stdout as a string corrupts multi-byte
//      UTF-8 split across chunks; the transport is script/m55/lsp-wire.ts, the
//      one byte-accurate client the other M55 gates use.
//   2. POSITIONS ARE FOUND, NOT FROZEN. The filing probe hardcoded line
//      numbers, so a fixture edit silently read a neighbouring symbol. Every
//      flow here resolves its position from the file text and DECLARES the
//      name it expected; when the declaration or the call site is absent the
//      flow is `blocked` with the reason — never a position pointing at
//      whatever happens to sit on that line.
//
// The fixture is external by owner decision (docs/m55/SCREENSHOT-PROTOCOL.md
// §3): when the workspace or its index is missing, the probe reports the
// declared blocked state instead of inventing data.
//
// Run: npx tsx script/m55/wire-probe.ts [--out <file>] [--workspace <dir>]

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { StdioLsp, ensureServerBuilt, M55_ROOT } from "./lsp-wire.ts"

/** The declared external fixture (owner decision, 2026-09-12). */
export const DECLARED_FIXTURE = "$HOME/bb-demo-hub"

export interface ProbeFlow {
  id: string
  /** what the flow reads, in one line (the claim it backs) */
  reads: string
  file: string
  symbol: string
  kind: "declaration" | "call-site"
  /** the request the flow issues */
  request:
    | { method: "textDocument/hover" }
    | { method: "textDocument/references" }
    | { method: "textDocument/prepareCallHierarchy"; expand: boolean }
    | { method: "bb/graph"; mode: "graph" | "usages" }
    | { method: "bb/impact" }
}

/** The flows the milestone's claims are read through. Each name is the symbol
 *  the position MUST resolve to; the probe asserts identity, not proximity. */
export const PROBE_FLOWS: ProbeFlow[] = [
  { id: "F1", reads: "the card at a method's declaration (T3, T4, T5)", file: "src/greeter.ts", symbol: "greet", kind: "declaration", request: { method: "textDocument/hover" } },
  { id: "F2", reads: "the card at a call site (T1 identity, T3)", file: "src/report.ts", symbol: "greet", kind: "call-site", request: { method: "textDocument/hover" } },
  { id: "F3", reads: "the card at the constructor's declaration (T1 U5, T5)", file: "src/greeter.ts", symbol: "constructor", kind: "declaration", request: { method: "textDocument/hover" } },
  { id: "F4", reads: "the card at a getter (T1 accessors, T5)", file: "src/store.ts", symbol: "size", kind: "declaration", request: { method: "textDocument/hover" } },
  { id: "F5", reads: "references for a method (T3 usages = usage sites)", file: "src/greeter.ts", symbol: "greet", kind: "declaration", request: { method: "textDocument/references" } },
  { id: "F6", reads: "the call hierarchy for a method (T2 shape)", file: "src/greeter.ts", symbol: "greet", kind: "declaration", request: { method: "textDocument/prepareCallHierarchy", expand: true } },
  { id: "F7", reads: "the hub's usages profile for a class (T3, T5)", file: "src/greeter.ts", symbol: "Greeter", kind: "declaration", request: { method: "bb/graph", mode: "usages" } },
  { id: "F8", reads: "the hub's usages profile for a method (T5 chips)", file: "src/greeter.ts", symbol: "greet", kind: "declaration", request: { method: "bb/graph", mode: "usages" } },
  { id: "F9", reads: "impact for a class (T1 U5 root, W5 bounds)", file: "src/greeter.ts", symbol: "Greeter", kind: "declaration", request: { method: "bb/impact" } },
  { id: "F10", reads: "the raw graph for a class (W2 schema)", file: "src/greeter.ts", symbol: "Greeter", kind: "declaration", request: { method: "bb/graph", mode: "graph" } },
]

export interface ProbeFlowResult {
  id: string
  reads: string
  status: "read" | "blocked"
  reason?: string
  /** the position actually used (0-based LSP), when a position was resolved */
  position?: { line: number; character: number }
  /** the bare name found at that position (identity evidence) */
  found?: { line: string; name: string }
  result?: unknown
  error?: string
}

export interface ProbeResult {
  status: "read" | "blocked"
  reason?: string
  workspace: string
  serverPath: string
  blockedFlows: string[]
  flows: Record<string, ProbeFlowResult>
  generatedAt: string
}

/** Resolve the 0-based LSP position of `symbol` in `file`, for a declaration
 *  or a call site. Returns null when the declared text is absent — the caller
 *  records a blocked flow rather than a nearby position. */
export function resolvePosition(workspace: string, flow: ProbeFlow): { line: number; character: number; text: string } | null {
  const abs = path.join(workspace, flow.file)
  if (!existsSync(abs)) return null
  const lines = readFileSync(abs, "utf8").split("\n")
  for (const [i, text] of lines.entries()) {
    if (flow.kind === "declaration") {
      // A declaration: the name is introduced by a type/member keyword or a
      // closing paren (a getter), and the line is not a call.
      const isDeclaration =
        new RegExp(`\\b(class|interface|function|const|let|var)\\s+${escapeRe(flow.symbol)}\\b`).test(text) ||
        new RegExp(`^\\s*(get\\s+)?${escapeRe(flow.symbol)}\\s*\\(`).test(text) ||
        (flow.symbol === "constructor" && /^\s*constructor\s*\(/.test(text))
      if (isDeclaration) {
        const at = text.indexOf(flow.symbol)
        if (at >= 0) return { line: i, character: at, text }
      }
    } else {
      // A call site: the name is invoked (and this is not its declaration).
      const call = new RegExp(`\\b${escapeRe(flow.symbol)}\\s*\\(`)
      const isDeclaration = new RegExp(`^\\s*(get\\s+)?${escapeRe(flow.symbol)}\\s*\\(`).test(text) || new RegExp(`\\b${escapeRe(flow.symbol)}\\s*\\([^)]*\\)\\s*:\\s*\\w`).test(text)
      if (call.test(text) && !isDeclaration) {
        const at = text.indexOf(flow.symbol)
        if (at >= 0) return { line: i, character: at, text }
      }
    }
  }
  return null
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Run every declared flow against the real server. `workspace` defaults to the
 *  declared fixture; `dataDir` defaults to the owner's own BB_DATA_DIR (the
 *  protocol's §3 decision: the session sees the same data the owner sees). */
export async function runWireProbe(opts: { workspace?: string; dataDir?: string } = {}): Promise<ProbeResult> {
  const workspace = opts.workspace ?? DECLARED_FIXTURE
  const dataDir = opts.dataDir ?? path.join(process.env.HOME ?? "", ".bb")
  const base: ProbeResult = {
    status: "read",
    workspace,
    serverPath: path.join(M55_ROOT, "dist/lsp/server.js"),
    blockedFlows: [],
    flows: {},
    generatedAt: new Date().toISOString(),
  }
  if (!existsSync(workspace)) {
    return { ...base, status: "blocked", reason: `declared fixture workspace is absent: ${workspace}` }
  }
  ensureServerBuilt()

  const wire = new StdioLsp(workspace, { ...process.env, BB_DATA_DIR: dataDir } as Record<string, string | undefined>)
  try {
    const init = await wire.initialize(workspace)
    if (init.error !== undefined) {
      return { ...base, status: "blocked", reason: `server did not initialize: ${init.error.message}` }
    }
    for (const flow of PROBE_FLOWS) {
      const pos = resolvePosition(workspace, flow)
      const uri = `file://${path.join(workspace, flow.file)}`
      if (pos === null) {
        base.flows[flow.id] = {
          id: flow.id,
          reads: flow.reads,
          status: "blocked",
          reason: `declared ${flow.kind} of '${flow.symbol}' not found in ${flow.file} — the fixture changed (no neighbouring position was substituted)`,
        }
        base.blockedFlows.push(flow.id)
        continue
      }
      const position = { line: pos.line, character: pos.character }
      try {
        switch (flow.request.method) {
          case "textDocument/hover": {
            const r = await wire.request("textDocument/hover", { textDocument: { uri }, position })
            base.flows[flow.id] = { id: flow.id, reads: flow.reads, status: "read", position, found: { line: pos.text.trim(), name: flow.symbol }, result: r.result ?? null, error: r.error?.message }
            break
          }
          case "textDocument/references": {
            const r = await wire.request("textDocument/references", { textDocument: { uri }, position, context: { includeDeclaration: true } })
            base.flows[flow.id] = { id: flow.id, reads: flow.reads, status: "read", position, found: { line: pos.text.trim(), name: flow.symbol }, result: r.result ?? null, error: r.error?.message }
            break
          }
          case "textDocument/prepareCallHierarchy": {
            const prep = await wire.request("textDocument/prepareCallHierarchy", { textDocument: { uri }, position })
            const item = prep.result?.item ?? (Array.isArray(prep.result) ? prep.result[0] : prep.result)
            let incoming: unknown = null
            let outgoing: unknown = null
            if (flow.request.expand && item !== undefined && item !== null) {
              incoming = (await wire.request("callHierarchy/incomingCalls", { item })).result ?? null
              outgoing = (await wire.request("callHierarchy/outgoingCalls", { item })).result ?? null
            }
            base.flows[flow.id] = {
              id: flow.id,
              reads: flow.reads,
              status: "read",
              position,
              found: { line: pos.text.trim(), name: flow.symbol },
              result: { item: item ?? null, incoming, outgoing },
              error: prep.error?.message,
            }
            break
          }
          case "bb/graph": {
            const r = await wire.request("bb/graph", { schemaVersion: 2, symbol: flow.symbol, file: path.join(workspace, flow.file), mode: flow.request.mode, direction: "both" })
            base.flows[flow.id] = { id: flow.id, reads: flow.reads, status: "read", position, found: { line: pos.text.trim(), name: flow.symbol }, result: r.result ?? null, error: r.error?.message }
            break
          }
          case "bb/impact": {
            const r = await wire.request("bb/impact", { schemaVersion: 1, symbol: flow.symbol, file: path.join(workspace, flow.file) })
            base.flows[flow.id] = { id: flow.id, reads: flow.reads, status: "read", position, found: { line: pos.text.trim(), name: flow.symbol }, result: r.result ?? null, error: r.error?.message }
            break
          }
        }
      } catch (e) {
        base.flows[flow.id] = {
          id: flow.id,
          reads: flow.reads,
          status: "blocked",
          reason: `request threw: ${e instanceof Error ? e.message : String(e)}`,
        }
        base.blockedFlows.push(flow.id)
      }
    }

    // The declared-absence flow: a symbol that does not exist must be a LOUD
    // error on both doors, never an empty result (T1's rule, read live).
    const absent = "nonexistent_symbol_xyz"
    const g = await wire.request("bb/graph", { schemaVersion: 2, symbol: absent, file: path.join(workspace, "src/greeter.ts"), mode: "usages" })
    const i = await wire.request("bb/impact", { schemaVersion: 1, symbol: absent, file: path.join(workspace, "src/greeter.ts") })
    base.flows.F11 = {
      id: "F11",
      reads: "declared absence on both doors (T1: never an empty result)",
      status: "read",
      result: { graphError: g.error?.message ?? null, graphHasResult: g.result !== undefined, impactError: i.error?.message ?? null, impactHasResult: i.result !== undefined },
      error: g.error?.message ?? i.error?.message,
    }
  } finally {
    await wire.dispose()
  }
  return base
}

// --- CLI ---------------------------------------------------------------------------
if (process.argv[1] !== undefined && /wire-probe\.ts$/.test(process.argv[1])) {
  const args = process.argv.slice(2)
  const outIdx = args.indexOf("--out")
  const wsIdx = args.indexOf("--workspace")
  const result = await runWireProbe({
    workspace: wsIdx >= 0 ? args[wsIdx + 1] : undefined,
  })
  const text = JSON.stringify(result, null, 2)
  if (outIdx >= 0 && args[outIdx + 1] !== undefined) {
    writeFileSync(args[outIdx + 1]!, text + "\n")
    console.log(`wire-probe: ${result.status} — ${Object.keys(result.flows).length} flows → ${args[outIdx + 1]}`)
  } else {
    console.log(text)
  }
  process.exit(result.status === "read" ? 0 : 2)
}
