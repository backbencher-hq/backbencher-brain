/**
 * LANGUAGE RULINGS — the ledger's other half, generated.
 *
 * WHAT THIS FILE IS FOR
 * ---------------------
 * A language page's 14-row ledger says which relationship types the family's
 * analyzer source can construct. The absent rows are not all the same kind of
 * fact: a family whose analyzer record carries a written *ruling* for an absent
 * type is making a falsifiable claim (no construct in the language produces that
 * edge, measured against the corpus, with a gate that fails if the construct
 * appears), while a family with no recorded ruling has only the derivation
 * ("this analyzer does not construct it"), which is not a format claim at all.
 *
 * The page used to collapse both into "empty", and asserted the format fact for
 * every absent row. That was wrong for exactly the families whose record has no
 * ruling. This generator reads, in order of authority:
 *
 *   1. the machine completeness record script/m14/spec/<lang>-completeness.json
 *      (`coverage.implemented` / `coverage.excluded`) — the ruling table the
 *      ontology workstream wrote per language, used only when its implemented
 *      set equals the analyzer-source derivation;
 *   2. the canonical analyzer page docs/analyzers/<lang>.md, as a fallback and
 *      only when its table is complete and agrees with the source;
 *   3. nothing: the family is reported as unrecorded and the page makes no claim.
 *
 * Per family it emits:
 *
 *   documented  the page's relationship table is complete (all 14 rows, every
 *               verdict parseable) AND its emitted set equals the derives-from-
 *               source set the site already publishes. This is the parity check:
 *               a table that disagrees with the analyzer source is stale, and a
 *               stale table is not evidence.
 *   ruled       absent types the complete table records as ruled (the page then
 *               says "ruled absent" and points at the ruling mechanism).
 *   unrecorded  absent types with no usable ruling table (the page says only
 *               "not constructed" and makes no format claim).
 *   delegates   analyzer modules this one hands work to (HTML resolves inline
 *               <script>/<style> through the JavaScript/TypeScript/CSS
 *               analyzers and merges their edges); the page discloses that the
 *               constructed count includes those edges.
 *
 * The generated file is byte-compared by the languages gate
 * (script/m56/verify-languages-surface.ts): editing it by hand, or editing an
 * analyzer page without regenerating, fails L1. It is not a new ledger gate —
 * M56.G1 pins the gate set, so the checks live inside the gate that already owns
 * the language surface.
 *
 * Run: npx tsx script/m56/generate-language-rulings.ts [--write]
 */
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const DATASET = path.join(ROOT, "website/src/data/brain-languages.ts")
const SLUGS = path.join(ROOT, "website/src/data/language-depth/slugs.ts")
const DOCS = path.join(ROOT, "docs/analyzers")
const AST = path.join(ROOT, "src/ast")
export const OUT = path.join(ROOT, "website/src/data/language-rulings.generated.ts")

const RELATIONSHIP_TYPES = (() => {
  const src = readFileSync(DATASET, "utf8")
  const m = src.match(/export const RELATIONSHIP_TYPES = \[([^\]]+)\] as const/)
  if (!m) throw new Error("generate-language-rulings: RELATIONSHIP_TYPES not found in brain-languages.ts")
  return [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!)
})()

