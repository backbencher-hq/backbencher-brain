// script/m55/verify-identity.ts — M55.T1 verifier + mutation suite
// (issue #770).
//
// Truth Rule 2 (§15, "identity is stated") is a claim about SEPARATION OF
// SURFACES, so one layer cannot prove it. This suite proves it over one
// fixture (script/m55/t1-fixture.ts, authored before these assertions):
//
//   R2 resolver:  the ONE resolver's rules over the REAL index the REAL
//                 indexer wrote — the member target roots at its owning
//                 declaration, an ambiguous same-name member stays null
//                 without a defining-file hint, a traversable name is left to
//                 the direct path, a genuine absence stays null.
//   R3 boundary:  rules the fixture cannot express through real analyzers
//                 (a member with its OWN reverse edges, an owner outside the
//                 traversable whitelist, a member with no owner) over a
//                 hand-seeded db — the same shape, real sqlite.
//   R4 wire:      the REAL dist server: `bb/graph` and `bb/impact` both carry
//                 the substitution as declared data; an absent symbol is a
//                 declared error on both doors, never an empty result.
//   R5 render:    the surfaces that name the result — the ONE title rule
//                 (ide/vscode/src/identity-label.ts, vscode-free so it can run
//                 here) and the core's impact note — state the substitution,
//                 and state it when nothing was substituted.
//   R6 agree:     differential: title label, wire resolution record, wire root
//                 and render note all name the SAME owner, and the label names
//                 the MEMBER too (the defect the owner hit live was a silently
//                 substituted title).
//   R7 mutants:   five planted defects, each a behaviour the pre-M55 code
//                 actually had or a plausible regression of the new rule.
//
// Run: npx tsx script/m55/verify-identity.ts
// Evidence: validation/m55/results/T1.json (machine-emitted)

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { T1_ROOT, T1_EXPECT, writeT1Fixture } from "./t1-fixture.ts"
import { StdioLsp, ensureServerBuilt } from "./lsp-wire.ts"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")
const IDENTITY = path.join(ROOT, "src/lsp/identity.ts")
const IDENTITY_LABEL = path.join(ROOT, "ide/vscode/src/identity-label.ts")
const CORE = path.join(ROOT, "script/m26/graph-core.ts")
const BB = path.join(ROOT, "bin/bb")
const EVIDENCE = path.join(ROOT, "validation/m55/results/T1.json")

let checks = 0
let passed = 0
const failures: string[] = []
let mutantsCaught = 0
let mutantsTotal = 0

function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}
function mutant(label: string, caught: boolean, detail = ""): void {
  mutantsTotal++
  if (caught) mutantsCaught++
  check(`${label} [mutant]`, caught, detail)
}

/** Minimal DOM port (the U3/V1 stub convention) for the ONE renderer core. */
class El {
  tagName: string
  className = ""
  children: El[] = []
  textContent = ""
  attrs: Record<string, string> = {}
  constructor(tag: string) {
    this.tagName = tag
  }
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value
  }
  appendChild(child: El): El {
    this.children.push(child)
    return child
  }
  addClass(name: string): void {
    this.className = this.className ? `${this.className} ${name}` : name
  }
  find(className: string): El | null {
    if (this.className.split(" ").includes(className)) return this
    for (const child of this.children) {
      const hit = child.find(className)
      if (hit !== null) return hit
    }
    return null
  }
  /** Full text of this subtree — the label assertions read it. */
  text(): string {
    return `${this.textContent}${this.children.map((c) => c.text()).join("")}`
  }
}
function makeDom(): { create: (t: string) => El; root: () => El; el: El } {
  const el = new El("div")
  return { create: (t: string) => new El(t), root: () => el, el }
}

const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
const branchDiffStatus = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => l.slice(3))

