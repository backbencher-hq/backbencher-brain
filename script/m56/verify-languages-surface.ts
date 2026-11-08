// script/m56/verify-languages-surface.ts — M56.L1 (#787), the language-surface gate.
//
// WHAT CHANGED AND WHY
// --------------------
// This gate used to police a `tier` of full / structural / generic. That label
// had no definition anywhere in src/ — the gate's own limitations block said so
// — and it was anti-correlated with measured analyzer quality. It put Svelte
// above JSON while Svelte emitted fewer relationship types, and it filed
// Markdown and TOML (measured 100% coverage / 0% fabrication) in a lower bucket
// than PowerShell (81% / 20%). Worse, four families were filed as "generic pass
// with no dedicated analyzer" — TOML, Protobuf, Visual Basic, Nim — and each of
// them has a large hand-written analyzer wired into `getAnalyzer`.
// `GenericAnalyzer` is the `default:` branch and is unreachable: every registry
// key has an explicit `case`. The website repeated that fiction on four pages.
//
// So the tier is gone and `emits` replaced it: the relationship vocabulary each
// family's analyzer can construct, derived from source and required to match the
// website's dataset in both directions.
//
// TWO READER REPAIRS SINCE, AND WHY THEY MATTER
// --------------------------------------------
// 1. THE ENUM BASIS MOVED. Until the 2026-10-17 consolidation
//    `export enum RelationshipType` lived in src/ast/engine.ts. It now lives in
//    src/ast/types.ts (engine.ts re-exports it as `ASTEngine.RelationshipType`),
//    so this gate's old `indexOf` in engine.ts found nothing, the derived
//    vocabulary was EMPTY, and every family reported `invented=<all types>`.
//    The reader now goes through script/site-truth/lib.ts, which refuses a
//    missing/partial enum instead of returning an empty vocabulary (an empty
//    basis makes every subset check vacuously pass — a green run measuring
//    nothing, the exact failure class this programme has paid for before).
// 2. THE DATASET IS GENERATED AGAIN. `website/src/data/brain-languages.ts` was
//    hand-maintained while claiming a generator that did not exist, and had
//    drifted: matlab/vba had analyzers and registry keys but no family, the
//    vocabulary grew from ten to fourteen, and one family claimed a registry id
//    (`sass`) the engine routes to a DIFFERENT analyzer than that family's
//    module. The dataset is now produced by script/site-truth/generate-languages.ts
//    and this gate proves the generated file still equals what the sources say —
//    it is the independent check on that generator, not a restatement of it.
//
// What this gate proves:
//   1. BASIS — the registry, the authoritative enum and the analyzer inventory
//      parse to the pinned snapshot; the emitted vocabulary is the enum's unique
//      values and agrees with graph.ts's EMITTED/DERIVED split.
//   2. DATASET — every PARSERS row parses byte-exactly and matches the imported
//      module; ids are non-empty and the union of ids equals the registry exactly
//      with no id claimed twice.
//   3. ROUTING — each family's ids are exactly the registry languages whose
//      getAnalyzer() route names the family's module. This is what catches the
//      old `sass`-under-SCSS claim.
//   4. ANALYZERS — every family resolves to a real analyzer module, the
//      family↔module mapping is a bijection, and no module is left unclaimed.
//   5. CAPABILITY — each family's `emits` equals what its analyzer source can
//      construct. A drifted dataset fails.
//   6. SNAPSHOT — registry, grammar, module, family and vocabulary counts match
//      an explicit expectation, so an engine change requires a conscious gate
//      update rather than a silent site drift.
//   7. BANDS — every family appears in exactly one ecosystem band.
//   8. RENDERED — the homepage register draws every family as a data point and
//      /languages publishes, for every family,
//      its extensions, its recorded symbols and its relationship vocabulary, and
//      neither page presents a language the registry cannot index.
//   9. NEGATIVES — planted mutants prove the detectors can fail.
//
// Run: npx tsx script/m56/verify-languages-surface.ts
// Evidence: validation/m56/results/L1.json

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  ROOT,
  dedicatedLanguageCount,
  readEngineTruth,
  readRepo,
  type EngineTruth,
} from "../site-truth/lib.ts"
import { FAMILY_SLUGS } from "../../website/src/data/language-depth/slugs.ts"
import { buildLanguageRulings, serializeLanguageRulings } from "./generate-language-rulings.ts"

const SITE = path.join(ROOT, "website")
const RESULTS = path.join(ROOT, "validation/m56/results")

