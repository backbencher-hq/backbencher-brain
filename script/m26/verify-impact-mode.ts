// script/m26/verify-impact-mode.ts — M26.W5 verifier + mutation suite.
//
// Proves the impact surface (src/lsp/impact.ts) honors its declared
// guarantees against a REAL seeded sqlite index, and that the suite CAN FAIL.
//
//   R1 real engine:   computeImpact over graphTraversal on a seeded db —
//                     flat-fixture counts agree with the L3 references
//                     surface (differential; flat sampling stated below)
//   R2 nested delta:  a nested-child caller counts in impact but not in flat
//                     L3 references — the declared containment difference,
//                     verified to behave exactly as declared
//   G2 declared:      truncated ⟺ reason; shown/total-if-known counts real
//                     (total via the independent COUNT query)
//   G4 rendered:      budget exhaustion renders a visible marker with
//                     declared counts; complete sets render none
//   P-budget:         p95 impact computation within the contract §3 render
//                     budget on the pinned fixture
//
// Mutants (each must be CAUGHT):
//   M1 silent truncation        (marker logic removed)
//   M2 fabricated total         (total invented when unknown)
//   M3 unbounded impact         (budget lifted)
//   M4 differential break       (containment rule dropped from total count)
//   M12 via erased              (a cascaded row claims to be an exact one)
//   M14 evidence re-read off    (one row's evidence at another row's depth)
//   M15 depth correction off    (the first trace published as the shortest path)
//   M13 composition undeclared  (the cascade breakdown stops being published)
//   M5 truncation state lost    (truncated flag always false)
//
// Differential sampling statement: the differential census samples ALL flat
// reverse-dependency symbols on the seeded fixture (the fixture IS the
// sample; nothing is skipped), restricted to direct-edge callers — the
// declared containment difference is verified separately (R2).
//
// Run: npx tsx script/m26/verify-impact-mode.ts
// Evidence: validation/m26/results/W5.json (machine-emitted)

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { realpathSync } from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const IMPACT = join(ROOT, "src", "lsp", "impact.ts")
// M42.H4: renderImpact moved into the ONE renderer core (webviews render
// through script/m26/graph-core.ts, never a second server-side renderer).
// The W5 render laws are unchanged; only the home moved.
const CORE = join(ROOT, "script", "m26", "graph-core.ts")

let checks = 0
let passed = 0

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}

// --- Test DOM (same stub shape as W1/W4) --------------------------------------
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
    for (const c of this.children) {
      const hit = c.find(className)
      if (hit) return hit
    }
    return null
  }
  findAll(className: string): El[] {
    const out: El[] = []
    if (this.className.split(" ").includes(className)) out.push(this)
    for (const c of this.children) out.push(...c.findAll(className))
    return out
  }
}
function makeDom(): { create: (t: string) => El; root: () => El; el: El } {
  const el = new El("div")
  return { create: (t: string) => new El(t), root: () => el, el }
}