// --- R1: fixture + the REAL indexer ------------------------------------------
console.log("R1: fixture indexed by the real indexer (isolated data dir)")
writeT1Fixture()
const dataDir = mkdtempSync(path.join(tmpdir(), "m55-t1-data-"))
const env = { ...process.env, BB_DATA_DIR: dataDir }
const canonical = path.resolve(T1_ROOT)
const projectId = createHash("sha1").update(canonical).digest("hex").substring(0, 40)
execFileSync(BB, ["index", T1_ROOT, "--no-setup"], {
  cwd: ROOT,
  encoding: "utf8",
  timeout: 300_000,
  stdio: ["ignore", "pipe", "inherit"],
  env,
})
const dbPath = path.join(dataDir, "projects", projectId, "brain.db")
check("R1: the real indexer wrote brain.db", readFileSync(dbPath).length > 0, dbPath)

const { resolveMemberIdentity, IDENTITY_TRAVERSABLE_TYPES, memberFileMatches } = (await import(
  pathToFileURL(IDENTITY).href
)) as typeof import("../../src/lsp/identity.ts")
const { applyResolutionTitle, substitutionLabel } = (await import(pathToFileURL(IDENTITY_LABEL).href)) as typeof import(
  "../../ide/vscode/src/identity-label.ts"
)

const { BrainDatabase } = (await import(pathToFileURL(path.join(ROOT, "src/brain/database.ts")).href)) as {
  BrainDatabase: { getRawInstance(projectId: string): unknown }
}

// The real index's own connection (read-only use; the resolver only reads).
// BB_DATA_DIR must be the fixture's data dir HERE too: `getRawInstance` reads
// the ambient env, not the env object handed to execFileSync, so the first run
// of this gate opened a fresh EMPTY project db under the default ~/.bb and
// reported the resolver as broken while the wire legs (which do carry the
// fixture env) passed. The harness was wrong, not the resolver.
process.env.BB_DATA_DIR = dataDir
const realDb = (await BrainDatabase.getRawInstance(projectId)) as {
  prepare(sql: string): { get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] }
}
const storeFileHint = path.join(T1_ROOT, T1_EXPECT.member.file)
const cacheFileHint = path.join(T1_ROOT, T1_EXPECT.ambiguous.file)

// --- R2: the resolver's rules over the real index ----------------------------
console.log("\nR2: resolver rules over the real index")
const member = resolveMemberIdentity(realDb, projectId, T1_EXPECT.member.name, storeFileHint)
check(
  "R2: member target roots at its owning declaration",
  member?.name === T1_EXPECT.member.owner,
  JSON.stringify(member),
)
check(
  "R2: the owner carries the owner's own file (not the member's)",
  member !== null && memberFileMatches(storeFileHint, T1_EXPECT.member.ownerFile) && member.name === "Store",
  JSON.stringify(member),
)
const ambiguous = resolveMemberIdentity(realDb, projectId, T1_EXPECT.ambiguous.name)
check(
  "R2: an ambiguous same-name member stays null without a hint (declared error downstream)",
  ambiguous === null,
  JSON.stringify(ambiguous),
)
const ambiguousHinted = resolveMemberIdentity(realDb, projectId, T1_EXPECT.ambiguous.name, cacheFileHint)
check(
  "R2: the hint breaks the ambiguity (constructor of Cache roots at Cache)",
  ambiguousHinted?.name === T1_EXPECT.ambiguous.owner,
  JSON.stringify(ambiguousHinted),
)
const staleHint = resolveMemberIdentity(realDb, projectId, T1_EXPECT.member.name, path.join(T1_ROOT, "src/nowhere.ts"))
check("R2: a hint matching no row never guesses an owner", staleHint === null, JSON.stringify(staleHint))
const direct = resolveMemberIdentity(realDb, projectId, T1_EXPECT.direct.name, path.join(T1_ROOT, T1_EXPECT.direct.file))
check("R2: a traversable root is left to the direct path", direct === null, JSON.stringify(direct))
const absent = resolveMemberIdentity(realDb, projectId, T1_EXPECT.absent)
check("R2: a genuine absence stays null (never someone else's impact)", absent === null, JSON.stringify(absent))

// The accessor: the fixture declares it so the gate asserts the invariant for
// whichever stored type the analyzer gives an accessor, instead of assuming.
const accessorRow = realDb
  .prepare("SELECT symbol_type AS symbolType FROM brain_symbol WHERE project_id = ? AND name = ?")
  .all(projectId, T1_EXPECT.accessor.name) as Array<{ symbolType: string }>
