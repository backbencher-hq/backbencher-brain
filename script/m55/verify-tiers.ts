// script/m55/verify-tiers.ts — M55.T5 verifier + mutation suite (issue #775,
// §14 Truth Rule 1: one surface, one answer).
//
// The defect: two methods of the same class, declared and stored the same way
// by the same analyzer, resolved different tier sets — and one of them
// reported a tier (`indexed`) that the legend cannot even render.
//
// What this gate proves, in order:
//
//   R1 fixture:  the authored fixture (script/m55/t5-fixture.ts) really is in
//                the index: one class, one method, one field, one external
//                target, one symbol with no rows, and the analyzer-shaped
//                metadata (including the UNCLAIMED `indexed` label).
//   R2 classifier: the ONE owner (src/lsp/evidence_tier.ts) — closed
//                vocabulary (legend tiers + the declared unknown, nothing
//                else), stored legend-tier class wins, unclaimed labels fall
//                through to the row's own kind, the 0.7 floor, the kind
//                table, the declared ORDER (never alphabetical) and the
//                primary being a member of the list it headlines.
//   R3 wire:     the REAL dist server over the fixture index — hover's
//                `provenance.evidenceClass`, hover's `evidenceTiers` and the
//                card text carry the authored story for every pinned symbol
//                (including the declared-unknown case), and the REAL
//                `bb/graph` usages response (the hub's own door) carries rows
//                whose core-resolved chip tier agrees with the owner AND the
//                authored per-row tier.
//   R4 one owner: source-level — nothing in the LSP lane derives a tier
//                outside the owner; the core's badge class template exists
//                exactly once (legend + badge call it); the core's mirror is
//                equivalent to the owner on a declared case table; and the
//                owner's vocabulary equals the legend's.
//   R5 mutants:  seven planted defects — the pre-T5 alphabetical primary, the
//                pre-T5 legacy label, the floor deleted, the stored class
//                ignored, an extra tier reported for a one-tier symbol, a
//                different rule for member rows, and a duplicated badge
//                template in the core — each FAIL.
//
// Run: npx tsx script/m55/verify-tiers.ts
// Evidence: validation/m55/results/T5.json (machine-emitted)

import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { T5_EXPECT, T5_ROW_TIER, T5_ROWS, T5_SYMBOLS, nameColumn, rowsForExternal, rowsForSymbol, seedT5Db, writeT5Workspace } from "./t5-fixture.ts"
import { StdioLsp, ensureServerBuilt } from "./lsp-wire.ts"
import { writeSealed } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")
const OWNER = path.join(ROOT, "src/lsp/evidence_tier.ts")
const HOVER = path.join(ROOT, "src/lsp/hover.ts")
const XHOVER = path.join(ROOT, "src/lsp/cross_language_hover.ts")
const CORE = path.join(ROOT, "script/m26/graph-core.ts")
const EVIDENCE = path.join(ROOT, "validation/m55/results/T5.json")

const LEGEND = ["structural", "import_based", "usage_contextual", "reference_qualified", "inferred"] as const

let checks = 0
let passed = 0
const failures: string[] = []
let mutantsTotal = 0
let mutantsCaught = 0

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

/** Minimal DOM port (the V1/U3 stub convention) for the ONE renderer core. */
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
  findAll(className: string, out: El[] = []): El[] {
    if (this.className.split(" ").includes(className)) out.push(this)
    for (const child of this.children) child.findAll(className, out)
    return out
  }
  text(): string {
    return `${this.textContent}${this.children.map((c) => c.text()).join("")}`
  }
}
function makeDom(): { create: (t: string) => El; root: () => El; el: El } {
  const el = new El("div")
  return { create: (t: string) => new El(t), root: () => el, el }
}

const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
const workingTreeRelevantChanges = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .map((l) => l.slice(3).trim())
  .filter((p) => p.startsWith("src/lsp/") || p.startsWith("script/m55/") || p.startsWith("script/m26/"))

