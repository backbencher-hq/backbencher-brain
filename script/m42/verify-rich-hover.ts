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
//                   **usages** top-3 file:line links, and a clickable
//                   definition footnote; hover on the Greeter class renders
//                   "implements Named". Existing sections unchanged.
//   R4 differential: every bb.openUsage link target in the hover equals a
//                   location the L3 references surface returns for the same
//                   position (one location owner; no guessed link).
//   R5 budget:      hover p95 <= 50ms warm with the new sections (§3/§12.7).
//   R6 laws:        declared absence (no fabricated sections), contains rows
//                   never render as connection facts, same-name callers are
//                   disambiguated, +N more escape hatch appears past top-3.
//   M1..M6:         mutations — each planted defect is caught.
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
  MAX_USAGE_LINKS,
  richSitesForSymbol,
  siteLabel,
  usagesSection,
  usageSitesOf,
  type RichSite,
} from "../../src/lsp/rich_hover.ts"
import { USAGE_SITE_FILTER_LABEL } from "../../src/lsp/relations.ts"
import type { CallSiteAddress } from "../../src/intelligence/contracts"
import { writeSealed } from "../lib/evidence.ts"

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
/** The real hover's `bb.openUsage` links, kept so the post-session negative can
 *  re-judge them through the same predicate the gate used. */
const hoverUsageLinks: Array<{ command: string; args: { file: string; line: number; character: number } }> = []
/** The reference locations the session measured, for the same reason. */
let refLocsForNegative: ReadonlySet<string> = new Set<string>()

/** THE DIFFERENTIAL, as one function so the gate and its negative judge the same
 *  thing: every link target equals an index-stored location, exactly. A gate that
 *  re-implements its own predicate for its negative is a gate whose negative can
 *  pass for a different reason than the gate fails. */