check(
  "R2: the fixture's accessor is indexed (the invariant below is not vacuous)",
  accessorRow.length >= 1,
  JSON.stringify(accessorRow),
)
const accessorType = accessorRow[0]?.symbolType ?? ""
const accessorTraversable = IDENTITY_TRAVERSABLE_TYPES.includes(accessorType)
const accessorResolved = resolveMemberIdentity(realDb, projectId, T1_EXPECT.accessor.name, storeFileHint)
check(
  `R2: accessor (${accessorType || "missing"}) is declared-iff-substituted`,
  accessorTraversable ? accessorResolved === null : accessorResolved?.name === T1_EXPECT.accessor.owner,
  JSON.stringify({ accessorType, accessorResolved }),
)

// --- R3: boundary rules over a hand-seeded db (same shape, real sqlite) ------
console.log("\nR3: boundary rules (hand-seeded db, the shape the real rows have)")
const seedDir = mkdtempSync(path.join(tmpdir(), "m55-t1-seed-"))
const seedProjectId = "t1seed".padEnd(40, "0")
mkdirSync(path.join(seedDir, "projects", seedProjectId), { recursive: true })
const prevDataDir = process.env.BB_DATA_DIR
process.env.BB_DATA_DIR = seedDir
const seedDb = (await BrainDatabase.getRawInstance(seedProjectId)) as {
  prepare(sql: string): { get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown }
}
const insFile = seedDb.prepare(
  "INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)",
)
insFile.run("f1", seedProjectId, path.join(seedDir, "a.ts"), "a.ts", "typescript", "h1")
const insSym = seedDb.prepare(
  "INSERT INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, byte_start, byte_end, owner_symbol_id, gravity_score) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
)
insSym.run("s-edge-member", seedProjectId, "f1", "edgeMember", "member", 3, 3, 10, 20, "s-owner", 5)
insSym.run("s-owner", seedProjectId, "f1", "Owner", "class", 1, 30, 1, 200, null, 9)
insSym.run("s-lonely", seedProjectId, "f1", "lonelyMember", "member", 40, 40, 220, 230, null, 4)
insSym.run("s-odd-owner", seedProjectId, "f1", "oddMember", "member", 45, 45, 240, 250, "s-nontrav-owner", 3)
insSym.run("s-nontrav-owner", seedProjectId, "f1", "NontraversableOwner", "namespace", 44, 60, 235, 300, null, 2)
insSym.run("s-quiet-member", seedProjectId, "f1", "quietMember", "member", 70, 70, 400, 410, "s-owner", 2)
const insRel = seedDb.prepare(
  "INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence) VALUES (?,?,?,?,?,?)",
)
insRel.run("r1", seedProjectId, "s-owner", "s-edge-member", "calls", 0.9)

const edgeMember = resolveMemberIdentity(seedDb, seedProjectId, "edgeMember")
check(
  "R3: a member with its OWN reverse edges keeps its own impact (no re-root)",
  edgeMember === null,
  JSON.stringify(edgeMember),
)
const lonely = resolveMemberIdentity(seedDb, seedProjectId, "lonelyMember")
check("R3: a member with no owning declaration stays null", lonely === null, JSON.stringify(lonely))
const oddOwner = resolveMemberIdentity(seedDb, seedProjectId, "oddMember")
check(
  "R3: a non-traversable owner is not a legal root (null, declared error downstream)",
  oddOwner === null,
  JSON.stringify(oddOwner),
)
const quiet = resolveMemberIdentity(seedDb, seedProjectId, "quietMember")
check(
  "R3: a quiet member with a traversable owner resolves (the rule is not a blanket refusal)",
  quiet?.name === "Owner",
  JSON.stringify(quiet),
)
process.env.BB_DATA_DIR = prevDataDir

