// Real MCP stdio door probe for bb_index.
//
//   BB_DATA_DIR=<isolated> npx tsx validation/tools/bb_index/probe-mcp.ts \
//       <fixtureDir> <cases.json> <out.json>
//
// Spawns `npx tsx src/mcp/server.ts --dir <fixture>` exactly as an MCP host
// would, performs the initialize/tools-list handshake, then calls bb_index for
// every case through JSON-RPC. Each case may pre-mutate the fixture (`write`,
// `rm`, `symlink`) so a single command proves the answer against a known tree.
// The full response text, isError flag and wall time are recorded; nothing is
// asserted here — assertions live in the gate file that reads this output.
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const fixture = path.resolve(process.argv[2] ?? "")
const casesPath = path.resolve(process.argv[3] ?? "")
const outPath = path.resolve(process.argv[4] ?? "")

interface ProbeCase {
    label: string
    arguments: Record<string, unknown>
    setup?: { write?: { path: string; content: string }; rm?: string; symlink?: { path: string; target: string } }
}

const cases: ProbeCase[] = JSON.parse(readFileSync(casesPath, "utf8"))
const dataDir = process.env.BB_DATA_DIR
if (!dataDir) {
    console.error("probe-mcp: BB_DATA_DIR must be set (isolated lane data dir)")
    process.exit(2)
}
// The campaign's real-corpus fixtures live outside the checkout and are READ by
// the indexer, never written. Only that corpus root is admitted as an external
// fixture; anything else must be inside the checkout.
const CORPUS_ROOT = "/home/ishaq2321/bb_tests/repositories"
if (!fixture.startsWith(ROOT + path.sep) && !fixture.startsWith(CORPUS_ROOT + path.sep)) {
    console.error(`probe-mcp: fixture must be inside the checkout or under ${CORPUS_ROOT}: ${fixture}`)
    process.exit(2)
}

const evidence: Record<string, unknown> = {
    schemaVersion: 1,
    tool: "bb_index",
    door: "real MCP stdio (npx tsx src/mcp/server.ts --dir <fixture>)",
    fixture,
    dataDir,
    startedAt: new Date().toISOString(),
    cases: [] as unknown[],
    stderr: "",
}

const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/mcp/server.ts", "--dir", fixture],
    cwd: ROOT,
    env: process.env as Record<string, string>,
    stderr: "pipe",
})
let stderr = ""
transport.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString() })
const client = new Client({ name: "bb-index-door-probe", version: "1.0.0" })

try {
    await client.connect(transport)
    const list = await client.listTools()
    const desc = list.tools.find((t) => t.name === "bb_index")
    evidence.toolsList = {
        count: list.tools.length,
        names: list.tools.map((t) => t.name),
        bbIndex: desc
            ? {
                descriptionLength: desc.description?.length ?? 0,
                modes: (desc.inputSchema?.properties as any)?.mode?.enum ?? null,
                required: desc.inputSchema?.required ?? null,
                pathDescription: (desc.inputSchema?.properties as any)?.path?.description ?? null,
            }
            : null,
    }

    const results: Array<Record<string, unknown>> = []
    for (const c of cases) {
        const setup = c.setup
        if (setup?.write) {
            const p = path.resolve(fixture, setup.write.path)
            mkdirSync(path.dirname(p), { recursive: true })
            writeFileSync(p, setup.write.content)
        }
        if (setup?.rm) {
            try { unlinkSync(path.resolve(fixture, setup.rm)) } catch { /* absent */ }
        }
        if (setup?.symlink) {
            const p = path.resolve(fixture, setup.symlink.path)
            try { unlinkSync(p) } catch { /* absent */ }
            mkdirSync(path.dirname(p), { recursive: true })
            symlinkSync(setup.symlink.target, p)
        }
        const started = performance.now()
        let record: Record<string, unknown>
        try {
            const result: any = await client.callTool({ name: "bb_index", arguments: c.arguments })
            const text = Array.isArray(result?.content)
                ? result.content.map((part: any) => (part?.type === "text" ? part.text : `[${part?.type}]`)).join("\n")
                : JSON.stringify(result)
            record = { label: c.label, arguments: c.arguments, isError: result?.isError === true, text, ms: Math.round(performance.now() - started) }
        } catch (e: any) {
            record = { label: c.label, arguments: c.arguments, protocolError: String(e?.message ?? e), ms: Math.round(performance.now() - started) }
        }
        results.push(record)
        console.log(`${record.isError === true ? "REFUSED" : record.protocolError ? "PROTOCOL" : "OK     "} ${c.label} (${record.ms}ms)`)
        console.log(`        ${String(record.text ?? record.protocolError ?? "").replace(/\n/g, "\n        ").slice(0, 1600)}`)
    }
    evidence.cases = results
} catch (e: any) {
    evidence.fatal = String(e?.stack ?? e)
} finally {
    try { await client.close() } catch { /* server already gone */ }
    evidence.stderr = stderr.slice(0, 4000)
    evidence.finishedAt = new Date().toISOString()
    mkdirSync(path.dirname(outPath), { recursive: true })
    writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n")
    console.error(`probe-mcp: wrote ${outPath}`)
}
