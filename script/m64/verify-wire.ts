// script/m64/verify-wire.ts — M64.E.
//
// THE GAP THIS CLOSES.
//
// Every addition in this lane is a TOOL OPTION. An option lives in three
// hand-edited places — the registry's inputSchema, the validation function, and
// the handler that maps args into the provider — and the eight m64 gates exercise
// only the LAST of them. They call getUnifiedHealth() directly. So every gate
// proves the provider is correct and nothing proves the agent can REACH it.
//
// That is not a theoretical gap. Two real defects lived in exactly the code the
// gates could not see: a `}` that closed the properties object one brace early,
// and an option wired into the provider but never into the handler's argument
// map. Both are invisible to a direct provider call. Both are fatal to the
// feature: the tool would answer with the old behaviour forever, and no gate in
// the suite would say so.
//
// So this gate drives the real thing: a spawned MCP server over stdio, the
// official SDK client, and JSON arguments — the same path an agent takes. It
// asserts what the agent actually READS, which is the text block, not the
// internal shape.
//
// It must run under bun: src/mcp/server.ts self-starts behind `import.meta.main`,
// a Bun API that is `undefined` under Node, so under Node the server never starts
// and the session dies with "Connection closed". That is why the whole verify
// chain is bun-only, and until now it had never been run at all.
//
// The schema assertions matter as much as the behaviour ones. For an MCP client
// the inputSchema description IS the documentation — there is no other channel.
// An option whose description fails to name the states it can return is a
// feature that cannot be used correctly, however correct the code behind it is.
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { Harness } from "../m13/harness"
import { getProjectId } from "../../src/util/project-id"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"

const harness = new Harness({
  issue: "M64",
  code: "H64e",
  tool: "bb_health",
  title: "bb_health over the wire: the five additions reachable by an agent, and the schema that guides it",
  layers: ["integration", "wire"],
  decisions: {
    why: "the eight existing gates call the provider directly, so they cannot see the registry schema, the validation function, or the handler argument map — where two real defects lived",
    surface: "the text block the agent READS, not the internal report shape",
    schema: "asserted as a first-class contract, because for an MCP client inputSchema is the only documentation channel there is",
    runtime: "bun-only, because src/mcp/server.ts self-starts behind import.meta.main",
  },
  limitations: [
    "This gate needs a spawned stdio server, so it is slower and heavier than the other eight. It is a wire gate by construction and cannot be made into a unit test without ceasing to test the wire.",
    "It exercises the SOURCE tree (bun src/mcp/server.ts), not the compiled dist bundle. A stale dist would therefore not be caught here; the bundle is a separate build artifact and is verified by its own build step.",
  ],
})

if (typeof Bun === "undefined") {
  console.log("H64e: SKIPPED — requires bun (src/mcp/server.ts self-starts behind import.meta.main, a Bun API)")
  console.log("  under Node the spawned server never starts, so there is no wire to test.")
  process.exit(0)
}

// ── fixture: build all five path states plus an escape and a bad argument ─────
const root = mkdtempSync(path.join(tmpdir(), "bb-h64e-"))
mkdirSync(path.join(root, "src"), { recursive: true })
for (let i = 0; i < 4; i++) writeFileSync(path.join(root, "src", `f${i}.ts`), `export function fn${i}(): number { return ${i} }\n`)
writeFileSync(path.join(root, "src", "doomed.ts"), "export function doomed(): number { return 1 }\n")
const pid = getProjectId(root)
await indexProjectParallel(pid as any, root, {})
// The three conditions that cannot all be true at index time.
appendFileSync(path.join(root, "src", "f0.ts"), "\n// edited over the wire fixture\n")   // stale
rmSync(path.join(root, "src", "doomed.ts"))                                               // gone
writeFileSync(path.join(root, "src", "brand-new.ts"), "export function brandNew(): number { return 42 }\n") // not-indexed
// "src/never-existed.ts" stays absent.

// `client` must be visible to `call`, which is defined out here. The first draft
// declared it inside the try block, so every call after the handshake died with
// "client is not defined" — the gate caught its own scoping error on the first
// run, which is the minimum a gate is entitled to do for itself.
let client: Client | null = null
const call = async (args: Record<string, unknown>) => {
  if (!client) throw new Error("no MCP client: the wire session did not start")
  const res: any = await client.callTool({ name: "bb_health", arguments: args })
  return { text: (res.content ?? []).map((c: any) => c.text ?? "").join("\n"), isError: res.isError === true, raw: res }
}
const line = (text: string, prefix: string) => text.split("\n").find((l) => l.startsWith(prefix)) ?? ""

