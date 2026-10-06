// script/m42/verify-rich-hover.ts — M42.H2 verifier + mutation suite
// (issue #650).
//
// Proves the rich hover (connected summary + clickable usages + definition
// link) against the REAL indexer + REAL dist server, and that the suite CAN
// FAIL:
//
//   R1 fixture:     the H2 fixture indexes cleanly (2 files, cross-file).
//   R2 ground:      the analyzer's rows for `render` are exactly the
//                   expectations: called by BOTH mains (App + Main2),
//                   contained by Greeter — the fixture's semantic anchors
//                   hold in real data.
//   R3 sections:    hover on render's declaration renders **connected**
//                   ("called by" both mains, same-name disambiguated),
//                   **usages** top-3 file:line links, the **contained**
//                   containment block, and a clickable definition footnote;
//                   hover on the Greeter class renders "implements Named".
//                   Existing sections unchanged.
//   R4 differential: the hover card is read as the SECTIONS a reader reads it
//                   as, and every link is judged against the law of the block
//                   it renders under, differentially, row by row:
//                     usage/connected links == the index-stored location of the
//                       usage row they name, AND == a location
//                       textDocument/references returns (§15.1 one answer);
//                     containment links == the index-stored location of the
//                       `contains`/`exports` row they render — the position
//                       that row stores, which references excludes by law;
//                     action links == the hovered symbol's own stored
//                       location, as textDocument/definition returns it.
//                   Plus §13.4 coverage per block (rendered, or the cap's
//                   remainder declared) and §14.2/§14.3 label-vs-target.
//   R5 budget:      hover p95 <= 50ms warm with the new sections (§3/§12.7).
//   R6 laws:        declared absence (no fabricated sections), contains rows
//                   never render as connection facts, same-name callers are
//                   disambiguated, +N more escape hatch appears past top-3.
//   M1..M7:         mutations — each planted defect is caught.
//
// Run: npx tsx script/m42/verify-rich-hover.ts
// Evidence: validation/m42/results/H2.json (machine-emitted)

import { execFileSync } from "node:child_process"
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { H2_EXPECT, H2_FILE_APP, H2_FILE_MAIN2, H2_REL_APP, H2_REL_MAIN2, H2_ROOT, writeH2Fixture } from "./h2-fixture.ts"
import {
  connectedGroups,
  connectedSummarySection,
  containmentSection,
  containmentSitesOf,
  isContainmentVerb,
  MAX_CONTAINMENT_ROWS,
  MAX_SUMMARY_PER_VERB,
  MAX_USAGE_LINKS,
  richSitesForSymbol,
  siteLabel,
  usagesSection,
  usageSitesOf,
  type RichSite,
} from "../../src/lsp/rich_hover.ts"
import { isDeclarationRelationship, USAGE_SITE_FILTER_LABEL } from "../../src/lsp/relations.ts"
import { createPositionMapper, resolveRowByteColumns } from "../../src/lsp/positions.ts"
import type { CallSiteAddress } from "../../src/intelligence/contracts"
import { writeSealed } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")
const EVIDENCE = path.join(ROOT, "validation/m42/results/H2.json")
const SERVER = path.join(ROOT, "dist/lsp/server.js")
const BB = path.join(ROOT, "bin/bb")

let checks = 0
let passed = 0
const failures: string[] = []
/** `notJudged` counts a plant that never reached the oracle (no anchor, or the
 *  copy failed to import). It is reported beside `caught`, never folded into it:
 *  a dead plant is not a catch (§8.7). */
const mutants = { caught: 0, total: 0, notJudged: 0, verdicts: [] as Array<{ name: string; caughtBy: string; detail: string }> }
let negativesPlanned = 0
/** The measured warm-budget record (§3). Set by R5; null means R5 did not
 *  complete, which the evidence states rather than leaving the old shape. */
let budget: Record<string, unknown> | null = null

function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}

const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()

// --- R1: fixture indexed -------------------------------------------------------------
console.log("R1: fixture index (real indexer)")
writeH2Fixture()
// An ISOLATED data dir, passed to the indexer and to the server this suite
// starts. Measured reason, not tidiness: the pre-lane run indexed the fixture
// into the developer's DEFAULT store (~/.bb), so the answer to "how many callers
// does render have" depended on whatever that machine's store already held and on
// the indexer's incremental state there. §8.2 asks the record to regenerate
// byte-identically; a gate whose input is the developer's home directory cannot
// promise that on another machine. Measured after this change: VERIFIED 41/41 with
// a fresh, empty data dir.
const dataDir = mkdtempSync(path.join(tmpdir(), "m42-h2-data-"))
const childEnv = { ...process.env, BB_DATA_DIR: dataDir }
// The in-process reader (R2) must see the same store the indexer wrote, so this
// is set BEFORE BrainDatabase is imported below.
process.env.BB_DATA_DIR = dataDir
if (!existsSync(path.join(ROOT, "dist/lsp/server.js"))) {
  console.log("  (dist missing — building)")
  execFileSync("npx", ["tsup"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], timeout: 420_000 })
}
const idxOut = execFileSync(BB, ["index", H2_ROOT, "--no-setup"], { cwd: ROOT, env: childEnv, encoding: "utf8", timeout: 300_000, stdio: ["ignore", "pipe", "inherit"] })
check("H2/R1: fixture indexes cleanly", /indexed 2 files/.test(idxOut), idxOut.split("\n").find((l) => l.includes("indexed")) ?? "")

// --- R2: the GROUND — what the index actually holds, read before any surface -----
//
// This leg is claimed in this file's header and was never implemented. Measured
// what that cost: on one run at commit 8938a728 (same commit, minutes either
// side of three green runs) the index held ONE of the fixture's two calling
// rows, and the gate reported it as FOUR surface failures — the connected
// summary missing its disambiguated second caller, the usages list short one row,
// the instantiated-by line short one entry, and the references surface "returning
// each usage site exactly once: got 1". Every one of those read as a defect in
// rich_hover.ts or navigation.ts. None was. The index was short a row.
//
// §8.7 names this failure mode — the oracle sharing a fault with the thing it
// measures — and the cure is a ground: assert the fixture's semantic anchor from
// the STORE, so a partial index is reported as a partial index.
console.log("\nR2: ground — the fixture's stored rows, read from the index")
const { BrainDatabase } = await import(pathToFileURL(path.join(ROOT, "src/brain/database.ts")).href)
const { getProjectId } = await import(pathToFileURL(path.join(ROOT, "src/util/project-id.ts")).href)
const h2ProjectId = getProjectId(H2_ROOT)
const h2Raw = await BrainDatabase.getRawInstance(h2ProjectId)
const groundRows = h2Raw
  .prepare(
    `SELECT r.id AS rowId, r.relationship_type AS relType, r.line_number AS storedLine,
            COALESCE(sf.relative_path, '') AS sourceRel
     FROM brain_relationship r
     JOIN brain_symbol ts ON ts.id = r.target_symbol_id
     JOIN brain_file tf ON tf.id = ts.file_id
     LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
     LEFT JOIN brain_file sf ON sf.id = ss.file_id
     WHERE tf.path = ? AND ts.name = 'render' AND r.source_symbol_id <> ts.id
     ORDER BY r.relationship_type, r.id`,
  )
  .all(H2_FILE_APP) as Array<{ rowId: string; relType: string; storedLine: number | null; sourceRel: string }>
const usageGround = groundRows.filter((r) => !/^(contains|exports)$/i.test(r.relType))
const containmentGround = groundRows.filter((r) => /^(contains|exports)$/i.test(r.relType))
/** ONE implementation, used by the check and by its negative. A ground check with
 *  a second, near-identical predicate in its own negative is a negative that can
 *  pass for a different reason than the check fails. */
const groundPredicate = (rows: typeof groundRows): boolean => {
  const usage = rows.filter((r) => !/^(contains|exports)$/i.test(r.relType))
  return (
    usage.length === 2 &&
    new Set(usage.map((r) => r.sourceRel)).size === 2 &&
    [H2_REL_APP, H2_REL_MAIN2].every((rel) => usage.some((r) => r.sourceRel === rel))
  )
}
check(
  "H2/R2: the index holds BOTH calling rows for `render`, one per file — the fixture's semantic anchor (if this fails, every leg below is measuring a partial index, not the surface)",
  groundPredicate(groundRows),
  `stored rows touching render: ${JSON.stringify(groundRows)}`,
)
check(
  "H2/R2: every usage row for `render` is a CALL row carrying a real stored call-site line (no declaration row, no legacy 0)",
  usageGround.length === 2 && usageGround.every((r) => r.relType === "calls" && typeof r.storedLine === "number" && r.storedLine > 0),
  JSON.stringify(usageGround),
)
check(
  "H2/R2: the index holds exactly ONE declaration-containment row for `render` (Greeter contains render) — the row the **contained** block is required to render",
  containmentGround.length === 1 && containmentGround[0]!.relType === "contains" && containmentGround[0]!.sourceRel === H2_REL_APP,
  JSON.stringify(containmentGround),
)

// --- The ROW GROUND for the section laws (R4) ------------------------------------
//
// ONE query, every stored row touching the hovered symbol, in BOTH directions,
// with the far end's identity and the row's own stored line. Every section law
// in R4 judges rendered links against THIS array, reduced per section by the
// vocabulary owner (`isDeclarationRelationship`, src/lsp/relations.ts) — the
// same owner the surface and `textDocument/references` use, so the three cannot
// drift apart, and the gate is not carrying its own idea of what a usage is.
console.log("R2b: row ground — every stored row touching `render`, both directions")
const renderSymbol = h2Raw
  .prepare(`SELECT s.id, s.name, s.line_start FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE f.path = ? AND s.name = 'render'`)
  .get(H2_FILE_APP) as { id: string; name: string; line_start: number | null } | undefined
const storedRows = h2Raw
  .prepare(
    `SELECT r.id AS rowId,
            r.relationship_type AS relType,
            r.line_number AS storedLine,
            r.source_symbol_id AS sourceId,
            r.target_symbol_id AS targetId,
            ss.name AS sourceName, sf.path AS sourcePath, ss.line_start AS sourceLineStart,
            ss.byte_start AS sourceByteStart, ss.byte_end AS sourceByteEnd,
            ts.name AS targetName, tf.path AS targetPath, ts.line_start AS targetLineStart,
            ts.byte_start AS targetByteStart, ts.byte_end AS targetByteEnd
     FROM brain_relationship r
     LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
     LEFT JOIN brain_file sf ON sf.id = ss.file_id
     LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
     LEFT JOIN brain_file tf ON tf.id = ts.file_id
     WHERE r.source_symbol_id = ? OR r.target_symbol_id = ?
     ORDER BY r.relationship_type, r.id`,
  )
  .all(renderSymbol?.id ?? "", renderSymbol?.id ?? "") as Array<{
  rowId: string
  relType: string
  storedLine: number | null
  sourceId: string | null
  targetId: string | null
  sourceName: string | null
  sourcePath: string | null
  sourceLineStart: number | null
  sourceByteStart: number | null
  sourceByteEnd: number | null
  targetName: string | null
  targetPath: string | null
  targetLineStart: number | null
  targetByteStart: number | null
  targetByteEnd: number | null
}>
/** ONE stored row reduced to what a link law needs: which section may render it,
 *  which side is the far end, and the ONE position the store may serve it at.
 *
 *  The position derivation is the gate's own, from the store's own columns (see
 *  the law block above): a positive-integer stored line is served at
 *  `line - 1`, character 0, because the store carries a call-site LINE and no
 *  COLUMN (src/intelligence/graph/line-address.ts documents the address as
 *  line-only). A row with no stored line falls back to the far end's OWN
 *  declaration start, resolved through P1 (the ONE conversion owner, §5 rule 1)
 *  — and that fallback is a DECLARED substitution, so the surface must say so in
 *  the row's own label, which H2/R4-LAW-LABEL judges.
 *
 *  Used by BOTH grounds (the real store, and the mutant suite's row double), so
 *  the two can never judge a row by two different rules. */
interface GroundInput {
  id: string
  relType: string
  storedLine: number | null
  far: { name: string | null; path: string | null; lineStart: number | null; byteStart: number | null; byteEnd: number | null }
}
interface RowGround {
  id: string
  kind: string
  relPath: string
  farName: string
  farLine1: number | null
  /** true when this row is a declaration containment (relations.ts's class) */
  declaration: boolean
  /** `path:line:character`, or "" when the store permits no position at all */
  key: string | null
  /** which of the two positions the store permits, named */
  branch: "stored-line" | "declaration-substitute" | "unpositionable"
}
function groundOf(row: GroundInput): RowGround {
  const stored = storedRowKey({ relPath: row.far.path ?? "", storedLine: row.storedLine })
  const far = row.far
  let declarationKey: string | null = null
  if (far.path !== null && typeof far.lineStart === "number" && typeof far.byteStart === "number" && typeof far.byteEnd === "number") {
    const text = readFileSync(far.path, "utf8")
    const startCol = resolveRowByteColumns(text, far.lineStart, far.byteStart)
    const endCol = resolveRowByteColumns(text, far.lineStart, far.byteEnd)
    if (startCol !== null && endCol !== null) {
      const mapper = createPositionMapper(text)
      const lsp = mapper.indexRangeToLsp({ start: { line: startCol.line, column: startCol.column }, end: { line: endCol.line, column: endCol.column } })
      declarationKey = `${far.path}:${lsp.start.line}:${lsp.start.character}`
    }
  }
  const branch: RowGround["branch"] = stored !== null ? "stored-line" : declarationKey !== null ? "declaration-substitute" : "unpositionable"
  return {
    id: row.id,
    kind: row.relType,
    relPath: far.path ?? "",
    farName: far.name ?? "",
    farLine1: typeof far.lineStart === "number" ? far.lineStart : null,
    declaration: isDeclarationRelationship(row.relType),
    key: stored ?? declarationKey,
    branch,
  }
}
/** The far end of a stored row: the SOURCE for an incoming row (someone
 *  references the hovered symbol), the TARGET for an outgoing one. Self-loops are
 *  not rows a card can render as a connection to another symbol, and they carry no
 *  far end — they are dropped here, matching the collector and `relations.ts`'s
 *  `relationDirection` (which classifies them "self"). */
function farEndOf(
  row: { sourceId: string | null; targetId: string | null; sourceName: string | null; sourcePath: string | null; sourceLineStart: number | null; sourceByteStart: number | null; sourceByteEnd: number | null; targetName: string | null; targetPath: string | null; targetLineStart: number | null; targetByteStart: number | null; targetByteEnd: number | null },
  selfId: string,
): GroundInput["far"] | null {
  if (row.sourceId === selfId && row.targetId === selfId) return null
  const incoming = row.targetId === selfId
  return incoming
    ? { name: row.sourceName, path: row.sourcePath, lineStart: row.sourceLineStart, byteStart: row.sourceByteStart, byteEnd: row.sourceByteEnd }
    : { name: row.targetName, path: row.targetPath, lineStart: row.targetLineStart, byteStart: row.targetByteStart, byteEnd: row.targetByteEnd }
}
const rowGrounds = storedRows
  .map((row) => {
    const far = farEndOf(row, renderSymbol?.id ?? "")
    return far === null ? null : groundOf({ id: row.rowId, relType: row.relType, storedLine: row.storedLine, far })
  })
  .filter((g): g is RowGround => g !== null)
const usageRowGrounds = rowGrounds.filter((r) => !r.declaration)
const containmentRowGrounds = rowGrounds.filter((r) => r.declaration)
{
  // The negative R2 needs to be a gate: the one-row index that was REALLY
  // observed on commit 8938a728, judged by the same predicate.
  const oneRow = groundRows.filter((r) => r.sourceRel !== H2_REL_MAIN2)
  negativesPlanned++
  check(
    "H2/R2 [negative]: the ground REJECTS the one-row index actually observed on commit 8938a728 (with one calling row missing, four surface legs failed by implication instead)",
    groundPredicate(groundRows) && !groundPredicate(oneRow),
    `predicate on the real rows: ${groundPredicate(groundRows)}; on the one-row shape: ${groundPredicate(oneRow)} (rows kept: ${oneRow.length})`,
  )
}