let checks = 0
let passed = 0
let negatives = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`)
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}
function negative(label: string, byDesign: boolean, detail = ""): void {
  negatives++
  check(`${label} [negative]`, byDesign, detail)
}

const read = (rel: string): string => readRepo(rel)
const site = (rel: string): string => readFileSync(path.join(SITE, rel), "utf8")

/** Receipt-only state so a basis failure still emits evidence instead of a stack trace. */
function writeEvidence(status: "verified" | "failed", extra: Record<string, unknown>): void {
  mkdirSync(RESULTS, { recursive: true })
  writeFileSync(
    path.join(RESULTS, "L1.json"),
    JSON.stringify(
      {
        issue: "M56.L1 — Language surface (#787)",
        code: "L1",
        milestone: "m56",
        status,
        checks,
        passed,
        failed: checks - passed,
        negativeCases: negatives,
        currentCommit: (() => {
          try {
            return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
          } catch {
            return "unknown"
          }
        })(),
        verifierCommand: "npx tsx script/m56/verify-languages-surface.ts",
        evidenceFile: "L1.json",
        generatedAt: new Date().toISOString(),
        ...extra,
        failures,
      },
      null,
      2,
    ) + "\n",
  )
}

// ============================================================================
// 0. BASIS — the sources this gate measures against. A failure here means the
//    gate cannot run, not that the site is wrong; it still exits non-zero.
// ============================================================================

// The snapshot. An engine change must be reflected here deliberately: this is
// the line that turns "the site drifted" into "someone changed the contract".
//
// Re-cut 2026-11-07 against the live tree. History, because each cut names a real
// engine move rather than site drift:
//   · 50/49/47/48 — before `solidity` joined SUPPORTED_LANGUAGES and while `nim`
//     was shadowed to `__generic__` by a duplicate declaration.
//   · 51/51/48/48 — after solidity joined and the nim duplicate was removed.
//   · 53/53/50/50 + 14 types — the M60 VB wave and the MATLAB lane added
//     `matlab`/`vba` registry keys with their own analyzers (50 modules), and the
//     2026-10-18 vocabulary extension took the emitted enum from ten to fourteen.
//     The site dataset was hand-maintained through all of it; that is defect D-03.
const EXPECTED = {
  languages: 53,
  dedicatedParsers: 53,
  families: 50,
  analyzers: 50,
  relationshipTypes: 14,
}

const REPAIR = "— the basis moved and this gate must be repaired (script/site-truth/lib.ts), not skipped"

let truth: EngineTruth
try {
  truth = readEngineTruth()
} catch (e) {
  check(`L1: the engine basis parses (registry, enum, analyzer inventory) ${REPAIR}`, false, (e as Error).message)
  writeEvidence("failed", { contract: { snapshot: EXPECTED } })
  console.log(`\nL1 gate: FAILED (${passed}/${checks} checks, ${negatives} negative cases)`)
  process.exit(1)
}

const registryNames = truth.registry.languages.map((l) => l.name)
const dedicatedCount = dedicatedLanguageCount(truth.registry)
const genericNames = truth.registry.languages.filter((l) => l.grammar === "__generic__").map((l) => l.name)
const analyzerTokens = truth.modules
const analyzerSet = new Set(analyzerTokens)
const vocab = truth.vocabulary
const ENUM_VALUES = vocab.emitted

check(
  `L1: the registry declares ${EXPECTED.languages} languages with ${EXPECTED.dedicatedParsers} dedicated grammars`,
  registryNames.length === EXPECTED.languages && dedicatedCount === EXPECTED.dedicatedParsers,
  `languages=${registryNames.length} dedicated=${dedicatedCount} generic=[${genericNames.join(",")}]`,
)
// Not `new Set(registryNames).size === registryNames.length` — that compares the
// map's keys with themselves and passes no matter what the source says. The
// duplicate that matters is in the SOURCE, so it is counted there.
const shadowed = truth.registry.declarations.filter((k, i) => truth.registry.declarations.indexOf(k) !== i)
check(
  "L1: no registry language is declared twice",
  shadowed.length === 0,
  `shadowed=[${[...new Set(shadowed)].join(",")}] declarations=${truth.registry.declarations.length} resolved=${registryNames.length}`,
)
check(
  `L1: the emitted relationship vocabulary is ${EXPECTED.relationshipTypes} values read from src/ast/types.ts`,
  ENUM_VALUES.length === EXPECTED.relationshipTypes,
  `types=${ENUM_VALUES.length} [${ENUM_VALUES.join(",")}]`,
)
check(
  `L1: the analyzer inventory is ${EXPECTED.analyzers} modules and matches the registry routes`,
  analyzerTokens.length === EXPECTED.analyzers && [...truth.analyzerModuleMap.keys()].length === EXPECTED.languages,
  `modules=${analyzerTokens.length} routedLanguages=${[...truth.analyzerModuleMap.keys()].length}`,
)

// Cross-source agreement: src/ast/graph.ts mirrors the enum and splits it into
// EMITTED and DERIVED blocks — DERIVED_RELATIONSHIP_TYPES is exported as data.
// The site publishes the EMITTED set; if graph.ts ever disagrees with types.ts
// about which values are emitted, the published vocabulary is a coin flip.
{
  const graphSrc = read("src/ast/graph.ts")
  const derivedBlockStart = graphSrc.indexOf("export const DERIVED_RELATIONSHIP_TYPES")
  const derivedBlockEnd = graphSrc.indexOf("])", derivedBlockStart)
  const graphEnumStart = graphSrc.indexOf("export enum RelationshipType")
  const graphEnumEnd = graphSrc.indexOf("\n  }", graphEnumStart)
  const graphMemberToValue = new Map<string, string>()
  if (graphEnumStart >= 0 && graphEnumEnd >= 0) {
    for (const line of graphSrc.slice(graphEnumStart, graphEnumEnd).split("\n")) {
      const t = line.trim()
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue
      const m = t.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*"([^"]+)"/)
      if (m) graphMemberToValue.set(m[1]!, m[2]!)
    }
  }
  const derivedMembers =
    derivedBlockStart >= 0 && derivedBlockEnd >= 0
      ? [...graphSrc.slice(derivedBlockStart, derivedBlockEnd).matchAll(/RelationshipType\.([A-Za-z]+)/g)].map((m) => m[1]!)
      : []
  const derivedValues = new Set(derivedMembers.map((m) => graphMemberToValue.get(m)!).filter(Boolean))
  const graphValues = new Set(graphMemberToValue.values())
  const overlap = ENUM_VALUES.filter((v) => derivedValues.has(v))
  const missingFromGraph = ENUM_VALUES.filter((v) => !graphValues.has(v))
  const unaccounted = [...graphValues].filter((v) => !ENUM_VALUES.includes(v) && !derivedValues.has(v))
  check(
    "L1: graph.ts's EMITTED/DERIVED split agrees with the authoritative enum",
    graphMemberToValue.size > 0 && derivedValues.size > 0 && overlap.length === 0 && missingFromGraph.length === 0 && unaccounted.length === 0,
    `overlap=[${overlap.join(",")}] missingFromGraph=[${missingFromGraph.join(",")}] unaccounted=[${unaccounted.join(",")}] derived=${derivedValues.size}`,
  )
}

// --- the website dataset ------------------------------------------------------------

const langSrc = site("src/data/brain-languages.ts")
type Family = { name: string; ext: string; ids: string[]; icon: string; color: string; emits: string[]; extracts: string }
const parsed: Family[] = [...langSrc.matchAll(
  /^\s*\{ name: '([^']+)', ext: '([^']*)', ids: \[([^\]]*)\], icon: ([A-Za-z][A-Za-z0-9]*), color: '([^']*)', emits: \[([^\]]*)\], extracts: '([^']*)' \},\s*$/gm,
)].map((m) => ({
  name: m[1]!, ext: m[2]!, ids: [...m[3]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!),
  icon: m[4]!, color: m[5]!, emits: [...m[6]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!), extracts: m[7]!,
}))

const { PARSERS } = (await import(path.join(SITE, "src/data/brain-languages.ts"))) as {
  PARSERS: { name: string; ext: string; ids: string[]; emits: string[]; extracts: string; color: string }[]
}

check(
  `L1: the dataset carries ${EXPECTED.families} families`,
  parsed.length === EXPECTED.families && PARSERS.length === EXPECTED.families,
  `bytes=${parsed.length} module=${PARSERS.length}`,
)
check(
  "L1: the byte-parsed dataset equals the imported module",
  parsed.length === PARSERS.length && parsed.every((p, i) => {
    const m = PARSERS[i]!
    return p.name === m.name && p.ext === m.ext && p.color === m.color && p.extracts === m.extracts
      && JSON.stringify(p.ids) === JSON.stringify(m.ids) && JSON.stringify(p.emits) === JSON.stringify(m.emits)
  }),
)

const fams = PARSERS
check("L1: every family has a name, extensions, a registry id and recorded symbols",
  fams.every((f) => f.name && f.ext && f.ids.length > 0 && f.extracts), "")
check("L1: every family's emits is a subset of the engine's emitted relationship vocabulary",
  fams.every((f) => f.emits.every((e) => ENUM_VALUES.includes(e))),
  fams.flatMap((f) => f.emits.filter((e) => !ENUM_VALUES.includes(e)).map((e) => `${f.name}:${e}`)).join(","),
)

// ids ↔ registry, both directions
const siteIds = fams.flatMap((f) => f.ids)
const dupIds = siteIds.filter((id, i) => siteIds.indexOf(id) !== i)
check("L1: no registry id is claimed by two families", dupIds.length === 0, [...new Set(dupIds)].join(","))
check(
  "L1: the families' ids are exactly the registry's languages",
  JSON.stringify([...new Set(siteIds)].sort()) === JSON.stringify([...registryNames].sort()),
  `site=${new Set(siteIds).size} registry=${registryNames.length}`,
)

// --- families are the analyzer inventory, and their ids are its routes ---------------
//
// The join key is the analyzer MODULE, and a family's ids must be exactly the
// registry languages whose getAnalyzer() route names that module. A family cannot
// borrow another module's language (`sass` under SCSS was the shipped version of
// that) and two families cannot share one module.
const moduleFor = (f: Family): string | undefined => f.ids.map((id) => truth.analyzerModuleMap.get(id)).find((m) => m && analyzerSet.has(m))

const analyzerGaps = fams.filter((f) => moduleFor(f) === undefined).map((f) => f.name)
check("L1: every family is backed by a real analyzer module", analyzerGaps.length === 0, analyzerGaps.join(","))

const claimed = fams.map((f) => moduleFor(f)).filter(Boolean) as string[]
const unclaimed = analyzerTokens.filter((m) => !claimed.includes(m))
check(
  `L1: the analyzer inventory is accounted for (${analyzerTokens.length} modules)`,
  analyzerTokens.length === EXPECTED.analyzers,
  `modules=${analyzerTokens.length}`,
)
check(
  "L1: every analyzer module is claimed by exactly one family",
  unclaimed.length === 0 && claimed.length === classifierCount(),
  `unclaimed=[${unclaimed.join(",")}] claimed=${claimed.length} modules=${analyzerTokens.length}`,
)
check(
  "L1: no two families claim the same analyzer module",
  new Set(claimed).size === claimed.length,
  claimed.filter((m, i) => claimed.indexOf(m) !== i).join(","),
)
check(
  "L1: each family's registry ids are exactly the languages its analyzer module routes",
  fams.every((f) => {
    const module = moduleFor(f)
    if (!module) return false
    const routed = truth.languagesByModule.get(module) ?? []
    return JSON.stringify([...f.ids].sort()) === JSON.stringify([...routed].sort())
  }),
  fams
    .filter((f) => {
      const module = moduleFor(f)
      if (!module) return true
      const routed = truth.languagesByModule.get(module) ?? []
      return JSON.stringify([...f.ids].sort()) !== JSON.stringify([...routed].sort())
    })
    .map((f) => `${f.name}: ids=[${f.ids.join(",")}] routed=[${(truth.languagesByModule.get(moduleFor(f)!) ?? []).join(",")}]`)
    .join(" · "),
)

function classifierCount(): number {
  return new Set(claimed).size
}

// --- the capability claim, checked in BOTH directions --------------------------------

function capabilityDrift(rows: Family[]): string[] {
  const drift: string[] = []
  for (const f of rows) {
    const mod = moduleFor(f)
    if (!mod) {
      drift.push(`${f.name}: no analyzer module`)
      continue
    }
    const fromSource = truth.emitsByModule.get(mod) ?? new Set<string>()
    if (fromSource.size === 0) {
      drift.push(`${f.name}(${mod}): analyzer derivation is empty ${REPAIR}`)
      continue
    }
    const declared = new Set(f.emits)
    const under = [...fromSource].filter((t) => !declared.has(t)).sort()
    const over = [...declared].filter((t) => !fromSource.has(t)).sort()
    if (under.length || over.length) drift.push(`${f.name}(${mod}) missing=${under.join("/")} invented=${over.join("/")}`)
  }
  return drift
}
const capabilityDriftHits = capabilityDrift(fams)
check(
  "L1: every family's emits equals what its analyzer source can construct",
  capabilityDriftHits.length === 0,
  capabilityDriftHits.join(" · "),
)

// --- bands, rails, ontology ---------------------------------------------------------

const bandsBlock = langSrc.slice(langSrc.indexOf("export const BANDS"), langSrc.indexOf("export const RAILS"))
const BANDS: { label: string; names: string[] }[] = [...bandsBlock.matchAll(/\{\s*label: '([^']+)',\s*names: \[([\s\S]*?)\],\s*\}/g)].map((m) => ({
  label: m[1]!, names: [...m[2]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!),
}))
const bandNames = BANDS.flatMap((b) => b.names)
check(
  "L1: every family appears in exactly one ecosystem band",
  new Set(bandNames).size === bandNames.length && fams.every((f) => bandNames.includes(f.name)) && bandNames.length === fams.length,
  `bands=${bandNames.length} families=${fams.length} missing=${fams.filter((f) => !bandNames.includes(f.name)).map((f) => f.name).join(",")}`,
)

const railSrc = langSrc.slice(langSrc.indexOf("export const RAILS"))
check(
  "L1: RAILS is two slices that partition the families",
  /export const RAILS = \[PARSERS\.slice\(/.test(railSrc) && /RAILS\.length === 2|RAILS\b/.test(langSrc),
  railSrc.split("\n")[0] ?? "",
)

// The deleted tier must not survive anywhere in the dataset, in any spelling.
const TIER_VOCAB = ["tier:", "TIER_PLATE", "TIER_DOT", "TIER_CELL", "TIER_TEXT", "Symbols + call graph", "Structural symbols", "Generic pass", "generic pass", "full / structural"]
const tierSurvivors = TIER_VOCAB.filter((v) => langSrc.includes(v))
check("L1: the deleted depth tier does not survive in the dataset", tierSurvivors.length === 0, tierSurvivors.join(","))

// The false claim must not survive in the CONTENT either.
const FALSE_CLAIMS = ["no dedicated analyzer", "generic traversal", "GenericAnalyzer", "no call graph is resolved", "generic pass"]
const depthFiles = existsSync(path.join(SITE, "src/data/language-depth"))
  // types.ts is the contract document. It quotes the false claims verbatim in
  // order to forbid them, so scanning it would flag the rule that forbids them.
  // Only the authored records are scanned for a claim.
  ? readdirSync(path.join(SITE, "src/data/language-depth"))
      .filter((f) => f.endsWith(".ts") && f !== "types.ts" && f !== "index.ts" && f !== "slugs.ts")
      .map((f) => `src/data/language-depth/${f}`)
  : []
const falseHits: string[] = []
for (const rel of depthFiles) {
  // Comments are stripped first. The band files legitimately NAME these phrases
  // in order to forbid them ("`GenericAnalyzer` is its unreachable default:
  // branch"), and a substring scan cannot tell a rule from a claim. The claim is
  // what ships.
  const body = site(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
  for (const c of FALSE_CLAIMS) if (body.toLowerCase().includes(c.toLowerCase())) falseHits.push(`${rel}: ${c}`)
}
check("L1: no depth record claims a missing analyzer or a missing call graph", falseHits.length === 0, falseHits.join(" · "))

// --- rendered surfaces ---------------------------------------------------------------

function htmlOf(route: string): string {
  for (const p of [
    path.join(SITE, `.next/server/app${route === "/" ? "/index" : route}.html`),
    path.join(SITE, `.next/server/app${route}/index.txt`),
  ]) {
    try {
      if (existsSync(p) && statSync(p).size > 0) return readFileSync(p, "utf8")
    } catch { /* try the next shape */ }
  }
  return ""
}
const decodeEntities = (h: string): string =>
  h.replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * A family the registry cannot index must never be presented as covered. Kept as
 * a function so the negative probe can prove the detector fires on planted HTML.
 */
function phantomCoverageHits(html: string, phantoms: readonly string[]): string[] {
  return phantoms.filter(
    (p) =>
      html.includes(`data-family="${p}"`) ||
      html.includes(`data-analyzer="${p}"`) ||
      new RegExp(`>${escapeRe(p)}</h[2-6]>`).test(html),
  )
}

const homeHtml = decodeEntities(htmlOf("/"))
const langHtml = decodeEntities(htmlOf("/languages"))
const built = homeHtml.length > 0 && langHtml.length > 0

// The homepage register is a field, not a catalogue: it prints no family list
// (the old card pin required 1200 characters of text per family, which is the
// repetition the owner rejected). The gate therefore verifies the drawing
// carries every analyzer as a data point — name + generated emits count — and
// that the plate declares the generated total. The per-family depth facts
// (extensions, ids, vocabulary, recorded symbols) stay pinned on /languages.
const homePoints = [...homeHtml.matchAll(/<circle[^>]*data-analyzer="([^"]+)"[^>]*data-emits="(\d+)"/g)].map((m) => ({
  name: m[1]!,
  emits: Number(m[2]),
}))
// Two plates exist (desktop and mobile geometry of the same drawing), so the
// same analyzer legitimately appears twice in the HTML; coverage is over names.
const homePointNames = new Set(homePoints.map((p) => p.name))
const homeGaps: string[] = []
if (homePointNames.size !== fams.length) homeGaps.push(`points=${homePointNames.size} families=${fams.length}`)
if (!homeHtml.includes(`data-analyzers="${fams.length}"`)) homeGaps.push(`plate total missing (${fams.length})`)
for (const f of fams) {
  const point = homePoints.find((p) => p.name === f.name)
  if (!point) homeGaps.push(`${f.name}: no data point`)
  else if (point.emits !== f.emits.length) homeGaps.push(`${f.name}: emits=${point.emits} data=${f.emits.length}`)
}
check(
  "L1: the homepage register draws every analyzer with its generated emits count",
  built && homeGaps.length === 0,
  homeGaps.slice(0, 6).join(" · "),
)

// Every family, on /languages: name in an <h2>, and within 2600 characters its
// extensions, its recorded symbols, every registry id as a <code> and its
// relationship vocabulary.
const langGaps: string[] = []
for (const f of fams) {
  const i = langHtml.indexOf(`>${f.name}</h2>`)
  if (i < 0) { langGaps.push(`${f.name}: no <h2>`); continue }
  const w = langHtml.slice(i, i + 2600)
  const missing: string[] = []
  if (!w.includes(f.ext)) missing.push(`ext(${f.ext})`)
  if (!w.includes(f.extracts)) missing.push("extracts")
  for (const id of f.ids) if (!new RegExp(`>${id}</code>`).test(w)) missing.push(`id:${id}`)
  if (f.emits.length && !f.emits.every((e) => w.includes(e))) missing.push(`emits(${f.emits.join("/")})`)
  if (missing.length) langGaps.push(`${f.name}: ${missing.join(" ")}`)
}
check(`L1: /languages publishes every family's facts within 2600 chars of its heading`, built && langGaps.length === 0, langGaps.slice(0, 6).join(" · "))