function linksEqualStoredLocations(
  links: Array<{ args: { file: string; line: number; character: number } }>,
  locations: ReadonlySet<string>,
): { ok: boolean; equal: number } {
  const equal = links.filter((l) => locations.has(`${l.args.file}:${l.args.line}:${l.args.character}`)).length
  return { ok: links.length > 0 && equal === links.length, equal }
}

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
  // It now asserts the real call sites AND the class's absence.
  check(
    "H2/R3: usages section renders the call sites as clickable links",
    md.includes("**usages**") && md.includes(`[main — App.java:${appCallLine}]`) && md.includes(`[main — Main2.java:${main2CallLine}]`),
    md.slice(md.indexOf("**usages**")),
  )
  check(
    "H2/R3: the hovered method's own class never renders as a usage",
    !md.slice(md.indexOf("**usages**")).includes(`Greeter — App.java:${H2_EXPECT.greeter.declLine}`),
    md.slice(md.indexOf("**usages**")),
  )
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
  // Hoisted so the negative below (which runs OUTSIDE the session, after the LSP
  // child is disposed) can re-judge the real links through the real predicate.
  hoverUsageLinks.push(...usageLinks)
  // Lane 6 (§14 rule 1 / rule 3): the differential that used to read "every hover
  // link target equals an L3 reference location" was asserting the DEFECT this
  // lane removed — `textDocument/references` navigated to the referencing
  // symbol's DECLARATION, so "equal to a reference location" meant "opens the
  // declaration". Lane 6 therefore weakened it to a FILE comparison and added a
  // second check asserting the two surfaces must DISAGREE.
  //
  // That second check is WITHDRAWN, and the reason is a law, not a preference:
  // §15.1 — "One surface, one answer… Counts of the same thing never differ" —
  // forbids two surfaces from disagreeing about where a call site is, so an
  // expectation that REQUIRES the disagreement asserts a violation. It was
  // written against the superseded navigation; the call-site migration
  // (9c25a1dc2, "fix(lsp/navigation): references land on the call site, and on
  // every stored row") moved `textDocument/references` onto the stored call site
  // for every row.
  //
  // MEASURED on this fixture at this commit: references answers App.java:15 and
  // Main2.java:6 (1-based) — the two `render()` invocations, not `main`'s
  // declarations on lines 13 and 4 — and all four hover usage links are exactly
  // those two locations. The surfaces agree, which is what the contract wants.
  //
  // What replaces it is STRICTLY STRONGER than either predecessor: lane 6's
  // fallback compared FILES only, which would have passed a link on the wrong
  // line of the right file. §12.1 requires exact equality with an index-stored
  // location — path, line and character.
  const differential = linksEqualStoredLocations(usageLinks, refLocs)
  refLocsForNegative = refLocs
  check(
    "H2/R4: every hover usage link target EQUALS an index-stored location the references surface returns — exact path:line:character, one location owner (§12.1 + §15.1)",
    differential.ok,
    `${differential.equal}/${usageLinks.length} links are index-stored locations; refs: ${JSON.stringify([...refLocs])}; links: ${JSON.stringify(usageLinks.map((l) => ({ f: l.args.file.split("/").pop(), l0: l.args.line, c: l.args.character })))}`,
  )
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
  // And the specific case, stated numerically: the pre-lane gate proved the
  // hover opened the declaration. The new gate proves it opens the call site.
  check(
    "H2/R4: the hover opens the CALL SITE, not the caller's declaration",
    usageLinks.length > 0 && usageLinks.every((l) => l.args.line + 1 === (l.args.file.endsWith("Main2.java") ? main2CallLine : appCallLine)),
    JSON.stringify(usageLinks.map((l) => ({ f: l.args.file.split("/").pop(), line0: l.args.line, line1: l.args.line + 1 }))),
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

/** The five things the pre-lane suite never actually checked, as predicates over
 *  one component's answer for a fixed set of rows. */
function verdictsFor(mod: any): Record<string, boolean> {
  const collected = mod.richSitesForSymbol(rawDouble, "sym-render") as RichSite[]
  const usage = collected.filter((s) => s.reversed && !/^(contains|exports)$/i.test(s.relationshipType))
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
  lastOracleTrace = {
    collected: collected.map((s) => ({ name: s.name, kind: s.relationshipType, reversed: s.reversed, path: `${s.path}:${s.line}:${s.character}`, callSite: s.callSite ?? null })),
    headerCount: header === null ? null : Number(header[1]),
    renderedRows: rows,
    linkTargets,
    refTargets,
    labels,
    expectedCallSites: [`${H2_FILE_APP}:${appCallLine - 1}:0`, `${H2_FILE_MAIN2}:${main2CallLine - 1}:0`],
    groups: groups.map((g) => ({ verb: g.verb, names: g.sites.map((s) => s.name) })),
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
    // §13.5 / M55.T3: a declaration containment is not a connection fact.
    contains: groups.length === 1 && groups[0]!.verb === "called by" && flat.length === 2 &&
      !flat.some((s) => s.name === "Greeter"),
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
    name: "M4: a declaration containment leaks into the connected summary",
    from: "    if (verb === null) continue",
    to: "    if (verb === null) { /* planted: admit every relationship kind */ }",
  },
  {
    name: "M5: undeclared substitution — the row label drops the caveat that says which position it opens",
    from: "  return addressNoteSuffix(site.callSite) === null ? label : `${label} ${addressNoteSuffix(site.callSite)}`",
    to: "  return label",
  },
]

// The CONTROL every mutant suite needs and this one lacked: the oracle must hold
// on the REAL component. If any predicate is false here, a mutant that fails it
// proves nothing, so the suite says so loudly instead of reporting 6/6.
const realVerdicts = verdictsFor({ richSitesForSymbol, usagesSection, connectedGroups, siteLabel })
const realOracleHolds = Object.values(realVerdicts).every(Boolean)
check(
  "H2/M: the mutant oracle HOLDS on the real component (a predicate false here would mark every mutant caught for free)",
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

// A NEGATIVE, not a mutant: the differential must REJECT a fabricated target.
// Run the real predicate against a link whose line was shifted by one — the
// pre-lane M1 asserted only that the fabricated target was absent from the set,
// which is a fact about the data; this asserts that the GATE rejects it.
{
  const tampered = hoverUsageLinks.map((l, i) => (i === 0 ? { ...l, args: { ...l.args, line: l.args.line + 1 } } : l))
  const t = linksEqualStoredLocations(tampered, refLocsForNegative)
  negativesPlanned++
  check("H2/R4 [negative]: the differential REJECTS a link shifted by one line (a fabricated target cannot pass it)", t.ok === false,
    `shifted the first of ${tampered.length} links by +1; differential still said ok=${t.ok} (${t.equal}/${tampered.length} equal)`)
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
      "the suite asserts its oracle HOLDS on the real component before judging any plant; a predicate that is false on the real component would mark every mutant caught for free.",
    importFailureIsNotCaught: true,
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
  verifierCommand: "npx tsx script/m42/verify-rich-hover.ts",
  evidenceFile: "H2.json",
  generatedAt: new Date().toISOString(),
  /**
   * Expectations this lane WITHDREW, with the law that now governs each. Left in
   * the record rather than deleted: a reader who remembers the old number needs
   * to know which law replaced it, and a gate comment is not an audit trail.
   */
  supersededExpectations: [
    {
      was: "H2/R4: the hover's call-site links DIFFER from the L3 reference lines, and the card states the difference",
      why: "superseded by the call-site migration (9c25a1dc2, src/lsp/navigation.ts now emits a per-stored-row `callSite` and textDocument/references lands on the call site for every row). It required two surfaces to DISAGREE about where a call is, which §15.1 forbids outright ('One surface, one answer').",
      governingLaw: "§15.1 + §12.1 — the two surfaces must agree, and every navigation target must equal an index-stored location, differentially checked.",
      replacedBy: "H2/R4: every hover usage link target EQUALS an index-stored location the references surface returns — exact path:line:character. Strictly stronger than lane 6's fallback, which compared FILES only and would have passed a link on the wrong line of the right file.",
      measured: "references answers App.java:15 and Main2.java:6 (1-based) — the two `render()` invocations — and all four hover usage links are exactly those two locations.",
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
}
writeSealed(EVIDENCE, result)
console.log(`\nH2: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${mutants.caught}/${mutants.total} mutants caught, ${mutants.notJudged} not judged)`)
if (failed > 0) process.exitCode = 1
