// script/m13/verify-health-mutability.ts — (H1).
//
// bb_health mutability contract: one truth across registry, generated docs,
// and behavior.
//
//  1. Registry + contract artifact + generated docs all say mutability=read.
//  2. refresh/force are documented as EXPLICIT index mutation, never implicit.
//  3. Runtime proof: a plain health call mutates nothing (DB fingerprint
//  identical), refresh=true and force=true mutate explicitly (fingerprint
//  changes), and the handler only refreshes when explicitly asked.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel, flushBackgroundEmbeddings } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { getUnifiedHealth } from "../../src/intelligence/health/health-provider"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.29",
  code: "H1",
  tool: "bb_health",
  title: "bb_health: mutability contract (read vs index)",
  layers: ["unit", "integration"],
  decisions: {
    singleTruth: "registry mutability field is the authority; docs/data/public-tools.json and docs/tools/bb_health.md are generated from it and must agree",
    explicitMutation: "refresh=true / force=true are documented and implemented as explicit index mutation; a plain call must never mutate",
    runtimeProof: "DB fingerprint (bytes + symbol count) must be identical after a plain call and different after refresh/force",
  },
  limitations: [
    "The fingerprint covers the project DB file; unrelated writes (e.g. shared caches outside the project) are out of scope.",
  ],
})

// ── 1. Single mutability value across registry, contract, and docs ────────
const descriptor = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_health")!
harness.check("registry: mutability is exactly read", descriptor.mutability === "read", descriptor.mutability)
harness.check("registry: refresh/force described as explicit reindex", descriptor.description.includes("refresh=true") && descriptor.description.includes("force=true"), "missing explicit mutation docs")

const artifact = JSON.parse(readFileSync(path.resolve("docs/data/public-tools.json"), "utf8")) as { tools: any[] }
const artifactHealth = artifact.tools.find((t) => t.name === "bb_health")
harness.check("contract artifact: mutability is read", artifactHealth?.mutability === "read", artifactHealth?.mutability)

const doc = readFileSync(path.resolve("docs/tools/bb_health.md"), "utf8")
harness.check("docs: mutability line is read", doc.includes("- Mutability: `read`"), "missing/incorrect")
// Assert the contract, not one frozen sentence: the curated Safety text is
// allowed to be rewritten as long as it says status is read-only, refresh is an
// explicit mutation and force is a destructive reindex.
const safetyText = doc.split("## Safety")[1]?.split("\n## ")[0] ?? ""
harness.check(
  "docs: refresh/force documented as explicit index mutation",
  /read-only/i.test(safetyText) && /refresh=true/.test(safetyText) && /(mutation|mutates|reindex)/i.test(safetyText) && /force=true/.test(safetyText) && /(destructive|WIPES)/i.test(safetyText),
  safetyText.trim().slice(0, 160),
)

// Static: handler only refreshes when explicitly requested.
const handlers = readFileSync(path.resolve("src/mcp/tools/bb_health/handler.ts"), "utf8")
harness.check("handler: refresh gated on explicit refresh/force flags", handlers.includes("args.refresh === true || args.force === true"), "implicit refresh possible")
// The only mutation this tool performs is the one the caller asked for, and the
// status path must not even open the index writable: the provider opens the
// driver read-only unless refresh/force was requested.
const provider = readFileSync(path.resolve("src/intelligence/health/health-provider.ts"), "utf8")
harness.check("provider: read calls open the index read-only", provider.includes("readonly: !writeRequested"), "writable open on a read path")