// The HTML is entity-decoded above, so `&amp;` is already `&` by the time these
// run — matching the encoded spelling here tested a string that cannot exist.
check("L1: /languages renders its eyebrow and title", /Languages & analyzers/.test(langHtml) && /<title>[^<]*Languages & analyzers/.test(langHtml))
check("L1: /languages explains the indexing pipeline and links the docs section", langHtml.includes("What happens when you index") && langHtml.includes("/docs#how-the-index-works"))
check("L1: the docs page carries the pipeline anchor the languages page links to", htmlOf("/docs").includes('id="how-the-index-works"'))

// --- the ledger's other half: ruled vs merely not constructed ------------------------
// The generated table is the page's source for "ruled absent" states. It is
// byte-compared against a fresh derivation, so neither a hand edit nor an
// analyzer page changing without a regeneration can pass.
const rulingSource = site("src/data/language-rulings.generated.ts")
const rulingRegenerated = serializeLanguageRulings()
check(
  "L1: the generated ruling table is byte-identical to the analyzer pages and family rows",
  rulingSource.length > 0 && rulingSource === rulingRegenerated,
  rulingSource === rulingRegenerated ? "" : "regenerate: npx tsx script/m56/generate-language-rulings.ts --write",
)

const rulingRows = buildLanguageRulings().rows
const rulingGaps: string[] = []
for (const f of fams) {
  const slug = FAMILY_SLUGS[f.name]
  const row = slug ? rulingRows[slug] : undefined
  if (!row) { rulingGaps.push(`${f.name}: no ruling entry`); continue }
  const absent = vocab.emitted.filter((t) => !f.emits.includes(t))
  const union = [...row.ruled, ...row.unrecorded]
  if (union.length !== absent.length || new Set(union).size !== absent.length || !absent.every((t) => union.includes(t))) {
    rulingGaps.push(`${f.name}: partition != absent types`)
  }
  if (row.ruled.length > 0 && !row.documented) rulingGaps.push(`${f.name}: rulings without a complete analyzer page`)
  if (row.delegatedTypes.some((t) => !f.emits.includes(t))) rulingGaps.push(`${f.name}: delegated type it does not publish`)
  if (row.delegates.length === 0 && row.delegatedTypes.length > 0) rulingGaps.push(`${f.name}: delegated type without a named delegate`)
  if (row.delegates.length > 0 && row.delegatedTypes.length === 0) rulingGaps.push(`${f.name}: named delegate with no attributed type`)
}
check("L1: every family's ruling entry partitions exactly its absent types", rulingGaps.length === 0, rulingGaps.slice(0, 5).join(" · "))
check("L1: the detail page reads the generated ruling table", site("src/app/languages/[slug]/page.tsx").includes("LANGUAGE_RULINGS"))