try {
  const transport = new StdioClientTransport({
    command: "bun",
    args: [path.resolve("src/mcp/server.ts"), "--dir", root],
    cwd: process.cwd(),
    stderr: "pipe",
  })
  client = new Client({ name: "verify-wire", version: "1.0.0" })
  await client.connect(transport)
  harness.check("the MCP server starts and completes the handshake over stdio", true, `runtime ${process.version}`)

  // ══ 1. the schema IS the contract ═══════════════════════════════════════
  const tools = await client.listTools()
  const health = tools.tools.find((t: any) => t.name === "bb_health") as any
  harness.check("bb_health is advertised", !!health, `tools: ${tools.tools.map((t: any) => t.name).join(",")}`)
  const props = health?.inputSchema?.properties ?? {}

  // Each addition must be REACHABLE: declared in the schema, or an agent cannot
  // pass it and the provider code is unreachable dead weight.
  for (const opt of ["paths", "checkUnindexed"]) {
    harness.check(`the schema advertises \`${opt}\``, !!props[opt], `an option the schema omits cannot be passed by an agent; declared options: ${Object.keys(props).join(", ")}`)
  }
  const pathsDesc = String(props.paths?.description ?? "")
  // The five states, by name, in the only documentation channel an agent has.
  for (const state of ["fresh", "stale", "gone", "not-indexed", "absent"]) {
    harness.check(`the paths description names the \`${state}\` state`, pathsDesc.toLowerCase().includes(state), `an agent cannot distinguish five states from a description that names ${pathsDesc.length} chars`)
  }
  harness.negative("and states that the rest of the report is NOT scoped", /PROJECT-WIDE|project-wide/i.test(pathsDesc), "without this the agent merges a 3-file verdict with files=1654")
  harness.negative("and says a refused path is not a clean one", /REFUSED|refused/i.test(pathsDesc), "")
  const unindexedDesc = String(props.checkUnindexed?.description ?? "")
  harness.negative("checkUnindexed says absence is not completeness", /not asserted|completeness is not asserted/i.test(unindexedDesc), "otherwise an agent reads a missing key as 'everything is indexed'")

  // ══ 2. all five states, in the text an agent READS ══════════════════════
  const asked = ["src/f1.ts", "src/f0.ts", "src/doomed.ts", "src/brand-new.ts", "src/never-existed.ts"]
  const scoped = await call({ paths: asked })
  harness.check("the scoped call is not an error", !scoped.isError, scoped.text.slice(0, 120))
  harness.check("the agent sees the scoped block FIRST", /^SCOPED ANSWER/m.test(scoped.text), scoped.text.split("\n")[0]?.slice(0, 90) ?? "absent")
  harness.check("and is told everything after it is project-wide", /everything below this block is PROJECT-WIDE/.test(scoped.text), "")

  // Takes the RAW path and escapes internally. The first draft took an
  // already-escaped path and escaped it a second time, so every lookup was
  // `src/f1\\\.ts` and all five state checks plus the omission check returned
  // undefined: six failures out of one missing backslash.
  const stateOf = (p: string) => {
    const esc = p.replace(/[/.]/g, "\\$&")
    return (new RegExp(`^\\s*(fresh|stale|gone|not-indexed|absent)\\s+${esc}\\b`, "m").exec(scoped.text) ?? [])[1]
  }
  harness.check("fresh      -> src/f1.ts", stateOf("src/f1.ts") === "fresh", `got ${stateOf("src/f1.ts")}`)
  harness.check("stale      -> src/f0.ts", stateOf("src/f0.ts") === "stale", `got ${stateOf("src/f0.ts")}`)
  harness.check("gone       -> src/doomed.ts", stateOf("src/doomed.ts") === "gone", `got ${stateOf("src/doomed.ts")}`)
  // THE anti-fabrication assertion, over the wire: a file the index has never
  // seen must never read as fresh, because an agent would edit, verify, proceed.
  harness.check("not-indexed -> src/brand-new.ts, NEVER 'fresh'", stateOf("src/brand-new.ts") === "not-indexed", `got ${stateOf("src/brand-new.ts")} — over the wire, this is the fabrication the whole design exists to prevent`)
  harness.check("absent     -> src/never-existed.ts, not 'not-indexed'", stateOf("src/never-existed.ts") === "absent", `got ${stateOf("src/never-existed.ts")}`)
  harness.check("every requested path has a row — no silent omission", asked.every((p) => stateOf(p) !== undefined), `asked ${asked.length}, rows found ${asked.filter((p) => stateOf(p) !== undefined).length}`)
  harness.check("the not-indexed row explains itself in the text", /not in the index/.test(scoped.text), "a bare state word is a label; the agent needs the reason to act")

  // ══ 3. the boundary refuses, loudly, over the wire ══════════════════════
  for (const [args, why] of [
    [{ paths: [] }, "an empty list"],
    [{ paths: ["src/f1.ts", "src/f1.ts"] }, "a duplicate"],
    [{ paths: ["   "] }, "a blank entry"],
    [{ paths: "src/f1.ts" }, "a bare string"],
    [{ paths: Array.from({ length: 51 }, (_, i) => `src/f${i}.ts`) }, "more than 50"],
  ] as any[]) {
    const r = await call(args)
    harness.check(`${why} is REFUSED with isError and the rule named`, r.isError && /paths/.test(r.text), r.text.replace(/\s+/g, " ").slice(0, 110))
  }
  const escape = await call({ paths: ["../outside.ts", "/etc/hosts"] })
  harness.check("a path escaping the project is REFUSED, not answered", /REFUSED/.test(escape.text), escape.text.split("\n").find((l) => l.includes("REFUSED"))?.slice(0, 110) ?? "absent")
  harness.negative("and never appears as fresh", !/fresh\s+.*outside\.ts/.test(escape.text), "a refused path is not a clean one")
  harness.check("the refusal is an error the agent cannot miss", escape.isError || /PATHS_REFUSED|REFUSED/.test(escape.text), `isError=${escape.isError}`)

  // ══ 4. scoping does not quietly become a project report ═════════════════
  const project = await call({})
  const filesIn = (t: string) => (/files=(\d+)/.exec(t) ?? [])[1]
  harness.check("the project report still reports project counts", !!filesIn(project.text), (project.text.split("\n").find((l) => l.startsWith("files=")) ?? "no `files=` line").slice(0, 80))
  // The first version compared two possibly-undefined values, so it would have
  // PASSED with both undefined — a vacuous green. A no-vacuity guard is part of
  // the assertion, not an afterthought: this is the check that would catch a
  // mixed-scope report, and it must be incapable of passing without a value.
  harness.check("and `paths` does not change that count", filesIn(project.text) !== undefined && filesIn(scoped.text) === filesIn(project.text), `project=${filesIn(project.text)} scoped=${filesIn(scoped.text)} — a scoped answer that moved the project number is a mixed-scope report`)
  harness.negative("the default report makes no scoped claim", !/^SCOPED ANSWER/m.test(project.text), "")
  harness.negative("and no completeness claim without checkUnindexed", !/^unindexed:/m.test(project.text), "an unrun walk must not read as 'everything is indexed'")

  // ══ 5. checkUnindexed, over the wire ═════════════════════════════════════
  const withUn = await call({ checkUnindexed: true })
  harness.check("checkUnindexed answers with a measured line", /^unindexed:/m.test(withUn.text), line(withUn.text, "unindexed:").slice(0, 110) || "absent")
  harness.check("and it NAMES the file the indexer would index but does not have", /brand-new\.ts/.test(withUn.text), line(withUn.text, "unindexed:").slice(0, 130))
  harness.check("and states the population it measured over", /indexable file|would index/.test(withUn.text), "a count without its population cannot be over-read correctly")
  const checkBoth = await call({ paths: ["src/brand-new.ts"], checkUnindexed: true })
  harness.check("both options compose without either being dropped", /not-indexed/.test(checkBoth.text) && /^unindexed:/m.test(checkBoth.text), `scoped block present=${/not-indexed/.test(checkBoth.text)}, project line present=${/^unindexed:/m.test(checkBoth.text)}`)

  // ══ 6. the lane's earlier additions are reachable here too ═══════════════
  // `healthy` is a FIELD ON THE TOOL RESULT, not a line in the text. The first
  // draft grepped the text for the word and failed — correctly, because the text
  // form has never carried it. An MCP client branches on res.healthy, so that is
  // the surface the assertion has to name.
  harness.check("the tool RESULT carries a boolean `healthy` for the agent to branch on", typeof project.raw?.healthy === "boolean", `res.healthy=${JSON.stringify(project.raw?.healthy)} — a client reads this field, not the prose`)
  harness.check("and it is true for a clean index", project.raw?.healthy === true, `healthy=${project.raw?.healthy}`)
  harness.check("the call reports its own cost", /^this call:/m.test(project.text), line(project.text, "this call:").slice(0, 90) || "absent")
  const why = await call({ freshness: "complete" })
  harness.check("the freshness reasons reach the wire", /freshness why/.test(why.text), "three conditions with three fixes, or one useless number")

  await client.close()
} catch (e) {
  harness.check("the MCP wire session", false, `${(e as Error).message}`)
} finally {
  try { rmSync(path.dirname(BrainDatabase.getDbPath(pid as any)), { recursive: true, force: true }) } catch {}
  rmSync(root, { recursive: true, force: true })
}

harness.emit()