// --- the fixtures' stored rows, in the owner's input shape -------------------------
const storedRow = (id: string) => {
  const r = T5_ROWS.find((x) => x.id === id)!
  return { relationship_type: r.type, confidence: r.confidence, metadata: r.cls === null ? null : JSON.stringify({ evidenceClass: r.cls }) }
}
const rowsOf = (symbolId: string) => (symbolId.startsWith("ext:") ? rowsForExternal(symbolId.slice(4)) : rowsForSymbol(symbolId))

// --- R1: the fixture ----------------------------------------------------------------
console.log("R1: the fixture (one class, one method, one field, one external, one unknown)")
const ws = mkdtempSync(path.join(tmpdir(), "m55-t5-ws-"))
const dataDir = mkdtempSync(path.join(tmpdir(), "m55-t5-data-"))
writeT5Workspace(ws)
const seed = await seedT5Db(ws, dataDir)
const raw = seed.raw as any

check(
  "R1: the four pinned symbols + the caller + the peer + the unknown case are all in the index",
  T5_SYMBOLS.length === 7 && (raw.prepare("SELECT COUNT(*) AS c FROM brain_symbol").get() as { c: number }).c === T5_SYMBOLS.length,
)
check(
  "R1: the pinned kinds are present (class, method, field)",
  ["class", "method", "field"].every((k) => T5_SYMBOLS.some((s) => s.type === k)),
)
check(
  "R1: the external target is stored the way the indexer writes it (target_external, no symbol row)",
  T5_ROWS.some((r) => r.targetExternal === "push" && r.target === null) &&
    (raw.prepare("SELECT COUNT(*) AS c FROM brain_symbol WHERE name = 'push'").get() as { c: number }).c === 0 &&
    (raw.prepare("SELECT COUNT(*) AS c FROM brain_relationship WHERE target_external = 'push'").get() as { c: number }).c === 2,
)
check(
  "R1: the stored metadata carries BOTH a legend tier and the unclaimed legacy label",
  T5_ROWS.some((r) => r.cls === "structural") && T5_ROWS.some((r) => r.cls === "indexed"),
)
check(
  "R1: the unknown case genuinely has no stored rows",
  rowsForSymbol("s-untouched").length === 0,
)
check(
  "R1: every stored row carries an authored per-row tier",
  T5_ROWS.every((r) => typeof T5_ROW_TIER[r.id] === "string"),
  T5_ROWS.filter((r) => T5_ROW_TIER[r.id] === undefined).map((r) => r.id).join(","),
)
check(
  "R1: every pinned symbol carries an authored tier story",
  Object.keys(T5_EXPECT).every((k) => k === "s-untouched" || rowsOf(k).length > 0),
  Object.keys(T5_EXPECT).join(","),
)

// --- R2: the one classifier ---------------------------------------------------------
console.log("\nR2: the ONE classifier (owner: src/lsp/evidence_tier.ts)")
const owner = (await import(pathToFileURL(OWNER).href)) as typeof import("../../src/lsp/evidence_tier.ts")
const { classifyTier, classifyStoredRow, orderTiers, primaryTier, symbolTierSet, isDeclaredTier, EVIDENCE_TIERS } = owner
const core = (await import(pathToFileURL(CORE).href)) as typeof import("../../script/m26/graph-core.ts")
const { tierForEdge, renderHubList, renderLegend, EDGE_TIERS, badgeClassForTier } = core

check("R2: the owner's vocabulary IS the legend's, in the legend's order", JSON.stringify(EVIDENCE_TIERS) === JSON.stringify(LEGEND))

