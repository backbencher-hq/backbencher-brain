// script/m50/verify-a2-param-aliases.ts — M50.A2 (#764) permanent gate.
//
// Governed surface: PARAMETER_ALIASES in src/mcp/tool-validation.ts.
//
// A1 recorded agents losing a round-trip to vocabulary, not capability:
// bb_graph/bb_impact/bb_cross_language take `symbol` while
// bb_analyze/bb_doc/bb_visualize take `target`, so a model that learned one
// family's spelling got `unknown or irrelevant options: target` verbatim
// (validation/m50/results/A1.json). This gate proves the fix is real AND
// bounded:
//
//   P1. Every declared alias resolves to its canonical key, and the alias key
//       is removed before the handler sees the arguments.
//   P2. An alias satisfies a REQUIRED canonical field (the actual A1 failure).
//   P3. Registry parity: each canonical target is a real property of that
//       tool's schema, and no alias shadows an existing property.
//   P4. Bounded: unknown options are still rejected, tools outside the table
//       are still strict, missing-required still fails, and an empty alias
//       value does not sneak past the required check.
//   P5. Both spellings present with equal values are accepted; with DIFFERENT
//       values the call is refused (never silently picking one).
//   P6. The registry documents each alias in the canonical parameter's
//       description (the docs generator carries it to docs/tools/*.md).
//   P7. BEHAVIORAL, through the production server (`node bin/bb mcp` over
//       stdio, real indexed fixture): alias and canonical spellings return the
//       SAME answer for bb_graph / bb_impact / bb_cross_language / bb_analyze /
//       bb_doc / bb_visualize / bb_annotations, and fail the same way for an
//       unknown symbol.
//
// Runs under bun AND node/tsx.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const BIN = path.join(ROOT, "bin/bb")
process.env.BB_DATA_DIR = mkdtempSync(path.join(tmpdir(), "bb-m50-alias-"))
// Keep the fixture index offline: no bb.json embedding provider, no env one.
process.env.BB_CONFIG_FILE = path.join(process.env.BB_DATA_DIR!, "no-config.json")
delete process.env.BB_EMBEDDING_BASE_URL
delete process.env.BB_EMBEDDING_API_KEY
delete process.env.BB_EMBEDDING_MODEL

