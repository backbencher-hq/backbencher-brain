// script/m13/verify-health-mutability.ts — M13.29 (H1).
//
// bb_health mutability contract: one truth across registry, generated docs,
// and behavior.
//
//   1. Registry + contract artifact + generated docs all say mutability=read.
//   2. refresh/force are documented as EXPLICIT index mutation, never implicit.
//   3. Runtime proof: a plain health call mutates nothing (DB fingerprint
//      identical), refresh=true and force=true mutate explicitly (fingerprint
//      changes), and the handler only refreshes when explicitly asked.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, statSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
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
harness.check("docs: refresh/force documented as explicit index mutation", doc.includes("refresh=true explicitly mutates only index data") && doc.includes("force=true performs a full in-place reindex"), "missing explicit mutation docs")

// Static: handler only refreshes when explicitly requested.
const handlers = readFileSync(path.resolve("src/mcp/tool-handlers.ts"), "utf8")
harness.check("handler: refresh gated on explicit refresh/force flags", handlers.includes("args.refresh === true || args.force === true"), "implicit refresh possible")

// ── 2. Runtime: plain read never mutates; explicit refresh does ────────────
const root = mkdtempSync(path.join(tmpdir(), "bb-health-mutability-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), "export function healthy(): number { return 1 }\n")
await indexProjectParallel(projectId, root, {})

function fingerprint(pid: string): string {
  const dbDir = path.dirname(BrainDatabase.getDbPath(pid))
  const files = readdirSync(dbDir).sort()
  const parts = files.map((f) => {
    const p = path.join(dbDir, f)
    return `${f}:${statSync(p).size}:${statSync(p).mtimeMs}`
  })
  const raw = BrainDatabase.getRawInstanceSync ? BrainDatabase.getRawInstanceSync(pid) : undefined
  const count = raw ? (raw.prepare("SELECT COUNT(*) c FROM brain_symbol").get() as any)?.c ?? -1 : -1
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16) + `:sym${count}`
}

const before = fingerprint(projectId)
{
  const report = await getUnifiedHealth(projectId, root, { refresh: false })
  const after = fingerprint(projectId)
  harness.negative("runtime: plain health call performs ZERO index mutation", after === before, `changed=${after !== before}`)
  harness.check("runtime: plain health call returns a report", typeof report === "object" && report !== null, "no report")
}

{
  // Explicit refresh: mutate source, then refresh=true → fingerprint changes.
  writeFileSync(path.join(root, "src", "app.ts"), "export function healthy(): number { return 2 }\nexport function added(): number { return 3 }\n")
  const beforeRefresh = fingerprint(projectId)
  await getUnifiedHealth(projectId, root, { refresh: true, wait: true })
  const afterRefresh = fingerprint(projectId)
  harness.negative("runtime: refresh=true explicitly mutates the index", afterRefresh !== beforeRefresh, `changed=${afterRefresh !== beforeRefresh}`)
}

{
  // Explicit force: fingerprint must change too (documented full reindex).
  const beforeForce = fingerprint(projectId)
  await getUnifiedHealth(projectId, root, { force: true, wait: true })
  const afterForce = fingerprint(projectId)
  harness.check("runtime: force=true performs an explicit in-place reindex", afterForce !== beforeForce, `changed=${afterForce !== beforeForce}`)
}

rmSync(root, { recursive: true, force: true })
harness.emit()