const VOCAB_CASES = [
  { relationshipType: "calls", confidence: 0.95, evidenceClass: null },
  { relationshipType: "imports", confidence: 0.9, evidenceClass: "indexed" },
  { relationshipType: "uses", confidence: 0.8, evidenceClass: "semantic_candidate" },
  { relationshipType: "mystery_kind", confidence: 1.0, evidenceClass: "free text" },
  { relationshipType: "calls", confidence: null, evidenceClass: null },
]
check(
  "R2: every classification lands inside the legend vocabulary (closed set)",
  VOCAB_CASES.every((c) => (LEGEND as readonly string[]).includes(classifyTier(c))),
  VOCAB_CASES.map((c) => `${c.relationshipType}=${classifyTier(c)}`).join(" "),
)
check(
  "R2: a stored legend-tier class wins over derivation",
  LEGEND.every((t) => classifyTier({ relationshipType: "mystery_kind", confidence: 1, evidenceClass: t }) === t),
)
check(
  "R2: an UNCLAIMED stored label is not a tier claim (the row's kind decides)",
  classifyTier({ relationshipType: "calls", confidence: 0.9, evidenceClass: "indexed" }) === "structural" &&
    classifyTier({ relationshipType: "uses", confidence: 0.8, evidenceClass: "indexed" }) === "usage_contextual" &&
    classifyTier({ relationshipType: "imports", confidence: 0.9, evidenceClass: "indexed" }) === "import_based" &&
    !isDeclaredTier("indexed") &&
    !isDeclaredTier("semantic_candidate"),
  `${classifyTier({ relationshipType: "imports", confidence: 0.9, evidenceClass: "indexed" })}`,
)
check(
  "R2: the 0.7 floor holds on both sides",
  classifyTier({ relationshipType: "calls", confidence: 0.7, evidenceClass: null }) === "structural" &&
    classifyTier({ relationshipType: "calls", confidence: 0.69, evidenceClass: null }) === "inferred" &&
    classifyTier({ relationshipType: "contains", confidence: 0.5, evidenceClass: null }) === "inferred",
)
check(
  "R2: the kind table (structural / imports / usage / qualified / heuristic)",
  [["contains", "structural"], ["exports", "structural"], ["instantiates", "structural"], ["inherits", "structural"], ["override", "structural"], ["imports", "import_based"], ["reference", "usage_contextual"], ["references", "usage_contextual"], ["use", "usage_contextual"], ["usage", "usage_contextual"], ["references_qualified", "reference_qualified"], ["widget_fact", "inferred"]].every(
    ([kind, tier]) => classifyTier({ relationshipType: kind!, confidence: 0.95, evidenceClass: null }) === tier,
  ),
)
check(
  "R2: kind matching is case/whitespace insensitive (the analyzers are not consistent)",
  classifyTier({ relationshipType: " CALLS ", confidence: 0.9, evidenceClass: null }) === "structural",
)
check(
  "R2: the order is the declared rank — never alphabetical (the #775 defect)",
  JSON.stringify(orderTiers(["usage_contextual", "inferred", "structural", "import_based"])) === JSON.stringify(["structural", "import_based", "usage_contextual", "inferred"]) &&
    JSON.stringify(orderTiers([...LEGEND].reverse())) === JSON.stringify(LEGEND) &&
    JSON.stringify([...orderTiers(["inferred", "reference_qualified", "structural"]), "x"]).startsWith("[\"structural\""),
)
check(
  "R2: the order deduplicates",
  JSON.stringify(orderTiers(["structural", "structural", "inferred"])) === JSON.stringify(["structural", "inferred"]),
)
check(
  "R2: the primary is always a member of its list (empty -> the declared unknown)",
  primaryTier(["usage_contextual", "structural"]) === "structural" && primaryTier([]) === "unknown" && primaryTier(["inferred"]) === "inferred",
)

// The pure differential: the owner applied to the fixture's stored rows.
let pureStories = 0
for (const id of Object.keys(T5_EXPECT)) {
  const story = symbolTierSet(rowsOf(id).map((r) => storedRow(r.id)))
  const primary = primaryTier(story)
  const want = T5_EXPECT[id]!
  const ok = JSON.stringify(story) === JSON.stringify(want.tiers) && primary === want.primary && (story.length === 0) === (want.primary === "unknown")
  check(`R2: ${id} — the owner reports the authored story`, ok, `got ${JSON.stringify(story)}/${primary} want ${JSON.stringify(want.tiers)}/${want.primary}`)
  if (ok) pureStories++
}
check("R2: every pinned symbol's story is the authored one", pureStories === Object.keys(T5_EXPECT).length, `${pureStories}/${Object.keys(T5_EXPECT).length}`)