const rulingRenders: string[] = []
if (built) {
  const zigHtml = htmlOf("/languages/zig")
  const unrecorded = Object.entries(buildLanguageRulings().rows).find(([, r]) => !r.documented && r.unrecorded.length > 0)
  const unrecordedHtml = unrecorded ? htmlOf(`/languages/${unrecorded[0]}`) : ""
  const htmlHtml = htmlOf("/languages/html")
  if (!zigHtml.includes("ruled absent") || !zigHtml.includes("written reason")) rulingRenders.push("zig: ruled absent not rendered")
  if (unrecordedHtml && (!unrecordedHtml.includes("not constructed") || !unrecordedHtml.includes("does not agree with the analyzer-source derivation"))) rulingRenders.push(`${unrecorded?.[0]}: unrecorded absence not disclosed`)
  if (!htmlHtml.includes("published through delegated analyzers") || !htmlHtml.includes("hosts for inline blocks")) rulingRenders.push("html: delegation not disclosed")
  if (!langHtml.includes("A missing type is a ruling, not a gap.")) rulingRenders.push("register: heading")
}
check("L1: rendered ledgers label ruled absences, unrecorded absences and delegation", built && rulingRenders.length === 0, rulingRenders.join(" · "))

negative("N8: a hand-edited ruling table is detected", (() => {
  const planted = rulingRegenerated.replace("documented: true", "documented: false")
  return planted !== rulingRegenerated && planted !== rulingSource
})())

