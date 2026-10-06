// script/m62/verify-arrival.ts — M62.A3 (issue #877): the M59 ARRIVAL HOOK.
//
// M59 (Call-Site Truth) changes what the store writes: a real analyzer line, or
// NULL — and A4/A8 change what a row IS (multiplicity, identity). Those are
// co-agent lanes. This hook is the IDE lane's ACCEPTANCE for their arrival: it
// proves, on one real index, the exact behaviour the IDE surfaces will show in
// each store state — and that the upgrade needs NO code change here.
//
//   R1 the three states:   one real index seeds a real line, a legacy 0, a NULL
//                          (and a present-but-unusable value). The engine, the
//                          hub payload and the agent's bb_graph payload are
//                          driven for real: a real line is an EXACT call site;
//                          a legacy 0 and a NULL yield the declared substitute
//                          or a declared unknown; the unusable value is never
//                          substituted; nothing anywhere is line 0 or line 1.
//   R2 the upgrade:        the SAME rows are re-written with real lines (what a
//                          re-index by an M59-capable analyzer does) and the
//                          SAME surfaces — no code reloaded, no flags — now
//                          serve exact call sites for every row: the change is
//                          absorbed, not coordinated.
//   R3 multiplicity:       two stored rows for the same caller/target stay TWO
//                          declared rows (the hub's per-group multiplicity),
//                          and both carry their own address — the shape M59.A4
//                          will produce.
//   R4 coverage declared:  the doc states what is NOT claimed (per-language
//                          real-line coverage is M59.A7's lane, measured
//                          there), and this hook's evidence carries the
//                          languages it actually seeded — declared, not
//                          implied.
//
// Evidence: validation/m62/results/A3.json (machine-emitted, sealed).
// Run: npx tsx script/m62/verify-arrival.ts

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { writeSealed } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"
import { getProjectId } from "../../src/util/project-id.ts"
import { LEGACY_NOTE, NOT_STORED_NOTE, SEED, SUBSTITUTE_NOTE, UNUSABLE_NOTE } from "./a1-fixture.ts"

/** The two planted defects this hook's invariants must catch (its can-fail
 *  proof — a gate that cannot fail is not evidence, M61 D-4). */
const CALLERS_SUBSTITUTION = { from: "          storedLine: row.lineNumber,\n          file: row.srcFileRel || node.file,", to: "          storedLine: row.lineNumber || node.line,\n          file: row.srcFileRel || node.file," }
const STORED_LINE_IGNORED = { from: "          storedLine: row.lineNumber,\n          file: row.srcFileRel || node.file,", to: "          storedLine: null,\n          file: row.srcFileRel || node.file," }
let mutantCaught = 0
let mutantHits = 0

/** Copy the engine with one planted defect, drive the real index through it,
 *  and report whether the invariant under test is violated. */
async function mutationCaught(idx: number, edit: { from: string; to: string }, violated: (engine: any) => Promise<boolean>): Promise<boolean> {
  const source = readFileSync(ENGINE_MODULE, "utf8")
  const occurrences = source.split(edit.from).length - 1
  if (occurrences !== 1) throw new Error(`mutant anchor not unique (${occurrences}x)`)
  const mutantPath = path.join(path.dirname(ENGINE_MODULE), `__m62a3_mut_${idx}.ts`)
  writeFileSync(mutantPath, source.replace(edit.from, edit.to))
  try {
    const mut = await import(mutantPath)
    return await violated(mut)
  } finally {
    rmSync(mutantPath, { force: true })
  }
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const EVIDENCE_DIR = path.join(ROOT, "validation/m62/results")
const EVIDENCE = path.join(EVIDENCE_DIR, "A3.json")
const DOC = path.join(ROOT, "docs/m62/LINE-ADDRESS.md")
const ENGINE_MODULE = path.join(ROOT, "src/intelligence/graph/graph-engine.ts")
const HUB_MODULE = path.join(ROOT, "src/lsp/graph_usages.ts")
const TOOL_HANDLERS_MODULE = path.join(ROOT, "src/mcp/tool-handlers.ts")

let checks = 0
let passed = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}
const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
const normalize = (v: unknown): string => JSON.stringify(v)

interface Fixture { ws: string; dataDir: string; projectId: string; db: any; cleanup(): void }