// --- R3: the wire (real server, real index, real renderer) --------------------------
console.log("\nR3: the wire — one story on hover, the hub chip and the legend")
ensureServerBuilt()
const wire = new StdioLsp(ws, { ...process.env, BB_DATA_DIR: dataDir } as Record<string, string | undefined>)
const wireStories: Record<string, unknown> = {}
try {
  const init = await wire.initialize(ws)
  check("R3: the server initializes over the fixture workspace", init.error === undefined, JSON.stringify(init).slice(0, 200))

  for (const id of Object.keys(T5_EXPECT)) {
    if (id.startsWith("ext:")) continue // no symbol row: no hoverable position (asserted in R1)
    const sym = T5_SYMBOLS.find((s) => s.id === id)!
    const abs = path.join(ws, sym.file)
    const res = await wire.request("textDocument/hover", {
      textDocument: { uri: `file://${abs}` },
      position: { line: sym.line - 1, character: nameColumn(sym) },
    })
    const want = T5_EXPECT[id]!
    const tiers: string[] = res.result?.data?.symbol?.evidenceTiers ?? []
    // The wire law puts provenance beside the symbol on `data` (server.ts).
    const primary = res.result?.data?.provenance?.evidenceClass ?? res.result?.data?.symbol?.provenance?.evidenceClass
    const card: string = res.result?.contents?.value ?? ""
    wireStories[id] = { tiers, primary, cardHasTierLine: card.includes("evidence:") }
    check(`R3: hover ${id} carries the authored tier list`, JSON.stringify(tiers) === JSON.stringify(want.tiers), `got ${JSON.stringify(tiers)} want ${JSON.stringify(want.tiers)}`)
    check(`R3: hover ${id} provenance.evidenceClass is the authored primary (a member of the list)`, primary === want.primary, `got ${String(primary)} want ${want.primary}`)
    check(
      `R3: hover ${id} renders the same list in the card (or the declared absence)`,
      want.tiers.length === 0 ? card.includes("evidence: none (no indexed relationships)") : card.includes(`evidence: ${want.tiers.join(", ")}`),
      card.split("\n").find((l) => l.startsWith("evidence:")) ?? "(no evidence line)",
    )
    check(
      `R3: hover ${id} claims no tier outside the legend vocabulary`,
      tiers.every((t) => (LEGEND as readonly string[]).includes(t)),
      JSON.stringify(tiers),
    )
  }
  check(
    "R3: the declared-unknown case really is unknown (not a guess)",
    (wireStories["s-untouched"] as { tiers: string[] }).tiers.length === 0 && (wireStories["s-untouched"] as { primary: string }).primary === "unknown",
    JSON.stringify(wireStories["s-untouched"]),
  )

  // The hub's own door: bb/graph in the declared usages profile.
  const hub = await wire.request("bb/graph", {
    schemaVersion: 2,
    symbol: "Store",
    mode: "usages",
    direction: "both",
    file: path.join(ws, "src/store.ts"),
  })
  const grouped = hub.result as
    | {
        root?: { name: string }
        callers?: Array<{ name: string; isExternal?: boolean; relationshipTypes: Array<{ type: string; occurrences: number }>; rows: Array<{ rowId: string; relationshipType: string; confidence: number; evidenceClass?: string }> }>
        callees?: Array<{ name: string; isExternal?: boolean; relationshipTypes: Array<{ type: string; occurrences: number }>; rows: Array<{ rowId: string; relationshipType: string; confidence: number; evidenceClass?: string }> }>
      }
    | undefined
  check("R3: bb/graph (usages) resolves the hub root to the pinned class", grouped?.root?.name === "Store", JSON.stringify(hub.result).slice(0, 200))

  const hubRows = [...(grouped?.callers ?? []), ...(grouped?.callees ?? [])].flatMap((g) => g.rows)
  check("R3: the hub door returned the fixture's traversable rows", hubRows.length >= 2, String(hubRows.length))
  const externalGroup = [...(grouped?.callees ?? [])].find((g) => g.isExternal === true)
  check(
    "R3: the external symbol surfaces as its own hub group (that is the only surface that shows it)",
    externalGroup !== undefined && externalGroup.rows.some((r) => r.relationshipType === "calls"),
    JSON.stringify(grouped?.callees ?? []).slice(0, 240),
  )

  // Differential, row by row: authored per-row tier == owner == core mirror.
  let rowAgreements = 0
  for (const row of hubRows) {
    const want = T5_ROW_TIER[row.rowId]
    const byOwner = classifyTier({ relationshipType: row.relationshipType, confidence: row.confidence, evidenceClass: row.evidenceClass ?? null })
    check(`R3: hub row ${row.rowId} (${row.relationshipType}) — the owner's tier IS the authored one`, byOwner === want, `got ${byOwner} want ${String(want)}`)
    if (byOwner === want) rowAgreements++
  }
  check("R3: every hub row agrees with the authored per-row tier", rowAgreements === hubRows.length, `${rowAgreements}/${hubRows.length}`)

  // The chip: the core's resolution over the REAL wire rows + the rendered DOM.
  const dom = makeDom()
  renderHubList(grouped as never, dom as never, "file")
  const chips = dom.el.findAll("bb-hub-relchip")
  check("R3: the hub renders its relationship chips", chips.length >= 2, String(chips.length))
  // Expected chips from the MODEL: per group, per type, uniform over that
  // group's rows of that type (the owner's answer), else the declared `mixed`.
  const expectedChips: string[] = []
  for (const group of [...(grouped?.callers ?? []), ...(grouped?.callees ?? [])]) {
    for (const rt of group.relationshipTypes) {
      const rows = group.rows.filter((r) => r.relationshipType === rt.type)
      const byOwner = new Set(rows.map((r) => classifyTier({ relationshipType: r.relationshipType, confidence: r.confidence, evidenceClass: r.evidenceClass ?? null })))
      expectedChips.push(`${rt.type}=${byOwner.size === 1 ? [...byOwner][0]! : "mixed"}`)
    }
  }
  check(
    "R3: every chip's tier is the owner's answer for that group's rows (uniform, else declared mixed)",
    JSON.stringify(chips.map((c) => `${c.attrs["data-rel-type"]}=${c.attrs["data-tier"]}`).sort()) === JSON.stringify([...expectedChips].sort()),
    `chips=${chips.map((c) => `${c.attrs["data-rel-type"]}=${c.attrs["data-tier"]}`).join(" ")} expected=${expectedChips.join(" ")}`,
  )
  check(
    "R3: every chip class is the ONE badge mapping (acceptance 4, at the DOM level)",
    chips.every((chip) => {
      const tier = chip.attrs["data-tier"]!
      if (tier === "mixed") return chip.className.split(" ").includes("bb-badge-mixed")
      return chip.className.split(" ").includes(badgeClassForTier(tier as never))
    }),
    chips.map((c) => c.className).join(" | "),
  )
  const legendDom = makeDom()
  // renderLegend RETURNS its element (the caller attaches it), so the search
  // must start at the returned node — not at the (empty) dom root.
  const legendEl = renderLegend(legendDom as never) as unknown as El
  // Tier swatches only: the legend also carries staleness rows (declared
  // separate, M44) which are not part of the tier vocabulary.
  const swatches = legendEl.findAll("bb-legend-swatch").filter((s) => s.attrs["data-legend-tier"] !== undefined)
  check(
    "R3: the legend lists exactly the vocabulary, with the same classes the chips use",
    swatches.length === EDGE_TIERS.length &&
      swatches.every((s) => (EDGE_TIERS as readonly string[]).includes(s.attrs["data-legend-tier"]!) && s.className.split(" ").includes(`bb-badge-${s.attrs["data-legend-tier"]}`)) &&
      swatches.every((s) => s.className.split(" ").includes(badgeClassForTier(s.attrs["data-legend-tier"] as never))),
    swatches.map((s) => s.attrs["data-legend-tier"]).join(","),
  )
  check(
    "R3: every chip tier is renderable by the legend it ships with",
    chips.every((chip) => chip.attrs["data-tier"] === "mixed" || (EDGE_TIERS as readonly string[]).includes(chip.attrs["data-tier"]!)),
    chips.map((c) => c.attrs["data-tier"]).join(","),
  )
} finally {
  await wire.dispose()
}

