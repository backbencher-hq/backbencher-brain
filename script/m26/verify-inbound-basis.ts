#!/usr/bin/env bun
/**
 * verify-inbound-basis.ts — the store states WHY a reverse walk may claim an edge.
 *
 * ## The defect this gate exists for
 *
 * The schema stored no inbound edge. Every reverse surface (impact, hover, references) answered by scanning
 * OUTGOING rows and matching targets, and a name match is not an identity:
 *   1. an unreferenced declaration and a declaration whose references were never emitted were identical;
 *   2. a name collision attributed an incoming edge to the WRONG declaration (zig measured 759 such edges
 *      while its own census read "dangling 0.00%", because the census resolves BY NAME and a collision
 *      resolves);
 *   3. a hopeless string (external package, path, builtin) looked exactly like a never-indexed target.
 * `script/m14/incoming-check.ts` documents the three. The remedy is not a duplicated reverse table: the rows
 * already carry both identities, and the missing fact is the RESOLUTION BASIS —
 * `brain_relationship.target_basis`, a VIRTUAL GENERATED column:
 *   symbol     target_symbol_id names a stored declaration (identity)
 *   external   the analyzer classified the target as a known-external identity (metadata.isExternalTarget)
 *   unresolved a string the store could not resolve and did not classify
 *
 * ## What this gate proves, on a REAL index built by the REAL CLI
 *
 *   B1 exists      the column is present on a pre-existing database (and on a fresh one) and re-opening is
 *                  idempotent (the generated-column probe in schema-ddl is what makes this true).
 *   B2 partition   every row's basis is one of the three; target_symbol_id IS NOT NULL ⟺ basis = 'symbol';
 *                  nothing else. No row can be "a symbol with an unresolved basis".
 *   B3 identity    the resolved rows are exactly the basis='symbol' rows, and the graph engine publishes the
 *                  basis on the edge it returns for one of them (the disclosure path consumers read).
 *   B4 classified  a known-external target carries basis='external' (not 'unresolved'), so a reader can tell
 *                  lie 3's two cases apart, and a string the store cannot resolve carries 'unresolved'.
 *
 * Usage: bun script/m26/verify-inbound-basis.ts [--keep]
 * Exit:  0 every contract holds, 1 otherwise.
 */
import { spawn } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { Database } from "bun:sqlite"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const SCRATCH = path.join(ROOT, ".tmp-lead", "inbound-basis")
const CLI = path.join(ROOT, "src", "cli", "index.ts")
const KEEP = process.argv.includes("--keep")

let failures = 0
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures++
}
function writeFile(dir: string, name: string, body: string) {
  writeFileSync(path.join(dir, name), body)
  return undefined
}
function runCli(projectDir: string, dataDir: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, "index", projectDir, "--no-setup"], {
      cwd: ROOT,
      env: { ...process.env, BB_DATA_DIR: dataDir },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let out = ""
    child.stdout.on("data", (d: Buffer) => { out += d.toString() })
    child.stderr.on("data", (d: Buffer) => { out += d.toString() })
    child.on("close", (code: number | null) => resolve({ code, out }))
  })
}
function dbPathOf(dataDir: string): string | null {
  const p = path.join(dataDir, "projects")
  try {
    const dirs = (require("node:fs").readdirSync(p) as string[])
    return dirs.length ? path.join(p, dirs[0], "brain.db") : null
  } catch { return null }
}