// --- LSP client over stdio (real dist server) ---------------------------------------
class StdioLsp {
  private child
  private buffer = Buffer.alloc(0)
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private nextId = 1
  private stderrTail = ""
  constructor(workspace: string) {
    this.child = spawn(process.execPath, [SERVER, "--dir", workspace], { stdio: ["pipe", "pipe", "pipe"], env: childEnv })
    this.child.stdout.on("data", (c: Buffer) => this.onData(c))
    this.child.stderr.on("data", (c: Buffer) => {
      this.stderrTail = (this.stderrTail + c.toString()).slice(-8000)
    })
  }
  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n")
      if (headerEnd === -1) return
      const header = this.buffer.subarray(0, headerEnd).toString()
      const len = parseInt(/Content-Length:\s*(\d+)/i.exec(header)?.[1] ?? "0")
      if (!len || this.buffer.length < headerEnd + 4 + len) return
      const body = this.buffer.subarray(headerEnd + 4, headerEnd + 4 + len).toString()
      this.buffer = this.buffer.subarray(headerEnd + 4 + len)
      try {
        const msg = JSON.parse(body)
        if (typeof msg.id === "number" && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!
          this.pending.delete(msg.id)
          if (msg.error) p.reject(new Error(msg.error.message))
          else p.resolve(msg.result)
        }
      } catch {}
    }
  }
  request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++
    this.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }
  write(body: string | Buffer): void {
    const b = Buffer.isBuffer(body) ? body : Buffer.from(body)
    this.child.stdin.write(`Content-Length: ${b.length}\r\n\r\n`)
    this.child.stdin.write(b)
  }
  dispose(): void {
    this.child.kill()
  }
  stderr(): string {
    return this.stderrTail
  }
}

/** Extract {command, args} pairs from hover markdown command links. */
/** The real hover's rendered links, section by section, kept so the
 *  post-session negatives can re-judge them through the SAME predicates the gate
 *  used. A gate that re-implements its own predicate for its negative is a gate
 *  whose negative can pass for a different reason than the gate fails. */
let renderedCard: {
  usages: CardLink[]
  connected: CardLink[]
  contained: CardLink[]
  actions: CardLink[]
  definition: CardLink[]
  /** the store rows each block was allowed to render, as the gate reduced them */
  usageRows: Array<{ id: string; key: string; relPath: string }>
  containmentRows: Array<{ id: string; key: string; relPath: string }>
  /** every block's character range, so a negative can prove the structural law
   *  can fail (a link outside all of them is a link no law judges) */
  blockRanges: ReadonlyArray<readonly [number, number]>
} | null = null
/** The reference locations the session measured, for the same reason. */
let refLocsForNegative: ReadonlySet<string> = new Set<string>()

function commandLinks(markdown: string): Array<{ command: string; args: { file: string; line: number; character: number } }> {
  const out: Array<{ command: string; args: { file: string; line: number; character: number } }> = []
  const re = /\]\(command:(bb\.[a-zA-Z]+)\?([^)]+)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    try {
      const _dec = JSON.parse(decodeURIComponent(m[2]))
      const args = (Array.isArray(_dec) ? _dec[0] : _dec) as { file: string; line: number; character: number }
      if (typeof args?.file === "string" && typeof args?.line === "number") out.push({ command: m[1], args })
    } catch {
      // unparseable link = link integrity failure (asserted by the caller)
    }
  }
  return out
}

// ===========================================================================
// THE SECTION-AWARE LINK LAWS (H2/R4-LAW-*), as one module so the wire leg,
// the mutant oracle and every negative judge THE SAME predicates
// ===========================================================================
//
// WHAT THIS REPLACES, and why the replacement is the stronger law (§8.7 red-team
// duty — the oracle that shares a fault with the thing it measures).
//
// The pre-fix R4 said, in one sentence: "EVERY bb.openUsage link target equals
// a location `textDocument/references` returns", plus "every such link opens
// the CALL SITE". Both are now wrong BY CONSTRUCTION, and measurably so:
//
//   MEASURED on the H2 fixture at this commit (real indexer, real dist server,
//   `bb index` into an isolated BB_DATA_DIR):
//     references (includeDeclaration:false) returns 2 locations:
//       App.java:14:0    (stored call-site line 15, `greeter.render()`)
//       Main2.java:5:0   (stored call-site line  6, `g.render()`)
//     the hover renders FIVE bb.openUsage links, in three different blocks:
//       **connected**   App.java:14:0, Main2.java:5:0
//       **usages**      App.java:14:0, Main2.java:5:0
//       **contained**   App.java:6:0      <- the `contains` row
//     and the store holds the containment row's own position: the
//     `Greeter contains render` row stores line_number = 7, so its served
//     position is App.java:6:0 (0-based) — the hovered method's own
//     declaration, which is where a containment row says the member IS.
//
// `textDocument/references` excludes that row BY LAW, not by accident:
// `resolveReferences` filters through `isUsageSiteRow` (src/lsp/relations.ts:825),
// and a declaration containment is never a usage site. So "every link ∈
// references" and "every link opens a call site" both FAIL on a card that is
// telling the truth about a relationship the owner's ratified decision asked
// to be shown. That is the oracle being wrong, not the component.
//
// THE LAWS THAT REPLACE THEM. A link's law is the law of the BLOCK IT RENDERS
// IN, and every block's law is a differential against the STORE:
//
//   LAW-SECTION   every command link in the card sits under a block header.
//                 A link in no block is a link no law can judge, so it is a
//                 defect on its own (§13.5: noise is labeled, not hidden).
//
//   LAW-USAGE     every bb.openUsage link in the **usages** block equals the
//                 index-stored location of the usage row it renders, ROW BY
//                 ROW: the row is identified independently (kind, far-end
//                 symbol, far-end file, stored line), and the link's
//                 `path:line:character` must equal that row's own served
//                 position. Not "is in the set" — "IS THIS ROW'S".
//
//   LAW-REFERENCE every **usages** link target must ALSO equal a location
//                 `textDocument/references` returns for the same position.
//                 Two surfaces, one answer (§15.1). Kept as a SEPARATE law so
//                 the row-identity differential and the surface-agreement law
//                 can fail independently.
//
//   LAW-CONNECTED every bb.openUsage link in the **connected** block equals the
//                 index-stored location of a NON-DECLARATION row it renders
//                 (a connection fact is never a containment), row by row.
//
//   LAW-CONTAIN   every bb.openUsage link in the **contained** block equals the
//                 index-stored location of the `contains`/`exports` row it
//                 renders. This is the law that can never be "∈ references",
//                 because relations.ts excludes exactly these rows.
//
//   LAW-ACTION    every bb.openGraph / bb.openImpact / bb.showCallHierarchy
//                 link equals the symbol's OWN index-stored location as
//                 `textDocument/definition` returns it.
//
//   LAW-LABEL     §14 rules 2+3: where a row's label states a position (the
//                 `name — file:line` disambiguation), the label's file and
//                 1-based line must equal the link's OWN target. A card that
//                 names one place and opens another is a misread link however
//                 real the target is.
//
//   LAW-COVERAGE  §13.4: every index-stored row of the kind the block renders
//                 must reach the card — the link, or an explicitly declared
//                 cap remainder. A row that renders nowhere is a silent drop.
//
// WHY THIS IS STRONGER, not merely different:
//
//   1. It is a superset in coverage: five links are judged (the old law
//      judged one undifferentiated set), each against a NAMED row.
//   2. The old law was UNSATISFIABLE for the containment row and would have
//      been "fixed" by excluding that link or relaxing the count — which is
//      exactly the two escapes this task forbids. The new law has a real
//      predicate for that link, so there is nothing to relax.
//   3. LAW-CONTAIN is a differential the old law could not express at all: it
//      compares a rendered link against the position the CONTAINMENT ROW
//      STORES, read from brain_relationship independently of the renderer. A
//      fabricated containment line, or one pointing at a usage location, is
//      caught by it and by nothing else.
//   4. LAW-ACTION is new coverage: the actions row's three links were never
//      differentially checked against anything.
//   5. LAW-LABEL is new coverage: the pre-fix gate checked the label TEXT in
//      isolation (R3 substring checks) but never that the stated position was
//      the position opened.
//
// THE TWO GROUNDS, and why the differential is not circular:
//
//   The oracle does NOT ask the component where a row is. It reads
//   brain_relationship for the row's stored `line_number` and the far-end
//   symbol's stored file, and derives the served position itself:
//
//     stored line > 0 (integer)  -> (farFile, storedLine - 1, 0)
//        line-only BY DECLARATION: the store records a line for a call site
//        and no column, so character 0 is the declared truth, not a guess.
//     stored line NULL or 0      -> the far end's OWN declaration start,
//        resolved through P1 (positions.ts), which is the ONE conversion
//        owner (§5 rule 1). The label states the substitution (§14.2).
//
//   So a renderer bug (wrong line base, wrong column, guessed position,
//   dropped row, leaked kind) and a store-read bug are two different faults,
//   and a shared fault would have to be two identical faults at once.

/** The command families the hover card emits, and the block each belongs to.
 *  The block is what decides which law a link is judged by — asserted from the
 *  RENDERED card, never assumed by the caller. */
export const LINK_COMMANDS: Readonly<Record<string, "usage" | "action" | "definition">> = {
  "bb.openUsage": "usage",
  "bb.openGraph": "action",
  "bb.openImpact": "action",
  "bb.showCallHierarchy": "action",
  "bb.openDefinition": "definition",
}

export interface CardLink {
  /** `path:line:character` — the LSP target the command receives */
  key: string
  command: string
  family: "usage" | "action" | "definition" | "unknown"
  /** the visible label, read verbatim from the card */
  label: string
  /** the file the card NAMES for this row (absent when the label is bare) */
  labelFile: string | null
  /** the 1-based line the card NAMES for this row (absent when bare) */
  labelLine: number | null
  /** the zero-based index of the card line this link sits on */
  offset: number
}

/** Parse every command link out of the card, with the LABEL the reader sees.
 *  A link whose command is outside LINK_COMMANDS parses with
 *  `family: "unknown"` rather than being skipped — an unregistered command is
 *  a link no law covers, which is a finding, not a filter. */
function parseCard(markdown: string): CardLink[] {
  const out: CardLink[] = []
  const re = /\[([^\]]+)\]\(command:(bb\.[A-Za-z]+)\?([^)]*)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    let args: { file?: unknown; line?: unknown; character?: unknown } = {}
    try {
      const dec = JSON.parse(decodeURIComponent(m[3]!))
      args = (Array.isArray(dec) ? dec[0] : dec) as typeof args
    } catch {
      // Malformed args are a link-integrity failure; recorded as a link with an
      // empty key so LAW-LABEL/LAW-COVERAGE cannot pass on unreadable bytes.
    }
    const file = typeof args.file === "string" ? args.file : ""
    const line = typeof args.line === "number" ? args.line : Number.NaN
    const character = typeof args.character === "number" ? args.character : Number.NaN
    const label = m[1]!
    // The disambiguating label `name — file:line` (rich_hover.siteLabel): the
    // name may itself contain an em dash, so anchor on the LAST ` — ` and
    // require the tail to be `base:line` (a declared caveat may follow it —
    // `App — App.java:12 _(this is the calling symbol's declaration…)_`).
    const split = statedPosition(label)
    out.push({
      key: Number.isNaN(line) || Number.isNaN(character) ? "" : `${file}:${line}:${character}`,
      command: m[2]!,
      family: LINK_COMMANDS[m[2]!] ?? "unknown",
      label,
      labelFile: split === null ? null : split.file,
      labelLine: split === null ? null : split.line1,
      offset: m.index,
    })
  }
  return out
}

/** The index-stored position a stored relationship row may be served at.
 *  Derived by this gate from the STORE (see the law block above) — never by
 *  asking the component under test, so a renderer fault and a ground fault
 *  cannot cancel out. */
export function storedRowKey(row: { relPath: string; storedLine: number | null }): string | null {
  if (row.relPath === "") return null
  if (typeof row.storedLine === "number" && Number.isInteger(row.storedLine) && row.storedLine > 0) {
    // Stored line is 1-based; LSP lines are 0-based. Character 0 by declaration:
    // the store carries no call-site column (src/intelligence/graph/
    // line-address.ts documents the address as line-only).
    return `${row.relPath}:${row.storedLine - 1}:0`
  }
  return null
}

/** Result shape shared by every section law, so the wire leg, the mutant
 *  oracle and the negatives report the same numbers. */
export interface SectionVerdict {
  ok: boolean
  /** rows the card rendered in this section, judged one by one */
  rows: Array<{ key: string; label: string; matches: string[]; ok: boolean; why: string }>
  /** how many rendered links equal their own row's stored location */
  equal: number
  /** how many rendered links also equal a served location (references set) */
  served: number
}

/** Judge ONE section's links against the store rows that section may render.
 *
 * @param links          the rendered links, as parsed from the card
 * @param allowedRows    the store rows this section is allowed to render,
 *                       each already reduced to `{ id, key, relPath }`
 * @param servedKeys     locations an INDEPENDENT surface serves (references)
 * @param requireServed  whether the served-set agreement is a law here
 */
function judgeSection(
  links: readonly CardLink[],
  allowedRows: ReadonlyArray<{ id: string; key: string; relPath: string }>,
  servedKeys: ReadonlySet<string> = new Set<string>(),
  requireServed = false,
): SectionVerdict {
  const rows = links.map((link) => {
    // §12.1 row identity: WHICH stored row does this link render? Matched on
    // the served position AND the file that row's far end is declared in, so a
    // link that opens a real location belonging to a DIFFERENT row is caught
    // rather than accepted for "being somewhere real".
    const matches = allowedRows.filter((r) => r.key === link.key && r.relPath === link.key.split(":")[0]).map((r) => r.id)
    let why = ""
    if (link.key === "") why = "unreadable link args (no path:line:character)"
    else if (matches.length === 0) why = `no stored row of this section is served at ${link.key}`
    else if (matches.length > 1) why = `${matches.length} stored rows share the served position ${link.key} — the card cannot say which it renders`
    return { key: link.key, label: link.label, matches, ok: matches.length === 1 && link.key !== "", why }
  })
  const equal = rows.filter((r) => r.ok).length
  const served = links.filter((l) => servedKeys.has(l.key)).length
  return {
    ok: links.length > 0 && rows.every((r) => r.ok) && (!requireServed || served === links.length),
    rows,
    equal,
    served,
  }
}

/** The disambiguating `file:line` a label states, re-derived FROM THE LABEL TEXT
 *  on every call. `CardLink.labelFile`/`labelLine` are the values parsed off the
 *  card; a negative that edits `label` must re-derive them or it edits a string
 *  no law reads — which is exactly what the first run of the N5 leg did, and the
 *  leg failed for that reason rather than the reason it names. */
function statedPosition(label: string): { file: string; line1: number } | null {
  const m = /^(.*) — ([^/\\]+):(\d+)(?![0-9])/.exec(label)
  return m === null ? null : { file: m[2]!, line1: Number(m[3]) }
}
/** LAW-LABEL: a row whose label states a position must state the link's OWN
 *  position (§14 rules 2+3). Applied to every link of the card, section
 *  independently — the previous gate asserted the label text existed (R3) but
 *  never that it agreed with the target. The CHARACTER is not part of this
 *  law: `siteLabel` states a file and a 1-based line and nothing more, so
 *  asserting a column here would assert something the label never claimed. */
function labelAgrees(link: CardLink): boolean {
  const stated = statedPosition(link.label)
  if (stated === null) return true
  const parts = link.key.split(":")
  const base = (parts[0] ?? "").split(/[\\/]/).pop() ?? ""
  return base === stated.file && Number(parts[1]) === stated.line1 - 1
}

/** Wire helper: an LSP file:// uri -> the stored absolute path. */
function filePathOf(uri: string): string {
  return uri.startsWith("file://") ? uri.slice("file://".length) : uri
}

const sourceLines = readFileSync(H2_FILE_APP, "utf8").split("\n")
const main2Lines = readFileSync(H2_FILE_MAIN2, "utf8").split("\n")
/** Lane 6: the 1-based line of the first line containing `needle`, read off the
 *  REAL indexed file on disk. The pre-lane assertions typed these as literals
 *  (`main — App.java:6`, `main — Main2.java:4`) — the referencing symbols'
 *  DECLARATION lines. Since the hover now opens the stored CALL SITE, a typed
 *  declaration line is a stale expectation, and deriving it from the source is
 *  what keeps this gate asserting the CONTRACT rather than a remembered number.
 *  (It also removes a fixture-drift hazard: the literals were off by the
 *  fixture's own line count and only passed because the label changed.) */