// --- R4: one owner (source level) ---------------------------------------------------
console.log("\nR4: one owner — no second derivation, one badge mapping, one vocabulary")
const ownerSource = readFileSync(OWNER, "utf8")
const hoverSource = readFileSync(HOVER, "utf8")
const xhoverSource = readFileSync(XHOVER, "utf8")
const coreSource = readFileSync(CORE, "utf8")

const laneOffenders: string[] = []
for (const entry of readdirSync(path.join(ROOT, "src/lsp"))) {
  if (!entry.endsWith(".ts")) continue
  const file = path.join(ROOT, "src/lsp", entry)
  if (file === OWNER) continue
  // Comments may NAME the rule (they must explain the delegation); only CODE
  // can reimplement it, so strip comments before looking for a second
  // derivation: the floor, a structural-kind set, or a metadata parse.
  const code = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
  if (/>=\s*0\.7\b/.test(code) && /structural/i.test(code)) laneOffenders.push(`${entry}: floor+structural`)
  if (/STRUCTURAL_(RELATIONSHIPS|KINDS|TYPES)\s*[:=]/.test(code)) laneOffenders.push(`${entry}: structural set`)
  if (/JSON\.parse\(\s*r\.metadata\s*\)/.test(code)) laneOffenders.push(`${entry}: metadata parsed for a tier`)
}
check("R4: no module in src/lsp derives a tier outside the owner", laneOffenders.length === 0, laneOffenders.join(" | "))
check(
  "R4: hover and the cross-language gloss delegate to the owner",
  hoverSource.includes('from "./evidence_tier"') && xhoverSource.includes('from "./evidence_tier"') && xhoverSource.includes("classifyTier("),
)
check(
  "R4: the owner declares the closed vocabulary and the unclaimed-label decision",
  ownerSource.includes("UNCLAIMED_STORE_LABELS") && ownerSource.includes("export type EvidenceTier = LegendTier | \"unknown\"") && ownerSource.includes("STRUCTURAL_FLOOR = 0.7"),
)