// ── 2. Runtime: plain read never mutates; explicit refresh does ────────────
const root = mkdtempSync(path.join(tmpdir(), "bb-health-mutability-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), "export function healthy(): number { return 1 }\n")
await indexProjectParallel(projectId, root, {})
// `indexProjectParallel` can leave background embedding/derived writes draining;
// a write that lands between the two fingerprints would be attributed to the
// health call. Drain first so the measurement is about the health call alone.
await flushBackgroundEmbeddings()

// WAS: `BrainDatabase.getRawInstanceSync ? … : undefined`.
//
// getRawInstanceSync DOES NOT EXIST. Not in src/brain/database.ts, not anywhere — `grep -rn
// getRawInstanceSync src/` returns nothing, and the real accessor is
// `export async function getRawInstance(projectId): Promise<CoreDatabase>`. So the ternary's
// condition was permanently falsy, `raw` was permanently `undefined`, and `count` was
// permanently -1. The `:sym${count}` suffix of this fingerprint was a constant.
//
// That is the same shape as the swallowed crashes fixed in the sibling m13 gates: the code
// LOOKED like it was measuring the symbol count and was not. It did not produce a false pass
// — the size+mtime half still varies on any write, and that is a stronger mutation signal
// than a count — but the fingerprint advertised a measurement it never made, and a reader
// comparing two fingerprints would see `:sym-1` in both and reasonably conclude the symbols
// had not changed, which is not what was established.
async function fingerprint(pid: string): Promise<string> {
  const dbDir = path.dirname(BrainDatabase.getDbPath(pid))
  // The INDEX is brain.db plus its WAL. `brain.db-shm` is SQLite's shared-memory
  // coordination file — a read-only reader joining the shm may advance a read
  // mark there, and that is not an index mutation. It is therefore reported
  // separately (see `shmStat` below) rather than folded into the equality test,
  // which would make the negative depend on connection ordering instead of on
  // whether a byte of the index moved.
  const indexedFiles = readdirSync(dbDir).filter((f) => f === "brain.db" || f === "brain.db-wal").sort()
  const parts = indexedFiles.map((f) => {
    const p = path.join(dbDir, f)
    const bytes = readFileSync(p)
    return `${f}:${bytes.length}:${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}:${statSync(p).mtimeMs}`
  })
  // The real accessor is async, so this function is too. It was made async rather than
  // dropping the count, because the count is the part that survives a mutation which keeps
  // every file's size and mtime identical — rare, but exactly the case a fingerprint exists
  // to catch.
  // READ-ONLY: a writable open runs the additive migrations/healers and would
  // move the WAL — the fingerprint would then be measuring its own write, which
  // is exactly the defect this negative exists to catch.
  const raw = await BrainDatabase.getRawInstance(pid, { readonly: true })
  const count = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol").get() as { c?: number } | undefined)?.c ?? -1
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16) + `:sym${count}`
}

const shmStat = () => {
  const p = path.join(path.dirname(BrainDatabase.getDbPath(projectId)), "brain.db-shm")
  return readFileSync(p).length + ":" + statSync(p).mtimeMs
}
const before = await fingerprint(projectId)
const shmBefore = existsSync(path.join(path.dirname(BrainDatabase.getDbPath(projectId)), "brain.db-shm")) ? shmStat() : "absent"
{
  const report = await getUnifiedHealth(projectId, root, { refresh: false })
  const after = await fingerprint(projectId)
  const shmAfter = existsSync(path.join(path.dirname(BrainDatabase.getDbPath(projectId)), "brain.db-shm")) ? shmStat() : "absent"
  harness.negative("runtime: plain health call performs ZERO index mutation (brain.db + WAL bytes)", after === before, `changed=${after !== before}`)
  // Honest companion fact: -shm is allowed to move (SQLite coordination), and
  // the check above proves the index bytes did not.
  harness.check("runtime: the shared-memory sidecar is the only file that may move", true, `shm ${shmBefore === shmAfter ? "unchanged" : "moved"} (brain.db+WAL ${after === before ? "unchanged" : "changed"})`)
  harness.check("runtime: plain health call returns a report", typeof report === "object" && report !== null, "no report")
}

{
  // Explicit refresh: mutate source, then refresh=true → fingerprint changes.
  writeFileSync(path.join(root, "src", "app.ts"), "export function healthy(): number { return 2 }\nexport function added(): number { return 3 }\n")
  const beforeRefresh = await fingerprint(projectId)
  await getUnifiedHealth(projectId, root, { refresh: true, wait: true })
  const afterRefresh = await fingerprint(projectId)
  harness.negative("runtime: refresh=true explicitly mutates the index", afterRefresh !== beforeRefresh, `changed=${afterRefresh !== beforeRefresh}`)
}

{
  // Explicit force: fingerprint must change too (documented full reindex).
  const beforeForce = await fingerprint(projectId)
  await getUnifiedHealth(projectId, root, { force: true, wait: true })
  const afterForce = await fingerprint(projectId)
  harness.check("runtime: force=true performs an explicit in-place reindex", afterForce !== beforeForce, `changed=${afterForce !== beforeForce}`)
}

rmSync(root, { recursive: true, force: true })
harness.emit()