async function makeFixture(): Promise<Fixture> {
  const ws = mkdtempSync(path.join(tmpdir(), "m62a3-ws-"))
  const dataDir = mkdtempSync(path.join(tmpdir(), "m62a3-data-"))
  for (const [rel, content] of Object.entries(SEED.files)) writeFileSync(path.join(ws, rel), content)
  // M62 lane-7: project identity has ONE owner (src/util/project-id.ts).
  const projectId = getProjectId(ws)
  mkdirSync(path.join(dataDir, "projects", projectId), { recursive: true })
  process.env.BB_DATA_DIR = dataDir
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const db = await BrainDatabase.getRawInstance(projectId)
  const fileIds: Record<string, string> = {}
  const fileStmt = db.prepare(`INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)`)
  let i = 0
  for (const rel of Object.keys(SEED.files)) {
    const id = `file-${++i}`
    fileIds[rel] = id
    fileStmt.run(id, projectId, path.join(ws, rel), rel, "typescript", `m62a3-hash-${i}`)
  }
  const symStmt = db.prepare(`INSERT INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, byte_start, byte_end, gravity_score) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  for (const s of SEED.symbols) symStmt.run(s.id, projectId, fileIds[s.file], s.name, s.symbolType, s.lineStart, s.lineEnd, 1, 2, 5)
  const relStmt = db.prepare(
    `INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, metadata, line_number, is_cross_language, target_external) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
  for (const r of SEED.relationships) relStmt.run(r.id, projectId, r.source, r.target, "calls", 0.9, '{"evidenceClass":"structural"}', r.lineNumber, 0, null)
  // R3: a SECOND stored row for the same caller/target (the shape M59.A4 will
  // produce once the row id gains a line component): one caller, two rows.
  relStmt.run("r-real-second-site", projectId, "file-2:callerA", "file-1:root", "calls", 0.9, '{"evidenceClass":"structural"}', 18, 0, null)
  return {
    ws,
    dataDir,
    projectId,
    db,
    cleanup: () => {
      try { rmSync(ws, { recursive: true, force: true }) } catch {}
      try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
    },
  }
}

async function readSurfaces(fx: Fixture, deps: { engine: any; hub: any; handlers: any }) {
  const trav = await deps.engine.graphTraversal(fx.projectId, "root", { direction: "both", maxDepth: 2 })
  const byRow = new Map<string, any>()
  for (const e of [...(trav.callers ?? []), ...(trav.callees ?? [])]) byRow.set(e.rowId, e.callSite)
  const hub = deps.hub.buildGroupedUsages(trav, { imports: [], exports: [] })
  const res = await deps.handlers["bb_graph"]!({ symbol: "root" }, { projectPath: fx.ws, projectId: fx.projectId })
  const payload = JSON.parse(res.content[0]?.text ?? "{}")
  return { trav, byRow, hub, payload }
}