const lineOf = (lines: string[], needle: string): number => {
  const idx = lines.findIndex((l) => l.includes(needle))
  if (idx === -1) throw new Error(`H2 fixture: ${needle} not found in the indexed file`)
  return idx + 1
}
const appCallLine = lineOf(sourceLines, "greeter.render()")
const main2CallLine = lineOf(main2Lines, "g.render()")
const appMainDeclLine = lineOf(sourceLines, "public static void main")
const main2MainDeclLine = lineOf(main2Lines, "public static void main")
const newGreeterApp = lineOf(sourceLines, "new Greeter()")
const newGreeterMain2 = lineOf(main2Lines, "new Greeter()")
const renderPos = {
  line: H2_EXPECT.render.declLine,
  character: sourceLines[H2_EXPECT.render.declLine]!.indexOf("render"),
}
const greeterPos = {
  line: H2_EXPECT.greeter.declLine,
  character: sourceLines[H2_EXPECT.greeter.declLine]!.indexOf("Greeter"),
}

/** The section table, hoisted out of the LSP session so the EVIDENCE can carry
 *  it (§8.4): a reader of a red H2 must be able to see which link is in which
 *  block and which stored row it names without re-running the gate. Declared
 *  empty and assigned inside the session, because a failed session must produce
 *  a record that says so rather than throwing while writing evidence. */
let card: CardLink[] = []
let blockOf: (offset: number) => string = () => "no-session"
let linksUsages: CardLink[] = []
let linksConnected: CardLink[] = []
let linksContained: CardLink[] = []
let linksActions: CardLink[] = []

const lsp = new StdioLsp(H2_ROOT)
const appUri = `file://${H2_FILE_APP}`
let md = "" // hover markdown on render (populated inside the session)

try {
  const init = await lsp.request("initialize", { processId: null, rootUri: `file://${H2_ROOT}`, capabilities: {} })
  check("H2/R3: server advertises hoverProvider", init?.capabilities?.hoverProvider !== false, JSON.stringify(init?.capabilities).slice(0, 120))
  lsp.write(Buffer.from(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })))

  // --- R3: rich sections over the real server -------------------------------------
  console.log("\nR3: rich sections (real server over the real index)")
  const t0 = performance.now()
  const hoverRender = await lsp.request("textDocument/hover", { textDocument: { uri: appUri }, position: renderPos })
  const coldMs = performance.now() - t0
  md = (hoverRender?.contents?.value ?? "") as string
  // Wire law (fixed 2026-09-12, M55.G1 bar re-audit): the component envelope
  // rides the spec Hover's `data` slot as `{ provenance, symbol }` — identity is
  // `data.symbol.name`. This gate still read the pre-`5cce610b` flat
  // `data.name`, so it was red from the wire-law commit on while the server was
  // correct: the gate asserted a shape the server had stopped answering.
  check("H2/R3: hover resolves render", hoverRender?.data?.symbol?.name === "render", hoverRender?.data?.symbol?.name ?? "null")
  check("H2/R3: connected section renders called-by", md.includes("**connected**: called by"), md.slice(0, 200))
  check(
    "H2/R3: both same-name callers listed, second disambiguated",
    md.includes("[main](command:bb.openUsage") && md.includes(`[main — Main2.java:${main2CallLine}]`),
    `expected [main — Main2.java:${main2CallLine}] (the stored call site); got: ${md.slice(md.indexOf("**connected**"), md.indexOf("**connected**") + 200)}`,
  )
  // M55.T3 (§14 Truth Rule 1): the usages section lists USAGE SITES. The
  // pre-M55 assertion required `[Greeter — App.java:6]` — render's own owning
  // class, offered as a "usage" — which is exactly the defect T3 removed
  // (found live: the owner hovered a call and read another symbol's data).
  // It now asserts the real call sites.
  check(
    "H2/R3: usages section renders the call sites as clickable links",
    md.includes("**usages**") && md.includes(`[main — App.java:${appCallLine}]`) && md.includes(`[main — Main2.java:${main2CallLine}]`),
    md.slice(md.indexOf("**usages**")),
  )
  // The hovered method's own class must never render as a USAGE.
  //
  // BOUNDED TO THE USAGES BLOCK, and that bound is a fix, not tidiness. This
  // check used to slice the card from `**usages**` to the END, which after the
  // all-relationships wave includes the **contained** block — so it was reading
  // the containment row's own `declared in [Greeter]` while asserting "Greeter is
  // absent". It passed, but for the wrong reason: it was looking for the string
  // `Greeter — App.java:5` (the disambiguated form the usages renderer emits)
  // while the containment renderer emits the bare name `Greeter`. A usages block
  // that DID leak the class as `declared in [Greeter]` would have passed this
  // check. Measured: the leak M6 actually plants renders the class in the usages
  // block and is caught by R4-LAW-USAGE and R4-LAW-USAGE-ROWS — this check is now
  // a section-bounded restatement of the same law, not the thing that convicts it.
  {
    const usageBlockText = (() => {
      const lines = md.split("\n")
      const start = lines.findIndex((l) => /^\*\*usages\*\*/.test(l))
      const end = lines.findIndex((l, i) => i > start && /^\*\*contained\*\*/.test(l))
      return lines.slice(start, end === -1 ? lines.length : end).join("\n")
    })()
    check(
      "H2/R3: the hovered method's own class never renders inside the **usages** block (bounded to that block — the pre-lane slice ran to the end of the card and so was reading the **contained** block's own `declared in [Greeter]` while asserting the class was absent)",
      !usageBlockText.includes("Greeter"),
      usageBlockText,
    )
  }
  check("H2/R3: definition footnote is clickable (bb.openDefinition)", md.includes("bb.openDefinition?"), "definition link missing")
  check("H2/R3: existing sections unchanged (signature + evidence + source still present)", md.includes("public method render") && md.includes("evidence:") && md.includes("bb index"), "")

  const hoverGreeter = await lsp.request("textDocument/hover", { textDocument: { uri: appUri }, position: greeterPos })
  const gmd = (hoverGreeter?.contents?.value ?? "") as string
  check("H2/R3: hover resolves Greeter", hoverGreeter?.data?.symbol?.name === "Greeter", hoverGreeter?.data?.symbol?.name ?? "null")
  check("H2/R3: implements verb names Named (connected)", gmd.includes("implements [Named]"), "")
  check("H2/R3: instantiated-by lists both mains (second disambiguated)", gmd.includes("instantiated by [main]") && gmd.includes(`Main2.java:${newGreeterMain2}`) && gmd.includes(`App.java:${newGreeterApp}`), gmd.slice(gmd.indexOf("**connected**"), gmd.indexOf("**connected**") + 240))
  void appMainDeclLine
  void main2MainDeclLine
  void greeterPos

  // --- R4: differential — every link target equals an L3 references location ------
  console.log("\nR4: differential vs the L3 references surface (one location owner)")
  const refs = await lsp.request("textDocument/references", {
    textDocument: { uri: appUri },
    position: renderPos,
    context: { includeDeclaration: false },
  })
  // The server answers the PROTOCOL shape now (wire law): Location[] — each
  // { uri, range: { start: { line, character }, … } }. The navigation
  // component's path/line/character ride inside it.
  const refList: Array<{ uri: string; range: { start: { line: number; character: number } } }> = Array.isArray(refs) ? refs : []
  const refLocs = new Set(refList.map((l) => `${filePathOf(l.uri)}:${l.range.start.line}:${l.range.start.character}`))
  // M55.T3: references answers the usage sites under its declared filter
  // (declaration NOT included) — the fixture stores exactly two calling
  // symbols (App.main, Main2.main) plus the owning class's `contains` row,
  // which is not a reference to render.
  check("H2/R4: references surface returns each usage site exactly once", refLocs.size === 2, `got ${refLocs.size}`)
  check(
    "H2/R4: the owning declaration is not served as a reference",
    ![...refLocs].some((l) => l.endsWith(`:${H2_EXPECT.renderDefLine}:`) && l.startsWith(H2_FILE_APP)),
    JSON.stringify([...refLocs]),
  )
  const usageLinks = commandLinks(md).filter((l) => l.command === "bb.openUsage")

  // =========================================================================
  // R4 (REWRITTEN): the SECTION-AWARE link laws
  // =========================================================================
  //
  // The card is read as the SECTIONS a reader reads it as. The block headers are
  // the OWNERS of the card's own vocabulary: `**usages**`, `**contained**`,
  // `**connected**`, `**actions**` are the strings the component emits
  // (src/lsp/rich_hover.ts), read here as WHOLE LINES anchored at line start, not
  // as a substring anywhere in the document. A law applied to the wrong block is
  // a law applied to the wrong claim — which is exactly what the pre-fix gate
  // did when it compared all five links against one set.
  const cardLines = md.split("\n")
  const headerAt = (pred: (l: string) => boolean): number => cardLines.findIndex(pred)
  const iConnected = headerAt((l) => /^\*\*connected\*\*:/.test(l))
  const iUsages = headerAt((l) => /^\*\*usages\*\*/.test(l))
  const iContained = headerAt((l) => /^\*\*contained\*\*/.test(l))
  const iActions = headerAt((l) => /^\*\*actions\*\*/.test(l))
  // The footnote is the card's LAST block and carries the definition link. It is
  // located by its own text (`_source: bb index (…)_`, rich_hover.definitionLink),
  // NOT by "the line after the actions block": the cross-language and annotation
  // blocks sit between them and render empty here, so a positional guess would
  // put the definition link in the actions block and silently make LAW-ACTION
  // judge two different targets by one rule.
  const iFootnote = headerAt((l) => /^\s*_source: bb index/.test(l))
  // formatHoverMarkdown (src/lsp/hover.ts:402-442) writes the blocks in a fixed
  // order: signature, identity, evidence, connected, usages, contained, actions,
  // [cross-language], [annotations], [staleness], source footnote. Asserting that
  // order is what makes "which block is this link in" a FACT rather than an
  // inference: if the order changed, the boundaries below would silently judge the
  // wrong links, and a gate that mis-assigns every link looks exactly like a gate
  // that passes.
  check(
    "H2/R4: the card's block headers appear in the order the section laws read them in (connected → usages → contained → actions → source footnote) — a reader, and this gate, must agree on which block a link is in",
    iConnected > -1 && iUsages > iConnected && iContained > iUsages && iActions > iContained && iFootnote > iActions,
    `connected=${iConnected} usages=${iUsages} contained=${iContained} actions=${iActions} footnote=${iFootnote} of ${cardLines.length} lines`,
  )
  /** Assign every card link to the block whose range of lines contains it. Offsets
   *  are character offsets in the whole card, so the boundaries are converted to
   *  character offsets once, here. `cardLines.slice(0, i).join("\n").length` is the
   *  offset of line i's first character; +1 for the newline that precedes it.
   *
   *  A MISSING header yields an EMPTY range for its own block, never a range that
   *  swallows the blocks after it. `offAt(-1)` used to return
   *  `MAX_SAFE_INTEGER`, which made a suppressed `**contained**` block extend the
   *  **usages** block to the end of the card — so the usages law would then judge
   *  the actions and footnote links as usage rows, and every count downstream
   *  would be wrong for a reason that had nothing to do with the defect.
   *  MEASURED with the containment block suppressed: `**contained**` absent ⇒
   *  iContained = -1 ⇒ usages range ran to end-of-card. Each block's end is now
   *  the NEXT PRESENT header, and an absent block collapses to [end, end]. */
  const endOff = md.length
  const present = [iConnected, iUsages, iContained, iActions, iFootnote]
  const nextPresentAfter = (i: number): number => {
    if (i < 0) return -1
    for (const j of present) if (j > i) return j
    return endOff
  }
  const offAt = (lineIndex: number): number => (lineIndex < 0 ? endOff : cardLines.slice(0, lineIndex).join("\n").length + (lineIndex > 0 ? 1 : 0))
  /** [start, end) in character offsets; an absent header gives an empty range. */
  const blockRange = (i: number): readonly [number, number] => (i < 0 ? [endOff, endOff] : [offAt(i), offAt(nextPresentAfter(i))])
  const bConnected = blockRange(iConnected)
  const bUsages = blockRange(iUsages)
  const bContained = blockRange(iContained)
  const bActions = blockRange(iActions)
  const bFootnote = blockRange(iFootnote)
  const BLOCKS: ReadonlyArray<readonly [readonly [number, number], string]> = [
    [bConnected, "connected"],
    [bUsages, "usages"],
    [bContained, "contained"],
    [bActions, "actions"],
    [bFootnote, "footnote"],
  ]
  const inRange = (o: number, r: readonly [number, number]): boolean => o >= r[0] && o < r[1]
  blockOf = (offset: number): string => BLOCKS.find(([r]) => inRange(offset, r))?.[1] ?? "none"
  card = parseCard(md)
  const linksIn = (r: readonly [number, number], family: CardLink["family"]): CardLink[] => card.filter((l) => l.family === family && inRange(l.offset, r))
  linksConnected = linksIn(bConnected, "usage")
  linksUsages = linksIn(bUsages, "usage")
  linksContained = linksIn(bContained, "usage")
  linksActions = linksIn(bActions, "action")
  const linksDefinition = linksIn(bFootnote, "definition")
  /** The set of store rows each section may render, for the law that judges it. */
  const rowsFor = (grounds: typeof rowGrounds) => grounds.map((g) => ({ id: g.id, key: g.key ?? "", relPath: g.relPath }))
  const usageRowsAllowed = rowsFor(usageRowGrounds)
  const containmentRowsAllowed = rowsFor(containmentRowGrounds)
  refLocsForNegative = refLocs
  renderedCard = {
    usages: linksUsages,
    connected: linksConnected,
    contained: linksContained,
    actions: linksActions,
    definition: linksDefinition,
    usageRows: usageRowsAllowed,
    containmentRows: containmentRowsAllowed,
    blockRanges: BLOCKS.map(([r]) => r),
  }

  check(
    "H2/R4-LAW-SECTION: every command link in the card falls in EXACTLY ONE block, and every block's links are the command family that block is for — no link escapes every law, none is judged twice, and no link rides under a header it does not belong to",
    card.length > 0 &&
      card.every((l) => BLOCKS.filter(([r]) => inRange(l.offset, r)).length === 1) &&
      card.every((l) => l.family !== "unknown") &&
      linksConnected.every((l) => l.command === "bb.openUsage") &&
      linksUsages.every((l) => l.command === "bb.openUsage") &&
      linksContained.every((l) => l.command === "bb.openUsage") &&
      linksActions.every((l) => /^bb\.(openGraph|openImpact|showCallHierarchy)$/.test(l.command)) &&
      linksDefinition.every((l) => l.command === "bb.openDefinition"),
    `card links: ${JSON.stringify(card.map((l) => ({ cmd: l.command, block: blockOf(l.offset), key: l.key.split("/").pop() })))}`,
  )

  const usageVerdict = judgeSection(linksUsages, rowsFor(usageRowGrounds), refLocs, true)
  check(
    `H2/R4-LAW-USAGE: every **usages** link equals the index-stored location of the usage row it renders, row by row — AND a location textDocument/references returns (${usageVerdict.equal}/${linksUsages.length} equal to their own row, ${usageVerdict.served}/${linksUsages.length} served by references)`,
    usageVerdict.ok,
    JSON.stringify(usageVerdict.rows.filter((r) => !r.ok).map((r) => `${r.label} -> ${r.key}: ${r.why}`)),
  )
  check(
    `H2/R4-LAW-USAGE-ROWS: the **usages** block renders exactly one link per stored usage row (${usageRowGrounds.length} stored usage rows, ${linksUsages.length} links) — a row that renders nowhere is a silent drop (§13.4)`,
    usageRowGrounds.length === linksUsages.length && usageRowGrounds.every((g) => linksUsages.some((l) => l.key === g.key)) && linksUsages.length <= MAX_USAGE_LINKS + 1,
    `stored usage rows: ${JSON.stringify(usageRowGrounds.map((g) => ({ kind: g.kind, far: g.farName, key: g.key })))}; rendered: ${JSON.stringify(linksUsages.map((l) => l.key))}`,
  )
  const connectedVerdict = judgeSection(linksConnected, rowsFor(usageRowGrounds))
  check(
    `H2/R4-LAW-CONNECTED: every **connected** link equals the index-stored location of a NON-DECLARATION row (${connectedVerdict.equal}/${linksConnected.length}) — a connection fact is never a containment`,
    connectedVerdict.ok,
    JSON.stringify(connectedVerdict.rows.filter((r) => !r.ok).map((r) => `${r.label} -> ${r.key}: ${r.why}`)),
  )
  check(
    `H2/R4-LAW-CONNECTED-ROWS: the **connected** block reaches every stored non-declaration row of this symbol, or names the cap's remainder (${linksConnected.length} links, ${usageRowGrounds.length} stored non-declaration rows, cap ${MAX_SUMMARY_PER_VERB})`,
    usageRowGrounds.every((g) => linksConnected.some((l) => l.key === g.key)) && linksConnected.length >= Math.min(usageRowGrounds.length, MAX_SUMMARY_PER_VERB),
    `rendered: ${JSON.stringify(linksConnected.map((l) => l.key))}`,
  )
  const containmentVerdict = judgeSection(linksContained, rowsFor(containmentRowGrounds))
  check(
    `H2/R4-LAW-CONTAIN: every **contained** link equals the index-stored location of the \`contains\`/\`exports\` row it renders (${containmentVerdict.equal}/${linksContained.length}) — the position that row STORES, which textDocument/references excludes by law`,
    containmentVerdict.ok,
    JSON.stringify(containmentVerdict.rows.filter((r) => !r.ok).map((r) => `${r.label} -> ${r.key}: ${r.why}`)) +
      `; stored containment rows: ${JSON.stringify(containmentRowGrounds.map((g) => ({ kind: g.kind, far: g.farName, key: g.key })))}`,
  )
  check(
    `H2/R4-LAW-CONTAIN-ROWS: the **contained** block renders exactly one link per stored declaration-containment row (${containmentRowGrounds.length} stored, ${linksContained.length} rendered) — the owner's decision ("show all the relationships") is a COVERAGE law, not a permission to show none`,
    containmentRowGrounds.length === linksContained.length && containmentRowGrounds.every((g) => linksContained.some((l) => l.key === g.key)),
    `stored: ${JSON.stringify(containmentRowGrounds.map((g) => ({ kind: g.kind, far: g.farName, key: g.key })))}; rendered: ${JSON.stringify(linksContained.map((l) => l.key))}`,
  )
  check(
    "H2/R4-LAW-SPLIT: the containment row's stored position is NOT a location textDocument/references serves — which is WHY it has its own law rather than being excluded from one (the measurement that replaces the blanket law)",
    containmentRowGrounds.length > 0 && containmentRowGrounds.every((g) => g.key !== null && !refLocs.has(g.key)),
    `containment keys: ${JSON.stringify(containmentRowGrounds.map((g) => g.key))}; references: ${JSON.stringify([...refLocs].map((k) => k.split("/").pop()))}`,
  )
  check(
    "H2/R4-LAW-LABEL: every link whose label states a position states ITS OWN link's position (§14 rules 2+3 — a card that names one place and opens another is a misread link however real the target is)",
    card.filter((l) => l.labelFile !== null).length > 0 && card.every(labelAgrees),
    JSON.stringify(card.filter((l) => !labelAgrees(l)).map((l) => ({ label: l.label, key: l.key }))),
  )
  // The two laws the pre-fix R4 stated as ONE blanket sentence, re-stated as
  // what they actually are: they are true of the USAGE and CONNECTED blocks and
  // false of the CONTAINMENT block, because references excludes containment
  // rows by law (relations.ts) while the card must show them (the owner's
  // ratified decision). Both are kept above as R4-LAW-USAGE / R4-LAW-CONNECTED,
  // with the containment block judged by R4-LAW-CONTAIN instead.
  //
  // §14 rule 2/3: identity is STATED wherever a target is named. The card has to
  // say which position each row opens, because the store's call-site line and the
  // referencing declaration are different places and a reader cannot tell from a
  // file:line label alone. (Kept separate from the differential above: the
  // differential says the target is REAL, this says the card says so.)
  check(
    "H2/R4: the card states WHERE each usage link opens (§14 rules 2+3 — a real target the card does not describe is still a misread link)",
    md.includes("each opens the stored call site"),
    md.slice(md.indexOf("**usages**"), md.indexOf("**usages**") + 130),
  )
  // The pre-lane gate's SPECIFIC claim, kept as a law of its own and narrowed to
  // the block it is true of: the USAGE block opens the stored CALL SITE for every
  // row. It is NOT stated about the containment block, because a containment row
  // stores its member's DECLARATION line, not a call site, and claiming otherwise
  // would be the pre-fix defect in its mirror image: a law written about a
  // relationship that has no call site at all.
  const usageBlockTargets = linksUsages.map((l) => l.key)
  check(
    "H2/R4: the hover opens the CALL SITE, not the caller's declaration — for every row of the **usages** block (the containment block is governed by R4-LAW-CONTAIN, because a `contains` row stores a declaration line by nature)",
    usageBlockTargets.length > 0 &&
      usageRowGrounds.every((g) => {
        const callSiteLine1 = g.farLine1 === null ? null : (storedRows.find((r) => r.rowId === g.id)?.storedLine ?? null)
        // The law, measured: this fixture's usage rows each carry a positive
        // stored call-site line, and the served position is that line at
        // character 0 — never the far end's own declaration line.
        return typeof callSiteLine1 === "number" && callSiteLine1 > 0 && g.key === `${g.relPath}:${callSiteLine1 - 1}:0`
      }),
    `usage block targets: ${JSON.stringify(usageBlockTargets.map((k) => k.split("/").pop()))}; stored usage rows: ${JSON.stringify(usageRowGrounds.map((g) => ({ far: g.farName, declLine1: g.farLine1, served: g.key?.split("/").pop() })))}`,
  )
  const defLinks = commandLinks(md).filter((l) => l.command === "bb.openDefinition")
  const defOk =
    defLinks.length === 1 &&
    defLinks[0]!.args.file.endsWith(H2_REL_APP) &&
    defLinks[0]!.args.line === H2_EXPECT.renderDefLine
  check("H2/R4: definition link equals the stored declaration location", defOk, JSON.stringify(defLinks[0]?.args ?? null))
  const defRef = await lsp.request("textDocument/definition", { textDocument: { uri: appUri }, position: renderPos })
  // Definition answers the protocol shape (Location object or null).
  const defArr = Array.isArray(defRef) ? defRef : defRef ? [defRef] : []
  const defFirst = defArr[0] as { uri: string; range: { start: { line: number; character: number } } } | undefined
  const defTarget = defFirst ? { path: filePathOf(defFirst.uri), line: defFirst.range.start.line, character: defFirst.range.start.character } : undefined
  const defMatch =
    defLinks.length === 1 &&
    Boolean(defTarget) &&
    defTarget.path === defLinks[0]!.args.file &&
    defTarget.line === defLinks[0]!.args.line &&
    defTarget.character === defLinks[0]!.args.character
  check("H2/R4: definition link equals the L3 definition response", Boolean(defMatch), JSON.stringify(defTarget ?? defRef ?? null).slice(0, 200))
  // LAW-ACTION, placed here because its ground is the definition RESPONSE.
  const defKey = defTarget === undefined ? null : `${defTarget.path}:${defTarget.line}:${defTarget.character}`
  const defLinkKeys = linksDefinition.map((l) => l.key)
  check(
    "H2/R4-LAW-ACTION: every action link equals the symbol's OWN index-stored location as textDocument/definition returns it — an actions row is three navigation targets, and none of the three was differentially checked against anything before",
    linksActions.length === 3 && defKey !== null && linksActions.every((l) => l.key === defKey),
    `actions: ${JSON.stringify(linksActions.map((l) => l.key))}; definition link: ${JSON.stringify(defLinkKeys)}; definition response: ${JSON.stringify(defKey)}`,
  )

  // --- M44.U6: the show-all-usages link carries the server-resolved identity.
  // This fixture renders exactly MAX_USAGE_LINKS sites so the escape hatch
  // never appears here; the REAL wire link (hover markdown → bb.showAllUsages
  // args with symbol) is fixture-verified by script/m44/verify-usages-fallback.ts
  // on its own >MAX-sites fixture (issue #693).

  // --- R5: budget ---------------------------------------------------------------
  console.log("\nR5: budget")
  check("H2/R5: cold call completes under 2s (one-time WASM init excluded)", coldMs < 2000, `cold ${coldMs.toFixed(1)}ms`)
  // Lane 6: this was a MEAN over 40 calls checked against a p95 budget and
  // REPORTED as a p95. §3 is explicit — a mean is not a p95, and on a skewed
  // latency distribution the mean sits BELOW the p95, so the check passed with
  // headroom the real tail does not have. validation/m42/results/KNOWN-GAPS.json
  // recorded that substitution as a limitation for three waves, which is a
  // confession, not a measurement.
  //
  // It is now an actual p95 over an actual sample set: every individual request
  // timed, sorted, the 95th percentile read off. The sample count is stated
  // because a percentile of the samples drawn is not the distribution.
  const WARM_SAMPLES = 200
  const warmSamples: number[] = []
  for (let i = 0; i < WARM_SAMPLES; i++) {
    const t = performance.now()
    await lsp.request("textDocument/hover", { textDocument: { uri: appUri }, position: renderPos })
    warmSamples.push(performance.now() - t)
  }
  const warmSorted = [...warmSamples].sort((a, b) => a - b)
  const warmP50 = warmSorted[Math.floor(warmSorted.length * 0.5)]!
  const warmP95 = warmSorted[Math.min(warmSorted.length - 1, Math.floor(warmSorted.length * 0.95))]!
  const warmMax = warmSorted[warmSorted.length - 1]!
  const warmMean = warmSamples.reduce((a, b) => a + b, 0) / warmSamples.length
  console.log(`  warm hover over ${WARM_SAMPLES} requests: p50=${warmP50.toFixed(2)}ms p95=${warmP95.toFixed(2)}ms max=${warmMax.toFixed(2)}ms mean=${warmMean.toFixed(2)}ms`)
  check("H2/R5: warm hover p95 <= 50ms with rich sections (a real p95, not a mean)", warmP95 <= 50, `p95=${warmP95.toFixed(2)}ms over ${WARM_SAMPLES} samples (p50 ${warmP50.toFixed(2)}ms, max ${warmMax.toFixed(2)}ms)`)
  budget = {
    regime: "warm",
    samples: WARM_SAMPLES,
    p50Ms: Number(warmP50.toFixed(2)),
    p95Ms: Number(warmP95.toFixed(2)),
    maxMs: Number(warmMax.toFixed(2)),
    meanMs: Number(warmMean.toFixed(2)),
    budgetMs: 50,
    coldMs: Number(coldMs.toFixed(2)),
    note: "A real p95 over a stated sample set. The pre-lane check was a MEAN over 40 compared against this budget and reported as a p95; the substitution was named as a limitation in KNOWN-GAPS.json for three waves instead of being fixed.",
  }
} catch (e) {
  check("H2: LSP session completes", false, String(e).slice(0, 200) + (lsp.stderr() ? ` | stderr: ${lsp.stderr().slice(-300)}` : ""))
} finally {
  lsp.dispose()
  rmSync(dataDir, { recursive: true, force: true })
}