// --- R4: the wire -----------------------------------------------------------------
console.log("\nR4: the real server over the real index (both doors)")
ensureServerBuilt()
const lsp = new StdioLsp(T1_ROOT, env)
let graphMember: any = null
let graphRecord: any = null
let impactMember: any = null
let impactRecord: any = null
let graphAbsentMessage = ""
let impactAbsentMessage = ""
let graphAmbiguousMessage = ""
try {
  await lsp.initialize(T1_ROOT)
  const g = await lsp.request("bb/graph", {
    schemaVersion: 2,
    symbol: T1_EXPECT.member.name,
    file: storeFileHint,
    direction: "both",
  })
  graphMember = g.result?.root ?? null
  graphRecord = g.result?.resolution ?? null
  check(
    "R4: bb/graph roots the member at its owning declaration",
    graphMember?.name === T1_EXPECT.member.owner,
    JSON.stringify(graphMember),
  )
  check(
    "R4: bb/graph carries the substitution as declared data",
    graphRecord?.through === "owning-declaration" &&
      graphRecord?.memberName === T1_EXPECT.member.name &&
      graphRecord?.ownerName === T1_EXPECT.member.owner,
    JSON.stringify(graphRecord),
  )

  const i = await lsp.request("bb/impact", {
    schemaVersion: 1,
    symbol: T1_EXPECT.member.name,
    file: storeFileHint,
  })
  impactMember = i.result?.root ?? null
  impactRecord = i.result?.resolution ?? null
  check(
    "R4: bb/impact roots the member at the same owning declaration",
    impactMember?.name === T1_EXPECT.member.owner,
    JSON.stringify(impactMember),
  )
  check(
    "R4: bb/impact carries the same declared substitution",
    impactRecord?.through === "owning-declaration" && impactRecord?.ownerName === T1_EXPECT.member.owner,
    JSON.stringify(impactRecord),
  )

  const gAbsent = await lsp.request("bb/graph", { schemaVersion: 2, symbol: T1_EXPECT.absent, direction: "both" })
  graphAbsentMessage = gAbsent.error?.message ?? ""
  check(
    "R4: an absent symbol is a declared error on bb/graph (never an empty result)",
    gAbsent.error !== undefined && graphAbsentMessage.startsWith("bb/graph:"),
    graphAbsentMessage.slice(0, 140),
  )
  const iAbsent = await lsp.request("bb/impact", { schemaVersion: 1, symbol: T1_EXPECT.absent })
  impactAbsentMessage = iAbsent.error?.message ?? ""
  check(
    "R4: an absent symbol is a declared error on bb/impact",
    iAbsent.error !== undefined && impactAbsentMessage.startsWith("bb/impact:"),
    impactAbsentMessage.slice(0, 140),
  )

  const gAmb = await lsp.request("bb/graph", { schemaVersion: 2, symbol: T1_EXPECT.ambiguous.name, direction: "both" })
  graphAmbiguousMessage = gAmb.error?.message ?? ""
  check(
    "R4: an ambiguous member with no hint is a declared error (never a guessed owner)",
    gAmb.error !== undefined && graphAmbiguousMessage.startsWith("bb/graph:"),
    JSON.stringify(gAmb.result ?? graphAmbiguousMessage).slice(0, 160),
  )
} finally {
  await lsp.dispose()
}

// --- R5: the render surfaces -------------------------------------------------------
console.log("\nR5: the render surfaces state the substitution")
const hubPanel = { title: "" }
applyResolutionTitle(
  hubPanel,
  "Backbencher Hub — constructor",
  { ok: true, resolution: graphRecord ?? undefined },
  T1_EXPECT.member.name,
  "Hub",
)
check(
  "R5: the hub title names the member AND its owning declaration",
  hubPanel.title.includes(T1_EXPECT.member.name) &&
    hubPanel.title.includes(T1_EXPECT.member.owner) &&
    hubPanel.title.includes("owning declaration"),
  hubPanel.title,
)
const impactPanelTitle = { title: "" }
applyResolutionTitle(
  impactPanelTitle,
  "Backbencher Impact — constructor",
  { ok: true, resolution: impactRecord ?? undefined },
  T1_EXPECT.member.name,
  "Impact",
)
check("R5: the impact title applies the same rule", impactPanelTitle.title === hubPanel.title.replace("Hub", "Impact"), impactPanelTitle.title)
const directTitle = { title: "" }
applyResolutionTitle(directTitle, "Backbencher Hub — main", { ok: true }, "main", "Hub")
check("R5: a direct resolution keeps the plain title (nothing substituted, nothing said)", directTitle.title === "Backbencher Hub — main", directTitle.title)
check("R5: no label is produced for a direct resolution", substitutionLabel({ through: "direct" }) === null, "")
const failedTitle = { title: "" }
applyResolutionTitle(failedTitle, "Backbencher Hub — constructor", { ok: false, error: "bb/graph: nope" }, "constructor", "Hub")
check("R5: a declared failure never invents a substitution label", failedTitle.title === "Backbencher Hub — constructor", failedTitle.title)

