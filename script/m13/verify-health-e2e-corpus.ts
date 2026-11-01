// script/m13/verify-health-e2e-corpus.ts — (H5).
//
// bb_health across the full loop and real repos:
//  1. sampled vs complete freshness are both correct (sample size honored,
//  complete covers every file, stale detection works in both modes),
//  2. e2e via real MCP stdio and the compiled CLI,
//  3. corpus health reports are internally consistent against direct DB
//  queries; every probe recorded, failures never excluded.

import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

// The gate owns its data dir so a caller that forgot BB_DATA_DIR cannot make the
// spawned server read or write the real ~/.bb index.
process.env.BB_DATA_DIR = process.env.BB_DATA_DIR ?? mkdtempSync(path.join(tmpdir(), "bb-health-e2e-data-"))
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { getUnifiedHealth } from "../../src/intelligence/health/health-provider"
import { Harness } from "./harness"
import { resolveCorpusRoot } from "../lib/corpus-root.ts"

const harness = new Harness({
  issue: "M13.33",
  code: "H5",
  tool: "bb_health",
  title: "bb_health: integration + e2e + corpus",
  layers: ["e2e", "integration", "corpus"],
  decisions: {
    freshness: "sampled honors sampleSize (checked <= sampleSize); complete checks every file; both detect staleness",
    transports: "source CLI via `node --import tsx src/cli/index.ts tool bb_health`; MCP via StdioClientTransport → a source server entry (the working tree, not a possibly-stale dist build)",
    corpus: "health counts must equal direct DB queries on the same project; probes recorded",
  },
  limitations: [
    "Only a small sub-directory per repo is indexed (full 29-repo indexing is hours-long); broader coverage is M14.",
  ],
})