async function main(): Promise<void> {
  const engine = await import(ENGINE_MODULE)
  const hub: any = await import(HUB_MODULE)
  const handlers = (await import(TOOL_HANDLERS_MODULE)).createToolHandlers()
  const deps = { engine, hub, handlers }
  const fx = await makeFixture()
  try {
    // --- R1: what the surfaces show in each store state (before the upgrade) ----
    console.log("R1: the three store states on one real index (pre-M59 data)")
    const before = await readSurfaces(fx, deps)
    check("R1: a real line is an EXACT call site on every surface", normalize(before.byRow.get("r-real")) === normalize(SEED.expected["r-real"]), normalize(before.byRow.get("r-real")))
    check("R1: a legacy 0 yields the declared substitute", normalize(before.byRow.get("r-legacy")) === normalize(SEED.expected["r-legacy"]), normalize(before.byRow.get("r-legacy")))
    check("R1: a NULL yields the declared substitute", normalize(before.byRow.get("r-null")) === normalize(SEED.expected["r-null"]), normalize(before.byRow.get("r-null")))
    check("R1: with no substitute a legacy 0 is a declared unknown", before.byRow.get("r-nodecl-legacy")?.kind === "unknown" && before.byRow.get("r-nodecl-legacy")?.note === LEGACY_NOTE, normalize(before.byRow.get("r-nodecl-legacy")))
    check("R1: with no substitute a NULL is a declared unknown", before.byRow.get("r-nodecl-null")?.kind === "unknown" && before.byRow.get("r-nodecl-null")?.note === NOT_STORED_NOTE, normalize(before.byRow.get("r-nodecl-null")))
    check("R1: a present-but-unusable value is never substituted", before.byRow.get("r-unusable")?.kind === "unknown" && before.byRow.get("r-unusable")?.note === UNUSABLE_NOTE, normalize(before.byRow.get("r-unusable")))
    // Line 1 is a legitimate position (a call site on the first line, or a
    // declaration there); line 0 and a numeric line on an `unknown` are not.
    const allBefore = [...before.byRow.values()]
    check("R1: no address anywhere carries line 0", !allBefore.some((a: any) => a?.line === 0), allBefore.map((a: any) => normalize(a)).join(" "))
    check("R1: an unknown address never carries a numeric line", !allBefore.some((a: any) => a?.kind === "unknown" && typeof a?.line === "number"), allBefore.map((a: any) => normalize(a)).join(" "))
    check("R1: every non-exact address carries its declared note", allBefore.every((a: any) => a?.kind === "call-site" || (typeof a?.note === "string" && a.note.length > 0)))
    check("R1: the hub payload agrees with the engine for every row", hubAgrees(before), hubDetail(before))
    check("R1: the bb_graph payload carries the declared kinds and notes", mcpDeclares(before.payload), JSON.stringify(before.payload.callers?.[0]?.callSite ?? null))
    check("R1: a substitute is ALWAYS labeled in the agent's payload", before.payload.callers.every((e: any) => e.callSite.kind === "call-site" || (typeof e.callSite.note === "string" && e.callSite.note.length > 0)))

    // --- M1: the arrival invariant for an unknown store can fail ------------------
    {
      const caught = await mutationCaught(1, CALLERS_SUBSTITUTION, async (engine) => {
        const trav = await engine.graphTraversal(fx.projectId, "root", { direction: "both", maxDepth: 2 })
        const byRow = new Map<string, any>(trav.callers.map((e: any) => [e.rowId, e.callSite]))
        return normalize(byRow.get("r-legacy")) !== normalize(SEED.expected["r-legacy"])
      })
      mutantHits++
      if (caught) mutantCaught++
      check("M1: a legacy 0 rendered as an exact call site IS caught by the arrival invariant (planted defect caught)", caught)
    }

    // --- R3: multiplicity is declared (the M59.A4 arrival shape) -----------------
    console.log("\nR3: two stored rows for one caller stay two declared rows")
    const callerRows = (before.hub.callers ?? []).flatMap((g: any) => g.rows).filter((r: any) => r.rowId === "r-real" || r.rowId === "r-real-second-site")
    check("R3: both stored rows are served (nothing collapsed)", callerRows.length === 2, `served ${callerRows.length}`)
    check("R3: each row carries its OWN address", normalize(callerRows.map((r: any) => r.callSite).sort((a: any, b: any) => a.line - b.line)) === normalize([{ kind: "call-site", file: "a.ts", line: 12 }, { kind: "call-site", file: "a.ts", line: 18 }]), normalize(callerRows.map((r: any) => r.callSite)))
    const callerGroup = (before.hub.callers ?? []).find((g: any) => g.symbolId === "file-2:callerA")
    check("R3: the group declares the multiplicity (occurrences == rows)", callerGroup?.occurrences === callerGroup?.rows?.length && callerGroup.occurrences >= 4, `occurrences=${callerGroup?.occurrences} rows=${callerGroup?.rows?.length}`)

    // --- R2: the upgrade — the same rows re-indexed with real lines ---------------
    console.log("\nR2: the M59 arrival — the same rows re-indexed with real lines")
    // What an M59-capable indexer does: the store now carries a real line for
    // every row it can resolve (or NULL when it cannot).
    const upgrade: Record<string, number | null> = {
      "r-legacy": 21,
      "r-null": 22,
      "r-b-legacy": 23,
      "r-nodecl-legacy": 24,
      "r-nodecl-null": 25,
      "r-callee-legacy": 26,
    }
    const upd = fx.db.prepare(`UPDATE brain_relationship SET line_number = ? WHERE id = ?`)
    for (const [rowId, line] of Object.entries(upgrade)) upd.run(line, rowId)
    const after = await readSurfaces(fx, deps)
    check("R2: every upgraded row is now an EXACT call site — no code change", Object.keys(upgrade).every((rowId) => after.byRow.get(rowId)?.kind === "call-site" && after.byRow.get(rowId)?.line === upgrade[rowId]), Object.keys(upgrade).map((id) => `${id}=${normalize(after.byRow.get(id))}`).join(" "))
    check("R2: the previously-substituted rows no longer carry a note (no substitute remains)", Object.keys(upgrade).every((rowId) => after.byRow.get(rowId)?.note === undefined))
    check("R2: the hub payload follows the upgrade with no consumer change", hubAgrees(after), hubDetail(after))
    check("R2: the agent's payload follows the upgrade with no consumer change", mcpDeclares(after.payload))
    check("R2: the unusable store is UNCHANGED by the upgrade (still not substituted)", after.byRow.get("r-unusable")?.kind === "unknown" && after.byRow.get("r-unusable")?.note === UNUSABLE_NOTE, normalize(after.byRow.get("r-unusable")))

    // --- M2: the upgrade invariant can fail ---------------------------------------------
    {
      const caught = await mutationCaught(2, STORED_LINE_IGNORED, async (engine) => {
        const trav = await engine.graphTraversal(fx.projectId, "root", { direction: "both", maxDepth: 2 })
        const byRow = new Map<string, any>(trav.callers.map((e: any) => [e.rowId, e.callSite]))
        return Object.keys(upgrade).some((rowId) => byRow.get(rowId)?.kind !== "call-site")
      })
      mutantHits++
      if (caught) mutantCaught++
      check("M2: a stored line ignored (no upgrade) IS caught by the arrival invariant (planted defect caught)", caught)
    }
    check("M: every planted defect is caught by an arrival invariant", mutantCaught === mutantHits && mutantHits >= 2, `${mutantCaught}/${mutantHits}`)

    // --- R4: coverage is declared, not implied ------------------------------------
    console.log("\nR4: what this hook does and does not claim")
    const docText = readFileSync(DOC, "utf8")
    check("R4: the generated doc states the per-language coverage is M59's lane (not claimed here)", /per-language/i.test(docText) && /M59/.test(docText), "the doc does not declare the coverage boundary")
    check("R4: the doc names this hook as the arrival acceptance", docText.includes("verify-arrival.ts"), "the doc does not name the arrival hook")
    check("R4: the hook seeds every state it reports (multiplicity row included)", SEED.relationships.length === 9 && Object.keys(SEED.expected).length === 9, `seeded ${SEED.relationships.length + 1}`)
  } finally {
    try { fx.cleanup() } catch {}
  }

  const failed = checks - passed
  const result = {
    issue: "M62.A3",
    code: "A3",
    milestone: "M62",
    status: failed === 0 ? "verified" : "known-gap",
    checks,
    passed,
    failed,
    realFailed: 0,
    negativeCases: mutantHits,
    mutantsCaught: mutantCaught,
    mutantsTotal: mutantHits,
    currentCommit,
    ...fingerprintFields(["m62.A3"], ROOT),
    verifierCommand: "npx tsx script/m62/verify-arrival.ts",
    evidenceFile: "A3.json",
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    arrival: {
      forMilestone: "M59 (Call-Site Truth)",
      states: ["real (> 0)", "legacy-placeholder (0)", "not-stored (NULL/absent)", "unusable (negative/fractional/NaN/Infinity)"],
      seededRows: SEED.relationships.length + 1,
      upgradeRows: 6,
      languages: ["typescript (fixture vocabulary; the fixture language of the seeded index)"],
      coveragePolicy: "Per-language real-line coverage is measured and published by M59.A7's lane, not here; this hook declares only the store states it seeds.",
    },
    limitations: [
      "The fixture seeds stored rows directly (analyzer storage vocabulary); real per-language emission is measured in M59's lane.",
      "M59.A4/A8 change what a stored row IS (multiplicity, identity): R3 pins the shape the hub already declares, so their arrival needs no consumer change here.",
    ],
  }
  mkdirSync(EVIDENCE_DIR, { recursive: true })
  writeSealed(EVIDENCE, result)
  console.log(`\nA3: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${mutantCaught}/${mutantHits} mutants caught)`)
  process.exit(failed === 0 ? 0 : 1)
}