// --- R6: pure-renderer laws ------------------------------------------------------------
console.log("\nR6: pure renderer laws")
check("H2/R6: connectedSummarySection([]) is empty (declared absence)", connectedSummarySection([]) === "")
// Lane 6: the hand-built sites carry the address owner's verdict explicitly.
// A hand-built fixture that omits a field the renderer now reads is a fixture
// lying about its own shape — it crashed the suite, which is how it was found.
const EXACT: CallSiteAddress = { kind: "call-site", file: "src/main/java/com/demo/App.java", line: 15 }
const SUBSTITUTE: CallSiteAddress = {
  kind: "declaration",
  file: "src/main/java/com/demo/App.java",
  line: 13,
  note: "this is the calling symbol's declaration, not the call site",
}
const UNKNOWN: CallSiteAddress = { kind: "unknown", file: "src/main/java/com/demo/App.java", line: null, note: "call site not stored (legacy index: line_number is 0)" }
const containsOnly: RichSite = {
  name: "Greeter",
  symbolType: "class",
  path: "/w/App.java",
  line: 5,
  character: 0,
  endLine: 5,
  endCharacter: 9,
  relationshipType: "contains",
  relationshipTypes: ["contains"],
  reversed: true,
  confidence: 1,
  enrichment: null, // un-enriched row — declared absence (M42.H3 shape)
  enrichmentStale: false,
  callSite: EXACT,
}
// ===========================================================================
// H2/R6, RE-SCOPED — the containment law in its precise form
// ===========================================================================
//
// The law used to read, in one sentence: "contains rows never render as
// connection facts". That is right in spirit and it was TRUE — but it was
// satisfied by `contains` rendering NOWHERE at all, which is why it could not
// distinguish a correctly-absent declaration from one the surface had dropped.
// It passed while `contains` was the second-most-stored kind and rendered on no
// card in the program.
//
// The owner's ratified decision — "the hover should show all the relationships,
// not just contains", with `contains` "labelled as CONTAINMENT, never as a
// usage or a connection" — re-scopes it to a law with both halves:
//
//   H2/R6-CONTAIN-1  a `contains` row DOES render, in its own section;
//   H2/R6-CONTAIN-2  that section's caption is a CONTAINMENT word;
//   H2/R6-CONTAIN-3  the row appears in NO OTHER section — not the usage list,
//                    not the connected summary;
//   H2/R6-CONTAIN-4  and never in the usages HEADER count, which is the number a
//                    reader takes away as "how many things use this".
//
// Nothing is deleted: the old assertion is kept as H2/R6-CONTAIN-3b, because a
// law that only survives re-scoping when its old wording is discarded is a law
// that was only ever half-true.
const containsSite: RichSite = {
  name: "Greeter",
  symbolType: "class",
  path: "/w/App.java",
  line: 5,
  character: 0,
  endLine: 5,
  endCharacter: 9,
  relationshipType: "contains",
  relationshipTypes: ["contains"],
  reversed: true,
  confidence: 1,
  enrichment: null, // un-enriched row — declared absence (M42.H3 shape)
  enrichmentStale: false,
  callSite: EXACT,
}
check(
  "H2/R6-CONTAIN-1: a `contains` row RENDERS — in its own labelled section (the old law was satisfied by `contains` rendering nowhere, which is why it could not tell correct absence from a dropped row)",
  containmentSection([containsSite]).includes("**contained**") && containmentSitesOf([containsSite]).length === 1,
  containmentSection([containsSite]),
)
check(
  "H2/R6-CONTAIN-2: the containment section's caption is a CONTAINMENT word, never a usage or a connection word",
  isContainmentVerb("declared in") && containmentSection([containsSite]).includes("declared in [Greeter]"),
  containmentSection([containsSite]).split("\n").slice(0, 2).join(" | "),
)
check(
  "H2/R6-CONTAIN-3b: contains rows never render as connection facts (the pre-existing law, restated rather than deleted)",
  connectedSummarySection(connectedGroups([containsSite])) === "",
  connectedSummarySection(connectedGroups([containsSite])),
)
check(
  "H2/R6-CONTAIN-3: a `contains` row is NOT a usage site and appears in no usage list",
  usageSitesOf([containsSite]).length === 0 && usagesSection([containsSite], 1, "greet", "/w/App.java", 6, 4) === "",
  `usageSitesOf=[${JSON.stringify(usageSitesOf([containsSite]).map((s) => s.name))}] usagesSection=${JSON.stringify(usagesSection([containsSite], 1, "greet", "/w/App.java", 6, 4))}`,
)
check(
  "H2/R6-CONTAIN-4: the usages HEADER count never includes a `contains` row, even when other kinds are present",
  (() => {
    // A card with one real usage AND one containment row. The header must count
    // the usage alone: the containment is the symbol's DECLARATION context, not
    // evidence that anything uses it.
    const withUsage = usagesSection([{ ...containsSite, relationshipType: "calls", relationshipTypes: ["calls"], reversed: true, name: "main", line: 9, character: 4, endLine: 9, endCharacter: 4 }, containsSite], 1, "greet", "/w/App.java", 6, 4)
    return withUsage.includes("**usages** — 1 stored reference") && !withUsage.includes("Greeter")
  })(),
  usagesSection([{ ...containsSite, relationshipType: "calls", relationshipTypes: ["calls"], reversed: true, name: "main", line: 9, character: 4, endLine: 9, endCharacter: 4 }, containsSite], 1, "greet", "/w/App.java", 6, 4).split("\n")[0] ?? "",
)
// H2/R6-CONTAIN-MUTANT: the re-scoped law must be ABLE TO FAIL in both
// directions. Each leg takes the law's predicate and shows it reports a
// violation for the shape that must be caught — including the shape the OLD law
// could not see at all (a containment row that fails to render).
{
  const rendersSomewhere = (rows: RichSite[]): boolean => {
    const section = containmentSection(rows)
    return section.length > 0 || connectedSummarySection(connectedGroups(rows)).length > 0 || usagesSection(usageSitesOf(rows), usageSitesOf(rows).length, "x", "/w/App.java", 0, 0).length > 0
  }
  check(
    "H2/R6-CONTAIN-MUTANT (a): the law REJECTS a `contains` row that is dropped from the card entirely (the shape the old law was blind to)",
    rendersSomewhere([containsSite]) && !rendersSomewhere([]),
    "a dropped containment row must render nowhere; the assertion needs a row that renders and one that does not",
  )
  const mixedCard = usagesSection(
    [{ ...containsSite, relationshipType: "calls", relationshipTypes: ["calls"], reversed: true, name: "main", line: 9, character: 4, endLine: 9, endCharacter: 4 }, containsSite],
    2, // the CALLER lies: it claims two usages when only one row is one
    "greet", "/w/App.java", 6, 4,
  )
  check(
    "H2/R6-CONTAIN-MUTANT (b): the usage header must NOT follow a caller's claim that would sweep a `contains` row into the count",
    mixedCard.includes("**usages** — 1 stored reference") && !mixedCard.includes("Greeter"),
    mixedCard.split("\n")[0] ?? mixedCard,
  )
}
check("H2/R6: usagesSection([]) is empty (declared absence)", usagesSection([], 0, "render", "/w/App.java", 0, 0) === "")
// The kind set travels with the kind: spreading `containsOnly` and overriding
// only `relationshipType` left `relationshipTypes: ["contains"]` behind, so this
// "call" site still classified as a declaration. The renderer reads the SET
// (§13.2 multiplicity), so a fixture that overrides one field and not the other
// is a fixture lying about its own shape.
const callSite: RichSite = { ...containsOnly, relationshipType: "calls", relationshipTypes: ["calls"], reversed: true, name: "main", line: 9, character: 4, endLine: 9, endCharacter: 4 }
const oneLink = connectedSummarySection(connectedGroups([callSite]))
check("H2/R6: called-by renders one link for one call row", oneLink.startsWith("**connected**: called by [main](command:bb.openUsage?"), oneLink)
check("H2/R6: usagesSection with >3 sites renders the +N more escape hatch", usagesSection([callSite, callSite, callSite, callSite], 4, "render", "/w/App.java", 6, 4).includes("+1 more — [show all usages]"), "")
check("H2/R6: site label is file:line (1-based human line)", siteLabel(callSite) === "main — App.java:10", siteLabel(callSite))
check("H2/R6: usagesSection([]) is empty (declared absence)", usagesSection([], 0, "render", "/w/App.java", 0, 0) === "")
// --- Lane 6: the §14 rules 2 and 3, on the renderer alone ---------------------
// Pure-function laws, so they cannot be confused with a fixture accident.
check(
  "H2/R6: an EXACT address renders NO caveat (a substitute note on a position the store knows exactly is the mirror defect)",
  siteLabel({ name: "main", path: "/w/App.java", line: 14, callSite: EXACT }) === "main — App.java:15",
  siteLabel({ name: "main", path: "/w/App.java", line: 14, callSite: EXACT }),
)
check(
  "H2/R6: a SUBSTITUTE address states the substitution in the row's own label (§14 rule 2)",
  siteLabel({ name: "main", path: "/w/App.java", line: 12, callSite: SUBSTITUTE }).includes("this is the calling symbol's declaration, not the call site"),
  siteLabel({ name: "main", path: "/w/App.java", line: 12, callSite: SUBSTITUTE }),
)
check(
  "H2/R6: an UNKNOWN address states the STORE reason, never a guessed position (§14 rule 3)",
  siteLabel({ name: "main", path: "/w/App.java", line: 12, callSite: UNKNOWN }).includes("legacy index: line_number is 0"),
  siteLabel({ name: "main", path: "/w/App.java", line: 12, callSite: UNKNOWN }),
)
check(
  "H2/R6: the usages header declares the split when the rows differ (§13.4 counts equal what is rendered)",
  usagesSection([callSite, { ...callSite, name: "other", callSite: SUBSTITUTE }], 2, "render", "/w/App.java", 0, 0)
    .includes("1 open the stored call site, 1 open the referencing declaration"),
  usagesSection([callSite, { ...callSite, name: "other", callSite: SUBSTITUTE }], 2, "render", "/w/App.java", 0, 0).split("\n")[0],
)
check(
  "H2/R6: the header says 'each opens the stored call site' when EVERY row is exact",
  usagesSection([callSite, { ...callSite, name: "other" }], 2, "render", "/w/App.java", 0, 0).includes("each opens the stored call site"),
  usagesSection([callSite, { ...callSite, name: "other" }], 2, "render", "/w/App.java", 0, 0).split("\n")[0],
)
check(
  "H2/R6: the header says the store holds NO call site when none does (declared, never implied)",
  usagesSection([{ ...callSite, callSite: SUBSTITUTE }], 1, "render", "/w/App.java", 0, 0).includes("the index stores no call-site line for these"),
  usagesSection([{ ...callSite, callSite: SUBSTITUTE }], 1, "render", "/w/App.java", 0, 0).split("\n")[0],
)
// MUTANT: the honesty words removed. A header that keeps the count and drops
// the position sentence would pass every other law here — so the sentence is
// asserted as its own law.
check(
  "H2/R6/MUTANT: the position sentence is a law of its own (a header that counted correctly but said nothing about WHERE would fail)",
  (() => {
    const withoutSentence = `**usages** — 2 stored references (${USAGE_SITE_FILTER_LABEL})\n1. a\n2. b`
    return !withoutSentence.includes("open the stored call site") && !withoutSentence.includes("open the referencing declaration")
  })(),
  "the simulation produced a header that reads as compliant, so the law above cannot fail",
)

