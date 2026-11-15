// bb_edit Phase A wire probe — a REAL MCP stdio session against the current
// source server (validation/tools/bb_edit/work/mcp-server-source.ts), with
// BB_DATA_DIR passed explicitly so the child can never fall back to ~/.bb.
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { buildFixtures } from "./fixtures"

const checks: Array<{ name: string; pass: boolean; detail: string; negative?: boolean }> = []
let failures = 0
function ck(name: string, pass: boolean, detail = ""): void {
  checks.push({ name, pass, detail })
  if (!pass) { failures++; console.log(`FAIL ${name} — ${detail}`) }
}
function negative(name: string, pass: boolean, detail = ""): void {
  checks.push({ name, pass, detail, negative: true })
  if (!pass) { failures++; console.log(`FAIL ${name} [negative] — ${detail}`) }
}
const hash = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex")

async function main(): Promise<void> {
  const f = buildFixtures()
  const dataDir = path.resolve("validation/tools/bb_edit/bbdata")
  // The fresh-project fixture path is stable, so its project id is too: wipe any
  // persisted index from an earlier run or the "no index" legs test leftover rows.
  rmSync(path.join(dataDir, "projects", getProjectId(f.noindex)), { recursive: true, force: true })
  const tsId = getProjectId(f.ts)
  await indexProjectParallel(tsId as any, f.ts, {})

  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")

  const serverEntry = path.resolve("validation/tools/bb_edit/work/mcp-server-source.ts")
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", serverEntry, "--dir", f.ts],
    cwd: process.cwd(),
    stderr: "pipe",
    // THE point of this probe: the MCP SDK's default child environment filters
    // arbitrary variables, so BB_DATA_DIR must be passed explicitly or the child
    // falls back to ~/.bb (which is read-only on this machine).
    env: { ...process.env, BB_DATA_DIR: dataDir, BB_NO_AUTO_REFRESH: "1" } as Record<string, string>,
  })
  const client = new Client({ name: "bb-edit-phase-a", version: "1.0.0" })
  try {
    await client.connect(transport)
    const call = async (args: Record<string, unknown>) => {
      const res: any = await client.callTool({ name: "bb_edit", arguments: args })
      const text = (res?.content ?? []).map((c: any) => c.text ?? "").join("\n")
      return { text, isError: res?.isError === true }
    }

    // ── advertised surface ────────────────────────────────────────────────
    const listed = await client.listTools()
    const edit = listed.tools.find((t) => t.name === "bb_edit")
    ck("wire: tools/list advertises bb_edit", !!edit, listed.tools.map((t) => t.name).join(","))
    const schema = (edit?.inputSchema ?? {}) as any
    const props = Object.keys(schema.properties ?? {})
    const expected = ["mode", "dryRun", "filePath", "symbolName", "lineStart", "content", "newContent", "targetSymbolName", "position", "newName", "force", "format", "overwrite", "edits", "files"]
    ck("wire: the advertised schema carries every option", expected.every((p) => props.includes(p)), `missing=${expected.filter((p) => !props.includes(p)).join(",")}`)
    ck("wire: mode enum is the six executable modes", JSON.stringify(schema.properties?.mode?.enum) === JSON.stringify(["write", "update", "insert", "delete", "refactor", "batch"]), JSON.stringify(schema.properties?.mode?.enum))
    ck("wire: required is [mode] only", JSON.stringify(schema.required) === JSON.stringify(["mode"]), JSON.stringify(schema.required))

    // ── a normal indexed update (dry run, then commit) ────────────────────
    const a = path.join(f.ts, "src/a.ts")
    const beforeA = hash(a)
    const dry = await call({ mode: "update", symbolName: "target", filePath: "src/a.ts", newContent: "return 5", dryRun: true })
    ck("wire: update dryRun succeeds and reports dryRun:true", !dry.isError && dry.text.includes('"dryRun": true'), dry.text.slice(0, 160))
    negative("wire: update dryRun writes no bytes", hash(a) === beforeA)

    const commit = await call({ mode: "update", symbolName: "target", filePath: "src/a.ts", newContent: "return 9", format: false })
    ck("wire: update commit succeeds and the bytes changed", !commit.isError && readFileSync(a, "utf8").includes("return 9"), commit.text.slice(0, 200))
    writeFileSync(a, readFileSync(a, "utf8").replace("return 9", "return x + 1"))
    await indexProjectParallel(tsId as any, f.ts, {})

    // ── a plan-stage refusal arrives as isError ───────────────────────────
    const big = path.join(f.ts, "src/wire-big.ts")
    writeFileSync(big, Array.from({ length: 41 }, (_, i) => `export const w${i} = ${i}`).join("\n") + "\n")
    const bigBefore = hash(big)
    const refused = await call({ mode: "write", filePath: "src/wire-big.ts", content: "export const w0 = 0\n", format: false })
    ck("wire: the overwrite-guard refusal is an ERROR", refused.isError && refused.text.includes("write refused"), refused.text.slice(0, 200))
    ck("wire: the refusal body is ok:false + rolledBack:true", refused.text.includes('"ok": false') && refused.text.includes('"rolledBack": true'), refused.text.slice(0, 200))
    negative("wire: the refused write leaves the file byte-identical", hash(big) === bigBefore)
    ck("wire: a plan-stage refusal carries the empty per-file envelope", refused.text.includes('"envelope"') && refused.text.includes('"entries": []') && refused.text.includes('"committed": 0') && refused.text.includes('"restored": 0'), refused.text.slice(0, 320))
    ck("wire: and declares that it refused before writing", refused.text.includes('"refusedBeforeWriting": true'), refused.text.slice(0, 220))

    // ── a validation failure AFTER the write: rollback over the wire ──────
    const roll = await call({ mode: "update", symbolName: "target", filePath: "src/a.ts", newContent: "export function target( { broken", format: false })
    ck("wire: a post-write validation failure is an ERROR", roll.isError && /validation failed|Syntax/.test(roll.text), roll.text.slice(0, 200))
    ck("wire: the failure carries rolledBack:true and a restored envelope", roll.text.includes('"rolledBack": true') && roll.text.includes('"restored": 1'), roll.text.slice(0, 400))
    negative("wire: every file is byte-identical after the wire rollback", hash(a) === beforeA)

    // ── path escape refusal ───────────────────────────────────────────────
    const escape = await call({ mode: "write", filePath: "../wire-escape.ts", content: "x\n", format: false })
    ck("wire: a path escape is an ERROR naming the escape", escape.isError && escape.text.includes("path escapes project root"), escape.text.slice(0, 200))
    const protectedWrite = await call({ mode: "write", filePath: ".git/hooks/pre-commit.ts", content: "export const hook = 1\n", format: false })
    ck("wire: a write under .git/ is refused by the protected-path policy", protectedWrite.isError && protectedWrite.text.includes("protected path"), protectedWrite.text.slice(0, 220))

    // ── batch over the wire ───────────────────────────────────────────────
    const batch = await call({ mode: "batch", format: false, edits: [
      { mode: "update", symbolName: "helper", filePath: "src/a.ts", newContent: "return 41" },
      { mode: "insert", targetSymbolName: "doomed", filePath: "src/del.ts", position: "after", newContent: "// batch-inserted" },
    ] })
    ck("wire: batch succeeds and reports a per-entry batch array", !batch.isError && batch.text.includes('"batch"') && batch.text.includes('"reindexed": true'), batch.text.slice(0, 300))
    ck("wire: the batch answer carries the envelope", batch.text.includes('"envelope"') && batch.text.includes('"atomic": true'), batch.text.slice(0, 200))
    const dup = await call({ mode: "batch", format: false, edits: [
      { mode: "update", symbolName: "helper", filePath: "src/a.ts", newContent: "return 1" },
      { mode: "insert", targetSymbolName: "helper", filePath: "src/a.ts", position: "after", newContent: "// dup" },
    ] })
    ck("wire: two entries on one file are refused as an ERROR", dup.isError && dup.text.includes("both resolve to"), dup.text.slice(0, 240))

    // ── per-mode argument rejection over the wire ─────────────────────────
    const irrelevant = await call({ mode: "update", symbolName: "target", newContent: "x", position: "after" })
    ck("wire: an option the mode cannot honor is refused at the boundary", irrelevant.isError && irrelevant.text.includes("does not accept: position") && irrelevant.text.includes("accepted for insert"), irrelevant.text.slice(0, 240))
    const unknown = await call({ mode: "write", filePath: "a.ts", content: "x", bogus: true })
    ck("wire: an unknown option is refused with the accepted set", unknown.isError && unknown.text.includes("unknown or irrelevant options: bogus"), unknown.text.slice(0, 200))
    const missing = await call({ mode: "write" })
    ck("wire: a missing required field is refused", missing.isError && missing.text.includes("requires filePath"), missing.text.slice(0, 160))

    // ── the index gate, per mode ──────────────────────────────────────────
    const fresh = f.noindex
    const freshTransport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", serverEntry, "--dir", fresh],
      cwd: process.cwd(),
      stderr: "pipe",
      env: { ...process.env, BB_DATA_DIR: dataDir, BB_NO_AUTO_REFRESH: "1" } as Record<string, string>,
    })
    const freshClient = new Client({ name: "bb-edit-phase-a-fresh", version: "1.0.0" })
    try {
      await freshClient.connect(freshTransport)
      const freshCall = async (args: Record<string, unknown>) => {
        const res: any = await freshClient.callTool({ name: "bb_edit", arguments: args })
        return { text: (res?.content ?? []).map((c: any) => c.text ?? "").join("\n"), isError: res?.isError === true }
      }
      const blocked = await freshCall({ mode: "update", symbolName: "anything", newContent: "x" })
      ck("wire: a symbol mode on a no-index project is refused with the remediation", blocked.isError && blocked.text.includes("No index found") && blocked.text.includes("bb index"), blocked.text.slice(0, 240))
      ck("wire: the index refusal names `write` as the mode that still works", blocked.text.includes("`write`") && /needs that index for/.test(blocked.text), blocked.text.slice(0, 300))
      const batchBlocked = await freshCall({ mode: "batch", format: false, edits: [{ mode: "write", filePath: "src/second.ts", content: "export const second = 1\n" }] })
      ck("wire: batch on a no-index project is refused (the documented conservative gate)", batchBlocked.isError && batchBlocked.text.includes("No index found"), batchBlocked.text.slice(0, 240))
      const created = await freshCall({ mode: "write", filePath: "src/first.ts", content: "export function firstWire(): number {\n  return 1\n}\n", format: false })
      ck("wire: write on a no-index project SUCCEEDS (the bootstrap path)", !created.isError && created.text.includes('"reindexed": true'), created.text.slice(0, 240))
      ck("wire: the file exists on disk after the wire write", existsSync(path.join(fresh, "src/first.ts")))
      const unblocked = await freshCall({ mode: "update", symbolName: "firstWire", newContent: "return 2", format: false })
      ck("wire: the same project's symbol mode works after that write (bootstrap closes)", !unblocked.isError && readFileSync(path.join(fresh, "src/first.ts"), "utf8").includes("return 2"), unblocked.text.slice(0, 240))
    } finally {
      try { await freshClient.close() } catch {}
    }
  } finally {
    try { await client.close() } catch {}
  }

  const out = path.resolve("validation/tools/bb_edit/artifacts/wire.json")
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify({
    schemaVersion: 1,
    tool: "bb_edit",
    phase: "A-audit-wire",
    generatedAt: new Date().toISOString(),
    transport: "MCP stdio via @modelcontextprotocol/sdk StdioClientTransport, source server under tsx, env BB_DATA_DIR passed explicitly",
    summary: { total: checks.length, passed: checks.length - failures, failed: failures, negativeCases: checks.filter((c) => c.negative).length },
    checks,
  }, null, 2) + "\n")
  console.log(`\nWIRE: ${checks.length} checks, ${checks.length - failures} passed, ${failures} failed → ${out}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error("FATAL", e); process.exit(2) })