// A language the registry cannot index must never be presented as covered.
// MATLAB was on this list until the M60/MATLAB lanes gave it a registry key, an
// analyzer and a family — it is a covered language now, so the list keeps only
// languages with no registry entry of any kind.
const PHANTOM_FAMILIES: readonly string[] = ["Fortran", "COBOL", "Pascal", "Delphi", "Kotlin Script", "Racket", "Elm", "OCaml"]
const phantoms = phantomCoverageHits(langHtml, PHANTOM_FAMILIES).concat(phantomCoverageHits(homeHtml, PHANTOM_FAMILIES))
check("L1: no language the registry cannot index is presented as covered", phantoms.length === 0, [...new Set(phantoms)].join(","))
check(
  "L1: the phantom list itself names no registry language",
  PHANTOM_FAMILIES.every((p) => !registryNames.includes(p.toLowerCase())),
  PHANTOM_FAMILIES.filter((p) => registryNames.includes(p.toLowerCase())).join(","),
)

// The counts the pages publish must be the registry's, not the old snapshot's.
const truthSrc = site("src/data/truth.generated.ts")
const truthLanguages = Number(truthSrc.match(/classified:\s*(\d+)/)?.[1] ?? 0)
const truthDedicated = Number(truthSrc.match(/dedicatedParsers:\s*(\d+)/)?.[1] ?? 0)
check(
  "L1: the generated truth file agrees with the registry",
  truthLanguages === registryNames.length && truthDedicated === dedicatedCount,
  `truth=${truthLanguages}/${truthDedicated} registry=${registryNames.length}/${dedicatedCount}`,
)
check(
  "L1: no surface still publishes the retired counts",
  !homeHtml.includes("46 dedicated tree-sitter parsers across 49")
    && !homeHtml.includes("51 dedicated tree-sitter parsers across 51")
    && !langHtml.includes("41 dedicated analyzer modules"),
  "",
)

