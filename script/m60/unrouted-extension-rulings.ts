/**
 * THE RULED WORKLIST for the unrouted-extension class — the census's fixable rows, joined against every ruling
 * that already exists, with CONTENT CONSENSUS over a stride for the ones that do not.
 *
 * ## WHY THIS EXISTS
 *
 * `unrouted-extension-census.ts` measures, for each refused extension, whether a grammar ALREADY IN THE FLEET
 * yields symbols on its content. Its own document says what that is: **a parse result, not a ruling** — and it
 * records the proof, `.pyx`, whose Python-grammar row reads 244 symbols while `routing-outlier-census.ts`
 * declares `.pyx` `other-format` and RETIRED (`#913`, 2026-09-24) because the Python grammar cannot REPRESENT
 * Cython. Acting on the census alone would re-add three retired extensions and fail R11, which exists to
 * convict exactly that. So the two instruments are JOINED here, and the result is disjoint categories:
 *
 *   not-actionable-name-fragment  the key is not an extension (see the census's EXTENSION_SHAPE): a filename
 *                                 fragment can carry a parse result like anything else, and it is never a work
 *                                 item. Twelve fixable rows were fragments — and were proposed for routing,
 *                                 which is what put this category here.
 *   closed-by-ruling              declared `other-format` (retired or not): a ruling says the shared routing is
 *                                 wrong, so the census's parse result does not reopen it.
 *   omission-with-a-ruling        declared `same-language` and still unrouted: the ruling already states the
 *                                 format IS that language, so the missing entry is an omission and the fix is
 *                                 the category.
 *   declared-ambiguous-sniff      declared ambiguous (the `.h` header): the router's contentless map cannot
 *                                 express it, so no entry is proposed.
 *   needs-a-ruling                undeclared anywhere: the census's candidate is a spelling proposal and the
 *                                 content has to say the rest.
 *
 * ## WHY A STRIDE AND NOT THREE EXAMPLES, AND WHY A CONSENSUS
 *
 * The first version read the census's three example files and called a single match a proposal. That is how a
 * routing defect gets created: three XML `.cfg` files propose `xml` for 151 files, while `.cfg` elsewhere is
 * INI and the entry would hand INI to the XML grammar — the same failure shape as `.pyx`, one step earlier.
 * So this walks the corpus (tracked files, the census's own population rule), sniffs up to `SNIFF_FILES` per
 * extension, and reports the DISTRIBUTION of signatures: a proposal requires a dominant language-bearing
 * signature at `>= 0.8` of the stride, `high` confidence additionally requires unanimity over at least five
 * files, and an extension whose stride disagrees with itself is reported as `mixed` with NO proposal.
 *
 * **A signature is still only a proposal.** It reads the first 1 KB and knows nothing about semantics; the
 * excerpt is the evidence and the ruling is a human act. `.resx` is the type case that shows the join working:
 * the census found the R grammar yielding symbols, the content is XML, and both are recorded — the census's
 * candidate is a parse result, the content signature is the true format, and only the second is routable.
 *
 * ## BOUNDARIES, DISCLOSED
 *
 *   * Front matter is not a format: a leading `---` fence proposes NOTHING (it opens Markdown, YAML, TOML...).
 *   * A one-file extension cannot reach `medium` on consensus alone; it needs a declaration.
 *   * The prize column is the CENSUS's number, an extrapolation under its declared caps; nothing is re-priced.
 *   * This instrument proposes. It does not edit the router, and nothing here is a ruling.
 *
 * Run: npx tsx script/m60/unrouted-extension-rulings.ts
 *   → validation/m60/results/unrouted-extension-rulings.json
 * Exit: 0 the worklist was produced, 2 the census artifact is absent (nothing to join against).
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, statSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { EXTENSION_RELATION } from "./routing-outlier-census"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CENSUS = path.join(ROOT, "validation/m14/measurements/unrouted-extension-census.json")
const OUT = path.join(ROOT, "validation/m60/results/unrouted-extension-rulings.json")
/** How many files of one extension are sniffed. The census prices a stride of 25; this reads the same order. */
const SNIFF_FILES = 25
const CONSENSUS_FLOOR = 0.8