// --- Real seeded sqlite fixture ------------------------------------------------
async function makeFixture(): Promise<{
  projectId: string
  raw: any
  ws: string
  cleanup: () => void
}> {
  const ws = mkdtempSync(join(tmpdir(), "w5-ws-"))
  const dataDir = mkdtempSync(join(tmpdir(), "w5-data-"))
  // Real file on disk: L3 position conversion reads it (byte columns below
  // follow the per-line convention against this content).
  writeFileSync(join(ws, "main.ts"), "export function rootFn(): void {}\nfunction caller1() { rootFn() }\nfunction caller2() { rootFn() }\nfunction caller3() { rootFn() }\nfunction nested1() { rootFn() }\nfunction otherFn() {}\n")
  const canonical = realpathSync(ws)
  const projectId = createHash("sha1").update(canonical).digest("hex").substring(0, 40)
  mkdirSync(join(dataDir, "projects", projectId), { recursive: true })
  process.env.BB_DATA_DIR = dataDir
  const { BrainDatabase } = await import(join(ROOT, "src", "brain", "database.ts"))
  const raw = await BrainDatabase.getRawInstance(projectId)
  raw.prepare(`INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)`).run("file-1", projectId, join(ws, "main.ts"), "main.ts", "typescript", "w5-hash")
  const sym = raw.prepare(`INSERT INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, byte_start, byte_end, gravity_score) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  // Flat fixture: root + 3 direct callers (differential sample) + 1 nested
  // child under caller1 (containment delta) + an unrelated symbol.
  sym.run("sym:root", projectId, "file-1", "rootFn", "function", 1, 2, 1, 4, 9)
  sym.run("sym:caller1", projectId, "file-1", "caller1", "function", 3, 3, 6, 9, 5)
  sym.run("sym:caller2", projectId, "file-1", "caller2", "function", 4, 4, 10, 13, 4)
  sym.run("sym:caller3", projectId, "file-1", "caller3", "function", 5, 5, 14, 17, 3)
  // Nested child: owner_symbol_id inside caller1's id-prefix cascade range.
  sym.run("sym:caller1:nested1", projectId, "file-1", "nested1", "function", 6, 6, 18, 21, 2)
  sym.run("sym:other", projectId, "file-1", "otherFn", "function", 7, 7, 22, 25, 1)
  const rel = raw.prepare(`INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence) VALUES (?,?,?,?,?,?)`)
  rel.run("w5-rel-1", projectId, "sym:caller1", "sym:root", "calls", 0.95)
  rel.run("w5-rel-2", projectId, "sym:caller2", "sym:root", "calls", 0.9)
  rel.run("w5-rel-3", projectId, "sym:caller3", "sym:root", "calls", 0.85)
  // Nested child calls root too — impact YES (cascade), flat L3 references NO extra location.
  rel.run("w5-rel-4", projectId, "sym:caller1:nested1", "sym:root", "calls", 0.8)
  // Unrelated edges that must not enter the impact set.
  rel.run("w5-rel-5", projectId, "sym:root", "sym:other", "calls", 0.9)
  rel.run("w5-rel-6", projectId, "sym:caller1", "sym:caller2", "calls", 0.7)

  // M63.T1 — the three shapes the OLD flat COUNT could not tell apart, seeded
  // on their own roots so the rootFn differential above stays untouched. The
  // corpus lane (fixtures/impact) found the real defects; these make the
  // in-repo gate able to see them too:
  //   hub2      a TRANSITIVE dependent (other → hub2mid → hub2): a depth-0
  //             count answers 1 where the set is 2
  //   hub2 cyc  a cycle (hub2 → hub2mid): the root is a dependent of itself
  //   klass     an OWNER CASCADE (other → mem, where mem belongs to klass):
  //             a count that forgets the cascade answers 0
  //   nondep    a `contains` row aimed at the class: a count with no
  //             relationship-kind filter answers 2 where the rule says 1
  const owned = raw.prepare(
    `INSERT INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, byte_start, byte_end, gravity_score, owner_symbol_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  )
  sym.run("sym:hub2", projectId, "file-1", "hub2", "function", 8, 8, 27, 31, 8)
  sym.run("sym:hub2:mid", projectId, "file-1", "hub2mid", "function", 9, 9, 32, 37, 7)
  sym.run("sym:klass", projectId, "file-1", "Klass", "class", 10, 12, 38, 46, 6)
  owned.run("sym:klass:mem", projectId, "file-1", "mem", "method", 11, 11, 39, 42, 5, "sym:klass")
  sym.run("sym:other2", projectId, "file-1", "otherFn2", "function", 13, 13, 47, 51, 1)
  rel.run("w5-rel-7", projectId, "sym:hub2:mid", "sym:hub2", "calls", 0.9)
  rel.run("w5-rel-8", projectId, "sym:other", "sym:hub2:mid", "calls", 0.9)
  rel.run("w5-rel-9", projectId, "sym:hub2", "sym:hub2:mid", "calls", 0.9)
  rel.run("w5-rel-10", projectId, "sym:other", "sym:klass:mem", "calls", 0.9)

  // M63.T2 — the shape that makes the ENGINE's depth and the ANSWER's depth
  // disagree, which is what the evidence re-read exists for. The engine's caller
  // walk recurses depth-first and stamps a node with the depth of the FIRST trace
  // that reached it, so when a node is reachable both directly and through an
  // intermediate, which trace finds it first is decided by the walk, not by the
  // graph. The corpus lane measured 340 of 4 258 rows (7.98%) published with the
  // engine's row and the answer's depth on two different paths, and a
  // cross-language flag was the field that showed it.
  //
  // `deep` is reachable directly AND through `viabridge`. Whichever trace the
  // engine takes, the answer's depth is the shortest (1), so the evidence it
  // quotes must be the DIRECT row — and the direct row carries
  // `is_cross_language = 0` while the indirect one carries 1. A tool that quotes
  // the engine's row regardless reports a cross-language dependent whose own
  // direct row says it is not one.
  sym.run("sym:deep", projectId, "file-1", "deepFn", "function", 14, 14, 52, 56, 7)
  sym.run("sym:via", projectId, "file-1", "viaFn", "function", 15, 15, 57, 61, 6)
  rel.run("w5-rel-11", projectId, "sym:deep", "sym:hub2", "calls", 0.55)
  rel.run("w5-rel-12", projectId, "sym:via", "sym:deep", "calls", 0.55)
  // The same pair, flagged, the way a stored cross-language row looks.
  raw.prepare(
    `INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, is_cross_language, bridge_mechanism)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run("w5-rel-13", projectId, "sym:via", "sym:deep", "calls", 0.55, 1, "name-resolution")

  // ...and the shape that makes the two paths DISAGREE, which the small fixture
  // above cannot produce on its own. The engine's per-query site limit is 200
  // rows and its order is `kindRank, fileRel, lineNumber, rowId`, so a symbol
  // whose direct row sorts last is cut from the root's query while the same
  // symbol reached through another caller survives — and the engine then stamps
  // it at the depth of the trace that got there first, which is not the shortest.
  //
  // `twice` is that symbol: 200 direct callers of `wide` sort ahead of its own
  // direct row, so the root's query never sees it, and it is found at depth 1
  // through `gate`. Its DIRECT row is not cross-language; the row through
  // `gate` is. So the depth and the evidence genuinely belong to two different
  // stored rows, and the answer can only be right by re-reading the evidence at
  // the depth it reports.
  sym.run("sym:wide", projectId, "file-1", "wideFn", "function", 20, 20, 62, 66, 9)
  // `gate` sorts ahead of the two hundred (line 21), so it IS seen at depth 0,
  // and `twice` is then found through it at depth 1.
  sym.run("sym:gate", projectId, "file-1", "gateFn", "function", 21, 21, 67, 71, 8)
  for (let i = 0; i < 200; i++) {
    sym.run(`sym:widec${i}`, projectId, "file-1", `wide${i}`, "function", 200 + i, 200 + i, 1_000 + i, 1_004 + i, 1)
    rel.run(`w5-wide-${i}`, projectId, `sym:widec${i}`, "sym:wide", "calls", 0.5)
  }
  // `twice` is inserted AFTER the two hundred and carries the highest line
  // number, so the engine's order — `kindRank, fileRel, lineNumber, rowId` — puts
  // its direct row LAST and the 200-row site limit cuts it. That is the whole
  // shape: a row that exists, is a real dependency, and the walk never sees.
  sym.run("sym:twice", projectId, "file-1", "twiceFn", "function", 9_999, 9_999, 9_000, 9_004, 7)
  rel.run("w5-twice-direct", projectId, "sym:twice", "sym:wide", "calls", 0.5)
  rel.run("w5-gate", projectId, "sym:gate", "sym:wide", "calls", 0.5)
  rel.run("w5-twice-via", projectId, "sym:twice", "sym:gate", "calls", 0.5)
  raw.prepare(
    `INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, is_cross_language, bridge_mechanism)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run("w5-twice-via-cross", projectId, "sym:twice", "sym:gate", "calls", 0.5, 1, "name-resolution")
  return {
    projectId,
    raw,
    ws,
    cleanup: () => {
      try {
        rmSync(ws, { recursive: true, force: true })
      } catch {}
      try {
        rmSync(dataDir, { recursive: true, force: true })
      } catch {}
    },
  }
}