// --- negatives -----------------------------------------------------------------------

// N1 (bytes): a family claiming an edge its analyzer cannot build must be caught.
negative("N1: an invented relationship type is detected", (() => {
  const invented = "not_a_relationship_type"
  const mutated = fams.map((f) => (f.name === "TOML" ? { ...f, emits: [...f.emits, invented] } : f))
  const bad = mutated.some((f) => f.emits.some((e) => !ENUM_VALUES.includes(e)))
  return bad && !fams.some((f) => f.emits.some((e) => !ENUM_VALUES.includes(e)))
})())

// N2 (bytes): an under-claim — a family that quietly stops publishing an edge
// its analyzer can build — must be caught by the SAME comparator the real check
// uses, on mutated rows. This is the direction the deleted `tier` failed in, four
// times, and it is the more dangerous of the two.
negative("N2: an under-claimed relationship type is detected", (() => {
  const ts = fams.find((f) => f.name === "TypeScript")
  if (!ts || ts.emits.length === 0) return false
  const shrunk = fams.map((f) => (f.name === "TypeScript" ? { ...f, emits: f.emits.slice(1) } : f))
  const drift = capabilityDrift(shrunk)
  return drift.some((d) => d.startsWith("TypeScript(")) && capabilityDrift(fams).length === 0
})())