/** The TIER badge-class template must exist exactly once in the renderer (a
 *  staleness chip may render its own status class — a different vocabulary). */
function badgeTemplateCount(source: string): number {
  return source.match(/bb-badge-\$\{\s*tier\s*\}/g)?.length ?? 0
}
check("R4: the badge-class template is written exactly once (single source, not duplicated)", badgeTemplateCount(coreSource) === 1, String(badgeTemplateCount(coreSource)))
check(
  "R4: legend swatches and edge badges both call the one mapping",
  /swatch\.addClass\(badgeClassForTier\(tier\)\)/.test(coreSource) && /badge\.addClass\(badgeClassForTier\(tier\)\)/.test(coreSource),
)
check("R4: the core's vocabulary mirrors the owner's", JSON.stringify(EDGE_TIERS as never) === JSON.stringify(EVIDENCE_TIERS as never))

// The mirror equivalence on a declared case table (the core is import-pure, so
// the mirror is asserted by EQUIVALENCE, not by import).
const MIRROR_CASES: Array<{ type: string; conf: number | null; cls: string | null }> = [
  { type: "calls", conf: 0.7, cls: null },
  { type: "calls", conf: 0.69, cls: null },
  { type: "contains", conf: 1.0, cls: null },
  { type: "exports", conf: 0.9, cls: null },
  { type: "instantiates", conf: 0.5, cls: null },
  { type: "inherits", conf: 0.8, cls: null },
  { type: "override", conf: 0.8, cls: null },
  { type: "imports", conf: 0.9, cls: null },
  { type: "references", conf: 0.9, cls: null },
  { type: "uses", conf: 0.8, cls: null },
  { type: "usage", conf: 0.8, cls: null },
  { type: "reference", conf: 0.8, cls: null },
  { type: "references_qualified", conf: 0.9, cls: null },
  { type: "widget_fact", conf: 0.9, cls: null },
  { type: "widget_fact", conf: 0.3, cls: null },
  { type: " CALLS ", conf: 0.9, cls: null },
  { type: "calls", conf: 0.99, cls: "usage_contextual" },
  { type: "uses", conf: 0.9, cls: "structural" },
  { type: "widget_fact", conf: 1.0, cls: "inferred" },
  { type: "calls", conf: 0.9, cls: "indexed" },
  { type: "imports", conf: 0.4, cls: "semantic_candidate" },
]
const mirrorMismatches = MIRROR_CASES.filter((c) => {
  const byOwner = classifyTier({ relationshipType: c.type, confidence: c.conf, evidenceClass: c.cls })
  const byCore = tierForEdge({ relationshipType: c.type, confidence: c.conf, metadata: c.cls === null ? undefined : { evidenceClass: c.cls } } as never)
  return byOwner !== byCore
})
check(
  "R4: the core's mirror equals the owner on every declared case",
  mirrorMismatches.length === 0,
  mirrorMismatches.map((c) => `${c.type}/${c.conf}/${c.cls}`).join(" | "),
)