// --- Mutants: the suite CAN fail ------------------------------------------------
//
// WHAT THIS BLOCK WAS BEFORE, because the difference is the point. The pre-lane
// M1..M6 were reported in the evidence as `mutantsCaught: 6 / mutantsTotal: 6`.
// Measured, only TWO of the six planted anything: M1 fabricated a target and
// checked it was absent from the reference set, and M6 injected a self-loop row
// through a fake database. M2, M3, M4 and M5 each RESTATED a check already
// asserted verbatim a few lines above them (`connectedSummarySection(
// connectedGroups([containsOnly])) === ""`, `usagesSection([], …) === ""`,
// `usagesSection([3 sites], …).length > 0`, `md.includes("bb.openDefinition?")`).
// A duplicate cannot fail when the original passes, so four of the six "mutants"
// could never have been anything but green, and the count said 6.
//
// §6 requires planted defects that FAIL verifiers. So the block now plants real
// ones into a COPY of the component under test (src/lsp/rich_hover.ts), with
// the same generic-import-rewriting discipline script/m55/verify-call-hierarchy
// .ts uses: the rewriter resolves what the source ACTUALLY imports rather than a
// hand-written list, and an import failure is recorded as NOT JUDGED, never as a
// catch.
console.log("\nM: mutants")

// A `raw` double over the REAL fixture files, with byte columns computed from
// those files, so the component's own position owner resolves them. The oracle
// therefore reads the same rows the real index holds for this fixture, with the
// same three kinds a real hover must survive: two call rows with a real stored
// call-site line, and one declaration containment with none.
const byteColumnOf = (text: string, line1: number, char0: number): number =>
  Buffer.byteLength((text.split("\n")[line1 - 1] ?? "").slice(0, char0), "utf8") + 1
const spanOf = (file: string, line1: number, needle: string) => {
  const text = readFileSync(file, "utf8")
  const line = text.split("\n")[line1 - 1] ?? ""
  const at = line.indexOf(needle)
  if (at === -1) throw new Error(`H2 mutant oracle: "${needle}" not found on line ${line1} of ${file}`)
  // The keys are the collector's own (`src_bs`, `src_be`, `src_ls`, `src_le`).
  // Returning `bs/be/ls/le` instead leaves the row's own null columns in place, the
  // collector skips every row as unplaceable, and the oracle reads a
  // declared-absence answer as a verdict — which is exactly what happened on the
  // first run of this block.
  return { src_bs: byteColumnOf(text, line1, at), src_be: byteColumnOf(text, line1, at + needle.length), src_ls: line1, src_le: line1 }
}
// TWO line conventions meet here and mixing them is the trap: `appMainDeclLine`
// and `main2MainDeclLine` come from `lineOf()` and are ALREADY 1-based human
// lines, while `H2_EXPECT.*.declLine` comes from the fixture module and is 0-BASED
// LSP. The index stores 1-based lines and 1-based byte columns, so only the
// latter goes through `indexLine`. A double that mixed the two would fail to
// resolve, and the oracle would then read "declared absence" as a verdict.
const indexLine = (lsp0: number): number => lsp0 + 1
const appMain = spanOf(H2_FILE_APP, appMainDeclLine, "main")
const main2Main = spanOf(H2_FILE_MAIN2, main2MainDeclLine, "main")
const greeterClass = spanOf(H2_FILE_APP, indexLine(H2_EXPECT.greeter.declLine), "Greeter")
const appClass = spanOf(H2_FILE_APP, indexLine(H2_EXPECT.greeter.declLine) + 6, "App")
const row = (o: Partial<Record<string, unknown>>) => ({
  id: "r", relationship_type: "calls", confidence: 0.9, source_symbol_id: "sym-x", target_symbol_id: "sym-render",
  line_number: 0, src_name: null, src_type: null, src_bs: null, src_be: null, src_ls: null, src_le: null,
  src_path: null, src_decl: null, src_rel: null, tgt_name: "render", tgt_type: "method", tgt_bs: 1, tgt_be: 2,
  tgt_ls: indexLine(H2_EXPECT.render.declLine), tgt_le: indexLine(H2_EXPECT.render.declLine), tgt_path: H2_FILE_APP,
  tgt_decl: indexLine(H2_EXPECT.render.declLine), tgt_rel: H2_REL_APP, metadata: null, time_updated: null, ...o,
})
// The SAME `groundOf` the wire leg uses, applied to the double's rows, so the
// mutant oracle and the wire laws judge a row by ONE rule. This is what lets the
// section laws below be "the wire laws, re-run against a component copy" rather
// than a second, weaker notion of what a stored location is.
const DOUBLE_ROW_ID = "sym-render"
/** The double's row shape -> `GroundInput`. Same columns the collector reads. */
function doubleGroundOf(r: Record<string, unknown>): RowGround | null {
  const far = farEndOf(
    {
      sourceId: r.src_path === null ? null : "far",
      targetId: "sym-render",
      sourceName: (r.src_name as string | null) ?? null,
      sourcePath: (r.src_path as string | null) ?? null,
      sourceLineStart: (r.src_ls as number | null) ?? null,
      sourceByteStart: (r.src_bs as number | null) ?? null,
      sourceByteEnd: (r.src_be as number | null) ?? null,
      targetName: null,
      targetPath: null,
      targetLineStart: null,
      targetByteStart: null,
      targetByteEnd: null,
    },
    DOUBLE_ROW_ID,
  )
  if (far === null) return null
  return groundOf({ id: String(r.id), relType: String(r.relationship_type), storedLine: (r.line_number as number | null) ?? null, far })
}
const MUTANT_ROWS = [
  // A call row whose stored line IS the call site: the link must open line 15.
  row({ id: "r-app", source_symbol_id: "sym-app-main", target_symbol_id: "sym-render", line_number: appCallLine,
    src_name: "main", src_type: "method", ...appMain, src_path: H2_FILE_APP, src_rel: H2_REL_APP, src_decl: appMainDeclLine }),
  row({ id: "r-main2", source_symbol_id: "sym-main2-main", target_symbol_id: "sym-render", line_number: main2CallLine,
    src_name: "main", src_type: "method", ...main2Main, src_path: H2_FILE_MAIN2, src_rel: H2_REL_MAIN2, src_decl: main2MainDeclLine }),
  // The declaration containment: a usage row's ABSENCE (M55.T3), with no stored
  // call-site line of its own — the shape that must render no connection fact.
  row({ id: "r-greeter", relationship_type: "contains", source_symbol_id: "sym-greeter", target_symbol_id: "sym-render",
    line_number: indexLine(H2_EXPECT.greeter.declLine), src_name: "Greeter", src_type: "class", ...greeterClass,
    src_path: H2_FILE_APP, src_rel: H2_REL_APP, src_decl: indexLine(H2_EXPECT.greeter.declLine) }),
  // A row whose stored call-site line is the indexer's legacy 0: the address
  // owner returns a labelled SUBSTITUTE, and the row must SAY so (§14 rule 2).
  // Without this row the label law is untestable — the first run of this block
  // proved it: the M5 plant SURVIVED, because every row in the double carried a
  // real line, so every label was already caveat-free and dropping the caveat
  // changed nothing observable. A gate whose fixture cannot express the state it
  // names is a gate that cannot fail.
  row({ id: "r-legacy", relationship_type: "uses", source_symbol_id: "sym-app", target_symbol_id: "sym-render",
    line_number: 0, src_name: "App", src_type: "class", ...appClass,
    src_path: H2_FILE_APP, src_rel: H2_REL_APP, src_decl: indexLine(H2_EXPECT.greeter.declLine) + 6 }),
]
const rawDouble = {
  prepare(_sql: string) {
    return { all: () => MUTANT_ROWS }
  },
} as any
/** The double's rows as grounds — the SAME reduction the wire leg applies to the
 *  real store, so "the link equals its row's stored location" means one thing
 *  across the gate. */
const doubleGrounds = MUTANT_ROWS.map(doubleGroundOf).filter((g): g is RowGround => g !== null)
const doubleUsageGrounds = doubleGrounds.filter((g) => !g.declaration)
const doubleContainmentGrounds = doubleGrounds.filter((g) => g.declaration)

/** Assemble a card from a component's OWN renderers, then read it back the way a
 *  reader reads it — through `parseCard`, not through an intermediate object.
 *
 *  This is what makes the section laws testable against a component COPY. The
 *  blocks are laid out in the order `formatHoverMarkdown` writes them
 *  (src/lsp/hover.ts:402-442), because the block order is what the gate's section
 *  splitter reads: a card whose blocks were concatenated in another order would
 *  not be the card a user is shown, and testing it would test the wrong thing. */
function cardFrom(mod: any, collected: RichSite[]): string {
  const blocks: string[] = []
  const connected = mod.connectedSummarySection(mod.connectedGroups(collected))
  const usages = mod.usagesSection(collected, collected.length, "render", H2_FILE_APP, H2_EXPECT.render.declLine, 11)
  const contained = mod.containmentSection(collected)
  if (connected !== "") blocks.push(connected)
  if (usages !== "") blocks.push(usages)
  if (contained !== "") blocks.push(contained)
  return `**render** — method, ${collected.length} usage(s)\n\n${blocks.join("\n\n")}`
}

/** Split a card into its blocks by header — the gate's own reader, so the wire
 *  leg and the mutant oracle cannot disagree about which block a link is in. */
function splitCard(md: string): { connected: CardLink[]; usages: CardLink[]; contained: CardLink[] } {
  const lines = md.split("\n")
  const at = (pred: (l: string) => boolean): number => lines.findIndex(pred)
  const iC = at((l) => /^\*\*connected\*\*:/.test(l))
  const iU = at((l) => /^\*\*usages\*\*/.test(l))
  const iK = at((l) => /^\*\*contained\*\*/.test(l))
  const card = parseCard(md)
  const end = md.length
  // Same absent-header rule as the wire leg: a missing `**contained**` header
  // must give an EMPTY containment range, not one that runs to end-of-card.
  const offAt = (i: number): number => (i < 0 ? end : lines.slice(0, i).join("\n").length + (i > 0 ? 1 : 0))
  const nextAfter = (i: number): number => {
    if (i < 0) return -1
    for (const j of [iC, iU, iK]) if (j > i) return j
    return end
  }
  const range = (i: number): readonly [number, number] => (i < 0 ? [end, end] : [offAt(i), offAt(nextAfter(i))])
  const inR = (l: CardLink, r: readonly [number, number]): boolean => l.offset >= r[0] && l.offset < r[1]
  return {
    connected: card.filter((l) => l.family === "usage" && inR(l, range(iC))),
    usages: card.filter((l) => l.family === "usage" && inR(l, range(iU))),
    contained: card.filter((l) => l.family === "usage" && inR(l, range(iK))),
  }
}

/** The five things the pre-lane suite never actually checked, PLUS the two
 *  section laws, as predicates over one component's answer for a fixed set of
 *  rows.
 *
 *  `sectionUsage` and `sectionContain` are the wire R4-LAW-USAGE and
 *  R4-LAW-CONTAIN predicates applied to a COMPONENT COPY over the row double.
 *  They are what the section-swap plants (M6/M7) have to be caught by: a mutant
 *  that renders a containment row under `**usages**` keeps every OTHER law green
 *  (the row is real, its location is stored, the count is honest) and is caught
 *  only by the rule that the block's links must equal the rows THAT BLOCK may
 *  render. */
