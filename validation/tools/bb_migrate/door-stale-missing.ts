// Missing-file leg of the freshness contract through the real MCP door: a plan whose
// source file no longer exists on disk must be counted as missing, not fresh.
import { cpSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { openDoor } from "./door"
import { getProjectId } from "../../../src/cli/index"
import { indexProjectParallel } from "../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../src/brain/database"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const FIXTURE = path.join(ROOT, "validation/tools/bb_migrate/work/stale-fixture")
const DATA = path.join(ROOT, "validation/tools/bb_migrate/work/stale-data")
rmSync(FIXTURE, { recursive: true, force: true })
cpSync(path.join(ROOT, "test/fixtures/polyglot"), FIXTURE, { recursive: true })
const projectId = getProjectId(FIXTURE)
await indexProjectParallel(projectId, FIXTURE, {})
const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
const checkoutSymbols = raw.prepare(
  `SELECT s.name name FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND f.relative_path='ts-js/src/checkout.ts' ORDER BY (SELECT COUNT(*) FROM brain_relationship r WHERE r.source_symbol_id=s.id OR r.target_symbol_id=s.id) DESC`,
).all(projectId) as any[]
const names = [...new Set(checkoutSymbols.map((r) => r.name))].slice(0, 4)
const door = await openDoor({ dir: FIXTURE, dataDir: DATA, label: "stale-missing" })
const out: any[] = []
const run = async (id: string, args: Record<string, unknown>) => {
  const r = await door.callTool(args, 120_000)
  out.push({ id, isError: r.isError, ms: r.ms, plans: r.parsed?.plans?.map((p: any) => ({ name: p.componentName, file: p.sourceFile, stale: p.stale })), freshness: r.parsed?.freshness, textHead: r.parsed ? undefined : r.text.split("\n").slice(0, 4) })
  console.log(JSON.stringify(out[out.length - 1]))
}
await run("checkout-symbols-present", { symbolNames: names, targetLanguage: "python", format: "json" })
rmSync(path.join(FIXTURE, "ts-js/src/checkout.ts"), { force: true })
await run("after-delete-json", { symbolNames: names, targetLanguage: "python", format: "json" })
await run("after-delete-text", { symbolNames: names, targetLanguage: "python" })
await door.close()
writeFileSync(path.join(ROOT, "validation/tools/bb_migrate/raw/door-stale-missing.json"), JSON.stringify({ projectId, names, out }, null, 1))