type CensusRow = {
  ext: string
  files: number
  bytes: number
  textFiles: number
  bucket: string
  grammar: string | null
  grammarLanguage: string | null
  extensionShape?: string
  examples: string[]
  priced: { files: number; symbols: number; relationships: number; extrapolatedToTextPool: { relationships: number; exact: boolean } | null } | null
}
type Kind = { kind: string; language: string | null }
const KINDS: Record<string, string | null> = {
  "shebang-shell": "bash",
  "shebang-python": "python",
  "shebang-node": "javascript",
  "shebang-perl": "perl",
  "shebang-ruby": "ruby",
  "xml-declaration": "xml",
  "html-doctype": "html",
  "json-parses": "json",
  "yaml-directive": "yaml",
  "front-matter-fence": null, // a fence opens Markdown, YAML, TOML... it identifies nothing
  "braces-unparsed": null,
  unknown: null,
  unreadable: null,
}

/**
 * THE OWNING GRAMMAR'S OWN DECLARATION, where one is vendored — the standard the XML lane states in its own
 * source: "routing is taken from the grammar's own declaration rather than from taste", which is why `.wsdl`,
 * `.pom` and `.plist` stay unrouted there although they are XML-shaped. A content consensus does NOT meet that
 * bar, so every proposal records whether the grammar that would receive it actually declares the extension:
 *
 *   true   the declaration names it — the proposal meets the declaration-based standard
 *   false  the declaration does NOT name it — under that lane's standard the entry is not allowed, however
 *          well the content reads; the proposal is evidence for the lane, not an entry to add
 *   null   no vendored declaration to check (the grammar ships as wasm only) — the applicable standard is the
 *          lane's own, and this instrument cannot certify it
 */
const grammarDeclaration = (language: string): { grammarDir: string; declares: string[] } | null => {
  const p = path.join(ROOT, "grammars", `tree-sitter-${language}`, "tree-sitter.json")
  if (!existsSync(p)) return null
  try {
    const d = JSON.parse(readFileSync(p, "utf8")) as { "file-types"?: string[]; grammars?: Array<{ "file-types"?: string[] }> }
    const declares = d["file-types"] ?? d.grammars?.[0]?.["file-types"] ?? []
    return { grammarDir: `grammars/tree-sitter-${language}`, declares }
  } catch {
    return null
  }
}