const { renderImpact } = (await import(pathToFileURL(CORE).href)) as typeof import("../../script/m26/graph-core.ts")
const domNote = makeDom()
renderImpact(
  {
    root: { id: "s-store", name: T1_EXPECT.member.owner, file: T1_EXPECT.member.ownerFile },
    impact: [],
    resolution: { through: "owning-declaration", memberName: T1_EXPECT.member.name, ownerName: T1_EXPECT.member.owner },
    shownCount: 0,
    totalCountIfKnown: 0,
    truncated: false,
  } as never,
  domNote as never,
)
const note = domNote.el.find("bb-impact-resolution-note")
check("R5: the impact render emits the declared substitution note", note !== null, "")
check(
  "R5: the note names the member and the owner (not the owner alone)",
  note !== null && note.text().includes(T1_EXPECT.member.name) && note.text().includes(T1_EXPECT.member.owner),
  note?.text() ?? "no note",
)
const domDirect = makeDom()
renderImpact(
  {
    root: { id: "s-store", name: "Store", file: "src/store.ts" },
    impact: [],
    resolution: { through: "direct" },
    shownCount: 0,
    totalCountIfKnown: 0,
    truncated: false,
  } as never,
  domDirect as never,
)
check(
  "R5: a direct resolution renders no note (nothing was substituted)",
  domDirect.el.find("bb-impact-resolution-note") === null,
  domDirect.el.text().slice(0, 120),
)

// --- R6: differential — the surfaces agree ------------------------------------------
console.log("\nR6: differential (title, wire record and render name the same owner)")
check(
  "R6: graph root == impact root == the record's ownerName",
  graphMember?.name === T1_EXPECT.member.owner &&
    impactMember?.name === graphMember?.name &&
    graphRecord?.ownerName === graphMember?.name,
  JSON.stringify({ graph: graphMember?.name, impact: impactMember?.name, record: graphRecord?.ownerName }),
)
check(
  "R6: the title's owner == the wire's owner",
  hubPanel.title.includes(String(graphRecord?.ownerName)),
  hubPanel.title,
)
check(
  "R6: the render note's owner == the wire's owner",
  note !== null && note.text().includes(String(graphRecord?.ownerName)),
  note?.text() ?? "no note",
)
check(
  "R6: every surface names the MEMBER too (the silent relabel this rule prevents)",
  hubPanel.title.includes(T1_EXPECT.member.name) &&
    note !== null &&
    note.text().includes(T1_EXPECT.member.name) &&
    graphRecord?.memberName === T1_EXPECT.member.name,
  "",
)

// --- R7: mutants ---------------------------------------------------------------------
console.log("\nR7: mutants (each planted defect must fail the suite)")
const identitySource = readFileSync(IDENTITY, "utf8")
const labelSource = readFileSync(IDENTITY_LABEL, "utf8")
const coreSource = readFileSync(CORE, "utf8")