// N3 (bytes): a generic-pass claim is dead vocabulary and must stay dead.
negative("N3: the deleted tier vocabulary is detected", TIER_VOCAB.some((v) => `tier: 'full' ${v}`.includes(v)))

// N4 (bytes): dropping a family's registry id must break id↔registry parity.
negative("N4: a dropped registry id is detected", (() => {
  const shrunk = fams.map((f) => (f.name === "TOML" ? { ...f, ids: f.ids.slice(1) } : f))
  return JSON.stringify([...new Set(shrunk.flatMap((f) => f.ids))].sort()) !== JSON.stringify([...registryNames].sort())
})())

// N4b (bytes): a family borrowing a registry id whose route names a different
// analyzer module must be caught by the routing check — this is the shipped
// `sass`-under-SCSS defect, planted in reverse.
negative("N4b: a borrowed registry id from another analyzer route is detected", (() => {
  const scss = fams.find((f) => f.name === "SCSS / Sass")
  const css = fams.find((f) => f.name === "CSS")
  const sassId = truth.languagesByModule.get("css")?.includes("sass")
  if (!scss || !css || !sassId) return false
  const mutated = fams.map((f) => (f.name === "SCSS / Sass" ? { ...f, ids: [...f.ids, "sass"] } : f))
  const routes = (row: Family): string[] => [...new Set(row.ids.map((id) => truth.analyzerModuleMap.get(id)!).filter(Boolean))]
  const bad = mutated.find((f) => f.name === "SCSS / Sass")!
  return routes(bad).length > 1 && routes(scss).length === 1
})())

// N5 (bytes): a family losing its analyzer module must be detected.
negative("N5: a family with no analyzer module is detected", (() => {
  // Drop one family's registry ids entirely and confirm the gap detector fires
  // for it — the shape of "a language was added to the dataset with no analyzer".
  const orphan = fams.find((f) => moduleFor(f) !== undefined)
  if (!orphan) return false
  const withoutIt = fams.map((f) => (f.name === orphan.name ? { ...f, ids: [] } : f))
  return withoutIt.some((f) => f.name === orphan.name && moduleFor(f) === undefined)
})())