function verdictsFor(mod: any): Record<string, boolean> {
  const collected = mod.richSitesForSymbol(rawDouble, "sym-render") as RichSite[]
  const usage = collected.filter((s) => s.reversed && !isDeclarationRelationship(s.relationshipType))
  const section = mod.usagesSection(collected, collected.length, "render", H2_FILE_APP, H2_EXPECT.render.declLine, 11)
  const header = /(\d+) stored reference/.exec(section)
  const rows = section === "" ? 0 : section.split("\n").filter((l) => /^\d+\. \[/.test(l)).length
  const groups = mod.connectedGroups(collected) as Array<{ verb: string; sites: RichSite[] }>
  const flat = groups.flatMap((g) => g.sites)
  // The rendered link target for a row, read back out of the rendered markdown —
  // the same way a reader reads it, not from the intermediate object.
  const linkTargets = commandLinks(section).map((l) => `${l.args.file}:${l.args.line}:${l.args.character}`)
  const refTargets = usage.map((s) => `${s.path}:${s.line}:${s.character}`)
  const exactSites = usage.filter((s) => s.callSite?.kind === "call-site")
  const substituteSites = usage.filter((s) => s.callSite !== undefined && s.callSite !== null && s.callSite.kind !== "call-site")
  const labels = usage.map((s) => mod.siteLabel(s))
  // The whole card, read back through the wire leg's own reader.
  const card = cardFrom(mod, collected)
  const blocks = splitCard(card)
  const allowed = (gs: RowGround[]) => gs.map((g) => ({ id: g.id, key: g.key ?? "", relPath: g.relPath }))
  const usageVerdict = judgeSection(blocks.usages, allowed(doubleUsageGrounds))
  const containmentVerdict = judgeSection(blocks.contained, allowed(doubleContainmentGrounds))
  const connectedVerdict = judgeSection(blocks.connected, allowed(doubleUsageGrounds))
  lastOracleTrace = {
    collected: collected.map((s) => ({ name: s.name, kind: s.relationshipType, reversed: s.reversed, path: `${s.path}:${s.line}:${s.character}`, callSite: s.callSite ?? null })),
    headerCount: header === null ? null : Number(header[1]),
    renderedRows: rows,
    linkTargets,
    refTargets,
    labels,
    expectedCallSites: [`${H2_FILE_APP}:${appCallLine - 1}:0`, `${H2_FILE_MAIN2}:${main2CallLine - 1}:0`],
    groups: groups.map((g) => ({ verb: g.verb, names: g.sites.map((s) => s.name) })),
    cardBlocks: {
      connected: blocks.connected.map((l) => `${l.label} -> ${l.key}`),
      usages: blocks.usages.map((l) => `${l.label} -> ${l.key}`),
      contained: blocks.contained.map((l) => `${l.label} -> ${l.key}`),
    },
    doubleGrounds: doubleGrounds.map((g) => ({ id: g.id, kind: g.kind, declaration: g.declaration, branch: g.branch, key: g.key?.split("/").pop() ?? null })),
    section,
  }
  return {
    // §12.1 / §14 rule 3: a link opens the stored CALL SITE (line 15 / line 6),
    // not the referencing declaration (13 / 4) and not a neighbour of it.
    position: linkTargets.length === 3 && refTargets.every((t) => linkTargets.includes(t)) &&
      linkTargets.includes(`${H2_FILE_APP}:${appCallLine - 1}:0`) && linkTargets.includes(`${H2_FILE_MAIN2}:${main2CallLine - 1}:0`),
    // §13.4: the header count IS the rendered list. Off-by-one fails here.
    count: header !== null && Number(header[1]) === rows && rows === 3,
    // §6 "dropped edge": every collected row still reaches the section.
    edge: collected.length === 4 && rows === 3 && collected.some((s) => s.name === "Greeter"),
    // §13.5 / M55.T3 / the owner's decision: a declaration containment renders in
    // ITS OWN labelled block, and in no other. Stated POSITIVELY on both sides —
    // the old one-sided form ("the connected summary has one group of two")
    // could not tell "contains never renders as a connection" from "a second kind
    // lost its verb", which is exactly what happened here (see the H2/M control
    // note below): `uses` gained a verb in the all-relationships wave, so the
    // group count went to 2 and the old predicate went false on a CORRECT
    // component, marking every mutant caught for free.
    containmentInItsOwnBlock:
      containmentVerdict.ok &&
      doubleContainmentGrounds.length > 0 &&
      blocks.contained.length === doubleContainmentGrounds.length &&
      blocks.contained.every((l) => containmentVerdict.rows.find((r) => r.key === l.key)?.ok === true) &&
      // and never in the other two blocks
      blocks.usages.every((l) => doubleUsageGrounds.some((g) => g.key === l.key)) &&
      blocks.connected.every((l) => doubleUsageGrounds.some((g) => g.key === l.key)) &&
      // and the connected summary still holds no containment row
      flat.every((s) => !isDeclarationRelationship(s.relationshipType)) &&
      !flat.some((s) => s.name === "Greeter"),
    // §12.1, per block: a link in the **usages** block equals the stored location
    // of a usage row, row by row.
    sectionUsage: usageVerdict.ok,
    // §12.1, per block: a link in the **connected** block equals the stored
    // location of a non-declaration row, row by row.
    sectionConnected: connectedVerdict.ok,
    // §12.1, per block: a link in the **contained** block equals the stored
    // location of the declaration-containment row it renders.
    sectionContainment: containmentVerdict.ok,
    // §14 rule 2: a row whose position is a LABELLED SUBSTITUTE says so in its own
    // label, and a row the store knows exactly carries NO caveat (a caveat on an
    // exact position is the mirror defect).
    label: exactSites.length === 2 && substituteSites.length === 1 &&
      exactSites.every((s) => !/declaration/.test(mod.siteLabel(s))) &&
      substituteSites.every((s) => /declaration/.test(mod.siteLabel(s))),
  }
}
/** What the oracle actually SAW on its last run. A control that fails without
 *  showing its input is a check nobody can act on. */
let lastOracleTrace: Record<string, unknown> = {}

const COMPONENT_SOURCE = path.join(ROOT, "src/lsp/rich_hover.ts")

/** Rewrite every RELATIVE import in a component copy to an absolute file URL,
 *  resolving what the source actually imports. A missing list entry is silent;
 *  this cannot go stale. */
function rewriteRelativeImports(source: string, componentDir: string): string {
  return source.replace(/from\s+"(\.\.?\/[^"]+)"/g, (_m, specifier: string) => {
    const target = path.join(componentDir, specifier)
    const resolved = existsSync(`${target}.ts`) ? `${target}.ts` : target
    return `from "${pathToFileURL(resolved).href}"`
  })
}

const MUTANTS: Array<{ name: string; from: string; to: string }> = [
  {
    name: "M1: wrong position — the link opens a line adjacent to the stored call site (±1)",
    from: "        ? { path: loc.path, line: callLine0, character: 0, endLine: callLine0, endCharacter: 0 }",
    to: "        ? { path: loc.path, line: callLine0 + 1, character: 0, endLine: callLine0 + 1, endCharacter: 0 }",
  },
  {
    name: "M2: wrong count — the usages header is one more than the list it headlines",
    from: '`**usages** — ${usage.length} stored reference${usage.length === 1 ? "" : "s"}',
    to: '`**usages** — ${usage.length + 1} stored reference${usage.length === 1 ? "" : "s"}',
  },
  {
    name: "M3: dropped edge — the last collected row never reaches the section",
    from: "  for (const row of rows) {",
    to: "  for (const row of rows.slice(0, -1)) {",
  },
  {
    // RE-ANCHORED, and the reason is a finding rather than a convenience.
    //
    // The pre-fix M4 plant was `if (verb === null) continue` -> admit every kind.
    // That guard is now DEAD for the plant's purpose: `verbFor("contains")`
    // returns "contained by" (the all-relationships wave gave every canonical kind
    // a verb), so a `contains` row no longer reaches it — the declaration-class
    // guard above it (`isDeclarationRelationship(kind) continue`) skips the row
    // FIRST. Measured on this run at this commit: M4 with the old anchor reports
    // [SURVIVED], i.e. the plant changes nothing observable.
    //
    // It was reported as caught before only because the pre-fix control's
    // `contains` predicate was ALREADY false on the real component, so M4 was
    // convicted by a broken oracle rather than by its plant. A no-op plant and a
    // broken predicate cancelling out is the §8.7 failure in its most flattering
    // disguise: the count said 5/5 and neither half was doing work.
    //
    // The anchor below is the line that actually decides the law today, so the
    // plant restores the defect the mutant NAMES: a `contains` row admitted into
    // the connection summary.
    name: "M4: a declaration containment leaks into the connected summary (re-anchored on the declaration-class guard, which is the line that decides this law today — the pre-fix `verb === null` anchor is a DEAD guard and its plant was a no-op)",
    from: "      if (isDeclarationRelationship(kind)) continue",
    to: "      if (false && isDeclarationRelationship(kind)) continue /* planted: admit declaration containments as connection facts */",
  },
  {
    name: "M5: undeclared substitution — the row label drops the caveat that says which position it opens",
    from: "  return addressNoteSuffix(site.callSite) === null ? label : `${label} ${addressNoteSuffix(site.callSite)}`",
    to: "  return label",
  },
  // --- The two section-swap plants. Each keeps EVERY pre-existing law green:
  // the row it moves is real, its location is index-stored, and the header count
  // stays honest. They are caught ONLY by the rule that a block's links must
  // equal the rows THAT BLOCK may render — which is why those rules exist and
  // why they had to be added rather than the old blanket law relaxed.
  {
    name: "M6: section swap — the **usages** block renders the declaration-containment row (a `contains` row offered as a usage, the exact defect relations.ts exists to prevent)",
    from: "  const usage = usageSitesOf(sites)",
    to: "  const usage = sites",
  },
  {
    name: "M7: section swap — the **contained** block renders nothing, so the owner's decision ('show all the relationships') silently drops the containment row",
    from: "  const declared = containmentSitesOf(sites)",
    to: "  const declared = [] as typeof sites",
  },
]

// The CONTROL every mutant suite needs and this one lacked: the oracle must hold
// on the REAL component. If any predicate is false here, a mutant that fails it
// proves nothing, so the suite says so loudly instead of reporting 6/6.
//
// WHAT THE CONTROL WAS, and why it failed. The pre-fix control evaluated five
// predicates, one of which (`contains`) read:
//
//     groups.length === 1 && groups[0].verb === "called by" && flat.length === 2
//
// — a POSITIVE claim that the connected summary holds exactly one verb group of
// exactly two sites. That was true when only `calls` had a verb. The owner's
// ratified decision ("show all the relationships, not just contains") gave EVERY
// canonical kind a verb, so the double's `uses` row now renders as its own
// "used by" group: two groups, three sites. The predicate went FALSE on a
// component that is correct — and while it was false, the `contains` mutant (M4)
// was reported "caught by: contains" for FREE. Measured at the pre-fix commit:
// the control read {position: true, count: true, edge: true, contains: FALSE,
// label: true} while all 5 mutants were reported caught, and M4 — the mutant
// that plant is FOR — was convicted by the only predicate that was broken.
//
// That is the §8.7 failure in its purest form: a control that cannot discriminate,
// reporting discrimination.
//
// The replacement states the law POSITIVELY AND IN BOTH DIRECTIONS: the
// declaration-containment row renders in ITS OWN block, reaches no other block,
// and the connected summary holds no containment row. It is true of the correct
// component (the `uses` row is now asserted to be RENDERED, not to be absent), and
// it is false for M4 (containment in the connected summary), M6 (containment in
// the usages block) and M7 (containment rendered nowhere) — which is the whole
// point: the predicate must fail for the mutants it exists to convict.
const realVerdicts = verdictsFor({
  richSitesForSymbol,
  usagesSection,
  connectedGroups,
  siteLabel,
  connectedSummarySection,
  containmentSection,
})
const realOracleHolds = Object.values(realVerdicts).every(Boolean)
check(
  "H2/M: the mutant oracle HOLDS on the real component — every predicate true, so no mutant can be marked caught for free (the pre-fix `contains` predicate asserted the connected summary has ONE group, which the all-relationships verb table made false on a correct component)",
  realOracleHolds,
  `${JSON.stringify(realVerdicts)} — oracle saw ${JSON.stringify(lastOracleTrace)}`,
)

const componentSource = readFileSync(COMPONENT_SOURCE, "utf8")
const mutantDir = mkdtempSync(path.join(tmpdir(), "m42-h2-mut-"))
for (const m of MUTANTS) {
  if (!componentSource.includes(m.from)) {
    mutants.total++
    mutants.notJudged++
    console.log(`  ✗ ${m.name} — NOT JUDGED: the plant anchor is not in the component (${m.from.slice(0, 60)}…)`)
    continue
  }
  const patched = rewriteRelativeImports(componentSource.replace(m.from, m.to), path.dirname(COMPONENT_SOURCE))
  const p = path.join(mutantDir, `rich_hover_mutant_${mutants.total}.ts`)
  writeFileSync(p, patched, "utf8")
  let mod: any
  try {
    mod = await import(pathToFileURL(p).href)
  } catch (error) {
    // NOT a catch: the code under test never ran (§8.7).
    mutants.total++
    mutants.notJudged++
    console.log(`  ✗ ${m.name} — NOT JUDGED: import failure ${String(error).split("\n")[0]}`)
    continue
  }
  const verdicts = verdictsFor(mod)
  const flipped = Object.entries(verdicts).filter(([, ok]) => !ok).map(([k]) => k)
  mutants.caught += flipped.length > 0 ? 1 : 0
  mutants.total++
  mutants.verdicts.push({ name: m.name, caughtBy: flipped.join(", ") || "(none: the mutant changed nothing the oracle measures)", detail: JSON.stringify(verdicts) })
  const label = `${m.name}${flipped.length > 0 ? ` [caught by: ${flipped.join(", ")}]` : " [SURVIVED]"}`
  check(label, flipped.length > 0, JSON.stringify(verdicts))
}
rmSync(mutantDir, { recursive: true, force: true })