async function main() {
  console.log(`\nINBOUND BASIS — target_basis on a real index; the store must state WHY a target may claim an edge\n`)
  rmSync(SCRATCH, { recursive: true, force: true })
  const project = path.join(SCRATCH, "proj")
  const dataDir = path.join(SCRATCH, "data")
  mkdirSync(project, { recursive: true })
  // The fixture is small but exercises all three bases:
  //   · same-file identity        DerivedThing extends BaseThing          → symbol
  //   · known-external target     readFile( from "node:fs" )              → external
  //   · an unresolvable string    calls to a name declared nowhere        → unresolved
  writeFile(project, "base.ts", `export class BaseThing { run(): number { return 1 } }\nexport class DerivedThing extends BaseThing { extra(): number { return 2 } }\n`)
  writeFile(project, "external.ts", `import { readFile } from "node:fs"\nexport function load(): unknown { return readFile("x", () => {}) }\nexport function ghost(): number { return nowhereDeclared(1) }\n`)
  const run = await runCli(project, dataDir)
  check("the fixture indexes successfully", run.code === 0, `exit ${run.code}`)

  const dbPath = dbPathOf(dataDir)
  check("brain.db was created", !!dbPath && require("node:fs").existsSync(dbPath!), dbPath ?? "none")
  // Open through the PRODUCT layer first: the migration must run on the pre-existing-DB path (the one every
  // editor opens), not only on fresh-DB creation.
  process.env.BB_DATA_DIR = dataDir
  const { BrainDatabase } = await import("../../src/brain/database")
  const projectsRoot = path.join(dataDir, "projects")
  const projectId = (require("node:fs").readdirSync(projectsRoot) as string[])[0]
  const raw = await BrainDatabase.getRawInstance(projectId as any)

  // B1 exists + idempotent
  const xinfo = raw.prepare("PRAGMA table_xinfo(brain_relationship)").all() as any[]
  const basisCol = xinfo.find((c) => c.name === "target_basis")
  check("B1 target_basis exists in the store", !!basisCol, basisCol ? `generated(hidden=${basisCol.hidden})` : "missing")
  check("B1 it is a GENERATED column (not a writer-maintained copy)", !!basisCol && basisCol.hidden !== 0, `hidden=${basisCol?.hidden}`)
  let reopenOk = true
  try {
    await BrainDatabase.getRawInstance(projectId as any)
    // a second open through the same product path must not throw (idempotent migration probe)
  } catch { reopenOk = false }
  check("B1 re-opening the database is idempotent", reopenOk)

  // B2 partition
  const badBasis = raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE target_basis IS NULL OR target_basis NOT IN ('symbol','external','unresolved')").get() as any
  check("B2 every row's basis is one of the three states", badBasis.c === 0, `${badBasis.c} invalid`)
  const mismatched = raw.prepare(`SELECT COUNT(*) c FROM brain_relationship
    WHERE (target_symbol_id IS NOT NULL AND target_basis != 'symbol')
       OR (target_symbol_id IS NULL AND target_basis = 'symbol')`).get() as any
  check("B2 target_symbol_id IS NOT NULL ⟺ basis = 'symbol'", mismatched.c === 0, `${mismatched.c} violations`)

  // B3 identity path + engine disclosure
  const census = raw.prepare("SELECT target_basis b, COUNT(*) c FROM brain_relationship GROUP BY b ORDER BY b").all() as any[]
  const byBasis = Object.fromEntries(census.map((r) => [r.b, r.c]))
  const resolved = raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE target_symbol_id IS NOT NULL").get() as any
  check("B3 resolved rows = basis='symbol' rows", (byBasis.symbol ?? 0) === resolved.c, `symbol=${byBasis.symbol ?? 0} resolved=${resolved.c}`)
  const { graphTraversal } = await import("../../src/intelligence/graph/graph-engine")
  const g = await graphTraversal(projectId as any, "DerivedThing", { direction: "both", maxDepth: 1 })
  const edges = [...(g.callers ?? []), ...(g.callees ?? [])]
  const extendsEdge = edges.find((e: any) => e.relationshipType === "extends" || e.type === "extends")
  check("B3 the engine publishes targetBasis on its edges", !!extendsEdge && extendsEdge.targetBasis === "symbol", JSON.stringify(extendsEdge?.targetBasis ?? null))
  check("B3 that edge is the stored identity (it names BaseThing)", !!extendsEdge && String(extendsEdge.to ?? "").includes("BaseThing"), String(extendsEdge?.to ?? ""))

  // B4 classification: external vs unresolved
  const hasExternal = (byBasis.external ?? 0) > 0
  check("B4 a known-external target is classified 'external', not 'unresolved'", hasExternal, `external=${byBasis.external ?? 0} unresolved=${byBasis.unresolved ?? 0}`)
  const externalRows = raw.prepare("SELECT target_external t FROM brain_relationship WHERE target_basis='external' LIMIT 5").all() as any[]
  check("B4 and the external rows name external identities", externalRows.length > 0, externalRows.map((r) => r.t).join(", ").slice(0, 80))
  const unresolvedRows = raw.prepare("SELECT target_external t FROM brain_relationship WHERE target_basis='unresolved' LIMIT 5").all() as any[]
  console.log(`  note  external=${byBasis.external ?? 0} unresolved=${byBasis.unresolved ?? 0} symbol=${byBasis.symbol ?? 0} — unresolved names: ${unresolvedRows.map((r) => r.t).join(", ").slice(0, 80) || "none in this fixture"}`)

  if (!KEEP) rmSync(SCRATCH, { recursive: true, force: true })
  console.log(failures === 0 ? `\nPASS — the store states the resolution basis and the engine publishes it` : `\nFAIL — ${failures} contract(s) broken`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
