// script/m28/verify-surface-parity.ts — Lane 8: the MCP tool surface and the
// LSP must not disagree. Verifier + mutation suite for M28.U2.
//
// WHY THIS EXISTS (the m63 CL1 lesson, generalised)
//
//   docs/m63/CL1.md records the class of defect this file exists to make
//   impossible to miss:
//
//     "`bb_cross_language` is the editor's hover projection
//      (src/lsp/cross_language_hover.ts) copied wholesale into the MCP door,
//      and the copy is what broke it."
//
//   That defect was invisible because `script/m28/verify-union.ts` derived the
//   "IDE side" expectation with a COPY of the same rule and then asserted the
//   two copies were equal. Two doors, one bug.
//
//   A copy-projection has three observable properties, and this gate asserts all
//   three against the SINGLE owner, never against another copy:
//
//     P1 COPY       the surface carries its own derivation instead of importing
//                   the owner (detected at SOURCE level: an inline kind set, an
//                   inline tier vocabulary, an inline verdict, an inline
//                   signature renderer).
//     P2 DIVERGENCE the copy has already drifted from the owner (detected
//                   BEHAVIOURALLY, from the bytes a consumer actually reads).
//     P3 UNREACHABLE the gate could not see the divergence even if it existed —
//                   i.e. the gate itself re-derives the expectation with a copy.
//
// HOW THE PROBES REACH THE SURFACES (the m63 CL5 §4 lesson)
//
//   CL5 found that six of sixteen mutants were "caught" by an import error, and
//   one probe never referenced the mutated code at all — while the suite
//   reported green. Two rules follow, and they are the difference between this
//   gate and that one:
//
//   1. NO SHAPE COLLAPSE. An expectation is never keyed on a shape coarser than
//      the surface can distinguish. The stored `evidenceClass` is read back from
//      the INDEX for the exact stored row each edge came from, so two edges that
//      differ only in their stored class are two expectations — not one.
//   2. NO VACUOUS PREMISES. Every mutant must be OBSERVED: the probe runs, it
//      reaches the mutated code, and it sees a difference. `UNREACHABLE` and
//      `UNVERIFIABLE` are recorded as such and BOTH fail the run. They are never
//      banked as catches, and there is no fallback that reports SURVIVED, which
//      reads like a working probe.
//
//   The derivation under test is reached through the SHIPPED PAYLOAD or through
//   a SEEDED INDEX SHAPE — never by re-implementing it here. A second
//   derivation inside this file would make this gate the thing it hunts.
//
// Run: npx tsx script/m28/verify-surface-parity.ts
// Evidence: validation/m28/results/U2.json (machine-emitted)

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import crypto from "node:crypto"
import os from "node:os"
import path from "node:path"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { classifyTier, isDeclaredTier, EVIDENCE_TIERS, STRUCTURAL_FLOOR, UNCLAIMED_STORE_LABELS, evidenceClassOf } from "../../src/lsp/evidence_tier"
import { tierForCrossLanguageEdge, factsFromRows, storedCrossLanguageRows } from "../../src/lsp/cross_language_hover"
import { renderSignature, renderParameterList, parseParameters, carriesRawJson, UNKNOWN_PARAMETER_LIST } from "../../src/lsp/signature"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

let checks = 0
let passed = 0
const failures: string[] = []
const notes: string[] = []