type Family = { name: string; emits: string[] }
const FAMILIES: Family[] = (() => {
  const src = readFileSync(DATASET, "utf8")
  const rows = [...src.matchAll(/\{ name: '([^']+)'[\s\S]*?emits: \[([^\]]*)\]/g)]
  if (!rows.length) throw new Error("generate-language-rulings: no family rows found")
  return rows.map((m) => ({
    name: m[1]!,
    emits: m[2]!.split(",").map((x) => x.trim().replace(/'/g, "")).filter(Boolean),
  }))
})()

const SLUG_BY_FAMILY: Record<string, string> = (() => {
  const src = readFileSync(SLUGS, "utf8")
  const out: Record<string, string> = {}
  for (const m of src.matchAll(/^\s+(?:"([^"]+)"|'([^']+)'|([A-Za-z][A-Za-z0-9+# /-]*?)):\s*"([^"]+)",/gm)) {
    const key = (m[1] ?? m[2] ?? m[3] ?? "").trim()
    if (key) out[key] = m[4]!
  }
  return out
})()

/** The docs/analyzers page for a slug, and the analyzer module token behind it. */
const DOC_BASE: Record<string, string> = { terraform: "hcl", makefile: "make", "visual-basic": "vb" }
/** Analyzer module token: the slug, except for the two whose module name differs. */
const MODULE_BY_SLUG: Record<string, string> = { terraform: "hcl", "visual-basic": "vb" }
/** Completeness-spec base name: the module token, except where the spec file differs. */
const SPEC_BASE: Record<string, string> = { terraform: "hcl", makefile: "make", "visual-basic": "vb", "objective-c": "objc" }
const SPEC_DIR = path.join(ROOT, "script/m14/spec")
const MODULES = new Set(
  readdirSync(AST).filter((f) => /^real-.*-analyzer\.ts$/.test(f)).map((f) => f.replace(/^real-/, "").replace(/-analyzer\.ts$/, "")),
)
const DELEGATE_LABELS: Record<string, string> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  css: "CSS",
  svelte: "Svelte",
  vue: "Vue",
}

const norm = (s: string) => s.replace(/`/g, "").replace(/\*\*/g, "").replace(/["']/g, "").trim().toLowerCase()

function verdict(cell: string): "yes" | "no" | "unknown" {
  const v = norm(cell)
  if (/^(yes|emitted)\b/.test(v) || v.includes("✅")) return "yes"
  if (/^(no|ruled|not emitted|not constructed|gap)\b/.test(v) || v.includes("❌") || v.includes("ruled") || /^gap\b/.test(v)) return "no"
  return "unknown"
}

/**
 * Parse one canonical analyzer page's relationship ontology table. Rows may be
 * split across more than one table inside the section (a few pages keep a
 * separate census table); the FIRST row per type that carries a yes/no verdict
 * is the ontology row. Anything else in the section (census rows with a numeric
 * second cell) is skipped rather than misread.
 */
type DocRow = "yes" | "no" | "gap"
function parseRulingsPage(file: string): { rows: Map<string, DocRow>; complete: boolean } | null {
  if (!existsSync(file)) return null
  const text = readFileSync(file, "utf8").replace(/\r/g, "")
  const heading = text.match(/^#+\s+Relationship ontology.*$/mi)
  if (!heading) return null
  const rest = text.slice(heading.index! + heading[0].length)
  const nextHeading = rest.match(/^##+\s+/m)
  const section = nextHeading ? rest.slice(0, nextHeading.index) : rest
  const rows = new Map<string, DocRow>()
  for (const line of section.split("\n")) {
    if (!line.trim().startsWith("|")) continue
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim())
    const type = norm(cells[0] ?? "")
    if (!RELATIONSHIP_TYPES.includes(type) || rows.has(type)) continue
    const v = verdict(cells[1] ?? "")
    if (v === "unknown") continue
    // A `no` row that names a GAP is a declared analyzer limitation, not a ruling.
    const gap = v === "no" && /\bgap\b/i.test(cells[1] ?? "")
    rows.set(type, v === "yes" ? "yes" : gap ? "gap" : "no")
  }
  return { rows, complete: rows.size === RELATIONSHIP_TYPES.length }
}

/**
 * Types this module's own code constructs, from emission sites only. The broad
 * derivation in site-truth also counts pass-through comparisons and delegates;
 * this narrower scan is used only to attribute a delegating family's emitted
 * types between its own sites and the analyzers it hosts.
 */
function ownEmittedTypes(module: string): Set<string> {
  const raw = readFileSync(path.join(AST, `real-${module}-analyzer.ts`), "utf8")
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  const found = new Set<string>()
  const members = new Map<string, string>()
  for (const type of RELATIONSHIP_TYPES) {
    const camel = type
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("")
    members.set(camel, type)
  }
  for (const m of src.matchAll(/\btype:\s*(?:ASTEngine\.)?RelationshipType\.([A-Za-z]+)/g)) {
    const v = members.get(m[1]!)
    if (v) found.add(v)
  }
  for (const m of src.matchAll(/\btype:\s*"([a-z_]+)"/g)) if (RELATIONSHIP_TYPES.includes(m[1]!)) found.add(m[1]!)
  for (const m of src.matchAll(/\brel\(\s*[^,()]+,\s*"([a-z_]+)"/g)) if (RELATIONSHIP_TYPES.includes(m[1]!)) found.add(m[1]!)
  return found
}

type SpecRow = { documented: boolean; ruled: string[] }
/**
 * The completeness spec (`script/m14/spec/<base>-completeness.json`) is the
 * machine-written per-language record: `coverage.implemented` lists the types
 * production work emits and `coverage.excluded` carries one entry per ruled
 * absence with an evidence kind, a written `from` and, for corpus rulings, a
 * measured `count`. It is used only when it AGREES with the analyzer-source
 * derivation this site already publishes; a spec that disagrees is stale and is
 * reported rather than believed.
 */
function rulingsFromSpec(slug: string, family: { name: string; emits: string[] }): SpecRow | null {
  const base = SPEC_BASE[slug] ?? MODULE_BY_SLUG[slug] ?? slug
  const file = path.join(SPEC_DIR, `${base}-completeness.json`)
  if (!existsSync(file)) return null
  const coverage = (JSON.parse(readFileSync(file, "utf8")) as { coverage?: { implemented?: string[]; excluded?: { label?: string }[] } }).coverage
  if (!coverage) return null
  const implemented = coverage.implemented ?? []
  const absent = RELATIONSHIP_TYPES.filter((t) => !family.emits.includes(t))
  const parity = implemented.length === family.emits.length && implemented.every((t) => family.emits.includes(t))
  const excluded = new Set((coverage.excluded ?? []).map((e) => e.label).filter((l): l is string => Boolean(l)))
  if (!parity || !absent.every((t) => excluded.has(t))) return null
  return { documented: true, ruled: absent }
}

/** Analyzer modules this module hands work to (delegation, not inheritance). */
function delegatesOf(module: string): string[] {
  // Comments discuss other analyzers; only code that actually requires/instantiates
  // one is a delegation. Strip block comments and full-line // comments first so a
  // doc comment mentioning `RealCAnalyzer` cannot invent a delegate.
  const raw = readFileSync(path.join(AST, `real-${module}-analyzer.ts`), "utf8")
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  const out = new Set<string>()
  for (const m of src.matchAll(/require\(\s*["']\.\/real-([a-z0-9-]+)-analyzer["']\s*\)|Real([A-Za-z0-9]+)Analyzer/g)) {
    const token = (m[1] ?? m[2]?.toLowerCase() ?? "").trim()
    if (token && token !== module && MODULES.has(token)) out.add(token)
  }
  return [...out].sort()
}

export type Ruling = {
  documented: boolean
  ruled: string[]
  unrecorded: string[]
  delegates: string[]
  /** Emitted types that come from a delegated analyzer, not this module's own sites. */
  delegatedTypes: string[]
}

export function buildLanguageRulings(): { rows: Record<string, Ruling>; sourceDigest: string; stalePages: string[] } {
  const rows: Record<string, Ruling> = {}
  const stalePages: string[] = []
  for (const family of FAMILIES) {
    const slug = SLUG_BY_FAMILY[family.name]
    if (!slug) throw new Error(`generate-language-rulings: no slug for family ${family.name}`)
    const module = MODULE_BY_SLUG[slug] ?? slug
    const docBase = DOC_BASE[slug] ?? slug
    const page = parseRulingsPage(path.join(DOCS, `${docBase}.md`))
    const absent = RELATIONSHIP_TYPES.filter((t) => !family.emits.includes(t))
    const fromSpec = rulingsFromSpec(slug, family)
    if (!fromSpec && existsSync(path.join(SPEC_DIR, `${SPEC_BASE[slug] ?? MODULE_BY_SLUG[slug] ?? slug}-completeness.json`))) {
      stalePages.push(`${family.name}: script/m14/spec completeness record disagrees with the analyzer-source derivation`)
    }
    let complete = Boolean(fromSpec)
    let ruledFrom = complete ? fromSpec!.ruled : []
    if (fromSpec) {
      // spec is the machine record; no page parsing needed
    } else if (page?.complete) {
      const docEmitted = RELATIONSHIP_TYPES.filter((t) => page.rows.get(t) === "yes")
      const parity = docEmitted.length === family.emits.length && docEmitted.every((t) => family.emits.includes(t))
      complete = parity
      if (parity) ruledFrom = absent.filter((t) => page!.rows.get(t) === "no")
      else stalePages.push(`${family.name}: docs/analyzers/${docBase}.md emitted set disagrees with the analyzer-source derivation`)
    } else if (existsSync(path.join(DOCS, `${docBase}.md`))) {
      stalePages.push(`${family.name}: docs/analyzers/${docBase}.md has no complete relationship ontology table`)
    } else {
      stalePages.push(`${family.name}: docs/analyzers/${docBase}.md is missing`)
    }
    const ruled = complete ? ruledFrom : []
    const unrecorded = absent.filter((t) => !ruled.includes(t))
    const delegateModules = delegatesOf(module)
    const own = ownEmittedTypes(module)
    rows[slug] = {
      documented: complete,
      ruled,
      unrecorded,
      delegates: delegateModules.map((t) => DELEGATE_LABELS[t] ?? t),
      delegatedTypes: delegateModules.length > 0 ? family.emits.filter((t) => !own.has(t)) : [],
    }
  }
  // Fail closed on the partition this file exists to state: for every family,
  // ruled and unrecorded are disjoint and together are exactly the absent types.
  for (const family of FAMILIES) {
    const slug = SLUG_BY_FAMILY[family.name]!
    const row = rows[slug]!
    const absent = RELATIONSHIP_TYPES.filter((t) => !family.emits.includes(t))
    const overlap = row.ruled.filter((t) => row.unrecorded.includes(t))
    const union = new Set([...row.ruled, ...row.unrecorded])
    if (overlap.length) throw new Error(`generate-language-rulings: ${family.name} lists ${overlap.join(",")} as both ruled and unrecorded`)
    if (union.size !== absent.length || !absent.every((t) => union.has(t))) {
      throw new Error(`generate-language-rulings: ${family.name} partition does not cover exactly the ${absent.length} absent types`)
    }
    if (!row.documented && row.ruled.length) throw new Error(`generate-language-rulings: ${family.name} claims rulings without a documented table`)
    if (row.delegatedTypes.some((t) => !family.emits.includes(t))) throw new Error(`generate-language-rulings: ${family.name} attributes a delegated type it does not publish`)
    if (row.delegates.length === 0 && row.delegatedTypes.length > 0) throw new Error(`generate-language-rulings: ${family.name} attributes edges to a delegate it does not name`)
    if (row.delegates.length > 0 && row.delegatedTypes.length === 0) throw new Error(`generate-language-rulings: ${family.name} names a delegate but attributes no type to it`)
  }
  const digest = createHash("sha256")
    .update(JSON.stringify({ types: RELATIONSHIP_TYPES, rows }))
    .digest("hex")
  return { rows, sourceDigest: digest, stalePages }
}

export function serializeLanguageRulings(): string {
  const { rows, sourceDigest } = buildLanguageRulings()
  const lines: string[] = [
    "// GENERATED by script/m56/generate-language-rulings.ts — do not edit.",
    "// Reads the canonical analyzer pages in docs/analyzers and the family dataset;",
    "// M56.L1 (verify-languages-surface.ts) re-derives this file byte-for-byte.",
    "",
    "export type LanguageRuling = {",
    "  /** The analyzer page carries a complete relationship table that agrees with the source derivation. */",
    "  documented: boolean",
    `  /** Absent types with a recorded ruling, in the engine's declaration order. */`,
    "  ruled: readonly string[]",
    "  /** Absent types with no usable ruling table; the page makes no format claim about them. */",
    "  unrecorded: readonly string[]",
    "  /** Analyzer modules this one delegates inline blocks to (display names). */",
    "  delegates: readonly string[]",
    "  /** Emitted types that the delegated analyzers publish, not this module's own sites. */",
    "  delegatedTypes: readonly string[]",
    "}",
    "",
    `export const LANGUAGE_RULINGS_DIGEST = ${JSON.stringify(sourceDigest)}`,
    "",
    "export const LANGUAGE_RULINGS: Record<string, LanguageRuling> = {",
  ]
  for (const [slug, row] of Object.entries(rows)) {
    lines.push(`  ${JSON.stringify(slug)}: {`)
    lines.push(`    documented: ${row.documented},`)
    lines.push(`    ruled: ${JSON.stringify(row.ruled)},`)
    lines.push(`    unrecorded: ${JSON.stringify(row.unrecorded)},`)
    lines.push(`    delegates: ${JSON.stringify(row.delegates)},`)
    lines.push(`    delegatedTypes: ${JSON.stringify(row.delegatedTypes)},`)
    lines.push("  },")
  }
  lines.push("}", "")
  return lines.join("\n")
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
if (isMain) {
  const built = buildLanguageRulings()
  const text = serializeLanguageRulings()
  const documented = Object.values(built.rows).filter((r) => r.documented).length
  const ruledTypes = Object.values(built.rows).reduce((n, r) => n + r.ruled.length, 0)
  const unrecordedTypes = Object.values(built.rows).reduce((n, r) => n + r.unrecorded.length, 0)
  const delegatedFamilies = Object.entries(built.rows).filter(([, r]) => r.delegates.length).map(([s]) => s)
  console.log(`families=${FAMILIES.length} documented=${documented} ruledRows=${ruledTypes} unrecordedRows=${unrecordedTypes} delegated=${delegatedFamilies.join(",")}`)
  for (const line of built.stalePages) console.log(`  not recorded: ${line}`)
  if (process.argv.includes("--write")) {
    writeFileSync(OUT, text)
    console.log(`wrote ${path.relative(ROOT, OUT)} (${text.length} bytes)`)
  } else {
    console.log("dry run — pass --write to update the generated file")
  }
}
