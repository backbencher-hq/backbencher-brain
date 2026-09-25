// script/m26/verify-evidence-badges.ts — M26.W4 verifier + mutation suite.
//
// Proves the honesty-in-UI law for edge badges and the legend, and that the
// suite CAN FAIL.
//
//   P1 badge per edge:   every rendered edge carries exactly one badge with
//                        the SAME tier as its edge class + the confidence
//   P2 inferred distinct: inferred badges/edges are class-distinct from
//                        structural — an inferred edge can never wear a
//                        structural badge
//   P3 legend:           every graph renders the five-tier legend with the
//                        documented meanings (UI terms) — nothing missing
//   P4 hover gloss:      the hover's tier wording applies the same rule;
//                        threshold drift between core and hover fails
//   P5 doc drift:        EVIDENCE-TIERS.md names every tier, the 0.7 floor,
//                        and the mutation gates
//   P6 derived tiers:    derivation order proven on real fixture edges
//                        (stored class wins; sub-floor → inferred)
//
// Mutants (each must be CAUGHT):
//   M1 inferred rendered as structural  (the cardinal sin, issue #512)
//   M2 badge/edge tier disagreement     (badge decoupled from edge resolution)
//   M3 legend tier dropped              (legend missing a tier)
//   M4 threshold drifted                (0.7 floor changed in the core)
//   M5 stored class ignored             (badge from derivation only)
//
// Run: npx tsx script/m26/verify-evidence-badges.ts
// Evidence: validation/m26/results/W4.json (machine-emitted)

import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const CORE = join(ROOT, "script", "m26", "graph-core.ts")
const HOVER_GLOSS = join(ROOT, "src", "lsp", "cross_language_hover.ts")
// M55.T5: the tier RULE moved out of the gloss into the LSP lane's single
// owner; the gloss now delegates. P4 drift-gates the owner and the mirror
// (core) against each other and asserts the delegation itself.
const TIER_OWNER = join(ROOT, "src", "lsp", "evidence_tier.ts")
const DOC = join(ROOT, "docs", "m26", "EVIDENCE-TIERS.md")

let checks = 0
let passed = 0

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}