/** High-confidence signatures only, from the first 1 KB. `json-parses` additionally parses the whole file. */
const sniff = (abs: string): string => {
  let head = ""
  try {
    const fd = openSync(abs, "r")
    const buf = Buffer.alloc(1024)
    const n = readSync(fd, buf, 0, 1024, 0)
    closeSync(fd)
    head = buf.subarray(0, n).toString("utf8")
  } catch {
    return "unreadable"
  }
  const t = head.trimStart()
  if (/^#!.*\b(bash|zsh|sh|dash|ksh)\b/.test(t)) return "shebang-shell"
  if (/^#!.*\bpython[0-9.]*\b/.test(t)) return "shebang-python"
  if (/^#!.*\b(node|deno|bun)\b/.test(t)) return "shebang-node"
  if (/^#!.*\bperl\b/.test(t)) return "shebang-perl"
  if (/^#!.*\bruby\b/.test(t)) return "shebang-ruby"
  if (/^<\?xml/.test(t)) return "xml-declaration"
  if (/^<!DOCTYPE html|<html[\s>]/i.test(t)) return "html-doctype"
  if (/^[[{]/.test(t)) {
    try {
      const size = statSync(abs).size
      if (size > 0 && size <= 512 * 1024 && JSON.parse(readFileSync(abs, "utf8")) !== undefined) return "json-parses"
    } catch {
      // not JSON, or too large to check: an unparsed brace is not evidence
    }
    return "braces-unparsed"
  }
  if (/^---\s*(\r?\n|$)/.test(t)) return "front-matter-fence"
  if (/^%YAML/.test(t)) return "yaml-directive"
  return "unknown"
}

if (!existsSync(CENSUS)) {
  console.error(`no census artifact at ${path.relative(ROOT, CENSUS)} — run npx tsx script/m60/unrouted-extension-census.ts first`)
  process.exit(2)
}
const census = JSON.parse(readFileSync(CENSUS, "utf8")) as {
  generatedAt: string
  scope: { corpusRoot: string; unroutedExtensionsInCorpus: number; unroutedFiles: number; extensionsDeclaredByTheRouter: number }
  rows: CensusRow[]
}
const corpusRoot = census.scope.corpusRoot
const fixable = census.rows.filter((r) => r.bucket === "sibling-grammar-reads-it")
const wanted = new Set(fixable.map((r) => r.ext))

// ---------------------------------------------------------------- 1. the corpus stride, per fixable extension
const strideOf = new Map<string, string[]>()
for (const repo of readdirSync(corpusRoot).sort()) {
  const dir = path.join(corpusRoot, repo)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const base = rel.split("/").pop() ?? rel
    const dot = base.lastIndexOf(".")
    const ext = dot > 0 ? base.slice(dot).toLowerCase() : "(none)"
    if (!wanted.has(ext)) continue
    const list = strideOf.get(ext) ?? []
    if (list.length < SNIFF_FILES * 4) list.push(path.join(dir, rel))
    strideOf.set(ext, list)
  }
  if (strideOf.size === wanted.size && [...strideOf.values()].every((l) => l.length >= SNIFF_FILES * 4)) break
}

// ---------------------------------------------------------------- 2. sniff, tally, classify
type RulingRow = {
  ext: string
  files: number
  nameShape: "extension-shaped" | "suspect-name-fragment"
  category: "not-actionable-name-fragment" | "closed-by-ruling" | "omission-with-a-ruling" | "declared-ambiguous-sniff" | "needs-a-ruling"
  declared: { relation: string; lang: string; retired: boolean; note: string } | null
  censusCandidate: { candidate: string | null; language: string | null; pricedRelationships: number; relationshipsScaledToWholeTextPool: number }
  content: { filesSniffed: number; distribution: Record<string, number>; dominant: string; dominantShare: number; verdict: "unanimous" | "consensus" | "mixed" | "unknown"; excerpts: string[] }
  proposal: { language: string; basis: string; confidence: "high" | "medium" | "low" } | null
  /** Whether the grammar that would RECEIVE the extension declares it — the XML lane's own standard. */
  grammarDeclaration: { grammarDir: string; declares: string[]; declaresThisExtension: boolean } | null
  /** True when the proposal cannot be an entry as it stands, and the reason is the lane's standard. */
  awaitsTheOwningLanesStandard: { reason: string } | null
  conflict: { censusSaid: string | null; contentSays: string | null; note: string } | null
  note: string
}

const rows: RulingRow[] = []
for (const r of fixable) {
  const key = r.ext.startsWith(".") ? r.ext.slice(1) : r.ext
  const declared = EXTENSION_RELATION[key] ?? null
  const nameShape = r.extensionShape === "suspect-name-fragment" ? "suspect-name-fragment" : "extension-shaped"

  const stride = (strideOf.get(r.ext) ?? []).slice(0, SNIFF_FILES)
  const distribution: Record<string, number> = {}
  const excerpts: string[] = []
  for (const abs of stride) {
    const kind = sniff(abs)
    distribution[kind] = (distribution[kind] ?? 0) + 1
    if (excerpts.length < 2) {
      try {
        excerpts.push(`${path.relative(corpusRoot, abs)}: ${readFileSync(abs, "utf8").slice(0, 100).replace(/\s+/g, " ")}`)
      } catch {
        excerpts.push(`${path.relative(corpusRoot, abs)}: (unreadable)`)
      }
    }
  }
  const filesSniffed = stride.length
  const dominant = Object.entries(distribution).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown"
  const dominantShare = filesSniffed === 0 ? 0 : (distribution[dominant] ?? 0) / filesSniffed
  const verdict: RulingRow["content"]["verdict"] = filesSniffed === 0 ? "unknown" : dominantShare === 1 ? "unanimous" : dominantShare >= CONSENSUS_FLOOR ? "consensus" : "mixed"
  const dominantLanguage = KINDS[dominant] ?? null

  let category: RulingRow["category"] = "needs-a-ruling"
  if (nameShape === "suspect-name-fragment") category = "not-actionable-name-fragment"
  else if (declared !== null) {
    if (declared.retired || declared.relation === "other-format") category = "closed-by-ruling"
    else if (declared.relation === "same-language") category = "omission-with-a-ruling"
    else category = "declared-ambiguous-sniff"
  }

  let proposal: RulingRow["proposal"] = null
  if (category === "omission-with-a-ruling" && declared !== null) {
    proposal = { language: declared.lang, basis: "declared same-language in routing-outlier-census — the ruling already exists and only the entry is missing", confidence: "high" }
  } else if (category === "needs-a-ruling" && dominantLanguage !== null && dominantShare >= CONSENSUS_FLOOR) {
    const confidence = dominantShare === 1 && filesSniffed >= 5 ? "high" : "medium"
    proposal = { language: dominantLanguage, basis: `content consensus: ${dominant} on ${distribution[dominant]}/${filesSniffed} sniffed file(s)`, confidence }
  }

  const conflict =
    dominantLanguage !== null && r.grammarLanguage !== null && dominantLanguage !== r.grammarLanguage && dominantShare >= CONSENSUS_FLOOR
      ? { censusSaid: r.grammarLanguage, contentSays: dominantLanguage, note: `the census's spelling candidate reads it as ${r.grammarLanguage}; the stride's content is ${dominant} (${dominantLanguage}) — the parse is real and the routing it suggests is not necessarily right` }
      : null

  const decl = proposal === null ? null : grammarDeclaration(proposal.language)
  const backed = decl === null ? null : decl.declares.includes(r.ext.slice(1))
  const awaits: RulingRow["awaitsTheOwningLanesStandard"] =
    proposal === null
      ? null
      : backed === false
        ? { reason: `${decl!.grammarDir}/tree-sitter.json declares [${decl!.declares.join(", ")}] and does NOT name \`${r.ext}\` — the lane's own standard is that routing is taken from the grammar's declaration, so this is evidence for that lane to rule on, not an entry to add` }
        : backed === null
          ? { reason: `the ${proposal.language} grammar ships as wasm only, so there is no vendored declaration to check and this instrument cannot certify the lane's standard` }
          : null

  rows.push({
    ext: r.ext,
    files: r.files,
    nameShape,
    category,
    grammarDeclaration: decl === null ? null : { ...decl, declaresThisExtension: backed === true },
    awaitsTheOwningLanesStandard: awaits,
    declared: declared === null ? null : { relation: declared.relation, lang: declared.lang, retired: declared.retired === true, note: declared.note },
    censusCandidate: {
      candidate: r.grammar,
      language: r.grammarLanguage,
      pricedRelationships: r.priced?.relationships ?? 0,
      relationshipsScaledToWholeTextPool: r.priced?.extrapolatedToTextPool?.relationships ?? r.priced?.relationships ?? 0,
    },
    content: { filesSniffed, distribution, dominant, dominantShare: Math.round(dominantShare * 1000) / 1000, verdict, excerpts },
    proposal,
    conflict,
    note:
      category === "not-actionable-name-fragment"
        ? "NOT A WORK ITEM: the key is a filename fragment, not an extension (the census's EXTENSION_SHAPE labels it). Its files are counted and its parse result is a curiosity."
        : category === "closed-by-ruling"
          ? "NOT ACTIONABLE: a ruling already states this extension is not the language whose spelling it shares, so the census's parse result does not reopen it"
          : category === "omission-with-a-ruling"
            ? "ACTIONABLE: the ruling already says the format IS this language; only the routing entry is missing"
            : category === "declared-ambiguous-sniff"
              ? "declared ambiguous (content-sniffed by the harness) — the router's contentless map cannot express it"
              : proposal === null
                ? `needs a ruling: ${verdict === "mixed" ? "the stride DISAGREES WITH ITSELF, so no single entry would be right" : "no language-bearing signature in the stride"} — NOT proposed for routing`
                : "needs a ruling: the stride's content proposes the target and the excerpts are the evidence for the human ruling",
  })
}

const order: RulingRow["category"][] = ["omission-with-a-ruling", "needs-a-ruling", "declared-ambiguous-sniff", "closed-by-ruling", "not-actionable-name-fragment"]
rows.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || b.censusCandidate.relationshipsScaledToWholeTextPool - a.censusCandidate.relationshipsScaledToWholeTextPool)
const byCategory = (c: RulingRow["category"]) => rows.filter((r) => r.category === c)

const payload = {
  schemaVersion: 2,
  kind: "m60-unrouted-extension-rulings",
  generatedAt: new Date().toISOString(),
  producedBy: "script/m60/unrouted-extension-rulings.ts",
  question: "of the extensions a grammar already reads, which are ACTUALLY fixable by a routing entry — and which are closed by a ruling, a fragment name, or a stride that disagrees with itself?",
  joinedAgainst: {
    census: { artifact: path.relative(ROOT, CENSUS), generatedAt: census.generatedAt, fixableRows: fixable.length },
    rulingTable: { module: "script/m60/routing-outlier-census.ts", exported: "EXTENSION_RELATION", declaredExtensions: Object.keys(EXTENSION_RELATION).length },
  },
  method: { sniffFilesPerExtension: SNIFF_FILES, consensusFloor: CONSENSUS_FLOOR, signatures: KINDS },
  counts: {
    fixableRows: rows.length,
    actionableWithAnExistingRuling: byCategory("omission-with-a-ruling").length,
    actionableWithAContentProposal: byCategory("needs-a-ruling").filter((r) => r.proposal !== null).length,
    needsARulingWithoutAProposal: byCategory("needs-a-ruling").filter((r) => r.proposal === null).length,
    mixedStrides: rows.filter((r) => r.content.verdict === "mixed").length,
    closedByRuling: byCategory("closed-by-ruling").length,
    declaredAmbiguousSniff: byCategory("declared-ambiguous-sniff").length,
    notActionableNameFragments: byCategory("not-actionable-name-fragment").length,
    proposalsTheGrammarItselfDeclares: rows.filter((r) => r.grammarDeclaration !== null && r.grammarDeclaration.declaresThisExtension).length,
    proposalsItsGrammarDoesNotDeclare: rows.filter((r) => r.grammarDeclaration !== null && !r.grammarDeclaration.declaresThisExtension).length,
    proposalsWithNoVendoredDeclarationToCheck: rows.filter((r) => r.proposal !== null && r.grammarDeclaration === null).length,
    proposalsAwaitingTheOwningLanesStandard: rows.filter((r) => r.awaitsTheOwningLanesStandard !== null).length,
    conflictsBetweenCensusAndContent: rows.filter((r) => r.conflict !== null).length,
    relationshipsBehindTheContentProposals: byCategory("needs-a-ruling").filter((r) => r.proposal !== null).reduce((a, r) => a + r.censusCandidate.relationshipsScaledToWholeTextPool, 0),
  },
  boundaries: [
    "a signature reads the first 1 KB and knows nothing about semantics: it proposes, it does not rule",
    "a proposal needs a dominant language-bearing signature at >= 80% of the stride; a stride that disagrees with itself is reported as mixed and proposes nothing",
    "a filename fragment is never a work item, whatever its parse result reads",
    "`closed-by-ruling` rows are not defects: routing them would re-add a retired extension and fail R11",
    "the prize column is the census's own extrapolation under its declared caps; this instrument re-prices nothing",
  ],
  rows,
}
if (!existsSync(path.dirname(OUT))) mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n")

const fmt = (n: number) => n.toLocaleString()
console.log(`\nunrouted-extension RULED WORKLIST — ${rows.length} fixable rows, joined against ${Object.keys(EXTENSION_RELATION).length} declarations, strides of up to ${SNIFF_FILES}`)
console.log(`  actionable with an existing ruling ${payload.counts.actionableWithAnExistingRuling} · actionable via content ${payload.counts.actionableWithAContentProposal} · waiting on a ruling ${payload.counts.needsARulingWithoutAProposal} · mixed strides ${payload.counts.mixedStrides} · closed by ruling ${payload.counts.closedByRuling} · fragments ${payload.counts.notActionableNameFragments}`)
for (const c of ["omission-with-a-ruling", "needs-a-ruling"] as const) {
  const rs = byCategory(c)
  if (rs.length === 0) continue
  console.log(`\n${c.toUpperCase()} (${rs.length})`)
  for (const r of rs.slice(0, 14)) {
    const p = r.proposal === null ? `  (no proposal: ${r.content.verdict}${r.content.filesSniffed ? `, ${Object.entries(r.content.distribution).map(([k, n]) => `${k} ${n}`).join(" / ")}` : ""})` : `  -> PROPOSE ${r.proposal.language} [${r.proposal.confidence}] (${r.proposal.basis})`
    console.log(`  ${r.ext.padEnd(16)} ${String(r.files).padStart(5)}f ${fmt(r.censusCandidate.relationshipsScaledToWholeTextPool).padStart(8)} rels~${p}`)
    if (r.conflict !== null) console.log(`      CONFLICT: census ${r.conflict.censusSaid} vs content ${r.conflict.contentSays}`)
    if (r.awaitsTheOwningLanesStandard !== null) console.log(`      AWAITS THE LANE'S STANDARD: ${r.awaitsTheOwningLanesStandard.reason.slice(0, 150)}`)
  }
  if (rs.length > 14) console.log(`  … ${rs.length - 14} more in the artifact`)
}
console.log(`\nartifact: ${path.relative(ROOT, OUT)}`)