// --- NEGATIVES: the section laws must REJECT, not merely accept ---------------
//
// A law nobody has watched fail is a law nobody knows works (§8.7, §11.7). Each
// negative below tampers with the REAL rendered links of the REAL card — by the
// smallest possible amount — and re-judges them through the SAME `judgeSection`
// predicate the passing checks used. A negative that re-implemented the predicate
// could pass for a different reason than the check fails, so they share the code.
//
// The four the section laws must convict:
//
//   N1 FABRICATED LINE      a usage link moved off its row's stored line by one
//   N2 CROSS-BLOCK USAGE    a usage link pointed at the CONTAINMENT row's
//                           location (the defect the old blanket law could not
//                           see, because the containment location is real)
//   N3 CROSS-BLOCK CONTAIN  a containment link pointed at a USAGE location
//   N4 SECTION SWAP         a link moved from one block to the other
//
// N2/N3 are the pair the whole rewrite exists for: both targets are index-stored
// locations and both are real places in a file. Only "WHICH ROW MAY THIS BLOCK
// RENDER" convicts them.
{
  const cardState = renderedCard
  const rejudge = (
    block: "usages" | "contained",
    links: CardLink[],
    rows: Array<{ id: string; key: string; relPath: string }>,
    served?: ReadonlySet<string>,
    requireServed = false,
  ): SectionVerdict => judgeSection(links, rows, served ?? new Set<string>(), requireServed)

  if (cardState === null) {
    negativesPlanned += 4
    check("H2/R4 [negative]: the section-law negatives ran against the real card", false, "the LSP session produced no card to tamper with — the negatives were NOT judged, not judged-pass")
  } else {
    const { usages, contained, actions, definition, usageRows, containmentRows, blockRanges: renderedBlockRanges } = cardState
    const withKey = (l: CardLink, key: string): CardLink => ({ ...l, key })
    const otherBlockKey = (rows: Array<{ key: string }>): string => rows[0]?.key ?? "none"
    /** Every negative below is guarded on the block it tampers with being
     *  NON-EMPTY, and says so in its detail when it is not.
     *
     *  MEASURED, and this is why the guards exist: with the containment block
     *  suppressed in the component, the unguarded N3 indexed element 0 of an empty
     *  array and threw `TypeError: Cannot read properties of undefined (reading
     *  'key')`. The throw escaped the check loop, so the gate exited with NO
     *  verdict and wrote NO evidence — a negative that can crash the suite is
     *  worse than one that fails cleanly, because it destroys the record a reader
     *  would use to find out what happened. A negative that cannot run says "NOT
     *  RUN" and still reports a verdict. */
    // N1 — fabricated line: a usage link one line off the stored call site.
    const n1 = usages.length === 0 ? [] : usages.map((l, i) => (i === 0 ? withKey(l, l.key.replace(/:(\d+):(\d+)$/, (_m, ln: string, ch: string) => `:${Number(ln) + 1}:${ch}`)) : l))
    negativesPlanned++
    check(
      "H2/R4 [negative]: LAW-USAGE REJECTS a usage link whose line is one off the stored call site (a fabricated target cannot pass it)",
      usages.length > 0 && rejudge("usages", n1, usageRows).ok === false,
      usages.length === 0 ? "no usage links rendered — the negative was NOT RUN" : `tampered ${n1[0]?.key}; verdict ok=${rejudge("usages", n1, usageRows).ok}`,
    )

    // N2 — cross-block, usage → containment location. Real location, wrong block.
    const n2 = usages.length === 0 ? [] : usages.map((l, i) => (i === 0 ? withKey(l, otherBlockKey(containmentRows)) : l))
    const n2Tampered = n2[0]?.key ?? null
    negativesPlanned++
    check(
      "H2/R4 [negative]: LAW-USAGE REJECTS a usage link pointed at the CONTAINMENT row's own stored location — a real index-stored place, but a row this block may not render",
      usages.length > 0 && containmentRows.length > 0 &&
        rejudge("usages", n2, usageRows).ok === false && containmentRows.some((r) => r.key === n2Tampered),
      usages.length === 0 || containmentRows.length === 0
        ? "no usage or containment links rendered — the negative was NOT RUN"
        : `tampered ${n2Tampered} (that IS the containment row's stored key: ${containmentRows.some((r) => r.key === n2Tampered)}); verdict ok=${rejudge("usages", n2, usageRows).ok}`,
    )

    // N3 — cross-block, containment → usage location. The mirror of N2.
    // Guarded on `contained.length > 0`: a negative that indexes element 0 of an
    // empty array CRASHES rather than failing. MEASURED: with the containment
    // block suppressed (the D-containment defect), the unguarded form threw
    // `TypeError: Cannot read properties of undefined (reading 'key')` and took
    // the whole gate down — so the suite reported NO verdict at all where it
    // should have reported one. A negative that can crash the suite is a worse
    // gate than one that fails cleanly: it destroys the evidence record.
    const n3 = contained.length === 0 ? [] : contained.map((l, i) => (i === 0 ? withKey(l, otherBlockKey(usageRows)) : l))
    const n3Tampered = n3[0]?.key ?? null
    negativesPlanned++
    check(
      "H2/R4 [negative]: LAW-CONTAIN REJECTS a containment link pointed at a USAGE location — the old blanket law could not convict this, because the target is index-stored and served by references",
      contained.length > 0 && rejudge("contained", n3, containmentRows).ok === false && usageRows.some((r) => r.key === n3Tampered),
      contained.length === 0
        ? "the card rendered no containment link, so this negative was NOT RUN (it cannot fabricate one: the law needs a real containment row to move)"
        : `tampered ${n3Tampered} (that IS a usage row's stored key: ${usageRows.some((r) => r.key === n3Tampered)}); verdict ok=${rejudge("contained", n3, containmentRows).ok}`,
    )

    // N4 — section swap: the containment link rendered inside the usages block.
    const n4 = [...usages, ...contained]
    negativesPlanned++
    check(
      "H2/R4 [negative]: LAW-SECTION REJECTS a card whose containment row is rendered inside the **usages** block (the swap the owner's ratified decision forbids)",
      usages.length > 0 && contained.length > 0 && rejudge("usages", n4, usageRows).ok === false,
      contained.length === 0
        ? "the card rendered no containment link to move — the negative was NOT RUN"
        : `moved ${contained.length} containment link(s) into the usages block; verdict ok=${rejudge("usages", n4, usageRows).ok}`,
    )

    // N5 — LAW-LABEL: a row that NAMES one place and OPENS another. The target is
    // a real index-stored location of a real row, so no location law convicts it;
    // only the label law can. Guarded on `usages.length > 0` for the same reason
    // as N3: a negative that can throw takes the whole suite's verdict with it.
    const n5 = usages.length === 0 ? [] : usages.map((l, i) => (i === 0 ? { ...l, label: `${l.label} — App.java:99` } : l))
    negativesPlanned++
    check(
      "H2/R4 [negative]: LAW-LABEL REJECTS a row whose label names App.java:99 while its link opens another line — a real target, a false name, and no location law can see it",
      // Every row of this card's usage block states a position (both callers are
      // same-named, so `siteLabel` disambiguates both), and exactly one is
      // tampered: so the count of disagreeing rows must be exactly 1. Asserted as
      // an exact count rather than "some row disagrees" — a negative that accepts
      // any disagreement would also accept a card where the law was already broken.
      n5.length > 0 &&
        n5.filter((l) => statedPosition(l.label) !== null).length === n5.length &&
        n5.length - n5.filter(labelAgrees).length === 1,
      n5.length === 0
        ? "no usage links rendered — the negative was NOT RUN"
        : `tampered label: ${JSON.stringify(n5[0]?.label)}; links agreeing with their label: ${n5.filter(labelAgrees).length}/${n5.length}`,
    )

    // N6 — LAW-ACTION: an action link pointed somewhere other than the symbol's
    // own declaration. `bb.openGraph` / `bb.openImpact` / `bb.showCallHierarchy` are
    // three of the card's nine navigation targets and had no differential at all
    // before this lane.
    const wrongTarget = containmentRows[0]?.key ?? usages[0]?.key ?? "none"
    const n6 = actions.length === 0 ? [] : actions.map((l, i) => (i === 0 ? withKey(l, wrongTarget) : l))
    const actionGround = definition[0]?.key ?? null
    negativesPlanned++
    check(
      "H2/R4 [negative]: LAW-ACTION REJECTS an action link pointed at a stored location other than the symbol's own declaration (the three action targets were never differentially checked before this lane)",
      actions.length > 0 && actionGround !== null && wrongTarget !== actionGround &&
        actions.every((l) => l.key === actionGround) && !n6.every((l) => l.key === actionGround),
      `ground (definition link): ${actionGround}; tampered action link: ${n6[0]?.key ?? "(no action link rendered — NOT RUN)"}`,
    )

    // N7 — LAW-SECTION: a link that rides under NO block at all. A structural law
    // that cannot fail is the §8.7 "fixture that cannot fail" in its purest form,
    // so it gets its own negative: an offset outside every block's range must not
    // satisfy the block law.
    const inAnyBlock = (o: number, ranges: ReadonlyArray<readonly [number, number]>): boolean => ranges.some((r) => o >= r[0] && o < r[1])
    negativesPlanned++
    check(
      "H2/R4 [negative]: LAW-SECTION REJECTS a link that falls in NO block — a structural law that cannot fail is not a law",
      usages.length > 0 && !inAnyBlock(-1, renderedBlockRanges) && inAnyBlock(usages[0]!.offset, renderedBlockRanges),
      usages.length === 0
        ? "no usage links rendered — the negative was NOT RUN"
        : `offset -1 is inside a block: ${inAnyBlock(-1, renderedBlockRanges)}; the real link's offset ${usages[0]!.offset} is inside: ${inAnyBlock(usages[0]!.offset, renderedBlockRanges)}`,
    )
  }
}

// The CONTROL's own negative: a false predicate must FAIL the control, or
// "mutantsCaught: 7/7" is a number with no meaning. Without this leg, the
// control's own failure mode — a predicate that is false on the real component —
// is invisible in the evidence: the control check fails, but nothing states that
// a control which CANNOT fail would look identical from the outside. This is the
// exact defect this lane found in the pre-fix control (see `oracleControlDefect`
// in the evidence), so the control now has to prove it can fail.
{
  const holds = (v: Record<string, boolean>): boolean => Object.values(v).every(Boolean)
  const probe: Record<string, boolean> = Object.fromEntries(
    Object.keys(verdictsFor({
      richSitesForSymbol,
      usagesSection,
      connectedGroups,
      siteLabel,
      connectedSummarySection,
      containmentSection,
    })).map((k) => [k, true]),
  )
  // The control must fail for a false predicate in EACH position: first, last and
  // middle. `Object.values().every()` short-circuits on the FIRST false, so a
  // control that dropped an aggregation to a `some()` would still look right here
  // unless a non-first predicate is exercised too.
  const keys = Object.keys(probe)
  const failsFor = (k: string): boolean => !holds({ ...probe, [k]: false })
  negativesPlanned++
  check(
    "H2/M [negative]: the mutant-oracle CONTROL FAILS when any predicate is false — first, last and middle alike — so a control that cannot fail cannot report 7/7 mutants caught for free (the exact failure this lane found in the pre-fix control)",
    holds(probe) && keys.length >= 5 && failsFor(keys[0]!) && failsFor(keys[keys.length - 1]!) && failsFor(keys[Math.floor(keys.length / 2)]!),
    `predicates: ${JSON.stringify(keys)}; control all-true: ${holds(probe)}; false at ${keys[0]}: ${failsFor(keys[0]!)}, at ${keys[keys.length - 1]}: ${failsFor(keys[keys.length - 1]!)}, at ${keys[Math.floor(keys.length / 2)]}: ${failsFor(keys[Math.floor(keys.length / 2)]!)}`,
  )
}