// --- Test DOM (same stub shape as the W1 suite) ------------------------------
class El {
  tagName: string
  className = ""
  children: El[] = []
  textContent = ""
  attrs: Record<string, string> = {}
  style: Record<string, string> = {}
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

function makeDom(): { create: (tag: string) => El; root: () => El; el: El } {
  const el = new El("div")
  return { create: (tag: string) => new El(tag), root: () => el, el }
}

function fixtureEdges(): { result: any; callers: any[] } {
  const mk = (id: string, name: string) => ({ id, name, symbolType: "function", file: `${name}.ts`, line: 1, lineEnd: 2, language: "typescript", isExternal: false })
  const root = mk("sym:root", "root")
  const c1 = mk("sym:c1", "c1")
  const c2 = mk("sym:c2", "c2")
  const c3 = mk("sym:c3", "c3")
  const callers = [
    { from: c1.id, to: root.id, relationshipType: "calls", confidence: 0.9, isCrossLanguage: false, callSite: { kind: "call-site", file: "c1.ts", line: 1 }, depth: 0 }, // structural (derived, above floor)
    { from: c2.id, to: root.id, relationshipType: "calls", confidence: 0.4, isCrossLanguage: false, callSite: { kind: "call-site", file: "c2.ts", line: 1 }, depth: 0, metadata: { evidenceClass: "inferred" } }, // stored inferred
    { from: c3.id, to: root.id, relationshipType: "imports", confidence: 0.8, isCrossLanguage: false, callSite: { kind: "call-site", file: "c3.ts", line: 1 }, depth: 0 }, // import_based
  ]
  const result = {
    root,
    callers,
    callees: [],
    nodes: { "sym:root": root, "sym:c1": c1, "sym:c2": c2, "sym:c3": c3 },
    summary: { totalCallers: 3, totalCallees: 0, truncated: false, crossLanguageEdges: 0 },
  }
  return { result, callers }
}

async function main(): Promise<void> {
  const core = await import(CORE)
  const dom = makeDom()
  const { result } = fixtureEdges()
  core.renderGraph(result, dom as never)

  const edgeEls = dom.el.findAll("bb-edge")
  const badgeEls = dom.el.findAll("bb-edge-badge")

  // --- P1: one badge per edge, same tier as the edge, confidence present -----
  check("P1: every edge carries exactly one badge", edgeEls.length === 3 && badgeEls.length === 3)
  let badgeMatch = true
  for (const edge of edgeEls) {
    const tier = edge.attrs["data-tier"]
    const badge = edge.findAll("bb-edge-badge")[0]
    if (!badge || badge.attrs["data-badge-tier"] !== tier || badge.attrs["data-badge-confidence"] !== edge.attrs["data-confidence"]) badgeMatch = false
  }
  check("P1: badge tier+confidence always agree with its edge", badgeMatch)
  check("P1: badge text renders tier and confidence", badgeEls.every((b) => b.textContent.includes("·") && b.textContent.split(" · ")[1] === b.attrs["data-badge-confidence"]))

  // --- P2: inferred visually distinct, never as structural --------------------
  const structuralBadges = badgeEls.filter((b) => b.attrs["data-badge-tier"] === "structural")
  const inferredBadges = badgeEls.filter((b) => b.attrs["data-badge-tier"] === "inferred")
  check("P2: stored-inferred edge wears an inferred badge with an inferred edge class", inferredBadges.length === 1 && dom.el.findAll("bb-edge-inferred").length === 1 && dom.el.findAll("bb-badge-inferred").length >= 1)
  check("P2: structural badges carry the structural class only", structuralBadges.length === 1 && structuralBadges[0]!.className.includes("bb-badge-structural") && !structuralBadges[0]!.className.includes("inferred"))
  check("P2: inferred badge class is disjoint from structural badge class", inferredBadges[0]!.className.split(" ").every((c) => !c.startsWith("bb-badge-structural")))

  // --- P3: legend complete with documented meanings ---------------------------
  const legend = dom.el.find("bb-legend")
  check("P3: legend ships with every graph", legend !== null)
  // M42.H3 vocabulary extension: tier rows (the ones with a swatch) are still
  // exactly the five tiers — the enrichment annotation row is a SEPARATE
  // legend item (data-legend-enrichment) and never a tier.
  const legendItems = legend ? legend.findAll("bb-legend-item") : []
  const legendTiers = legendItems.map((i) => i.find("bb-legend-swatch")?.attrs["data-legend-tier"]).filter(Boolean)
  check("P3: legend lists all five tiers", JSON.stringify([...(legendTiers as string[])].sort()) === JSON.stringify([...(core.EDGE_TIERS as readonly string[])].sort()))
  const meanings = legendItems.flatMap((i) => {
    const m = i.find("bb-legend-meaning")?.textContent
    return m ? [m] : []
  })
  const tierMeanings = meanings.filter((m) => Object.values(core.TIER_MEANINGS as Record<string, string>).some((v) => m.endsWith(v)))
  // M44.U4: the legend now also carries the staleness section (4 status
  // rows). Tier meanings stay exactly the five tier rows — matched against
  // the tier-carrying items, never the total (staleness rows are separate).
  const tierItems = legendItems.filter((i) => (i.find("bb-legend-swatch")?.attrs["data-legend-tier"] ?? "") !== "")
  check("P3: legend meanings are the documented UI terms", tierMeanings.length === 5 && tierMeanings.length === tierItems.length)
  check("P3: enrichment annotation row present and distinct (M42.H3)", legendItems.some((i) => i.attrs["data-legend-enrichment"] === "1") && legendItems.filter((i) => i.attrs["data-legend-status"] !== undefined).length === 4)

  // --- P4: hover gloss applies the same rule (threshold drift gate) ------------
  const glossSource = readFileSync(HOVER_GLOSS, "utf8")
  const coreSource = readFileSync(CORE, "utf8")
  const ownerSource = readFileSync(TIER_OWNER, "utf8")
  // Comments may NAME the rule (they must explain the delegation); only CODE
  // can reimplement it, so the negative assertions read the comment-stripped
  // source.
  const glossCode = glossSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  check(
    "P4: hover gloss delegates to the tier owner (no second rule)",
    glossSource.includes('from "./evidence_tier"') && glossSource.includes("classifyTier(") && !glossCode.includes("0.7") && !glossCode.includes("STRUCTURAL"),
    "the gloss must call src/lsp/evidence_tier.ts, not re-implement the rule",
  )
  check("P4: owner and core declare the same 0.7 floor", ownerSource.includes("STRUCTURAL_FLOOR = 0.7") && coreSource.includes(">= 0.7"))
  check(
    "P4: owner and core declare the same structural set",
    ["calls", "extends", "implements", "overrides", "contains", "exports", "instantiates"].every((t) => ownerSource.includes(`"${t}"`) && coreSource.includes(`"${t}"`)),
    "the core mirrors the owner (verify-tiers.ts P1 asserts the equivalence table)",
  )

  // --- P5: doc drift gate -------------------------------------------------------
  const doc = readFileSync(DOC, "utf8")
  check("P5: doc names every tier", (core.EDGE_TIERS as readonly string[]).every((t) => doc.includes(`bb-badge-${t}`)))
  check("P5: doc documents the 0.7 threshold decision", doc.includes("0.7") && doc.toLowerCase().includes("patterns.ts"))
  check("P5: doc declares the mutation gates", doc.includes("M1") && doc.includes("M3"))

  // --- P6: derivation order on real fixture edges -------------------------------
  check("P6: stored evidenceClass wins over derivation", (core.tierForEdge as (e: any) => string)({ relationshipType: "calls", confidence: 0.99, metadata: { evidenceClass: "usage_contextual" } }) === "usage_contextual")
  check("P6: sub-floor calls derive inferred", (core.tierForEdge as (e: any) => string)({ relationshipType: "calls", confidence: 0.69, metadata: undefined }) === "inferred")
  check("P6: floor-edge calls derive structural", (core.tierForEdge as (e: any) => string)({ relationshipType: "calls", confidence: 0.7, metadata: undefined }) === "structural")

  // --- Mutants -------------------------------------------------------------------
  const mutants: Array<{ name: string; from: string; to: string }> = [
    {
      name: "M1 inferred rendered as structural",
      from: 'return edge.confidence >= 0.7 ? "structural" : "inferred"',
      to: 'return "structural"',
    },
    {
      name: "M2 badge tier decoupled from edge",
      from: 'badge.setAttribute("data-badge-tier", tier)',
      to: 'badge.setAttribute("data-badge-tier", "structural")',
    },
    {
      name: "M3 legend tier dropped",
      from: "for (const tier of EDGE_TIERS) {",
      to: "for (const tier of EDGE_TIERS.slice(0, 4)) {",
    },
    {
      name: "M4 threshold drifted",
      from: 'return edge.confidence >= 0.7 ? "structural" : "inferred"',
      to: 'return edge.confidence >= 0.4 ? "structural" : "inferred"',
    },
    {
      name: "M5 stored class ignored",
      from: "if (stored && (EDGE_TIERS as readonly string[]).includes(stored)) return stored as EdgeTier",
      to: "if (false) return stored as EdgeTier",
    },
  ]

  let caught = 0
  let mutantsTotal = 0
  for (const mutant of mutants) {
    if (!coreSource.includes(mutant.from)) {
      console.log(`  SKIP (anchor not found): ${mutant.name}`)
      continue
    }
    mutantsTotal++
    const mutantPath = join(ROOT, "validation/m26", `graph-core.w4mutant.${Date.now()}.${mutantsTotal}.ts`)
    writeFileSync(mutantPath, coreSource.replace(mutant.from, mutant.to))
    let detected = false
    try {
      const m = await import(mutantPath)
      const d = makeDom()
      const fx = fixtureEdges()
      m.renderGraph(fx.result, d as never)
      const badges = d.el.findAll("bb-edge-badge")
      const inferredEdges = d.el.findAll("bb-edge-inferred")
      const legendItems = d.el.findAll("bb-legend-item")
      switch (true) {
        case mutant.name.startsWith("M1"):
          // A DERIVED sub-floor call must not render structural: check the
          // mutated tier function directly and its badge on a fresh fixture.
          detected = (m.tierForEdge as (e: any) => string)({ relationshipType: "calls", confidence: 0.4, metadata: undefined }) === "structural"
          if (!detected) {
            const dSub = makeDom()
            const fxSub = fixtureEdges()
            fxSub.result.callers = [{ from: "sym:c1", to: "sym:root", relationshipType: "calls", confidence: 0.4, isCrossLanguage: false, callSite: { kind: "call-site", file: "c1.ts", line: 1 }, depth: 0 }]
            m.renderGraph(fxSub.result, dSub as never)
            detected = dSub.el.findAll("bb-badge-structural").length > 0 // sub-floor call wearing structural
          }
          break
        case mutant.name.startsWith("M2"):
          // Some badge must now disagree with its edge's resolved tier.
          detected = d.el.findAll("bb-edge").some((edge) => {
            const b = edge.findAll("bb-edge-badge")[0]
            return b !== undefined && b.attrs["data-badge-tier"] !== edge.attrs["data-tier"]
          })
          break
        case mutant.name.startsWith("M3"):
          // A tier missing from the legend: with the M42.H3 enrichment row AND
          // the M44.U4 staleness rows (which carry status swatches, not tier
          // swatches), the legend has more items — dropping a tier leaves 4
          // tier swatches. Detect by TIER swatch count (data-legend-tier),
          // never by total items or bare swatch presence.
          detected = legendItems.filter((i) => (i.find("bb-legend-swatch")?.attrs["data-legend-tier"] ?? "") !== "").length === 4
          break
        case mutant.name.startsWith("M4"):
          detected = (m.tierForEdge as (e: any) => string)({ relationshipType: "calls", confidence: 0.5, metadata: undefined }) === "structural"
          break
        case mutant.name.startsWith("M5"):
          detected = (m.tierForEdge as (e: any) => string)({ relationshipType: "calls", confidence: 0.99, metadata: { evidenceClass: "usage_contextual" } }) === "structural"
          break
        default:
          detected = false
      }
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
  check("mutation suite: every planted defect is caught", caught === mutantsTotal && mutantsTotal >= 4, `${caught}/${mutantsTotal}`)

  // --- Persist evidence -----------------------------------------------------------
  const failed = checks - passed
  let commit = "unknown"
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {}
  const result2 = {
    issue: "M26.W4",
    code: "W4",
    milestone: "M26",
    status: failed === 0 ? "verified" : "known-gap",
    checks,
    passed,
    failed,
    mutantsCaught: caught,
    mutantsTotal,
    currentCommit: commit,
    verifierCommand: "npx tsx script/m26/verify-evidence-badges.ts",
    evidenceFile: "W4.json",
    generatedAt: new Date().toISOString(),
    limitations: [
      "Badge styling (colors/shape) is per-editor CSS; the verified honesty surface is the class + data-attribute contract.",
      "Legend meanings are English UI terms; localization is not declared.",
    ],
  }
  const dir = join(ROOT, "validation/m26/results")
  mkdirSync(dir, { recursive: true })
  writeSealed(join(dir, "W4.json"), result2)
  console.log(`W4: ${result2.status.toUpperCase()} (${passed}/${checks} passed, ${caught}/${mutantsTotal} mutants caught)`)
  process.exit(failed === 0 ? 0 : 1)
}

void main()