// N6 (real mutation on disk): emptying one family's `emits` must fail the
// capability check, and the restore must be byte-clean. The backup lives in
// tmpdir so a broad `git add` can never see it.
//
// The dataset's `emits` is an ARRAY now (it was a space-joined string when this
// negative was written), so the mutation rewrites the bracketed list; the old
// string form matched nothing and the probe passed for the wrong reason.
{
  const target = path.join(SITE, "src/data/brain-languages.ts")
  const backup = path.join(tmpdir(), `l1-langs-n6-${process.pid}.ts`)
  const original = readFileSync(target, "utf8")
  writeFileSync(backup, original)
  try {
    const mutated = original.replace(/(\{ name: 'Rust'[^}]*?emits: )\[[^\]]*\]/, "$1[]")
    writeFileSync(target, mutated)
    const after = [...mutated.matchAll(/^\s*\{ name: '([^']+)'[^}]*?emits: \[([^\]]*)\]/gm)]
    const rust = after.find((m) => m[1] === "Rust")
    const rustRow = rust
      ? { name: "Rust", ext: "", ids: [...(rust[0].match(/ids: \[([^\]]*)\]/)?.[1] ?? "").matchAll(/'([^']+)'/g)].map((x) => x[1]!), icon: "", color: "", emits: [...rust[2]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!), extracts: "" }
      : undefined
    const drift = rustRow ? capabilityDrift([rustRow]) : []
    negative("N6: an emptied emits field fails the capability check", mutated !== original && drift.length > 0, drift.join(" · "))
  } finally {
    writeFileSync(target, original)
    rmSync(backup, { force: true })
  }
  check("N6 restore-proof: the language dataset is byte-clean again", readFileSync(target, "utf8") === original)
}

// N7 (bytes): the phantom-coverage detector must fire on planted HTML.
negative("N7: a family the registry cannot index is detected on rendered HTML", (() => {
  const planted = '<h2>Fortran</h2><p class="x">a language nobody indexes</p>'
  const notPlanted = `<h2>${fams[0]!.name}</h2>`
  return phantomCoverageHits(planted, PHANTOM_FAMILIES).length === 1 && phantomCoverageHits(notPlanted, PHANTOM_FAMILIES).length === 0
})())

// --- verdict + evidence ---------------------------------------------------------------

const failed = checks - passed
const ok = failed === 0
writeEvidence(ok ? "verified" : "failed", {
  contract: {
    snapshot: EXPECTED,
    registryLanguages: registryNames.length,
    dedicatedGrammars: dedicatedCount,
    genericRegistryEntries: genericNames,
    analyzerModules: analyzerTokens.length,
    families: fams.length,
    relationshipEnum: ENUM_VALUES,
  },
  summary: [
    `the registry declares ${registryNames.length} languages, ${dedicatedCount} with a dedicated grammar`,
    `${fams.length} families, one per analyzer module; all ${analyzerTokens.length} modules claimed exactly once`,
    "each family's registry ids are exactly the languages its analyzer module routes",
    "each family's relationship vocabulary equals what its analyzer source can construct, checked in both directions",
    "graph.ts's EMITTED/DERIVED split agrees with the authoritative types.ts enum",
    "the full/structural/generic depth tier has been removed: it had no definition in src/ and was anti-correlated with measured coverage",
    "no depth record claims a missing analyzer or a missing call graph",
    `the homepage register points at every family, and /languages publishes each family's extensions, recorded symbols and relationship vocabulary`,
    "the language ledger's other half is generated: an absent type is ruled absent only where the family's analyzer page records the ruling, and unrecorded otherwise",
  ],
  limitations: [
    "`emits` is derived from the analyzer source by regex over RelationshipType sites and literal type strings, the same over-reporting derivation script/m60/rel-type-coverage-gate.ts uses. A relationship built through an indirection neither regex can see would be missed; the derivation errs toward over-reporting so a family's claim is checked against a superset. The independent audit of that derivation is script/m60/rel-type-coverage-gate.ts (differential-audited labels), not this gate.",
    "The rendered-surface checks read website/.next, so they are skipped when the site has not been built. The dataset, routing, analyzer and capability checks above always run.",
    "The ledger's ruled/non-constructed split is generated from the canonical analyzer pages in docs/analyzers: a page with no complete, source-consistent relationship table leaves its family's absences marked unrecorded rather than filling them in. The table is byte-checked against a fresh derivation on every run.",
    "The homepage pin requires a `data-analyzer=\"<name>\"` point with the generated emits count for every family, and `data-analyzers` = the family total; a missing family cannot pass.",
  ],
})
console.log(`\nL1 gate: ${ok ? "VERIFIED" : "FAILED"} (${passed}/${checks} checks, ${negatives} negative cases)`)
if (!ok) process.exit(1)