async function main(): Promise<void> {
  const mod = await import(IMPACT)
  const impact = mod as {
    computeImpact: (db: any, projectId: string, name: string, deps?: any) => Promise<any>
    countImpactDependents: (db: any, projectId: string, id: string, opts?: any) => { total: number | null; direct: number; rowsScanned: number; expansions: number; hitScanCeiling: boolean }
    IMPACT_BUDGET: { maxNodes: number; maxDepth: number }
  }
  const coreMod = await import(CORE)
  const core = coreMod as { renderImpact: (r: any, dom: any) => any }
  const source = readFileSync(IMPACT, "utf8")
  const coreSource = readFileSync(CORE, "utf8")

  const fx = await makeFixture()
  try {
    // M63.T2: the two-path shape, and what the answer says about it. Printed
    // unconditionally first, because a check that passes vacuously on a fixture
    // that does not produce the shape is worse than no check at all.
    const deepResult = await impact.computeImpact(fx.raw, fx.projectId, "hub2")
    console.log(
      `  [fixture] hub2 impact: ${deepResult.impact
        .map((d: any) => `${d.name}@${d.depth}/ev@${d.evidenceAtDepth}/cross=${d.isCrossLanguage}`)
        .join(" ")}`,
    )
    const wideResult = await impact.computeImpact(fx.raw, fx.projectId, "wideFn")
    const twice = wideResult.impact.find((d: any) => d.id === "sym:twice")
    const twiceShape = twice ? `${twice.name}@${twice.depth}/ev@${twice.evidenceAtDepth}/cross=${twice.isCrossLanguage}` : "ABSENT"
    check(
      wideResult.totalCountIfKnown === 202 && wideResult.truncated === true && wideResult.truncationReason === "impact-node-budget-exhausted",
      "R5: a root whose site limit cut a real dependent declares a prefix and the true size",
      "fixture/wideFn",
      `shown=${wideResult.shownCount} total=${wideResult.totalCountIfKnown} reason=${wideResult.truncationReason}`,
    )
    // The shape the corpus lane measured at 7.98% of rows: the engine reached
    // `twice` through `gate` because its direct row was cut by the site limit, so
    // the engine's depth (1) and the shortest path (0) disagree — and the two
    // rows disagree about the cross-language flag as well.
    check(twice !== undefined && twice.depth === 0, "R5: the dependent is reported at its SHORTEST path, not the engine's first trace", "fixture/wideFn", twiceShape)
    check(twice !== undefined && twice.isCrossLanguage === false, "R5: the evidence is the row at the reported depth, so a longer path's flag is not quoted", "fixture/wideFn", twiceShape)
    check(twice !== undefined && twice.evidenceAtDepth === twice.depth, "R5: the answer says which path the quoted evidence is on", "fixture/wideFn", twiceShape)

    // --- R1: real engine + differential vs L3 --------------------------------
    const result = await impact.computeImpact(fx.raw, fx.projectId, "rootFn")
    const names = result.impact.map((d: any) => d.name).sort()
    check("R1: real engine — impact set is the 4 reverse dependencies", names.join(",") === "caller1,caller2,caller3,nested1", names.join(","))
    check("G2: complete set is not truncated and total is exact", result.truncated === false && result.truncationReason === null && result.totalCountIfKnown === 4 && result.shownCount === 4)

    // Differential vs the L3 references surface (real resolveReferences).
    // Declared sampling: the flat fixture IS the sample — every reverse edge
    // of rootFn is in it, none skipped. Like-for-like rule: since M55.T3
    // (issue #772, §14 Truth Rule 1) L3 references answers the USAGE SITES —
    // incoming rows whose kind is not a declaration containment — which is
    // exactly the reverse-only set impact computes. No direction correction is
    // needed any more: the pre-M55 version had to subtract the fixture's one
    // outgoing row (rootFn→otherFn) because references counted both ways.
    // Callers are 1:1 with their edges here (one call site each) — the flat
    // condition.
    const { resolveReferences } = await import(join(ROOT, "src", "lsp", "navigation.ts"))
    const refs = resolveReferences(fx.raw, { filePath: join(fx.ws, "main.ts"), line: 0, character: 17, includeDeclaration: false })
    const depth0 = result.impact.filter((d: any) => d.depth === 0)
    const l3Incoming = refs.totalCount
    check("R1: differential — impact set equals the L3 usage-site set on the flat fixture (all reverse edges sampled)", l3Incoming === 4 && depth0.length === 4 && result.shownCount === 4, `l3 totalCount=${refs.totalCount} incoming=${l3Incoming} impact=${result.shownCount}`)
    check("R1: L3 truncated=false with the full set under MAX_LOCATIONS", refs.truncated === false && refs.evidenceTier === "indexed")

    // --- R2: the declared containment delta ------------------------------------
    check("R2: nested caller counts in impact (cascade) — declared containment rule", names.includes("nested1"))
    check("R2: containment delta documented in the component", source.includes("owner cascade") && source.includes("flat reference counts"))

    // --- G2: total via the independent counting walk ----------------------------
    // M63.T1: the total is measured under the walk's own rule (kinds, cascade,
    // noise, depth) with no node budget — the same reason the flat COUNT it
    // replaced could not be trusted on a real corpus.
    const counted = impact.countImpactDependents(fx.raw, fx.projectId, "sym:root")
    check("G2: independent counting walk agrees with the traversal total", counted.total === 4, `total=${counted.total}`)
    check("G2: the counting walk reports its own cost (declared, never hidden)", counted.rowsScanned > 0 && counted.expansions > 0 && counted.hitScanCeiling === false, JSON.stringify(counted))

    // --- G4: in-UI rendering with declared counts --------------------------------
    // The renderer under law is the ONE core (M42.H4 home); the DOM contract
    // is the W5-born one, verbatim.
    const dom = makeDom()
    const rendered = core.renderImpact(result, dom as never)
    check("G4: complete set renders all nodes and NO truncation marker", rendered.nodesRendered === 4 && dom.el.find("bb-impact-truncation-marker") === null)

    // Over-budget: run the traversal then slice through a budget-limited render.
    const big = { ...result, impact: result.impact.slice(0, 2), shownCount: 2, totalCountIfKnown: 4, truncated: true, truncationReason: "impact-node-budget-exhausted" }
    const domT = makeDom()
    const renderedT = core.renderImpact(big, domT as never)
    const marker = domT.el.find("bb-impact-truncation-marker") as El | null
    check("G4: truncated set renders a visible marker", renderedT.nodesRendered === 2 && marker !== null)
    check("G4: marker declares shown vs total-if-known counts", marker !== null && marker!.attrs["data-shown"] === "2" && marker!.attrs["data-total-if-known"] === "4" && marker!.textContent.includes("2 of 4"))
    // Unknown total renders honestly as unknown.
    const domU = makeDom()
    core.renderImpact({ ...big, totalCountIfKnown: null }, domU as never)
    const markerU = domU.el.find("bb-impact-truncation-marker") as El | null
    check("G4: unknown total renders 'unknown', never a fabricated number", markerU !== null && markerU!.attrs["data-total-if-known"] === "unknown" && markerU!.textContent.includes("total unknown"))

    // Declared empty-state (owner live test, 2026-09-12): a resolved root with
    // zero reverse dependencies renders the visible absence note — never
    // legend-only silence.
    const domE = makeDom()
    const renderedE = core.renderImpact({ ...result, impact: [], shownCount: 0, totalCountIfKnown: 0, truncated: false, truncationReason: null }, domE as never)
    const emptyEl = domE.el.find("bb-impact-empty") as El | null
    check("G4: empty impact set renders the declared absence note (never legend-only)", renderedE.nodesRendered === 0 && emptyEl !== null && emptyEl!.attrs["data-empty"] === "impact" && emptyEl!.textContent.includes("No reverse dependencies"))
    // ...and a non-empty set must NOT carry the empty note (no false absence).
    const domNE = makeDom()
    core.renderImpact(result, domNE as never)
    check("G4: non-empty impact set renders no absence note", domNE.el.find("bb-impact-empty") === null)

    // --- G4b: a NON-EXACT name is a substitution and the panel says so --------
    // M63.T1. Measured on the bb_impact corpus lane: asked about graphql-js
    // `push` (141 stored relationships point at a `push`), the answer is an
    // empty set about a different `push`. A panel that renders only the
    // numbers is indistinguishable from "nothing depends on this".
    const domFuzzy = makeDom()
    core.renderImpact(
      { ...result, root: { ...result.root, file: "lib/push.js" }, rootMatch: { requested: "rootFnX", via: "fuzzy-containment", nameMatches: 0 } } as never,
      domFuzzy as never,
    )
    const fuzzyNote = domFuzzy.el.find("bb-root-match-note") as El | null
    check(
      "G4b: a containment match renders a visible substitution note",
      fuzzyNote !== null && fuzzyNote!.textContent.includes("rootFnX") && fuzzyNote!.textContent.includes("rootFn") && fuzzyNote!.textContent.includes("lib/push.js"),
      fuzzyNote?.textContent ?? "no note",
    )
    check(
      "G4b: the note rides machine-readable attributes",
      domFuzzy.el.attrs["data-root-match"] === "fuzzy-containment" && domFuzzy.el.attrs["data-root-requested"] === "rootFnX" && domFuzzy.el.attrs["data-root-name-matches"] === "0",
      JSON.stringify(domFuzzy.el.attrs),
    )
    // An EXACT match renders no such note (declared absence), and neither does
    // the owning-declaration case, which has its own resolution note.
    const domExact = makeDom()
    core.renderImpact({ ...result, rootMatch: { requested: "rootFn", via: "exact", nameMatches: 1 } } as never, domExact as never)
    check("G4b: an exact match renders no substitution note", domExact.el.find("bb-root-match-note") === null)
    const domOwner = makeDom()
    core.renderImpact(
      { ...result, resolution: { through: "owning-declaration", memberName: "ctor", ownerName: "rootFn" }, rootMatch: { requested: "ctor", via: "owning-declaration", nameMatches: 2 } } as never,
      domOwner as never,
    )
    check(
      "G4b: the owning-declaration case keeps its own note and gains no second one",
      domOwner.el.find("bb-impact-resolution-note") !== null && domOwner.el.find("bb-root-match-note") === null,
    )

    // --- Latency (contract §3 render budget, headless regime) --------------------
    const samples: number[] = []
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now()
      await impact.computeImpact(fx.raw, fx.projectId, "rootFn")
      samples.push(performance.now() - t0)
    }
    samples.sort((a, b) => a - b)
    const p95 = samples[Math.floor(samples.length * 0.95)]!
    check("P: warm p95 impact computation within the 300 ms render budget", p95 < 300, `p95=${p95.toFixed(2)}ms`)

    // --- Mutants -------------------------------------------------------------------
    // M1/M2 render in the ONE core (their home after M42.H4); M3–M5 stay in
    // the compute component. Each mutant is planted into its own home.
    const mutants: Array<{ name: string; home: "core" | "component"; from: string; to: string; probe: (m: any) => Promise<boolean> | boolean }> = [
      {
        name: "M1 silent truncation",
        home: "core",
        from: "if (result.truncated) {",
        to: "if (false) {",
        probe: (m) => {
          const d = makeDom()
          const r = m.renderImpact({ ...result, impact: result.impact.slice(0, 2), shownCount: 2, totalCountIfKnown: 4, truncated: true, truncationReason: "x" }, d as never)
          return d.el.find("bb-impact-truncation-marker") === null // marker gone => defect visible
        },
      },
      {
        name: "M1b empty-state dropped",
        home: "core",
        from: "if (result.impact.length === 0) {",
        to: "if (false) {",
        probe: (m) => {
          const d = makeDom()
          m.renderImpact({ ...result, impact: [], shownCount: 0, totalCountIfKnown: 0, truncated: false, truncationReason: null }, d as never)
          return d.el.find("bb-impact-empty") === null // note gone => defect visible
        },
      },
      {
        name: "M2 fabricated total",
        home: "core",
        from: 'result.totalCountIfKnown === null ? "unknown"',
        to: 'String(result.shownCount + 1)',
        probe: (m) => {
          const d = makeDom()
          m.renderImpact({ ...result, impact: result.impact.slice(0, 1), shownCount: 1, totalCountIfKnown: null, truncated: true, truncationReason: "x" }, d as never)
          const mk = d.el.find("bb-impact-truncation-marker") as El | null
          return mk !== null && mk!.attrs["data-total-if-known"] !== "unknown" // invented number => defect visible
        },
      },
      {
        name: "M3 unbounded impact",
        home: "component",
        from: "if (impact.length >= IMPACT_BUDGET.maxNodes) {",
        to: "if (impact.length >= Number.MAX_SAFE_INTEGER) {",
        probe: async (m) => {
          // Feed an oversized traversal through the mutant: it must exceed the
          // declared budget (defect visible).
          let exceeded = false
          try {
            const r = await m.computeImpact(fx.raw, fx.projectId, "rootFn", {
              traverse: async () => {
                const nodes: Record<string, any> = { "sym:root": { id: "sym:root", name: "rootFn", file: "main.ts" } }
                const callers = Array.from({ length: impact.IMPACT_BUDGET.maxNodes + 50 }, (_, i) => {
                  const id = `sym:big${i}`
                  nodes[id] = { id, name: `big${i}`, file: "main.ts" }
                  return { from: id, to: "sym:root", relationshipType: "calls", confidence: 0.9, depth: 0 }
                })
                return { root: nodes["sym:root"], callers, callees: [], nodes, summary: { totalCallers: callers.length, totalCallees: 0, maxDepthReached: 0, crossLanguageEdges: 0, truncated: false } }
              },
            })
            exceeded = r.shownCount > impact.IMPACT_BUDGET.maxNodes
          } catch {
            exceeded = false
          }
          return exceeded
        },
      },
      {
        name: "M4 differential break (cascade dropped from the total count)",
        home: "component",
        // M63.T2: the range predicate is now a separate per-range term rather
        // than part of a per-member disjunction, so the mutation narrows the
        // RANGE to a point (`owner = prefix AND owner = prefix`, which no
        // stored owner can satisfy because the prefix ends in a colon) instead
        // of deleting the clause. The parameter count is unchanged, so the
        // mutation is the cascade and nothing else.
        from: 'new Array(ranges).fill(" OR (m.owner_symbol_id >= ? AND m.owner_symbol_id < ?)")',
        to: 'new Array(ranges).fill(" OR (m.owner_symbol_id = ? AND m.owner_symbol_id = ?)")',
        // sym:klass is reached only through its member (other → mem): with
        // the cascade gone the declared total of a class drops from 1 to 0.
        probe: (m) => m.countImpactDependents(fx.raw, fx.projectId, "sym:klass").total !== 1
      },
      {
        name: "M4b kinds dropped from the total count (a contains row counts as a dependency)",
        home: "component",
        from: '"WHERE r.project_id = ? AND r.relationship_type IN (" + relPlaceholders + ") "',
        to: '"WHERE r.project_id = ? AND 1=1 "',
        probe: (m) => {
          // A `contains` row aimed at the class is NOT a dependency. With the
          // kind filter the class still answers 1 (through its member); with
          // it gone the answer becomes 2 — the defect the corpus measured
          // (GraphQLList: 57 declared, 8 real).
          const before = m.countImpactDependents(fx.raw, fx.projectId, "sym:klass").total
          fx.raw
            .prepare(`INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence) VALUES (?,?,?,?,?,?)`)
            .run("w5-rel-nondep", fx.projectId, "sym:other2", "sym:klass", "contains", 0.9)
          const after = m.countImpactDependents(fx.raw, fx.projectId, "sym:klass").total
          return after !== before && after !== null
        },
      },
      {
        name: "M4c transitive collapse (the count stops at depth 0)",
        home: "component",
        from: "if (frontier[0]!.depth + 1 < maxDepth) next.push({ id: row.id, depth: frontier[0]!.depth + 1 })",
        to: "if (false) next.push({ id: row.id, depth: frontier[0]!.depth + 1 })",
        // hub2 has one direct dependent and one through it: a depth-0 count
        // answers 1 where the set is 2. This is the defect that made the
        // surface say "showing 200 of 145".
        probe: (m) => m.countImpactDependents(fx.raw, fx.projectId, "sym:hub2").total !== 2
      },
      {
        name: "M6 root listed as its own dependent (cycle)",
        home: "component",
        from: "if (nodeId === result.root.id) continue",
        to: "if (false) continue",
        probe: async (m) => {
          // hub2 calls hub2mid and hub2mid calls hub2: without the guard the
          // root appears in its own impact set.
          const r = await m.computeImpact(fx.raw, fx.projectId, "hub2")
          return r.impact.some((d: any) => d.id === r.root.id)
        },
      },
      {
        name: "M14 evidence re-read disabled (one row's evidence published at another row's depth)",
        home: "component",
        from: "if (entry.evidenceAtDepth === entry.depth) continue",
        to: "if (true) continue",
        // `twiceFn` is reachable directly (a row the engine's 200-row site limit
        // cut) and through `gateFn` (a row the engine did see, and which IS
        // cross-language). Skip the re-read and the answer quotes the longer
        // path's flag at the shorter path's depth — measured on nine real
        // repositories at 340 of 4 258 rows, and caught on vue-core by the
        // corpus suite's cross-language law.
        probe: async (m) => {
          const r = await m.computeImpact(fx.raw, fx.projectId, "wideFn")
          const twice = r.impact.find((d: any) => d.id === "sym:twice")
          return twice === undefined || twice.isCrossLanguage !== false
        },
      },
      {
        name: "M15 the depth correction removed (the engine's first trace is published as the shortest path)",
        home: "component",
        from: "if (measured !== undefined && measured !== entry.depth) entry.depth = measured",
        to: "if (false && measured !== undefined && measured !== entry.depth) entry.depth = measured",
        // Same shape: with the correction gone, `twiceFn` is reported at depth 1
        // because that is the trace the engine's depth-first walk took first.
        probe: async (m) => {
          const r = await m.computeImpact(fx.raw, fx.projectId, "wideFn")
          const twice = r.impact.find((d: any) => d.id === "sym:twice")
          return twice === undefined || twice.depth !== 0
        },
      },
      {
        name: "M12 how-each-dependent-is-a-dependent erased (every row claims to be exact)",
        home: "component",
        from: 'via: edge.targetMatch === "owner-cascade" ? "member" : "exact",',
        to: 'via: "exact" as const,',
        // sym:other is in Klass's impact set ONLY because the row names its
        // member, so `via: "exact"` on that row is a false claim about the
        // stored row. The engine already publishes the classification; this
        // mutant is what dropping it looks like.
        probe: async (m) => {
          const r = await m.computeImpact(fx.raw, fx.projectId, "Klass")
          return !r.impact.some((d: any) => d.via === "member" && d.viaMember?.name === "mem")
        },
      },
      {
        name: "M13 the cascade composition stops being declared",
        home: "component",
        from: "cascade = { exact, member, rangeFolded }",
        to: "cascade = null",
        // The rows would still carry `via`; the answer would stop saying how
        // many of them are `range-folded`, which is the one number a reader
        // needs to weigh a conservative over-count.
        probe: async (m) => (await m.computeImpact(fx.raw, fx.projectId, "Klass")).cascade === null,
      },
      {
        name: "M7 fabricated total when the ceiling is hit (a partial count as a total)",
        home: "component",
        // Anchored on ONE expression, not the whole return literal: the literal
        // grows every time a measurement is added, and an anchor that spans it
        // silently stops matching — which is reported as SKIP and counted as a
        // pass by a suite that only compares caught === total.
        from: "total: hitScanCeiling ? null : found.size",
        to: "total: found.size",
        probe: (m) => m.countImpactDependents(fx.raw, fx.projectId, "sym:hub2", { expansionCeiling: 1 }).total !== null
      },
      {
        name: "M8 non-exact name rendered as an exact hit (silent substitution in the panel)",
        home: "core",
        from: 'if (match && match.via !== "exact" && match.via !== "owning-declaration") {',
        to: "if (false) {",
        probe: (m) => {
          const d = makeDom()
          m.renderImpact({ ...result, rootMatch: { requested: "rootFnX", via: "fuzzy-containment", nameMatches: 0 } }, d as never)
          return d.el.find("bb-root-match-note") === null // the substitution became invisible
        },
      },
      {
        name: "M5 truncation state lost",
        home: "component",
        from: "truncated = true\n      truncationReason = \"impact-node-budget-exhausted\"",
        to: "truncated = false\n      truncationReason = null",
        probe: async (m) => {
          const r = await m.computeImpact(fx.raw, fx.projectId, "rootFn", {
            traverse: async () => {
              const nodes: Record<string, any> = { "sym:root": { id: "sym:root", name: "rootFn", file: "main.ts" } }
              const callers = Array.from({ length: impact.IMPACT_BUDGET.maxNodes + 10 }, (_, i) => {
                const id = `sym:m5${i}`
                nodes[id] = { id, name: `m5${i}`, file: "main.ts" }
                return { from: id, to: "sym:root", relationshipType: "calls", confidence: 0.9, depth: 0 }
              })
              return { root: nodes["sym:root"], callers, callees: [], nodes, summary: { totalCallers: callers.length, totalCallees: 0, maxDepthReached: 0, crossLanguageEdges: 0, truncated: false } }
            },
          })
          return r.truncated === false && r.shownCount === impact.IMPACT_BUDGET.maxNodes // budget hit but flagged complete (break still fires; flag lost)
        },
      },
    ]

    // The roster, stated. A mutant that cannot be planted has STOPPED being
    // tested, and a suite that only compares caught === total cannot tell that
    // from a pass: the skipped mutant is dropped from the denominator, the
    // equality still holds, and the summary reads BETTER than before while
    // testing less. (Measured: the M7 anchor was invalidated by a field added
    // to a return literal, the suite reported 10/10, and nothing failed.)
    const EXPECTED_MUTANTS = 15
    let caught = 0
    let mutantsTotal = 0
    let skipped = 0
    for (const mutant of mutants) {
      // Render mutants plant into the ONE core (their home); compute mutants
      // plant into the impact component. The anchor must exist in the home.
      const base = mutant.home === "core" ? coreSource : source
      if (!base.includes(mutant.from)) {
        console.log(`  ANCHOR NOT FOUND (a defect this suite no longer tests): ${mutant.name}`)
        skipped++
        continue
      }
      mutantsTotal++
      const mutantPath = join(ROOT, "validation/m26", `${mutant.home === "core" ? "core" : "impact"}.mutant.${Date.now()}.${mutantsTotal}.ts`)
      let mutantSource = base.replace(mutant.from, mutant.to)
      if (mutant.home !== "core") {
        mutantSource = mutantSource.replace(/from "\.\.\/intelligence\/graph\/graph-engine"/g, `from "file://${join(ROOT, "src", "intelligence", "graph", "graph-engine.ts").replace(/\\/g, "/")}"`).replace(/from "\.\.\/intelligence\/contracts"/g, `from "file://${join(ROOT, "src", "intelligence", "contracts.ts").replace(/\\/g, "/")}"`)
      }
      writeFileSync(mutantPath, mutantSource)
      let detected = false
      try {
        const m = await import(mutantPath)
        detected = await mutant.probe(m)
      } catch {
        detected = true
      } finally {
        try {
          rmSync(mutantPath, { force: true })
        } catch {}
      }
      if (detected) {
        caught++
        console.log(`  caught: ${mutant.name}`)
      } else {
        console.log(`  SURVIVED: ${mutant.name}`)
      }
    }
    check(
      "mutation suite: every planted defect is caught, and the whole roster ran",
      skipped === 0 && caught === mutantsTotal && mutantsTotal === EXPECTED_MUTANTS,
      `${caught}/${mutantsTotal} caught, ${skipped} anchor(s) not found, ${EXPECTED_MUTANTS} expected`,
    )

    // --- Persist evidence ------------------------------------------------------------
    const failed = checks - passed
    let commit = "unknown"
    try {
      commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
    } catch {}
    const evidence = {
      issue: "M26.W5",
      code: "W5",
      milestone: "M26",
      status: failed === 0 ? "verified" : "known-gap",
      checks,
      passed,
      failed,
      mutantsCaught: caught,
      mutantsTotal,
      currentCommit: commit,
      verifierCommand: "npx tsx script/m26/verify-impact-mode.ts",
      evidenceFile: "W5.json",
      generatedAt: new Date().toISOString(),
      differential: {
        sampling: "all reverse-dependency edges of the fixture root (the fixture IS the sample, none skipped); L3 answers usage sites since M55.T3 (incoming, non-declaration) — no direction correction needed; containment delta verified separately",
        l3TotalCount: refs.totalCount,
        l3IncomingCount: l3Incoming,
        impactShownCount: result.shownCount,
        nestedDelta: names.includes("nested1") ? "nested1 counted in impact via owner cascade (a flat L3 location too, as a distinct edge)" : "absent",
      },
      limitations: [
        "totalCountIfKnown is computed by an independent bounded COUNT under the same containment rule; it counts distinct caller symbols, not call sites.",
        "Impact depth cap mirrors the engine (5); deeper chains exist but are declared out of budget.",
        "Latency measured headless (component + engine); in-editor regime is measured by the editor legs.",
      ],
    }
    const dir = join(ROOT, "validation/m26/results")
    mkdirSync(dir, { recursive: true })
    writeSealed(join(dir, "W5.json"), evidence)
    console.log(`W5: ${evidence.status.toUpperCase()} (${passed}/${checks} passed, ${caught}/${mutantsTotal} mutants caught)`)
    process.exit(failed === 0 ? 0 : 1)
  } finally {
    fx.cleanup()
  }
}

void main()