// --- R5: mutants --------------------------------------------------------------------
console.log("\nR5: mutants (each planted defect must fail the suite)")
const OWNER_SOURCE = ownerSource

async function withOwnerMutant(name: string, from: string, to: string, probe: (m: any) => boolean): Promise<void> {
  if (!OWNER_SOURCE.includes(from)) {
    check(`M: ${name} (SKIP — anchor not found)`, false, from.slice(0, 90))
    return
  }
  const dir = mkdtempSync(path.join(tmpdir(), "m55-t5-mut-"))
  const target = path.join(dir, "evidence_tier.mutant.ts")
  writeFileSync(target, OWNER_SOURCE.replace(from, to))
  try {
    const m = await import(pathToFileURL(target).href)
    mutant(name, probe(m))
  } catch (e) {
    check(`M: ${name} (mutant failed to load)`, false, String(e).slice(0, 120))
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

const storyDeviates = (m: any): boolean =>
  Object.keys(T5_EXPECT).some((id) => {
    const tiers = m.symbolTierSet(rowsOf(id).map((r) => storedRow(r.id)))
    const primary = m.primaryTier(tiers)
    return JSON.stringify(tiers) !== JSON.stringify(T5_EXPECT[id]!.tiers) || primary !== T5_EXPECT[id]!.primary
  })

await withOwnerMutant(
  "M1: alphabetical order restored (the #775 primary defect)",
  "  return [...set].sort((a, b) => TIER_RANK[a] - TIER_RANK[b])",
  "  return [...set].sort()",
  (m) => storyDeviates(m) && m.primaryTier(["usage_contextual", "inferred", "structural"]) === "inferred",
)
await withOwnerMutant(
  "M2: the pre-T5 legacy label honored again",
  "  return (EVIDENCE_TIERS as readonly string[]).includes(value)",
  '  return (EVIDENCE_TIERS as readonly string[]).includes(value) || value === "indexed"',
  (m) => m.classifyTier({ relationshipType: "uses", confidence: 0.8, evidenceClass: "indexed" }) === "indexed" && storyDeviates(m),
)
await withOwnerMutant(
  "M3: the 0.7 floor deleted",
  "export const STRUCTURAL_FLOOR = 0.7",
  "export const STRUCTURAL_FLOOR = 0",
  (m) => m.classifyTier({ relationshipType: "calls", confidence: 0.4, evidenceClass: null }) === "structural" && storyDeviates(m),
)
await withOwnerMutant(
  "M4: the stored legend class ignored",
  "  if (stored !== null && isDeclaredTier(stored)) return stored",
  "  if (false) return stored as never",
  (m) => m.classifyTier({ relationshipType: "calls", confidence: 0.95, evidenceClass: "reference_qualified" }) === "structural",
)
await withOwnerMutant(
  "M5: an extra tier reported for a one-tier symbol",
  "export function symbolTierSet(rows: readonly StoredTierRow[]): EvidenceTier[] {\n  return orderTiers(rows.map(classifyStoredRow))",
  'export function symbolTierSet(rows: readonly StoredTierRow[]): EvidenceTier[] {\n  const t = orderTiers(rows.map(classifyStoredRow))\n  return t.includes("structural") ? [...t, "indexed" as never] : t',
  (m) => {
    const story = m.symbolTierSet(rowsOf("s-store").map((r) => storedRow(r.id)))
    return story.some((t: string) => !(LEGEND as readonly string[]).includes(t))
  },
)
await withOwnerMutant(
  "M6: member rows derived by a different rule",
  "export function symbolTierSet(rows: readonly StoredTierRow[]): EvidenceTier[] {\n  return orderTiers(rows.map(classifyStoredRow))",
  'export function symbolTierSet(rows: readonly StoredTierRow[]): EvidenceTier[] {\n  return orderTiers(rows.map((r: StoredTierRow) => (r.relationship_type === "uses" ? ("indexed" as never) : classifyStoredRow(r))))',
  (m) => m.symbolTierSet(rowsOf("s-store").map((r) => storedRow(r.id))).includes("indexed"),
)
{
  // The core-side defect: a second copy of the badge-class template.
  const duplicated = coreSource.replace(
    "  badge.addClass(badgeClassForTier(tier))",
    '  badge.addClass(`bb-badge-${tier}`)',
  )
  mutant("M7: the badge-class template duplicated in the renderer", duplicated !== coreSource && badgeTemplateCount(duplicated) > 1)
}

// --- evidence ----------------------------------------------------------------------
const failed = checks - passed
const result = {
  issue: "M55.T5",
  code: "T5",
  milestone: "M55",
  status: failed === 0 ? "verified" : "known-gap",
  checks,
  passed,
  failed,
  realFailed: failed,
  negativeCases: mutantsTotal,
  mutants: { total: mutantsTotal, caught: mutantsCaught },
  currentCommit,
  ...fingerprintFields(["m55.T5"], ROOT),
  workingTreeRelevantChanges,
  verifierCommand: "npx tsx script/m55/verify-tiers.ts",
  evidenceFile: "T5.json",
  generatedAt: new Date().toISOString(),
  fixture: { workspace: ws, projectId: seed.projectId, symbols: T5_SYMBOLS.length, rows: T5_ROWS.length },
  observed: { wireStories },
  failures,
  limitations: [
    "The fixture's RED proof is the M2 mutant (the pre-T5 rule reintroduced → the gate fails) plus the issue's own step-zero wire probe; the pre-fix build is not replayed because the owner module is new (authored with the fix), so the RED form is reproduced by planting the old rule rather than by reverting code.",
    "The external target `push` has no brain_symbol row — that is the indexer's shape for `ext:` targets (target_external, target_symbol_id NULL) — so it has no hoverable position; its story is asserted through its stored rows and through the hub, which is the surface that renders it.",
    "The hub (bb/graph usages) only traverses the engine's declared relationship types (calls/instantiates/extends/implements), so the `contains`/`imports`/`references`/`uses` rows are asserted on the hover leg and on the model legs, not as hub chips. The hub leg asserts the rules it can carry: stored-class-wins, the floor, and the closed vocabulary.",
    "The legend's tier set is the five legend tiers by contract; a symbol with no stored rows reports the declared `unknown`, which is deliberately NOT a legend badge (no chip is rendered for it).",
  ],
}

try {
  writeSealed(EVIDENCE, result)
  console.log(`\nEV T5 evidence written: ${path.relative(ROOT, EVIDENCE)}`)
} catch (e) {
  console.log(`\nEV T5 evidence write failed: ${String(e)}`)
}

console.log(`\nT5 RESULT: ${failed === 0 ? "VERIFIED" : "KNOWN-GAP"} — ${passed}/${checks} passed, ${mutantsCaught}/${mutantsTotal} mutants caught`)
if (failed > 0) console.log(`failures:\n  - ${failures.join("\n  - ")}`)
try {
  rmSync(ws, { recursive: true, force: true })
  rmSync(dataDir, { recursive: true, force: true })
} catch {}
process.exit(failed === 0 ? 0 : 1)