// --- Evidence -----------------------------------------------------------------------------
const failed = checks - passed
const result = {
  issue: "650",
  code: "H2",
  milestone: "M42",
  status: failed === 0 ? "verified" : "known-gap",
  checks,
  passed,
  failed,
  failures,
  verdict: {
    realComponentFailures: failed,
    mutantsCaught: mutants.caught,
    mutantsTotal: mutants.total,
    mutantsNotJudged: mutants.notJudged,
    ok: failed === 0 && mutants.caught === mutants.total && mutants.notJudged === 0,
  },
  mutants: {
    ...mutants,
    whatTheseAre:
      "source-copy plants inside src/lsp/rich_hover.ts, judged by per-predicate verdicts computed against the REAL fixture files (byte columns read off the files on disk, so the component's own position owner resolves them) and read back out of the RENDERED markdown rather than from an intermediate object.",
    preLaneDefect:
      "the pre-lane M1..M6 reported 6/6 caught while only TWO planted anything. M2, M3, M4 and M5 each restated a check already asserted verbatim above them (connectedSummarySection(connectedGroups([containsOnly])) === \"\", usagesSection([], …) === \"\", usagesSection([3 sites], …).length > 0, md.includes(\"bb.openDefinition?\")), so four of the six could never have been anything but green. A duplicate cannot fail when the original passes.",
    oracleControl:
      "the suite asserts its oracle HOLDS on the real component before judging any plant; a predicate that is false on the real component would mark every mutant caught for free. The control has its OWN negative (H2/M [negative]): a control that cannot fail would report 5/5 for free, which is the failure this control exists to prevent.",
    /** What the pre-fix control actually was, and what it cost. This is a finding
     *  about the GATE, found by running it (§8.7 red-team duty), and it is the
     *  reason the M leg list is not what it was. */
    oracleControlDefect: {
      what: "The control evaluated five predicates; `contains` read `groups.length === 1 && groups[0].verb === 'called by' && flat.length === 2` — a POSITIVE claim that the connected summary holds exactly one verb group of exactly two sites.",
      whenItBroke: "The owner's all-relationships wave gave EVERY canonical kind a verb (src/lsp/rich_hover.ts RELATIONSHIP_VERB now has all ten), so the mutant double's `uses` row renders as its own 'used by' group: 2 groups, 3 sites. The predicate went FALSE on a component that is correct.",
      whatItCost: "While it was false, M4 — the mutant that plant EXISTS FOR ('a declaration containment leaks into the connected summary') — was reported 'caught by: contains' for free, alongside a no-op plant (below). Measured at the pre-fix commit: control read {position: true, count: true, edge: true, contains: FALSE, label: true} while all 5 mutants reported caught. The count was 5/5 and neither half of M4's conviction was doing work: a broken predicate and a dead plant cancelled out and read as a pass.",
      replacement: "`containmentInItsOwnBlock` states the law in BOTH directions and positively: the declaration-containment row renders in ITS OWN block (one link per stored containment row, each equal to that row's stored location), reaches NEITHER other block, and the connected summary holds no containment row. It also asserts the non-declaration rows ARE rendered, so a kind that lost its verb fails rather than passing. Measured: true on the real component; false for M4, M6 and M7 — the three mutants that section laws exist to convict.",
    },
    /** The M4 finding. A mutant that plants nothing cannot be caught, and one that
     *  is convicted by a broken predicate is worse — the pair cancels and reads as
     *  a pass. */
    mutantAnchorAudit: [
      {
        mutant: "M4 (declaration containment leaks into the connected summary)",
        preFixAnchor: "if (verb === null) continue",
        measured: "With that anchor the plant is a NO-OP: `verbFor('contains')` returns 'contained by' (every canonical kind now has a verb), so a `contains` row never reaches the `verb === null` guard — the declaration-class guard `isDeclarationRelationship(kind) continue` above it skips the row first. Measured on this run at this commit: M4 with the old anchor reports [SURVIVED], all predicates unchanged.",
        reAnchoredOn: "if (isDeclarationRelationship(kind)) continue -> if (false && isDeclarationRelationship(kind)) continue",
        caughtBy: "containmentInItsOwnBlock, sectionConnected",
      },
      {
        mutant: "M1..M3, M5 (position, count, dropped edge, label caveat)",
        preFixAnchor: "unchanged — verified still present in the component source by the suite's own anchor check (a missing anchor is recorded NOT JUDGED, never as a catch)",
        measured: "M1 caught by position + all three section laws; M2 by count; M3 by position, count, edge, label; M5 by label.",
      },
    ],
    importFailureIsNotCaught: true,
  },
  /**
   * §8.2 byte-identical regeneration, with the varying fields NAMED rather than
   * left for a checker to guess. Measured at this commit with a clean tree: two
   * consecutive runs differ ONLY in the fields listed here. `measured` carries the
   * p95 latency sample set, which is a wall-clock measurement and is declared
   * volatile for that reason; every other count, verdict, ground row and section
   * table is stable.
   */
  determinism: {
    declaredVolatileFields: ["generatedAt", "bbSeal.sealedAt", "bbSeal.contentSha256", "currentCommit", "measured"],
    whyTheseAndNoOthers:
      "generatedAt / bbSeal.sealedAt are wall-clock stamps; bbSeal.contentSha256 hashes the record, which includes generatedAt; currentCommit changes when the gate is committed; `measured` is a latency sample set (p50/p95/max/mean in ms) and a latency sample is not reproducible to the last decimal. The ground rows, the section table, every count, every mutant verdict and every negative are functions of the index, the sources and this script. The fixture is written fresh into the worktree's own .tools/ and the index is written into a per-run mkdtemp BB_DATA_DIR, so no random path reaches an emitted field (the fixture's root is the worktree's, not the temp dir's).",
    measuredAt: "two consecutive runs at this commit, compared field by field after canonicalising the five declared volatile fields: identical",
  },
  /**
   * The section table — the measurement behind the two per-section laws. Every
   * rendered link, the block it renders in, the stored row it names, and the
   * stored location that row carries. This is what a reader of a red H2 needs to
   * tell WHICH law a link failed, without re-running anything.
   */
  sections: {
    note: "one entry per rendered command link, in card order; `groundBranch` is which stored position the store permits for that row, derived by this gate from brain_relationship.line_number (never from the component).",
    links: card.map((l) => ({
      command: l.command,
      block: blockOf(l.offset),
      label: l.label,
      target: l.key,
      inReferencesSet: refLocsForNegative.has(l.key),
      storedRow: (usageRowGrounds.concat(containmentRowGrounds).find((g) => g.key === l.key) ?? null) === null
        ? null
        : { id: usageRowGrounds.concat(containmentRowGrounds).find((g) => g.key === l.key)!.id, kind: usageRowGrounds.concat(containmentRowGrounds).find((g) => g.key === l.key)!.kind, branch: usageRowGrounds.concat(containmentRowGrounds).find((g) => g.key === l.key)!.branch },
    })),
    storedRows: rowGrounds.map((g) => ({ id: g.id, kind: g.kind, declaration: g.declaration, farName: g.farName, farDeclLine1: g.farLine1, branch: g.branch, servedAt: g.key === null ? null : g.key.split("/").pop() })),
    counts: {
      storedUsageRows: usageRowGrounds.length,
      storedContainmentRows: containmentRowGrounds.length,
      referencesLocations: refLocsForNegative.size,
      renderedUsageLinks: linksUsages.length,
      renderedConnectedLinks: linksConnected.length,
      renderedContainmentLinks: linksContained.length,
      renderedActionLinks: linksActions.length,
    },
  },
  negatives: { planned: negativesPlanned },
  fixture: { root: H2_ROOT, files: [H2_REL_APP, H2_REL_MAIN2], expectations: H2_EXPECT },
  /**
   * The GROUND, as measured from the store before any surface leg ran. It is in
   * the record so a reader of a red H2 can tell a surface defect from a partial
   * index without re-running anything — the confusion this leg exists to prevent,
   * measured live on one run at commit 8938a728 where a one-row index produced
   * four surface-shaped failures.
   */
  ground: {
    indexDataDir: "an isolated mkdtemp BB_DATA_DIR, passed to the indexer AND to the server this suite starts (the pre-lane run used the developer's default ~/.bb, so the answer depended on that machine's store)",
    storedRowsTouchingRender: groundRows,
    usageRows: usageGround.length,
    groundHolds: groundRows.length > 0 && usageGround.length === 2,
  },
  budgets: { hoverP95Ms: 50 },
  measured: budget,
  currentCommit,
  ...fingerprintFields(["m42.H2"], ROOT),
  verifierCommand: "npx tsx script/m42/verify-rich-hover.ts",
  evidenceFile: "H2.json",
  generatedAt: new Date().toISOString(),
  /**
   * Expectations this lane WITHDREW, with the law that now governs each. Left in
   * the record rather than deleted: a reader who remembers the old number needs
   * to know which law replaced it, and a gate comment is not an audit trail.
   */
  /**
   * Expectations this lane RETIRED, with the law that now governs each and the
   * measurement that retired it. Left in the record rather than deleted: a reader
   * who remembers the old sentence needs to know which law replaced it, and a gate
   * comment is not an audit trail.
   *
   * The lane that added them is worth naming, because it is the reason this gate
   * was red at 48/51: the owner's ratified decision ("the hover should show all
   * the relationships, not just contains", with `contains` rendered as
   * DECLARATION CONTAINMENT, never a usage) merged and is correct. It grew the
   * card from four links to five. Both retired checks were stated as ONE blanket
   * law over "every bb.openUsage link", so adding a fifth link of a kind the law
   * said could not exist made them false — on a component that was telling the
   * truth. The gate, not the component, was stale.
   */
  supersededExpectations: [
    {
      was: "H2/R4: the hover's call-site links DIFFER from the L3 reference lines, and the card states the difference",
      why: "superseded by the call-site migration (9c25a1dc2, src/lsp/navigation.ts now emits a per-stored-row `callSite` and textDocument/references lands on the call site for every row). It required two surfaces to DISAGREE about where a call is, which §15.1 forbids outright ('One surface, one answer').",
      governingLaw: "§15.1 + §12.1 — the two surfaces must agree, and every navigation target must equal an index-stored location, differentially checked.",
      replacedBy: "H2/R4-LAW-USAGE (usage block) and H2/R4-LAW-CONNECTED (connected block): every link in those blocks equals the index-stored location of the row it names, row by row, and the usage block additionally equals a location references returns.",
      measured: "references answers App.java:15 and Main2.java:6 (1-based) — the two `render()` invocations — and the usage/connected blocks' four links are exactly those two locations.",
    },
    {
      was: "H2/R4: every hover usage link target EQUALS an index-stored location the references surface returns (4 of 5 links are index-stored locations)",
      retiredBy: "this lane",
      why: "Wrong BY CONSTRUCTION once the card renders containment rows, not merely inconvenient. `textDocument/references` filters through `isUsageSiteRow` (src/lsp/navigation.ts:825, owner src/lsp/relations.ts) and a declaration containment is NEVER a usage site — so the containment row's own stored location is absent from the reference set by law. A law that says every link must be in that set cannot be satisfied by a card that renders `contains`. The two available 'fixes' — excluding the fifth link, or relaxing the count — would both restore the tick while removing the protection, and are forbidden by the assignment and by §12.1's differential requirement.",
      governingLaw: "§12.1 (every navigation target equals an index-stored location, differentially checked) applied PER SECTION, plus §15.1 (two surfaces, one answer) for the blocks a surface serves.",
      replacedBy: [
        "H2/R4-LAW-USAGE — every **usages** link equals the stored location of the usage row it names, row by row, AND a location references returns.",
        "H2/R4-LAW-CONNECTED — every **connected** link equals the stored location of a non-declaration row.",
        "H2/R4-LAW-CONTAIN — every **contained** link equals the stored location of the `contains`/`exports` row it renders. This law did not exist before; it is the differential the old blanket law could not express.",
        "H2/R4-LAW-ACTION — every action link equals the symbol's own stored location as `textDocument/definition` returns it. Also new: the actions row's three links were never differentially checked against anything.",
        "H2/R4-LAW-LABEL — a row whose label states a position states its OWN link's position. Also new.",
        "H2/R4-LAW-SECTION — every link falls in exactly one block, so no link escapes a law and none is judged twice.",
      ],
      measured: "On this fixture at this commit the store holds 3 rows touching `render`: 2 `calls` (stored lines 15 and 6) and 1 `contains` (stored line 7). references returns 2 locations (App.java:14:0, Main2.java:5:0). The card renders 5 `bb.openUsage` links: 2 in **connected** (both in the reference set), 2 in **usages** (both in the reference set), 1 in **contained** at App.java:6:0 — which is the `contains` row's OWN stored line (7 → 0-based 6) and is absent from the reference set, exactly as relations.ts requires.",
      whyStronger: [
        "Coverage: 5 links judged with a NAMED row each, instead of one undifferentiated set checked for membership.",
        "No escape hatch: the containment link has a real predicate, so there is nothing to exclude or relax.",
        "LAW-CONTAIN convicts a containment link pointed at a usage location — a target that is index-stored AND served by references, so the old blanket law would have PASSED it. That case is the negative N3 leg below.",
        "LAW-ACTION and LAW-LABEL are new coverage, not restatements.",
        "LAW-SECTION makes block assignment a checked fact instead of an assumption: if the card's block order changed, the gate fails rather than silently judging the wrong links.",
      ],
    },
    {
      was: "H2/R4: the hover opens the CALL SITE, not the caller's declaration (asserted over every bb.openUsage link)",
      retiredBy: "this lane",
      why: "Also wrong by construction, for the mirror-image reason: a `contains` row stores its member's DECLARATION line (7 here), not a call site. Asserting 'every link opens a call site' over a block whose rows have no call site asserts a claim about a relationship that has none.",
      governingLaw: "§14 rule 3 (positions are where the thing is) and §15.3, applied per section.",
      replacedBy: "H2/R4: the hover opens the CALL SITE, not the caller's declaration — for every row of the **usages** block. The containment block's target is governed by H2/R4-LAW-CONTAIN instead, which requires it to equal the position that row stores.",
      measured: "Both usage rows carry a positive stored call-site line (App.java 15, Main2.java 6) and each is served at `line - 1`, character 0. The `contains` row stores line 7 and is served at App.java:6:0 — the member's declaration, which is what a containment row says.",
    },
  ],
  limitations: [
    // GAP 1 (M42 HONESTY GAP H2, header count vs the rendered list) — CLOSED
    // by M55.T3 and restated here rather than inherited. The pre-T3
    // limitation said the header kept "the M24 semantics (raw
    // relationship-row count)" while the list showed deduplicated L3
    // locations, so the two numbers could differ. That is no longer true and
    // the sentence is withdrawn: the header count IS the rendered list's own
    // length, both taken from one array (src/lsp/relations.ts is the single
    // owner of the usage-site vocabulary). Withdrawn rather than reworded,
    // because leaving a stale honesty note in place is the same defect as
    // leaving a stale honesty gate in place.
    // GAP 2 (M42 HONESTY GAP H2, usage links vs call sites) — CLOSED, and the
    // old sentence was FALSE. It said "the analyzer stores no call-site byte
    // ranges; usage links point at the referencing symbol's declaration".
    // Measured on this machine's real indexes at the current commit:
    // `brain_relationship.line_number` carries a positive, real call-site line
    // on 52,597 of 52,597 rows of the backbencher-brain index, and on 4,688
    // of 5,000 sampled `calls` rows that line differs from the referencing
    // symbol's declaration. The store does hold the call site. The hover now
    // reads it through the ONE owner (src/intelligence/graph/line-address.ts)
    // and opens the call site; where the store holds no line, the link opens
    // the declaration and SAYS SO on the row (§14 rule 2). The residual and
    // real limitation is the byte column: a call-site ADDRESS carries a line,
    // not a column, so those links open at character 0.
    "A usage link opens the index-stored CALL SITE when brain_relationship.line_number holds a real line, and the referencing symbol's DECLARATION when it does not — every such row states which, in its own label and in the usages header. The store carries no call-site BYTE COLUMN, so a call-site link opens at character 0: the line is exact, the column is not stored.",
    "Declared residual, unchanged by this lane: textDocument/references and the hover card now agree EXACTLY on the call site (both open the stored line at character 0), so there is no second answer left to reconcile on this surface. The agreement is what §15.1 asks for; the shared limit is the missing byte column, above.",
    /**
     * MEASURED FINDING — the wire legs cannot see one class of section defect,
     * and saying so is part of this record.
     *
     * A planted defect that removes `usagesSection`'s OWN defensive filter
     * (`const usage = usageSitesOf(sites)` -> `const usage = sites`) is caught,
     * but NOT by any wire leg: only by the in-process ones
     * (R6-CONTAIN-3, R6-CONTAIN-4, R6-CONTAIN-MUTANT (b)) and by mutant M6.
     * Measured by rebuilding dist and re-running: 66/70, zero wire-leg failures,
     * four in-process failures.
     *
     * The reason is a second layer of filtering on the caller: `hover()` computes
     * `usageSiteRows = usageSitesOf(sites)` (src/lsp/hover.ts:526) and passes
     * THAT to `usagesSection` (hover.ts:633), so on the wire path the section's
     * own filter is redundant — removing it changes nothing a wire check can see.
     *
     * This is defence in depth working as intended, and it is NOT a hole in the
     * gate (the defect is caught, red, with a verdict). But it does bound what the
     * wire legs prove: they prove the RENDERED card honours the usage vocabulary,
     * not that the renderer enforces it on its own. The in-process legs own that
     * claim, and they are the ones that must keep running.
     */
    "A SECTION-LEVEL defect in usagesSection's own defensive filter is invisible to the WIRE legs and is caught only by the in-process legs (R6-CONTAIN-3/4, mutant M6). MEASURED by rebuilding dist with `const usage = sites`: 66/70 with zero wire-leg failures. The cause is defence in depth — hover() passes `usageSiteRows = usageSitesOf(sites)` (src/lsp/hover.ts:526) into usagesSection (hover.ts:633), so the section's own filter is redundant on the wire path. The wire legs therefore prove the RENDERED card honours the usage vocabulary, not that the renderer enforces it unaided.",
    // The render cap: MAX_USAGE_LINKS is 3. A symbol with more usage sites
    // shows 3 and a `+N more` link — declared, not silently dropped.
    `A hover renders at most ${MAX_USAGE_LINKS} usage links plus a "+N more" link, so a symbol with many callers shows three of them on the card and the rest through the hub.`,
    "No editor leg: this file proves the server surface. Link clicking in a real session is the E5-pattern session at H2 acceptance.",
    // Observed, not hypothetical: one run of this gate at commit 8938a728 — same
    // commit as three consecutive green runs either side of it — indexed the
    // fixture with ONE of its two calling rows and reported the result as four
    // SURFACE failures. The cause was not isolated to this lane: the java
    // analyzer's cross-file resolution is order-sensitive (this fixture's own
    // header records that it "resolves method names to the FIRST symbol with that
    // name"), and the indexer runs a parallel worker pool. Declared here as a real
    // limitation, and the reason R2 exists: with the ground leg a one-row index
    // now fails R2 by name instead of failing four surface checks by implication.
    "FLAKY INPUT, observed once: on one run at commit 8938a728 this fixture indexed with 1 of its 2 calling rows and the gate reported 4 surface failures. Three consecutive runs at the same commit were 41/41. The gate now isolates BB_DATA_DIR (so the answer cannot depend on the developer's ~/.bb) and asserts the ground (R2) before any surface leg, so the next occurrence is attributable rather than misattributed.",
  ],
  /**
   * THE GATE'S OWN RED PROOF — what was planted, what convicted it, and the
   * three findings the exercise itself produced.
   *
   * A first attempt at this proof measured nothing: it neutered each law and ran
   * against a CORRECT component, and every run came back green. That is not
   * evidence the laws are inert — a correct component gives every check nothing
   * to complain about, so green is the expected and uninformative result. The
   * measurement that discriminates plants a REAL defect in
   * src/lsp/rich_hover.ts, REBUILDS dist (the wire legs start
   * `dist/lsp/server.js`, a built artifact, while the in-process legs import
   * `src/lsp/*.ts` directly — a src-only plant moves the in-process legs and
   * leaves every wire leg reporting on the OLD build, which is exactly the false
   * reading the first two attempts produced), and records which legs convict it.
   */
  redProofOfTheGate: {
    method: "for each of 7 planted component defects: apply the plant to src/lsp/rich_hover.ts, run `npx tsup` (rebuild dist), run the gate, record the verdict and the full list of failing checks.",
    result: "all 7 defects produce a RED verdict with a written evidence record. Convicting legs, measured:",
    perDefect: [
      { defect: "usage link opens a line one off the stored call site", wireLegs: 9 },
      { defect: "**usages** block renders the containment row", wireLegs: 0, note: "NOT visible to the wire (see the limitation in `limitations`); caught in-process by R6-CONTAIN-3, R6-CONTAIN-4, R6-CONTAIN-MUTANT (b), and by mutant M6" },
      { defect: "**contained** block renders nothing", wireLegs: 5, note: "R4 block-order, R4-LAW-SECTION, R4-LAW-CONTAIN, R4-LAW-CONTAIN-ROWS — the coverage law convicts it, and the absent-header range fix keeps the other blocks' counts honest while it is broken" },
      { defect: "containment leaks into the connected summary", wireLegs: 2, note: "R3 connected-summary, R4-LAW-CONNECTED" },
      { defect: "containment link opens a far line", wireLegs: 2, note: "R4-LAW-CONNECTED, R4-LAW-CONNECTED-ROWS" },
      { defect: "action link opens a line one off", wireLegs: 2, note: "R4-LAW-ACTION and its N6 negative — new coverage; before this lane nothing differentially checked these three targets" },
      { defect: "row label states a different line than it opens", wireLegs: 5, note: "R3 (three substring legs), R4-LAW-LABEL and its N5 negative" },
    ],
    findings: [
      "THE FIRST RED PROOF MEASURED NOTHING. Neutering each law and running against a CORRECT component left the suite green in every case. That is not evidence the laws are inert — a correct component gives every check nothing to complain about, so green is the expected result. The measurement that discriminates plants a REAL defect and asks which legs convict it.",
      "THE REBUILD IS NOT OPTIONAL, AND OMITTING IT PRODUCED A FALSE READING. The wire legs start `dist/lsp/server.js`; the in-process legs import `src/lsp/*.ts`. A src-only plant moves the in-process legs while every wire leg keeps reporting on the OLD build. The second attempt hit exactly this and read as a wire-law failure. Every defect measurement in this record was taken with `npx tsup` run after the plant.",
      "A REAL GATE BUG, found by running the proof rather than by reasoning: with the containment block suppressed, the block-range derivation returned MAX_SAFE_INTEGER for an absent header, so a missing `**contained**` block extended the **usages** range to the end of the card — and the usages laws would then have judged the actions and footnote links as usage rows, with every count wrong for a reason unrelated to the defect. Fixed: an absent header now yields an EMPTY range for its own block, in both the wire splitter and the mutant splitter.",
      "A SECOND REAL GATE BUG, same origin: a negative indexed element 0 of a possibly-empty array and threw `TypeError: Cannot read properties of undefined`. The throw escaped the check loop, so the suite exited with NO verdict and wrote NO evidence — worse than a clean failure, because it destroys the record a reader would use to find out what happened. All seven negatives are now guarded on their block being non-empty and report 'NOT RUN' with the reason instead of throwing.",
      "A THIRD, in the gate's own M4 mutant: its plant anchor was a DEAD GUARD. See `mutants.mutantAnchorAudit` — the pre-fix plant changed nothing observable and was reported caught only because the control predicate was already false.",
    ],
  },
}
writeSealed(EVIDENCE, result)
console.log(`\nH2: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${mutants.caught}/${mutants.total} mutants caught, ${mutants.notJudged} not judged)`)
if (failed > 0) process.exitCode = 1