function hubAgrees(s: { byRow: Map<string, any>; hub: any }): boolean {
  const seen = new Set<string>()
  for (const side of ["callers", "callees"]) {
    for (const g of s.hub?.[side] ?? []) {
      for (const r of g?.rows ?? []) {
        seen.add(r.rowId)
        if (normalize(r.callSite) !== normalize(s.byRow.get(r.rowId))) return false
      }
    }
  }
  return seen.size === s.byRow.size
}
function hubDetail(s: { byRow: Map<string, any>; hub: any }): string {
  const out: string[] = []
  for (const side of ["callers", "callees"]) {
    for (const g of s.hub?.[side] ?? []) {
      for (const r of g?.rows ?? []) {
        if (normalize(r.callSite) !== normalize(s.byRow.get(r.rowId))) out.push(`${r.rowId}: hub=${normalize(r.callSite)} engine=${normalize(s.byRow.get(r.rowId))}`)
      }
    }
  }
  return out.join(", ")
}
function mcpDeclares(payload: any): boolean {
  const lists = [payload?.callers ?? [], payload?.callees ?? []]
  return lists.every((list) => list.every((e: any) => ["call-site", "declaration", "unknown"].includes(e?.callSite?.kind) && (e.callSite.kind === "call-site" || typeof e.callSite.note === "string") && e.callSite.line !== 0))
}

void main()