let pass = 0
let failed = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++
    console.log(`  ok ${name}`)
  } else {
    failed++
    console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`)
  }
}
function throws(fn: () => void): string {
  try {
    fn()
    return ""
  } catch (e: any) {
    return e?.message ?? String(e)
  }
}

/** Minimal valid arguments for the alias pair of a tool. */
function minimalArgs(tool: string, aliasKey: string, aliasValue: string): Record<string, unknown> {
  if (tool === "bb_analyze") return { mode: "callers", [aliasKey]: aliasValue }
  if (tool === "bb_doc") return { mode: "symbol", [aliasKey]: aliasValue }
  if (tool === "bb_visualize") return { scope: "symbol", [aliasKey]: aliasValue }
  // bb_annotate requires a body in addition to the symbol (validation only here).
  if (tool === "bb_annotate") return { [aliasKey]: aliasValue, body: "m50 alias validation probe" }
  return { [aliasKey]: aliasValue }
}

async function main() {
  const { validateToolArguments, PARAMETER_ALIASES } = await import(path.join(ROOT, "src/mcp/tool-validation"))
  const { PUBLIC_TOOL_DESCRIPTORS } = await import(path.join(ROOT, "src/mcp/tool-registry"))
  const byName = new Map(PUBLIC_TOOL_DESCRIPTORS.map((d: any) => [d.name, d]))

  // ── P1/P2/P3/P6: alias resolution + registry parity + docs ─────────────
  for (const [tool, map] of Object.entries(PARAMETER_ALIASES)) {
    const descriptor = byName.get(tool) as any
    check(`P3 ${tool} is a registered tool`, !!descriptor)
    if (!descriptor) continue
    const props = descriptor.inputSchema.properties ?? {}
    for (const [alias, canonical] of Object.entries(map)) {
      check(`P3 ${tool}: canonical ${canonical} is a real property`, canonical in props)
      check(`P3 ${tool}: alias ${alias} does not shadow a real property`, !(alias in props), Object.keys(props).join(","))
      check(
        `P6 ${tool}: registry documents the ${alias} alias`,
        String(props[canonical]?.description ?? "").includes(alias),
        String(props[canonical]?.description ?? "").slice(0, 80),
      )
      const out = validateToolArguments(descriptor, minimalArgs(tool, alias, "symbolUnderTest"))
      check(`P1 ${tool}: ${alias} resolves to ${canonical}`, out[canonical] === "symbolUnderTest" && !(alias in out), JSON.stringify(out))
    }
  }

  // ── P4: bounded strictness (no blanket forgiveness) ────────────────────
  const graph = byName.get("bb_graph") as any
  const health = byName.get("bb_health") as any
  const search = byName.get("bb_search") as any
  const errUnknown = throws(() => validateToolArguments(graph, { symbol: "x", bogus: 1 }))
  check("P4 unknown option still rejected", errUnknown.includes("unknown or irrelevant options"), errUnknown)
  const errForeign = throws(() => validateToolArguments(health, { target: "x" }))
  check("P4 a tool outside the alias table stays strict", errForeign.includes("unknown or irrelevant options"), errForeign)
  const errSearch = throws(() => validateToolArguments(search, { symbol: "x" }))
  check("P4 bb_search still rejects `symbol` (table is explicit, not global)", errSearch.includes("unknown or irrelevant options"), errSearch)
  const errMissing = throws(() => validateToolArguments(graph, {}))
  check("P4 missing canonical still rejected", errMissing.includes("missing required option: symbol"), errMissing)
  const errEmptyAlias = throws(() => validateToolArguments(graph, { target: "   " }))
  check(
    "P4 whitespace-only alias does not satisfy a required field",
    errEmptyAlias.includes("missing required option: symbol") || errEmptyAlias.includes("non-empty"),
    errEmptyAlias,
  )

  // ── P4b: a rejection must teach (M50.A2 follow-up) ─────────────────────
  // A1 recorded the agent-visible failure text: "unknown or irrelevant
  // options: target". That names the mistake but not the fix, so the agent's
  // next guess is another coin flip. The rejection now names the accepted
  // options and the aliases the tool forgives.
  check("P4b rejection names the accepted options", errUnknown.includes("accepted options:") && errUnknown.includes("symbol"), errUnknown)
  check("P4b rejection names the forgiven aliases", errUnknown.includes("aliases accepted:") && errUnknown.includes("query"), errUnknown)
  const errDirection = throws(() => validateToolArguments(graph, { symbol: "x", direction: "callers" }))
  check(
    "P4b the verbatim A1 guess (`direction` on bb_graph) is still refused, with the fix named",
    errDirection.includes("direction") && errDirection.includes("accepted options:") && errDirection.includes("aliases accepted:"),
    errDirection,
  )
  check("P4b a tool with no aliases names no alias list", !throws(() => validateToolArguments(health, { bogus: 1 })).includes("aliases accepted:"))

  // ── P4c: `query` is the phrase-1 guess on every non-search tool ────────
  for (const tool of ["bb_graph", "bb_impact", "bb_cross_language", "bb_analyze", "bb_doc", "bb_visualize", "bb_annotations"]) {
    const descriptor = byName.get(tool) as any
    const out = validateToolArguments(descriptor, minimalArgs(tool, "query", "symbolUnderTest"))
    const canonical = (PARAMETER_ALIASES as any)[tool].query
    check(`P4c ${tool}: query resolves to ${canonical}`, out[canonical] === "symbolUnderTest" && !("query" in out), JSON.stringify(out))
  }
  // bb_search / bb_ask own `query` for real — they must NOT be in the alias table.
  check("P4c bb_search is not in the alias table (query is its real property)", !("bb_search" in (PARAMETER_ALIASES as any)))
  check("P4c bb_ask is not in the alias table (query is its real property)", !("bb_ask" in (PARAMETER_ALIASES as any)))

  // ── P5: conflict / agreement ───────────────────────────────────────────
  const errConflict = throws(() => validateToolArguments(graph, { symbol: "a", target: "b" }))
  check("P5 conflicting symbol/target refused loudly", errConflict.includes("aliases with different values"), errConflict)
  const same = validateToolArguments(graph, { symbol: "a", target: "a" })
  check("P5 agreeing spellings accepted", same.symbol === "a" && !("target" in same), JSON.stringify(same))
  const errConflict2 = throws(() => validateToolArguments(byName.get("bb_analyze") as any, { mode: "callers", target: "a", symbol: "b" }))
  check("P5 conflicting target/symbol on bb_analyze refused loudly", errConflict2.includes("aliases with different values"), errConflict2)

  // ── P7: behavioral equivalence through the production server ───────────
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))

  const proj = mkdtempSync(path.join(tmpdir(), "bb-m50-alias-proj-"))
  mkdirSync(path.join(proj, "src"), { recursive: true })
  writeFileSync(path.join(proj, "src", "lib.ts"), `export function aliasLeaf(v: number): number { return v + 1 }\nexport function aliasOther(v: number): number { return v * 2 }\n`)
  writeFileSync(path.join(proj, "src", "mid.ts"), `import { aliasLeaf, aliasOther } from "./lib"\nexport function aliasMid(v: number): number { return aliasLeaf(v) + aliasOther(v) }\n`)
  writeFileSync(path.join(proj, "src", "app.ts"), `import { aliasMid } from "./mid"\nexport function aliasTop(v: number): number { return aliasMid(v) }\n`)
  writeFileSync(path.join(proj, "package.json"), JSON.stringify({ name: "m50-alias-fixture", version: "1.0.0" }))

  const pid = getProjectId(proj)
  const idx = await indexProjectParallel(pid as any, proj, { force: true })
  check("P7 fixture indexed with full post-processing", (idx?.successFiles ?? 0) >= 3, JSON.stringify({ f: idx?.successFiles, e: idx?.errors }))
  BrainDatabase.closeAll()

  // One server process for all pairs: the production shape (node bin/bb mcp).
  const { spawn } = await import("node:child_process")
  const server = spawn("node", [BIN, "mcp"], { cwd: proj, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } })
  let buf = ""
  let idc = 0
  const pending = new Map<number, (v: { ok: boolean; text: string }) => void>()
  server.stdout.on("data", (d: Buffer) => {
    buf += d.toString()
    const lines = buf.split("\n")
    buf = lines.pop() ?? ""
    for (const line of lines) {
      try {
        const msg = JSON.parse(line)
        if (typeof msg.id === "number" && pending.has(msg.id)) {
          const resolve = pending.get(msg.id)!
          pending.delete(msg.id)
          const text = msg.result?.content?.[0]?.text ?? (msg.error ? `ERROR ${JSON.stringify(msg.error)}` : "")
          resolve({ ok: !msg.error && msg.result?.isError !== true, text: String(text) })
        }
      } catch {
        /* partial line */
      }
    }
  })
  const call = (name: string, args: Record<string, unknown>) =>
    new Promise<{ ok: boolean; text: string }>((resolve, reject) => {
      const id = ++idc
      pending.set(id, resolve)
      server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n")
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error(`${name} timed out`))
        }
      }, 60_000)
    })
  await new Promise<void>((res) => {
    const on = (d: Buffer) => {
      if (d.toString().includes('"result"')) {
        server.stdout.off("data", on)
        res()
      }
    }
    server.stdout.on("data", on)
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "m50-alias", version: "0" } } }) + "\n")
    setTimeout(res, 20_000)
  })
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n")

  /** Collapse whitespace and drop values that legitimately differ per call. */
  const norm = (text: string) =>
    text
      .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<ts>")
      .replace(/\b\d+(\.\d+)?\s?ms\b/g, "<ms>")
      .replace(/\s+/g, " ")
      .trim()

  const PAIRS: Array<{ tool: string; canonical: Record<string, unknown>; alias: Record<string, unknown> }> = [
    { tool: "bb_graph", canonical: { symbol: "aliasMid" }, alias: { target: "aliasMid" } },
    { tool: "bb_impact", canonical: { symbol: "aliasMid" }, alias: { target: "aliasMid" } },
    { tool: "bb_cross_language", canonical: { symbol: "aliasMid" }, alias: { target: "aliasMid" } },
    { tool: "bb_analyze", canonical: { mode: "callers", target: "aliasMid" }, alias: { mode: "callers", symbol: "aliasMid" } },
    { tool: "bb_doc", canonical: { mode: "symbol", target: "aliasMid", maxTokens: 800 }, alias: { mode: "symbol", symbol: "aliasMid", maxTokens: 800 } },
    { tool: "bb_visualize", canonical: { scope: "symbol", target: "aliasMid" }, alias: { scope: "symbol", symbol: "aliasMid" } },
    { tool: "bb_annotations", canonical: { symbol: "aliasMid" }, alias: { target: "aliasMid" } },
    // `query` (the bb_search/bb_ask spelling) must answer identically too.
    { tool: "bb_graph", canonical: { symbol: "aliasMid" }, alias: { query: "aliasMid" } },
    { tool: "bb_impact", canonical: { symbol: "aliasMid" }, alias: { query: "aliasMid" } },
    { tool: "bb_cross_language", canonical: { symbol: "aliasMid" }, alias: { query: "aliasMid" } },
    { tool: "bb_analyze", canonical: { mode: "callers", target: "aliasMid" }, alias: { mode: "callers", query: "aliasMid" } },
    { tool: "bb_doc", canonical: { mode: "symbol", target: "aliasMid", maxTokens: 800 }, alias: { mode: "symbol", query: "aliasMid", maxTokens: 800 } },
    { tool: "bb_visualize", canonical: { scope: "symbol", target: "aliasMid" }, alias: { scope: "symbol", query: "aliasMid" } },
    // unknown symbol: both spellings must fail the same way
    { tool: "bb_graph", canonical: { symbol: "noSuchSymbolAnywhere" }, alias: { target: "noSuchSymbolAnywhere" } },
    { tool: "bb_graph", canonical: { symbol: "noSuchSymbolAnywhere" }, alias: { query: "noSuchSymbolAnywhere" } },
  ]

  for (const pair of PAIRS) {
    const a = await call(pair.tool, pair.canonical)
    const b = await call(pair.tool, pair.alias)
    const sameAnswer = norm(a.text) === norm(b.text)
    const aliasKeys = Object.keys(pair.alias).filter((k) => !(k in pair.canonical))
    check(
      `P7 ${pair.tool}: ${aliasKeys.join("+") || "(none)"} aliases answer like ${Object.keys(pair.canonical).join("+")}`,
      sameAnswer && a.ok === b.ok,
      sameAnswer ? `ok=${a.ok}/${b.ok}` : `${norm(a.text).slice(0, 120)} || ${norm(b.text).slice(0, 120)}`,
    )
  }
  server.kill()

  console.log(`\n${pass} passed, ${failed} failed`)
  try {
    BrainDatabase.closeAll()
  } catch {}
  rmSync(process.env.BB_DATA_DIR!, { recursive: true, force: true })
  rmSync(proj, { recursive: true, force: true })
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error("FAIL", e && (e.stack || e.message))
  process.exit(1)
})