// ── 1. Sampled vs complete freshness ───────────────────────────────────────
const root = mkdtempSync(path.join(tmpdir(), "bb-health-e2e-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
for (let i = 0; i < 5; i++) writeFileSync(path.join(root, "src", `f${i}.ts`), `export function fn${i}(): number { return ${i} }\n`)
await indexProjectParallel(projectId, root, {})

// Make one file stale.
const stalePath = path.join(root, "src", "f0.ts")
writeFileSync(stalePath, readFileSync(stalePath, "utf8") + "\n// h5-probe\n")

{
  const sampled = await getUnifiedHealth(projectId, root, { freshness: "sampled", sampleSize: 2 })
  harness.check("freshness: sampled mode honors sampleSize", sampled.freshness.checked === 2 && sampled.freshness.mode === "sampled", `checked=${sampled.freshness.checked}`)
  // A deterministic sample of 2 of 5 files need not contain the one edited file,
  // so stale-detection is asserted on a sample that covers the fixture; asserting
  // it on the 2-file draw tested the hash ranking, not the detector.
  const sampledAll = await getUnifiedHealth(projectId, root, { freshness: "sampled", sampleSize: 5 })
  harness.check("freshness: sampled mode detects the stale file", sampledAll.freshness.stale === 1, `stale=${sampledAll.freshness.stale} checked=${sampledAll.freshness.checked}`)
  const complete = await getUnifiedHealth(projectId, root, { freshness: "complete" })
  harness.check("freshness: complete mode checks every file", complete.freshness.checked === 5 && complete.freshness.total === 5, `checked=${complete.freshness.checked}`)
  harness.check("freshness: complete mode detects the stale file", complete.freshness.stale === 1, `stale=${complete.freshness.stale}`)
  harness.check("freshness: complete covers the sampled one (sampled subset of complete)", sampled.freshness.checked <= complete.freshness.checked)
}

// ── 2. e2e: MCP + source CLI ──────────────────────────────────────────────
// The gate drives the WORKING TREE, not a dist build that may lag it. `bin/bb`
// would have been the compiled entry, so a split/refactor could leave this leg
// measuring the previous release.
const cliEntry = path.resolve("src/cli/index.ts")
const runCliTool = (args: Record<string, unknown>) =>
  execFileSync(process.execPath, ["--import", "tsx", cliEntry, "tool", "bb_health", "--dir", root, "--args", JSON.stringify(args)], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
{
  const out = runCliTool({})
  harness.check("CLI: health reports counts", /files=5 symbols=\d+/.test(out), out.slice(0, 120))
  harness.check("CLI: health reports freshness line", out.includes("freshness:"), out.slice(0, 120))
  const verbose = runCliTool({ verbose: true })
  harness.check("CLI: verbose adds the language breakdown", verbose.includes("languages:"), verbose.slice(0, 140))
  harness.negative("CLI: default output does NOT leak the verbose breakdown", !out.includes("languages:"), out.slice(0, 140))
}
{
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
  // A one-line source entry, because src/mcp/server.ts self-starts behind
  // `import.meta.main` (a Bun API) and would not start under Node. The MCP child
  // gets the ISOLATED data dir explicitly: StdioClientTransport defaults to a
  // safe env subset that drops BB_DATA_DIR, so without this the spawned server
  // would target the real ~/.bb (and fail here with ENOENT under the sandbox).
  const serverEntry = path.join(root, "server-entry.mts")
  writeFileSync(serverEntry, `import { startMcpServer } from "${path.resolve("src/mcp/server.ts").replace(/\\/g, "/")}"\nconst i = process.argv.indexOf("--dir")\nawait startMcpServer(i >= 0 ? process.argv[i + 1] : process.cwd())\n`)
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", serverEntry, "--dir", root], cwd: process.cwd(), stderr: "pipe", env: { ...process.env, BB_DATA_DIR: process.env.BB_DATA_DIR ?? "" } as Record<string, string> })
  const client = new Client({ name: "verify-health-e2e", version: "1.0.0" })
  const call = async (args: Record<string, unknown>) => {
    const res: any = await client.callTool({ name: "bb_health", arguments: args })
    return { text: (res?.content ?? []).map((c: any) => c.text ?? "").join("\n"), isError: res?.isError ?? false }
  }
  try {
    await client.connect(transport)
    const r = await call({})
    harness.check("MCP: health reports counts", !r.isError && /files=5/.test(r.text), r.text.slice(0, 120))
    const integrity = await call({ integrity: true })
    harness.check("MCP: integrity report present", !integrity.isError && integrity.text.includes("integrity:"), integrity.text.slice(0, 140))
  } catch (e) {
    harness.check("MCP bb_health e2e session", false, e instanceof Error ? e.message : String(e))
  } finally {
    try { await client.close() } catch {}
  }
}
rmSync(root, { recursive: true, force: true })

// ── 3. Corpus: internally consistent health reports ───────────────────────
// Was: the literal foreign corpus root "$HOME/fixtures/repositories" — see
// script/lib/corpus-root.ts, which is where the corpus actually lives on THIS machine.
const REPO_ROOT = resolveCorpusRoot(process.cwd()) ?? "REPO_ROOT_UNRESOLVED"
const SAMPLE: Array<[string, string, string]> = [
  ["rake", "lib/rake", "Ruby"],
  ["rebar3", "apps", "Erlang"],
  ["go-tools", "go/analysis/passes", "Go"],
]

for (const [repo, subPath, family] of SAMPLE) {
  const indexRoot = path.join(REPO_ROOT, repo, subPath)
  if (!existsSync(indexRoot)) {
    harness.check(`corpus ${repo}/${subPath} (${family}): present`, false, `${indexRoot} missing`)
    continue
  }
  const pid = getProjectId(indexRoot)
  try {
    await indexProjectParallel(pid, indexRoot, {})
    const report = await getUnifiedHealth(pid, indexRoot, { freshness: "complete" })
    const raw = await BrainDatabase.getRawInstance(pid)
    const q = (sql: string) => (raw.prepare(sql).get(pid) as any)?.c ?? 0
    const dbFiles = q("SELECT COUNT(*) c FROM brain_file WHERE project_id=?")
    const dbSymbols = q("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?")
    const tag = `${repo}/${subPath} (${family})`
    harness.check(`corpus ${tag}: files count matches DB`, report.counts.files === dbFiles, `report=${report.counts.files} db=${dbFiles}`)
    harness.check(`corpus ${tag}: symbols count matches DB`, report.counts.symbols === dbSymbols, `report=${report.counts.symbols} db=${dbSymbols}`)
    harness.check(`corpus ${tag}: freshness totals consistent`, report.freshness.total === dbFiles && report.freshness.fresh + report.freshness.stale + report.freshness.missing === report.freshness.checked, `checked=${report.freshness.checked} total=${report.freshness.total}`)
    harness.check(`corpus ${tag}: embedding totals consistent`, report.embeddings.total === q("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id=?"), `total=${report.embeddings.total}`)
    harness.check(`corpus ${tag}: schema version is a positive number`, typeof report.schema.version === "number" && report.schema.version > 0, String(report.schema.version))
  } catch (e) {
    harness.check(`corpus ${repo}/${subPath} (${family}): corpus session`, false, e instanceof Error ? e.message : String(e))
  } finally {
    try { rmSync(path.dirname(BrainDatabase.getDbPath(pid)), { recursive: true, force: true }) } catch {}
  }
}

harness.emit()