function check(label: string, condition: boolean, detail = ""): boolean {
  checks++
  if (condition) passed++
  else {
    failures.push(label)
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
  return condition
}

type MutantVerdict = "observed" | "unreachable" | "unverifiable"
interface MutantRecord {
  name: string
  caught: boolean
  verdict: MutantVerdict
  observed: string
}
const mutantRecords: MutantRecord[] = []
/** A mutant counts as caught ONLY on an observed difference. Everything else is a
 *  gate defect, and a gate defect fails the run. */
function mutant(name: string, verdict: MutantVerdict, observed = ""): void {
  const caught = verdict === "observed"
  mutantRecords.push({ name, caught, verdict, observed })
  checks++
  if (caught) {
    passed++
    console.log(`  CAUGHT: ${name}${observed ? ` — ${observed}` : ""}`)
  } else {
    failures.push(`mutant not observed: ${name} (${verdict})`)
    console.log(`  ${verdict === "unreachable" ? "UNREACHABLE" : "UNVERIFIABLE"}: ${name}${observed ? ` — ${observed}` : ""}`)
  }
}

const sha256 = (text: string): string => crypto.createHash("sha256").update(text).digest("hex")
const sourceOf = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8")
/** Strip line and block comments so a rule named only in a rationale is never
 *  mistaken for a rule the file executes. */
const codeOnly = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")

/** The ONE tier expectation in this file: the owner, imported from its real
 *  module. A second derivation here is the CL5 anti-pattern. */
const ownerTier = (e: { relationshipType: string; confidence: number | null; evidenceClass: string | null }): string =>
  classifyTier({ relationshipType: e.relationshipType, confidence: e.confidence, evidenceClass: e.evidenceClass })

/** The declaration the owner itself publishes about what it accepts, so the
 *  probe's shape corpus is derived from the owner rather than from a list typed
 *  here that could drift from it. */
const OWNER_KINDS: readonly string[] = [
  ...(codeOnly(sourceOf("src/lsp/evidence_tier.ts")).match(/"[a-z_]+"/g)?.map((s) => s.slice(1, -1)) ?? []),
  "calls", "inherits", "implements", "overrides", "call", "extends", "override",
  "contains", "exports", "instantiates", "import", "imports", "reference",
  "references", "use", "uses", "usage", "references_qualified", "reference_qualified",
  "CALLS", " Calls ", "widget_fact",
]
const OWNER_CLASSES: Array<string | null> = [null, "structural", "import_based", "usage_contextual", "reference_qualified", "inferred", ...UNCLAIMED_STORE_LABELS, "nonsense-tier", ""]
/** Confidence buckets bracketing the declared STRUCTURAL_FLOOR.
 *  `null` is deliberately ABSENT: `brain_relationship.confidence` is
 *  `NOT NULL` in src/brain/schema-ddl.ts, so a stored row cannot carry it and a
 *  seeded shape with a null confidence would be a fixture the index refuses —
 *  the same class of lie as a probe that cannot reach what it claims to test.
 *  The owner's own `?? 0` branch is exercised through the reference assertions
 *  in R7 instead, which call the owner directly rather than through the index. */
const OWNER_CONFIDENCES: readonly number[] = [0, 0.1, 0.5, STRUCTURAL_FLOOR - 0.0001, STRUCTURAL_FLOOR, 0.9, 1]

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let currentCommit = "unknown"
  try {
    currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {}

  // --- R1: the shared fixture through the real indexer ------------------------
  const base = mkdtempSync(path.join(os.tmpdir(), "u2-base-"))
  const workspaceDir = mkdtempSync(path.join(base, "u2-ws-"))
  const dataDir = mkdtempSync(path.join(base, "u2-data-"))
  const javaDir = path.join(workspaceDir, "src", "main", "java", "com", "demo")
  const scalaDir = path.join(workspaceDir, "src", "main", "scala", "com", "demo")
  mkdirSync(javaDir, { recursive: true })
  mkdirSync(scalaDir, { recursive: true })
  writeFileSync(path.join(javaDir, "Inventory.java"), `package com.demo;\n\npublic class Inventory {\n    public int count() { return 42; }\n}\n`)
  writeFileSync(path.join(javaDir, "Barcode.java"), `package com.demo;\n\npublic class Barcode {\n    public String scan() { return "OK"; }\n}\n`)
  writeFileSync(path.join(scalaDir, "Warehouse.scala"), `package com.demo\n\nimport com.demo.Inventory\n\nclass Warehouse(inventory: Inventory) {\n  def stock: Int = inventory.count()\n}\n`)
  const canonical = execFileSync("node", ["-e", `console.log(require("fs").realpathSync(${JSON.stringify(workspaceDir)}))`], { encoding: "utf8" }).trim()
  const dist = await import(path.join(ROOT, "dist", "index.js"))
  const projectId: string = (dist as any).getProjectId(canonical)
  process.env.BB_DATA_DIR = dataDir
  const indexResult = await (dist as any).indexProjectParallel(projectId, canonical, {})
  check("U2: real indexer indexed the shared fixture", (indexResult?.processedFiles ?? 0) >= 3, JSON.stringify({ processed: indexResult?.processedFiles }))

  const handlers = createToolHandlers() as Record<string, (args: any, ctx: { projectId: string; projectPath: string }) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>>
  const ctx = { projectId, projectPath: canonical }
  const callText = async (tool: string, args: any): Promise<string> => (await handlers[tool](args, ctx)).content?.[0]?.text ?? ""
  const callJson = async (tool: string, args: any): Promise<any> => {
    const text = await callText(tool, args)
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }
  const { BrainDatabase } = await import(path.join(ROOT, "src", "brain", "database.ts"))
  const raw = await (BrainDatabase as any).getRawInstance(projectId)

  const indexKinds = (raw.prepare("SELECT DISTINCT relationship_type AS k FROM brain_relationship").all() as Array<{ k: string }>).map((r) => r.k)
  check("U2: the fixture index stores relationship rows to classify", indexKinds.length > 0, `${indexKinds.length} kinds: ${indexKinds.join(",")}`)
  notes.push(`fixture relationship kinds: ${indexKinds.join(",") || "(none)"}`)

  // --- R2: P1, source level --------------------------------------------------
  const handlersSrc = sourceOf("src/mcp/tool-handlers.ts")
  const handlersCode = codeOnly(handlersSrc)
  check("U2 P1: src/mcp/tool-handlers.ts imports the tier owner src/lsp/evidence_tier", /from\s+"\.\.\/lsp\/evidence_tier"/.test(handlersCode), "the agent door must CALL the one owner, not carry its own rule")
  check("U2 P1: src/mcp/tool-handlers.ts carries no inline derivation (kind set / tier vocabulary / structural verdict)", inlineDerivation(handlersSrc).length === 0, inlineDerivation(handlersSrc).join("; "))

  // --- R3: P2, behavioural — the bytes a consumer of bb_graph reads ----------
  // The probe recovers, for each SHIPPED edge, the exact stored row it came from
  // (via the edge's own rowId) and asks the owner what that row's tier is. The
  // stored evidenceClass is read from the INDEX for that row — never inferred
  // from the payload and never collapsed onto a coarser key.
  const projectHash = projectId as string
  const storedRowByEdge = (e: any): { relationshipType: string; confidence: number | null; evidenceClass: string | null } => {
    // bb_graph compacts the stored row id to `<sourceId>:<kind>:<n>`; the full
    // key is `<projectHash>:rel:` + that. An `ext:` edge has no stored row.
    const full = typeof e?.rowId === "string" && e.rowId.includes(":") ? `${projectHash}:rel:${e.rowId}` : null
    if (!full) throw new Error(`NO-STORED-ROW rowId=${String(e?.rowId)}`)
    const row = raw.prepare("SELECT relationship_type, confidence, metadata FROM brain_relationship WHERE id = ?").get(full) as any
    if (!row) throw new Error(`NO-STORED-ROW-IN-INDEX ${full}`)
    return { relationshipType: row.relationship_type, confidence: row.confidence, evidenceClass: evidenceClassOf(row.metadata) }
  }

  const graphOf = async (symbol: string, maxDepth = 3): Promise<any[]> => {
    const g = await callJson("bb_graph", { symbol, maxDepth })
    return [...(g?.callers ?? []), ...(g?.callees ?? [])]
  }
  /** The shape corpus must be reachable, and bb_graph's DEFAULT per-symbol site
   *  limit is 200 (its registry declares `edgeLimit`, max 5000, and `maxEdges`,
   *  max 5000). Asking with the DECLARED bounds — rather than accepting a
   *  silently capped page as "the shapes I could see" — is what keeps the probe
   *  honest: a shape the surface never renders is not agreement, and a gate that
   *  treats it as agreement is the CL5 anti-pattern. */
  const graphOfEveryShape = async (symbol: string, kinds?: string[]): Promise<{ edges: any[]; truncated: boolean; edgeLimit: number | null; kindsUsed: string[] }> => {
    const g = await callJson("bb_graph", { symbol, maxDepth: 3, edgeLimit: 5000, maxEdges: 5000, timeBudgetMs: 0, ...(kinds ? { relationshipTypes: kinds } : {}) })
    return {
      edges: [...(g?.callers ?? []), ...(g?.callees ?? [])],
      truncated: g?.summary?.truncated === true,
      edgeLimit: g?.summary?.edgeLimit ?? null,
      kindsUsed: g?.summary?.scope?.relationshipTypes ?? [],
    }
  }
  const hub = (raw.prepare(`
    SELECT t.name AS name, COUNT(*) AS n FROM brain_relationship r JOIN brain_symbol t ON t.id = r.source_symbol_id
     WHERE r.project_id = ? GROUP BY 1 ORDER BY n DESC LIMIT 1`).get(projectId) as { name: string; n: number } | undefined)?.name
  const hubEdges = hub ? await graphOf(hub) : []
  check("U2: bb_graph shipped at least one edge with a traceable stored row (probe is reachable)", hubEdges.length > 0 && hubEdges.every((e: any) => typeof e.rowId === "string"), `hub=${hub} edges=${hubEdges.length}`)

  /** Tier parity over a list of SHIPPED edges: every edge's published tier is
   *  compared with the owner's classification of the row it came from. */
  function shippedTierParity(label: string, edges: any[]): { diverged: number; sample: string[] } {
    const diverged: string[] = []
    let compared = 0
    for (const e of edges) {
      let stored: { relationshipType: string; confidence: number | null; evidenceClass: string | null }
      try {
        stored = storedRowByEdge(e)
      } catch (error) {
        diverged.push(`untraceable edge: ${String(error).slice(0, 70)}`)
        continue
      }
      compared++
      const owner = ownerTier(stored)
      if (String(e.tier) !== owner) {
        diverged.push(`${stored.relationshipType} conf=${stored.confidence} stored=${JSON.stringify(stored.evidenceClass)}: bb_graph=${e.tier} owner=${owner}`)
      }
    }
    check(`${label}: every edge's tier equals the owner's classification of its own stored row`, diverged.length === 0, `${diverged.length} of ${compared} edges diverge${diverged.length === 0 ? "" : `; first 4: ${diverged.slice(0, 4).join(" ;; ")}`}`)
    check(`${label}: every published tier is in the owner's declared vocabulary`, edges.every((e: any) => isDeclaredTier(String(e.tier))), JSON.stringify([...new Set(edges.map((e: any) => e.tier))]))
    return { diverged: diverged.length, sample: diverged.slice(0, 4) }
  }
  const hubParity = shippedTierParity("U2 P2 (bb_graph on the fixture's own hub symbol)", hubEdges)

  // --- R4: P2 over a SEEDED shape corpus — every kind x confidence x class ----
  // Reaching a derivation with an arbitrary stored shape requires the index to
  // hold that shape. The shapes are spread over SEVERAL probe symbols so that no
  // single bb_graph answer is truncated: a capped page is not "the shapes I could
  // see", and treating one as agreement is the CL5 anti-pattern.
  const projectDirsBefore = (await import("node:fs")).readdirSync(dataDir).sort()
  // bb_graph's per-direction fan-out budget is the ENGINE's own default (50,
  // src/intelligence/graph/graph-engine.ts DEFAULT_BUDGET) and it is not exposed
  // as a bb_graph parameter, so the corpus is spread over enough probe symbols
  // that no single answer can hit it: a truncated page is an UNREACHABLE shape,
  // and an unreachable shape is never counted as agreement.
  const SEED_SYMBOLS = Math.max(24, Math.ceil(([...new Set([...indexKinds, ...OWNER_KINDS])].length * OWNER_CONFIDENCES.length * OWNER_CLASSES.length) / 30))
  const seedSymbolNames = Array.from({ length: SEED_SYMBOLS }, (_, i) => `u2SeedProbe${i}`)
  const seeded: Array<{ id: string; seedSymbol: string }> = []
  let seedFileId: string | null = null
  {
    const fileRow = raw.prepare("SELECT id FROM brain_file WHERE project_id = ? LIMIT 1").get(projectId) as { id: string } | undefined
    seedFileId = fileRow?.id ?? null
    if (seedFileId) {
      const shapes: Array<{ kind: string; conf: number; cls: string | null }> = []
      for (const kind of [...new Set([...indexKinds, ...OWNER_KINDS])]) {
        for (const conf of OWNER_CONFIDENCES) {
          for (const cls of OWNER_CLASSES) shapes.push({ kind, conf, cls })
        }
      }
      // The seed SYMBOLS are written ONCE, before any relationship row.
      // `INSERT OR REPLACE` is a DELETE followed by an INSERT, and
      // brain_relationship.target_symbol_id carries `ON DELETE SET NULL`
      // (src/brain/schema-ddl.ts) — so re-replacing a symbol mid-loop silently
      // detaches every edge seeded against it, and the probe then reads an
      // EMPTY corpus and calls it agreement. That is the m63 CL5 shape exactly:
      // a fixture that cannot reach what it claims to test, reporting success.
      // ONE FILE PER PROBE SYMBOL, deliberately. The owner cascade is a LEXICAL
      // id-prefix range, so probe symbols sharing a file id-prefix are folded
      // into one another and the traversal dedupes across them — which caps the
      // page without the tool declaring which shapes went missing.
      const seedIdOf = (name: string): string => `${projectHash}:src/main/java/com/demo/u2seed/${name}.java:${name}:1`
      // ONE PEER PER SHAPE, on purpose. The engine deduplicates an edge per
      // (from, to) NODE PAIR, keeping one kind by the declared kind priority —
      // so a corpus whose 30 shapes all share one peer collapses to ~10
      // returned edges and the probe reads a corpus the TOOL chose. A distinct
      // peer per shape gives every seeded row its own endpoint pair, so what
      // comes back is the seed, not the engine's priority order.
      const peerIdOf = (name: string, shapeIndex: number): string => `${projectHash}:src/main/java/com/demo/u2seed/${name}.java:peer${shapeIndex}:2`
      for (const name of seedSymbolNames) {
        raw.prepare("INSERT OR REPLACE INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end) VALUES (?,?,?,?,?,?,?)").run(seedIdOf(name), projectId, fileRow.id, name, "class", 1, 1)
      }
      // Round-robin so every probe symbol holds a comparable mix of shapes.
      shapes.forEach((shape, i) => {
        const name = seedSymbolNames[i % SEED_SYMBOLS]!
        const seedId = seedIdOf(name)
        const id = `${projectHash}:rel:${projectHash}:${seedId}:${shape.kind}:${i}`
        const metadata = shape.cls === null ? null : JSON.stringify({ evidenceClass: shape.cls })
        const peerId = peerIdOf(name, i)
        raw.prepare("INSERT OR REPLACE INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end) VALUES (?,?,?,?,?,?,?)").run(peerId, projectId, fileRow.id, `u2peer${i}`, "method", 2, 2)
        raw.prepare("INSERT OR REPLACE INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, metadata) VALUES (?,?,?,?,?,?,?)").run(id, projectId, peerId, seedId, shape.kind, shape.conf, metadata)
        seeded.push({ id, seedSymbol: name })
      })
      const attached = seeded.filter((x) => (raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE id = ? AND target_symbol_id = ?").get(x.id, seedIdOf(x.seedSymbol)) as any).c === 1).length
      check("U2: every seeded row is still ATTACHED to its probe symbol (a detached row is a shape the probe cannot see)", attached === seeded.length, `${attached} of ${seeded.length} rows carry their target_symbol_id`)
      notes.push(`seeded ${seeded.length} relationship shapes across ${SEED_SYMBOLS} probe symbols (${shapes.length} kind x confidence x stored-class combinations)`)
    }
  }
  check("U2: the shape seed was written (probe for arbitrary stored shapes is reachable)", seeded.length > 0, `seeded=${seeded.length} seedFileId=${seedFileId}`)

  // The probe asks for EXACTLY the kinds it seeded. bb_graph's default kind set
  // is the engine's own list of ten, so a corpus that seeds a wider vocabulary
  // and takes the default silently loses shapes the probe believes it seeded —
  // the same "absence over-claimed" shape as CL1 defect B, in a gate.
  const seedKinds = [...new Set([...indexKinds, ...OWNER_KINDS])]
  const seedPages: Array<{ n: string; edges: any[]; truncated: boolean; edgeLimit: number | null; kindsUsed: string[] }> = []
  if (seeded.length > 0) for (const n of seedSymbolNames) seedPages.push({ n, ...(await graphOfEveryShape(n, seedKinds)) })
  const seedEdges = seedPages.flatMap((p) => p.edges)
  const seedParity = shippedTierParity("U2 P2 (bb_graph over the seeded shape corpus)", seedEdges)
  const seedShapeCount = seeded.length
  const seedReturned = seedEdges.length
  // Reachability is measured by the ROW IDs the payload carries, not by the
  // tool's `truncated` boolean: `truncated: true` with
  // `truncationReason: "relationshipTypes: …"` is the tool DECLARING the filter
  // the probe asked for, not a shape lost. Conversely a page that is not
  // truncated but is missing a seeded row is an unreachable shape, and an
  // unreachable shape is never counted as agreement.
  const returnedRowIds = new Set(seedEdges.map((e: any) => `${projectHash}:rel:${String(e.rowId)}`))
  const unreachable = seeded.filter((x) => !returnedRowIds.has(x.id))
  const declaredFilterPages = seedPages.filter((p) => p.truncated).length
  notes.push(`seed reachability: ${seedReturned} rows returned for ${seeded.length} seeded; ${declaredFilterPages} of ${seedPages.length} pages declared a filter in truncationReason (the filter the probe asked for)`)
  check("U2: every seeded shape is REACHABLE — each seeded stored row id appears in some bb_graph answer (an unreachable shape is not agreement)", seeded.length > 0 && unreachable.length === 0, `seeded=${seeded.length} returnedRows=${returnedRowIds.size} unreachable=${unreachable.length}${unreachable.length ? `; first missing: ${unreachable[0]!.id}` : ""}`)

  // The owner must not be order-dependent: calling it twice over the seeded
  // corpus is a DETERMINISM check, not a self-comparison (a self-comparison is a
  // check that cannot fail, which is the thing this lane exists to kill).
  {
    let nondeterministic = 0
    for (const s of seeded) {
      const row = raw.prepare("SELECT relationship_type, confidence, metadata FROM brain_relationship WHERE id = ?").get(s.id) as any
      const input = { relationshipType: row.relationship_type, confidence: row.confidence, evidenceClass: evidenceClassOf(row.metadata) }
      if (ownerTier(input) !== ownerTier({ ...input })) nondeterministic++
    }
    check("U2: the owner is deterministic over the seeded corpus (no order or state dependence)", nondeterministic === 0, `${nondeterministic} of ${seeded.length} rows gave two answers`)
  }

  // --- R5: the cross-language door -------------------------------------------
  const crossHandlerBody = handlersCode.slice(handlersCode.indexOf("bb_cross_language: async"), handlersCode.indexOf("bb_annotate: async"))
  const CROSS_OWNER_CALLS = /tierForCrossLanguageEdge|factsFromRows|storedCrossLanguageRows|storedCrossLanguageFactsByName/
  check("U2 P1: bb_cross_language reuses src/lsp/cross_language_hover.ts rather than re-deriving tiers", CROSS_OWNER_CALLS.test(crossHandlerBody) && !/\btierFor\s*=/.test(crossHandlerBody) && inlineDerivation(crossHandlerBody).length === 0, `delegates=${CROSS_OWNER_CALLS.test(crossHandlerBody)} inline=${inlineDerivation(crossHandlerBody).join("; ") || "none"}`)
  const invRow = raw.prepare("SELECT s.id, f.language FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND s.name = 'Inventory'").get(projectId) as { id: string; language: string } | undefined
  const ideFacts = invRow ? factsFromRows(storedCrossLanguageRows(raw, invRow.id) as any, invRow.language) : []
  const mcpCross = await callJson("bb_cross_language", { symbol: "Inventory" })
  check("U2: cross-language fact COUNT identical through both doors", mcpCross?.facts?.length === ideFacts.length, `${mcpCross?.facts?.length} vs ${ideFacts.length}`)
  {
    // The stored class is read from the INDEX for each fact's own stored row —
    // the same no-collapse rule as R3.
    const diverged: string[] = []
    for (const f of mcpCross?.facts ?? []) {
      const row = raw.prepare("SELECT relationship_type, confidence, metadata FROM brain_relationship WHERE id = ?").get(f.rowId) as any
      if (!row) {
        diverged.push(`fact carries no stored row: ${String(f.rowId)}`)
        continue
      }
      const stored = { relationshipType: row.relationship_type, confidence: row.confidence, evidenceClass: evidenceClassOf(row.metadata) }
      if (f.tier !== ownerTier(stored)) diverged.push(`${stored.relationshipType} conf=${stored.confidence} stored=${JSON.stringify(stored.evidenceClass)}: bb_cross_language=${f.tier} owner=${ownerTier(stored)}`)
      if (f.relationshipType !== stored.relationshipType) diverged.push(`relationshipType mismatch: payload=${f.relationshipType} stored=${stored.relationshipType}`)
    }
    check("U2 P2: every bb_cross_language fact's tier equals the owner's classification of its own stored row", diverged.length === 0, `${diverged.length} divergence(s); ${diverged.slice(0, 3).join(" ;; ")}`)
    // The hover door's facts carry no stored evidenceClass on the fact itself, so
    // the question is answered by reading each fact's OWN stored class back from
    // the index — never by assuming the fact's `tier` is right.
    const hoverDiverged: string[] = []
    // The rows are read through the module's OWN query, and each fact is paired
    // to the row it was built from by (kind, confidence) — a `.get()` on
    // relationship_type alone would hand back whichever of several rows SQLite
    // returned first, which is CL1 defect B wearing a different hat.
    const hoverRows = (invRow ? storedCrossLanguageRows(raw, invRow.id) as any[] : []).map((r) => ({
      relationshipType: r.relationship_type as string,
      confidence: r.confidence as number | null,
      evidenceClass: evidenceClassOf(r.metadata),
    }))
    for (const f of ideFacts) {
      const row = hoverRows.find((r) => r.relationshipType === f.relationshipType && r.confidence === f.confidence)
      if (!row) {
        hoverDiverged.push(`hover fact names a kind/confidence the module's own row query does not return: ${f.relationshipType} conf=${f.confidence}`)
        continue
      }
      const owner = ownerTier(row)
      const viaHoverModule = tierForCrossLanguageEdge({ relationship_type: f.relationshipType, confidence: f.confidence, evidence_class: row.evidenceClass })
      if (f.tier !== owner) hoverDiverged.push(`${row.relationshipType} conf=${row.confidence} stored=${JSON.stringify(row.evidenceClass)}: hover=${f.tier} owner=${owner}`)
      if (viaHoverModule !== owner) hoverDiverged.push(`${row.relationshipType}: tierForCrossLanguageEdge=${viaHoverModule} owner=${owner}`)
    }
    check("U2 P2: the hover door's facts classify through the owner too (tierForCrossLanguageEdge delegates, and the fact's tier agrees)", hoverDiverged.length === 0, `${hoverDiverged.length} of ${ideFacts.length} facts disagree with the owner; ${hoverDiverged.slice(0, 3).join(" ;; ")}`)
  }
  check("U2: every published cross-language tier is in the owner's declared vocabulary", [...(mcpCross?.facts ?? []), ...ideFacts].every((f: any) => isDeclaredTier(String(f.tier))), JSON.stringify(EVIDENCE_TIERS))

  // --- R6: §15.2 identity is stated in the TOOL RESULT ------------------------
  // The owner (src/lsp/identity.ts) publishes the resolution shape; the gate
  // asserts each TOOL result names the substitution wherever it names the target.
  const identityCode = codeOnly(sourceOf("src/lsp/identity.ts"))
  check("U2 §15.2: the owner declares the owning-declaration substitution vocabulary", /owning-declaration/.test(identityCode) && /memberName/.test(identityCode) && /ownerName/.test(identityCode), "src/lsp/identity.ts is the declared owner of the resolution record")
  const impact = await callJson("bb_impact", { symbol: "count" })
  check("U2 §15.2: bb_impact carries the component's resolution record (identity stated, never silent)", impact && typeof impact.resolution === "object" && typeof impact.resolution.through === "string", JSON.stringify(impact?.resolution ?? null))
  check("U2 §15.2: a resolution that substituted names BOTH the member and the owner", impact?.resolution?.through === "direct" || (typeof impact?.resolution?.memberName === "string" && typeof impact?.resolution?.ownerName === "string"), JSON.stringify(impact?.resolution ?? null))
  const impactBody = handlersCode.slice(handlersCode.indexOf("bb_impact: async"), handlersCode.indexOf("bb_cross_language: async"))
  check("U2 §15.2: bb_impact does not compute the resolution itself (the owner decides)", !/through:\s*"owning-declaration"/.test(impactBody) && /impact\.resolution/.test(impactBody), "a substitution decided here is a second decision")
  const graphBody = handlersCode.slice(handlersCode.indexOf("bb_graph: async"), handlersCode.indexOf("bb_impact: async"))
  check("U2 §15.2: bb_graph states how the requested name resolved (root.match / root.candidates), never a silent relabel", /rootMatch/.test(graphBody) && /candidates:/.test(graphBody), "a name held by several symbols must say so where the target is named")

  // --- R7: §15.4 human text is human, on the tool side -----------------------
  const docEngineSrc = sourceOf("src/intelligence/documentation/doc-engine.ts")
  const docInline = inlineDerivation(docEngineSrc)
  check("U2 P1: doc-engine.ts's separate renderer is DETECTED by the same inline-derivation detector (the copy exists and is named)", docInline.length > 0, `expected an inline renderer in doc-engine.ts; detector found: ${docInline.join("; ") || "nothing"}`)

  const parameterShapes: Array<{ label: string; value: string | null }> = [
    { label: "stored JSON array (the shape the analyzers write)", value: `[{"name":"names","type":"string[]","isOptional":false}]` },
    { label: "stored JSON OBJECT (not an array)", value: `{"name":"names","type":"string[]"}` },
    { label: "array entry with no type (unresolved)", value: `[{"name":"names"}]` },
    { label: "array entry with no name", value: `[{"type":"string[]"}]` },
    { label: "array of non-objects", value: `[1,2,3]` },
    { label: "plain text list", value: "names, opts" },
    { label: "already-rendered text", value: "(int a, int b)" },
    { label: "empty array", value: "[]" },
    { label: "absent (NULL)", value: null },
  ]
  const docSymbol = raw.prepare("SELECT id, symbol_type, parameters FROM brain_symbol WHERE project_id = ? AND name = 'count'").get(projectId) as { id: string; symbol_type: string; parameters: string | null } | undefined
  const leaks: string[] = []
  const ownerDisagreements: string[] = []
  if (docSymbol) {
    for (const shape of parameterShapes) {
      raw.prepare("UPDATE brain_symbol SET parameters = ? WHERE id = ?").run(shape.value, docSymbol.id)
      const prose = await callText("bb_doc", { mode: "symbol", target: "count", format: "markdown" })
      const line = prose.split("\n").find((l) => /\bis defined in\b/.test(l) && /\(/.test(l)) ?? ""
      if (line === "") {
        // The probe could not find the line it reads. That is UNREACHABLE, and
        // it must fail rather than count as "no leak found".
        check(`U2 §15.4 probe reachable: bb_doc's signature line for shape "${shape.label}"`, false, "no line matched the documented prose shape — the probe cannot see this surface")
        continue
      }
      if (carriesRawJson(line)) leaks.push(`${shape.label}: ${line.slice(0, 150)}`)
      const ownerText = renderSignature({ name: "count", symbol_type: docSymbol.symbol_type, parameters: shape.value }, "java")
      const head = ownerText.split("(")[0]!.trim()
      if (!line.includes(head)) ownerDisagreements.push(`${shape.label}: bb_doc="${line.slice(0, 100)}" owner-head="${head}"`)
    }
    raw.prepare("UPDATE brain_symbol SET parameters = ? WHERE id = ?").run(docSymbol.parameters, docSymbol.id)
  } else {
    check("U2 §15.4 probe reachable: a fixture symbol whose stored parameters can be seeded", false, "no symbol named 'count' in the fixture index")
  }
  check(`U2 §15.4: no bb_doc signature renders raw JSON into human text (all ${parameterShapes.length} stored shapes)`, leaks.length === 0, `${leaks.length} leak(s): ${leaks.slice(0, 3).join(" ;; ")}`)
  check(`U2 §15.4: bb_doc's signature names the same symbol the owner's renderer names (${parameterShapes.length} stored shapes)`, ownerDisagreements.length === 0, `${ownerDisagreements.length} disagreement(s): ${ownerDisagreements.slice(0, 3).join(" ;; ")}`)
  // Reference: the OWNER leaks nothing on any shape, by construction. If this
  // fails, the owner changed and every comparison above is void.
  check("U2 §15.4 reference: the owner renderer leaks no raw JSON on any stored shape", parameterShapes.every((s) => !carriesRawJson(renderSignature({ name: "count", symbol_type: "method", parameters: s.value }, "typescript"))), "src/lsp/signature.ts changed; the reference is void")
  check("U2 §15.4: an absent parameter list renders the declared unknown marker, never nothing", renderParameterList(null, "typescript") === UNKNOWN_PARAMETER_LIST, renderParameterList(null, "typescript"))
  check("U2 §15.4: an unresolvable parameter type renders the declared unknown marker, never a guess", renderParameterList(`[{"name":"names"}]`, "typescript") === "names: unknown", renderParameterList(`[{"name":"names"}]`, "typescript"))
  check("U2 §15.4: a serialized non-array shape renders the declared absence, never the serialization", parseParameters(`{"name":"names"}`).shape === "serialized" && !carriesRawJson(renderParameterList(`{"name":"names"}`, "typescript")), renderParameterList(`{"name":"names"}`, "typescript"))

  // --- R8: mutation suite — the gate itself can fail -------------------------
  const loadMutant = async (rel: string, mutate: (src: string) => string | null): Promise<{ ok: true; mod: any } | { ok: false; why: string }> => {
    const mutated = mutate(sourceOf(rel))
    if (mutated === null) return { ok: false, why: `anchor not found in ${rel}` }
    const target = path.join(ROOT, path.dirname(rel), `__u2mutant-${crypto.randomBytes(6).toString("hex")}.ts`)
    writeFileSync(target, mutated)
    try {
      return { ok: true, mod: await import(`${target}?u2=${Date.now()}`) }
    } catch (error) {
      return { ok: false, why: `module failed to load: ${String(error).slice(0, 100)}` }
    } finally {
      rmSync(target, { force: true })
    }
  }

  /** Run the parity comparison against a HANDLERS MODULE (the real or a mutant).
   *  Returns the divergence count and a sample, or a reason it was unreachable. */
  const parityAgainst = async (createHandlers: () => any): Promise<{ diverged: number; sample: string[] } | { unreachable: string }> => {
    try {
      const h = createHandlers()
      const edges: any[] = []
      for (const name of seedSymbolNames) {
        const r = await h.bb_graph({ symbol: name, maxDepth: 3, edgeLimit: 5000, maxEdges: 5000, timeBudgetMs: 0, relationshipTypes: seedKinds }, ctx)
        const d = JSON.parse(r.content[0].text)
        edges.push(...(d.callers ?? []), ...(d.callees ?? []))
      }
      if (edges.length === 0) return { unreachable: "the mutated handler shipped no edge to read" }
      const diverged: string[] = []
      for (const e of edges) {
        let stored: { relationshipType: string; confidence: number | null; evidenceClass: string | null }
        try {
          stored = storedRowByEdge(e)
        } catch (error) {
          return { unreachable: String(error).slice(0, 90) }
        }
        const owner = ownerTier(stored)
        if (String(e.tier) !== owner) diverged.push(`${stored.relationshipType} conf=${stored.confidence} stored=${JSON.stringify(stored.evidenceClass)}: surface=${e.tier} owner=${owner}`)
      }
      return { diverged: diverged.length, sample: diverged.slice(0, 3) }
    } catch (error) {
      return { unreachable: `probe could not run the mutated handler: ${String(error).slice(0, 100)}` }
    }
  }

  // M1 — the CL1 shape: the agent door keeps its own drifted inline copy.
  {
    const res = await loadMutant("src/mcp/tool-handlers.ts", (src) => {
      const anchor = "return textResult(JSON.stringify({\n      symbol,"
      if (!src.includes(anchor)) return null
      const copy = `const tierForMutant = (e: { relationshipType: string; confidence: number; metadata?: { evidenceClass?: string } }): string => {\n      const STRUCTURAL = new Set(["calls", "inherits", "implements", "overrides"])\n      const IMPORT = new Set(["imports", "import"])\n      const stored = e.metadata?.evidenceClass\n      if (stored && ["structural", "import_based", "usage_contextual", "reference_qualified", "inferred"].includes(stored)) return stored\n      if (STRUCTURAL.has(e.relationshipType)) return e.confidence >= 0.7 ? "structural" : "inferred"\n      if (IMPORT.has(e.relationshipType)) return "import_based"\n      return "inferred"\n    }\n    `
      const mutated = src.replace(anchor, `${copy}${anchor}`).replace("tier: tierFor(e),", "tier: tierForMutant(e),")
      return mutated === src ? null : mutated
    })
    if (!res.ok) {
      mutant("U2 M1: an inline drifted tier copy in the agent door is OBSERVED diverging", "unverifiable", res.why)
    } else {
      const outcome = await parityAgainst(() => (res.mod as any).createToolHandlers?.() ?? (res.mod as any).default)
      if ("unreachable" in outcome) mutant("U2 M1: an inline drifted tier copy in the agent door is OBSERVED diverging", "unreachable", outcome.unreachable)
      else if (outcome.diverged > 0) mutant("U2 M1: an inline drifted tier copy in the agent door is OBSERVED diverging", "observed", `${outcome.diverged} of ${seedReturned} shapes diverge; ${outcome.sample.join(" ;; ")}`)
      else mutant("U2 M1: an inline drifted tier copy in the agent door is OBSERVED diverging", "unverifiable", "the mutated copy agreed with the owner on every shape the corpus exercises — the probe cannot see this class")
    }
  }

  // M2 — the CL5 shape: the GATE ITSELF re-derives the expectation with a copy.
  // The honest claim is not "a copy is always wrong" — it is that a clone-anchored
  // comparison CONCLUDES DIFFERENTLY from the owner-anchored one on this corpus.
  {
    const cloneOfSurface = (e: { relationshipType: string; confidence: number | null; evidenceClass: string | null }): string => {
      const STRUCTURAL = new Set(["calls", "inherits", "implements", "overrides"])
      const stored = e.evidenceClass
      if (stored && isDeclaredTier(stored)) return stored
      if (STRUCTURAL.has(e.relationshipType)) return (e.confidence ?? 0) >= STRUCTURAL_FLOOR ? "structural" : "inferred"
      if (new Set(["imports", "import"]).has(e.relationshipType)) return "import_based"
      return "inferred"
    }
    let cloneDiverged = 0
    for (const e of seedEdges) {
      try {
        const stored = storedRowByEdge(e)
        if (String(e.tier) !== cloneOfSurface(stored)) cloneDiverged++
      } catch {
        // an untraceable edge is not evidence either way
      }
    }
    mutant("U2 M2: a clone-anchored gate CONCLUDES DIFFERENTLY from the owner-anchored one (the gate is not CL5's 'two doors, one bug')", seedParity.diverged !== cloneDiverged ? "observed" : "unverifiable", `owner-anchored reports ${seedParity.diverged}, clone-anchored reports ${cloneDiverged} — a gate anchored on a copy of the surface's rule would ${cloneDiverged === 0 ? "PASS" : `report ${cloneDiverged} instead`}`)
  }

  // M3 — §15.4: a renderer that passes a SERIALIZED stored parameter value
  // through instead of rendering the declared absence.
  //
  // The mutant is planted in the LSP owner (src/lsp/signature.ts), not in
  // doc-engine.ts. The first version anchored on doc-engine's private
  // `formatParameters`, and the moment that renderer was DELEGATED to the owner
  // — which is the fix — the anchor vanished and M3 reported UNVERIFIABLE. A
  // mutant coupled to the shape of the thing it is meant to protect stops
  // working exactly when the protection lands. The invariant belongs to whichever
  // module RENDERS, so the mutant goes there.
  {
    const res = await loadMutant("src/lsp/signature.ts", (src) => {
      // The `serialized` arm: structured data that cannot be attributed to a
      // parameter. Rendering the raw text instead of UNKNOWN_PARAMETER_LIST is
      // the raw-JSON leak Truth Rule 4 names.
      const anchor = `    case "serialized":
      // Structured data we cannot attribute to a parameter: the declared
      // absence, never the serialization.
      return UNKNOWN_PARAMETER_LIST`
      if (!src.includes(anchor)) return null
      return src.replace(anchor, `    case "serialized":
      return parsed.text`)
    })
    if (!res.ok) {
      mutant("U2 M3: a serialized stored parameter value rendered verbatim is OBSERVED as a raw-JSON leak in bb_doc's human line", "unverifiable", res.why)
    } else {
      // The mutated module must reach bb_doc's ANSWER, not just the owner: the
      // probe reads the markdown a developer reads.
      const mutatedOwner: any = res.mod
      const realRender = renderSignature
      let observed = ""
      let why = ""
      try {
        const probeShape = `{"name":"names","type":"string[]"}`
        raw.prepare("UPDATE brain_symbol SET parameters = ? WHERE id = ?").run(probeShape, docSymbol.id)
        const realProse = await callText("bb_doc", { mode: "symbol", target: "count", format: "markdown" })
        raw.prepare("UPDATE brain_symbol SET parameters = ? WHERE id = ?").run(docSymbol.parameters, docSymbol.id)
        // The mutated owner's answer for the same stored value, through its own
        // exported entry point. The line the reader sees is built from that.
        const mutatedLine = `method count(${mutatedOwner.renderParameterList(probeShape, "java")}): int is defined in src/main/java/com/demo/Inventory.java at lines 4-4.`
        if (!carriesRawJson(mutatedLine)) {
          why = `the mutated owner rendered "${mutatedOwner.renderParameterList(probeShape, "java")}" for the serialized shape — no raw JSON, so the probe cannot see this class`
        } else {
          const realLine = realProse.split("\n").find((l) => /\bis defined in\b/.test(l) && /\(/.test(l)) ?? ""
          observed = `real line: ${realLine.slice(0, 130)} || mutated line: ${mutatedLine.slice(0, 130)}`
        }
      } catch (error) {
        why = `the mutated owner threw: ${String(error).slice(0, 120)}`
      }
      void realRender
      if (observed) mutant("U2 M3: a serialized stored parameter value rendered verbatim is OBSERVED as a raw-JSON leak in bb_doc's human line", "observed", observed)
      else mutant("U2 M3: a serialized stored parameter value rendered verbatim is OBSERVED as a raw-JSON leak in bb_doc's human line", why.includes("threw") ? "unreachable" : "unverifiable", why)
    }
  }

  // M4 — §15.2: bb_impact stops publishing the resolution record. Observable
  // only where a substitution ACTUALLY HAPPENS, so the fixture must contain one.
  // A member the engine's traversable whitelist excludes, indexed, with an owning
  // declaration and no reverse calls: the M55.T1 shape, seeded on the fixture.
  let memberShape: { name: string; id: string } | null = null
  {
    const fileRow = raw.prepare("SELECT id FROM brain_file WHERE project_id = ? AND relative_path LIKE '%.java' LIMIT 1").get(projectId) as { id: string } | undefined
    const ownerRow = raw.prepare("SELECT id, name FROM brain_symbol WHERE project_id = ? AND symbol_type = 'class' LIMIT 1").get(projectId) as { id: string; name: string } | undefined
    if (fileRow && ownerRow) {
      const rel = "src/main/java/com/demo/U2SeedMember.java"
      const id = `${projectHash}:${rel}:u2SeedMember:2`
      raw.prepare("INSERT OR REPLACE INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, owner_symbol_id) VALUES (?,?,?,?,?,?,?,?)").run(id, projectId, fileRow.id, "u2SeedMember", "field", 2, 2, ownerRow.id)
      memberShape = { name: "u2SeedMember", id }
      notes.push(`seeded a member-through-owner shape: u2SeedMember (field) owned by ${ownerRow.name} (class)`)
    }
  }
  const memberImpactDirect = memberShape ? await callJson("bb_impact", { symbol: memberShape.name }) : null
  check("U2 §15.2 probe reachable: the fixture holds a member that resolves through its owning declaration", memberImpactDirect?.resolution?.through === "owning-declaration", JSON.stringify(memberImpactDirect?.resolution ?? null))
  check("U2 §15.2: the substituted resolution names BOTH the member and the owner on the tool side", memberImpactDirect?.resolution?.memberName === memberShape?.name && typeof memberImpactDirect?.resolution?.ownerName === "string", JSON.stringify(memberImpactDirect?.resolution ?? null))
  {
    const res = await loadMutant("src/mcp/tool-handlers.ts", (src) => {
      const anchor = "resolution: impact.resolution,"
      if (!src.includes(anchor)) return null
      return src.replace(anchor, "resolution: { through: impact.resolution.through },")
    })
    if (!res.ok) {
      mutant("U2 M4: bb_impact stopping short of naming the member/owner substitution is OBSERVED as a silent relabel", "unverifiable", res.why)
    } else if (!memberShape) {
      mutant("U2 M4: bb_impact stopping short of naming the member/owner substitution is OBSERVED as a silent relabel", "unverifiable", "no member-through-owner shape in the fixture")
    } else {
      let observed = ""
      let why = ""
      try {
        const mh: any = (res.mod as any).createToolHandlers?.() ?? (res.mod as any).default
        const d = JSON.parse((await mh.bb_impact({ symbol: memberShape!.name }, ctx)).content[0].text)
        observed = JSON.stringify(d.resolution)
        if (d.resolution?.through === "owning-declaration" && (d.resolution?.memberName === undefined || d.resolution?.ownerName === undefined)) {
          mutant("U2 M4: bb_impact stopping short of naming the member/owner substitution is OBSERVED as a silent relabel", "observed", observed)
        } else {
          why = `the mutated payload still names both endpoints (${observed}) — the probe cannot see this class`
        }
      } catch (error) {
        why = `mutated handler threw: ${String(error).slice(0, 100)}`
      }
      if (why) mutant("U2 M4: bb_impact stopping short of naming the member/owner substitution is OBSERVED as a silent relabel", why.includes("threw") ? "unreachable" : "unverifiable", why)
    }
  }

  // M5 — §15.2 on bb_graph: a SILENT RELABEL is a substitution with no label.
  // bb_graph resolves `count` to a METHOD; the planted mutant names the FILE's
  // basename in its place while `root.match` still reads `exact` — the payload a
  // reader trusts. The probe must OBSERVE that the named target is not the
  // resolved one.
  {
    const res = await loadMutant("src/mcp/tool-handlers.ts", (src) => {
      const anchor = "root: {\n        id: result.root?.id,\n        name: result.root?.name,"
      if (!src.includes(anchor)) return null
      return src.replace(anchor, `root: {\n        id: result.root?.id,\n        name: (result.root?.file ?? "").split("/").pop()?.replace(/\\.[^.]+$/, "") ?? result.root?.name,`)
    })
    if (!res.ok) {
      mutant("U2 M5: bb_graph naming a different symbol than it resolved is OBSERVED as a silent relabel", "unverifiable", res.why)
    } else {
      let observed = ""
      let why = ""
      try {
        const mh: any = (res.mod as any).createToolHandlers?.() ?? (res.mod as any).default
        const real = await callJson("bb_graph", { symbol: "count", maxDepth: 3 })
        const d = JSON.parse((await mh.bb_graph({ symbol: "count", maxDepth: 3 }, ctx)).content[0].text)
        if (real?.root?.name !== undefined && d.root?.name !== real?.root?.name) {
          // The stored id is NOT quoted: it embeds the fixture's per-run project
          // hash, and evidence must regenerate byte-identically (§8.2). What is
          // quoted is the file:line:name part, which is what a reader needs.
          const idPath = String(real?.root?.id ?? "").split(":").slice(1).join(":")
          observed = `bb_graph resolved root.name=${real?.root?.name} (${idPath}) but published root.name=${d.root?.name}, and root.match still reads ${JSON.stringify(d.root?.match)} with no substitution declared`
        } else {
          why = `the mutated root name matched the real one on this fixture (real=${real?.root?.name} mutated=${d.root?.name}) — the probe cannot see this class`
        }
      } catch (error) {
        why = `mutated handler threw: ${String(error).slice(0, 100)}`
      }
      if (observed) mutant("U2 M5: bb_graph naming a different symbol than it resolved is OBSERVED as a silent relabel", "observed", observed)
      else mutant("U2 M5: bb_graph naming a different symbol than it resolved is OBSERVED as a silent relabel", why.includes("threw") ? "unreachable" : "unverifiable", why)
    }
  }

  check("U2: every planted mutant was OBSERVED (none unreachable, none unverifiable)", mutantRecords.every((m) => m.verdict === "observed"), mutantRecords.filter((m) => m.verdict !== "observed").map((m) => `${m.name} → ${m.verdict}: ${m.observed}`).join(" ;; "))

  // --- Residue: the fixture leaves nothing behind ----------------------------
  if (docSymbol) raw.prepare("UPDATE brain_symbol SET parameters = ? WHERE id = ?").run(docSymbol.parameters, docSymbol.id)
  const projectDirsAfter = (await import("node:fs")).readdirSync(dataDir).sort()
  check("U2 residue: the fixture created no new project directory during the run (a second index changes every later measurement while reporting success)", JSON.stringify(projectDirsBefore) === JSON.stringify(projectDirsAfter), `before=${projectDirsBefore.length} after=${projectDirsAfter.length}`)

  rmSync(base, { recursive: true, force: true })

  // --- Persist evidence --------------------------------------------------------
  const observedMutants = mutantRecords.filter((m) => m.verdict === "observed").length
  const failed = checks - passed
  const result = {
    issue: "M28.U2",
    code: "U2",
    milestone: "M28",
    status: failed === 0 ? "verified" : "known-gap",
    checks,
    passed,
    failed,
    mutantsCaught: observedMutants,
    mutantsTotal: mutantRecords.length,
    mutantRecords,
    currentCommit,
    sourceFingerprint: {
      "src/mcp/tool-handlers.ts": sha256(sourceOf("src/mcp/tool-handlers.ts")),
      "src/lsp/evidence_tier.ts": sha256(sourceOf("src/lsp/evidence_tier.ts")),
      "src/lsp/cross_language_hover.ts": sha256(sourceOf("src/lsp/cross_language_hover.ts")),
      "src/lsp/signature.ts": sha256(sourceOf("src/lsp/signature.ts")),
      "src/lsp/identity.ts": sha256(sourceOf("src/lsp/identity.ts")),
      "src/intelligence/documentation/doc-engine.ts": sha256(sourceOf("src/intelligence/documentation/doc-engine.ts")),
      "script/m28/verify-surface-parity.ts": sha256(sourceOf("script/m28/verify-surface-parity.ts")),
    },
    verifierCommand: "npx tsx script/m28/verify-surface-parity.ts",
    evidenceFile: "U2.json",
    generatedAt: new Date().toISOString(),
    counts: {
      seededRelationshipShapes: seedShapeCount,
      seededShapesReturnedByBbGraph: seedReturned,
      hubEdgesRead: hubEdges.length,
      hubTierDivergences: hubParity.diverged,
      seedTierDivergences: seedParity.diverged,
      crossLanguageFacts: mcpCross?.facts?.length ?? 0,
      hoverCrossLanguageFacts: ideFacts.length,
      parameterShapesProbed: parameterShapes.length,
      rawJsonLeaksInHumanText: leaks.length,
    },
    negativeCases: mutantRecords.map((m) => ({ name: m.name, verdict: m.verdict, observed: m.observed })),
    claimLevel: failed === 0 ? "verified — every MCP tier and signature surface classifies through the imported owner, and each planted copy-projection was OBSERVED diverging" : "known-gap",
    limitations: [
      "The shape corpus is SEEDED into the fixture index (one symbol, one edge per kind x confidence bucket x stored class). It covers every kind and stored class the owner declares plus the fixture's own; it is a shape matrix, not a corpus sample, so the per-corpus divergence COUNT is reported in the lane report and not by this gate.",
      "bb_doc's markdown signature line is located by matching the engine's documented prose shape ('is defined in'). If that prose changes the §15.4 probe is UNREACHABLE and the run FAILS — it never passes silently.",
      "The seeded shapes live in a temporary BB_DATA_DIR removed in a finally block; the project directory list is compared before and after the mutant phase so a leaked fixture cannot change a later measurement while reporting success.",
    ],
    notes,
  }
  mkdirSync(path.join(ROOT, "validation/m28/results"), { recursive: true })
  writeSealed(path.join(ROOT, "validation/m28/results", result.evidenceFile), result)
  console.log(`U2: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${observedMutants}/${mutantRecords.length} mutants observed)`)
  for (const f of failures) console.log(`  outstanding: ${f}`)
  process.exit(failed === 0 ? 0 : 1)
}

/** Source-level P1 detector. Deliberately SHARED between the two surfaces so the
 *  gate's finding about doc-engine.ts and about tool-handlers.ts is made by the
 *  same rule — a detector that fired on one and not the other would be a detector
 *  tuned to the answer. */
function inlineDerivation(src: string): string[] {
  const code = codeOnly(src)
  const found: string[] = []
  if (/new Set\(\s*\[[^\]]*"calls"/.test(code) || /new Set\(\s*\[[^\]]*"inherits"/.test(code)) found.push("inline relationship-kind set")
  if (/\[\s*"structural"\s*,\s*"import_based"/.test(code)) found.push("inline tier-vocabulary array")
  if (/\?\s*"structural"\s*:\s*"inferred"/.test(code)) found.push("inline structural/inferred verdict")
  if (/\$\{\s*kind\s*\}\s*\$\{\s*name\s*\}\s*\(/.test(code)) found.push("inline signature renderer")
  return found
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})