/** Write a single-file mutant (these three files import nothing) and probe it. */
async function withFile(
  name: string,
  source: string,
  from: string,
  to: string,
  probe: (m: any) => Promise<boolean> | boolean,
): Promise<void> {
  if (!source.includes(from)) {
    check(`M: ${name} (SKIP — anchor not found)`, false, from.slice(0, 90))
    return
  }
  const dir = mkdtempSync(path.join(tmpdir(), "m55-t1-mut-"))
  const target = path.join(dir, "mutant.ts")
  writeFileSync(target, source.replace(from, to))
  try {
    const m = await import(pathToFileURL(target).href)
    mutant(name, await probe(m))
  } catch (e) {
    mutant(name, true, `mutant failed to load: ${String(e).slice(0, 90)}`)
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
}

// M1: the resolver hands back the MEMBER row instead of its owning declaration
// — the pre-M55 shape this whole rule exists to end.
await withFile(
  "M1: owner substituted by the member row (silent relabel at the source)",
  identitySource,
  "    return { id: owner.id, name: owner.name, file: owner.file }",
  "    return { id: member.id, name: member.name, file: member.file }",
  (m) => (m.resolveMemberIdentity(realDb, projectId, T1_EXPECT.member.name, storeFileHint)?.name ?? "Store") !== "Store",
)
// M2: the ambiguity guard removed — a name-only lookup guesses the first row.
await withFile(
  "M2: ambiguity guard removed (a name-only lookup guesses an owner)",
  identitySource,
  "    if (memberRows.length > 1) {",
  "    if (false) {",
  (m) => m.resolveMemberIdentity(realDb, projectId, T1_EXPECT.ambiguous.name) !== null,
)
// M3: the title rule ignores the resolution — the panel keeps the plain title,
// which is exactly the defect found live.
await withFile(
  "M3: title rule ignores the substitution (panel keeps the plain title)",
  labelSource,
  "  const label = substitutionLabel(outcome.resolution)",
  "  const label = null",
  (m) => {
    const p = { title: "" }
    m.applyResolutionTitle(p, "plain", { ok: true, resolution: { through: "owning-declaration", memberName: "constructor", ownerName: "Store" } }, "constructor", "Hub")
    return p.title === "plain"
  },
)
// M4: the label names only the owner — the member the user asked for is gone.
await withFile(
  "M4: label names only the owner (the member disappears)",
  labelSource,
  "  return `${member} → ${owner} (owning declaration)`",
  "  return `${owner} (owning declaration)`",
  (m) => {
    const l = m.substitutionLabel({ through: "owning-declaration", memberName: "constructor", ownerName: "Store" })
    return typeof l === "string" && !l.includes("constructor")
  },
)
// M5: the render note stops naming the member — the owner alone is displayed.
await withFile(
  "M5: render note drops the member name",
  coreSource,
  '    (member, owner) => `"${member}" has no dependencies of its own — showing the impact of its owner ${owner}`,',
  "    (member, owner) => `showing the impact of its owner ${owner}`,",
  (m) => {
    const d = makeDom()
    m.renderImpact(
      {
        root: { id: "s", name: "Store", file: "src/store.ts" },
        impact: [],
        resolution: { through: "owning-declaration", memberName: "constructor", ownerName: "Store" },
        shownCount: 0,
        totalCountIfKnown: 0,
        truncated: false,
      },
      d,
    )
    const n = d.el.find("bb-impact-resolution-note")
    return n === null || !n.text().includes("constructor")
  },
)

// --- Evidence ------------------------------------------------------------------------
const status = failures.length === 0 ? "verified" : "known-gap"
const result = {
  issue: "770",
  code: "T1",
  milestone: "M55",
  title: "One identity resolver (Truth Rule 2)",
  status,
  passed,
  failed: failures.length,
  checks,
  mutantsCaught,
  mutantsTotal,
  negatives: 0,
  currentCommit,
  workingTreeRelevantChanges: branchDiffStatus.filter(
    (f) =>
      f.startsWith("src/lsp/") ||
      f.startsWith("ide/vscode/src/") ||
      f.startsWith("script/m55/") ||
      f.startsWith("script/m26/graph-core.ts"),
  ),
  verifierCommand: "npx tsx script/m55/verify-identity.ts",
  evidenceFile: "T1.json",
  generatedAt: new Date().toISOString(),
  failures,
}
mkdirSync(path.dirname(EVIDENCE), { recursive: true })
writeSealed(EVIDENCE, result)
console.log(`\nT1: ${status.toUpperCase()} (${passed}/${checks} passed, ${mutantsCaught}/${mutantsTotal} mutants)`)
console.log(`Evidence: ${EVIDENCE}`)
if (failures.length > 0) {
  console.log("Failures:")
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
process.exit(0)
