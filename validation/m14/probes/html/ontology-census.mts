/**
 * HTML LANE — RELATIONSHIP-ONTOLOGY CENSUS (the ten types, measured).
 *
 * WHY THIS FILE EXISTS AND WHY IT IS NOT IN `script/m14/`.
 *
 * The ontology workstream (`docs/analyzers/ONTOLOGY-WORKSTREAM.md`) says a verdict
 * is only worth something with a number behind it, and that a ruling needs a CORPUS
 * MEASUREMENT, because `overrides` carried a prose justification for a whole wave
 * and the prose was wrong. Every number in the html verdicts comes from this file,
 * so the numbers are re-runnable rather than asserted.
 *
 * It lives under `validation/m14/probes/html/` rather than `script/m14/**` because
 * `script/m14/**` is the master agent's; a new file there cannot conflict with
 * master, but it is not this lane's to add either. The fixtures this lane does own
 * live one directory up, and this is the same kind of artefact — a measurement
 * over the production entry point, not a gate.
 *
 * WHAT IT MEASURES, and the instrument chosen per question.
 *
 *   PHASE 1  production `parseFile` (src/ast/pool-worker.ts — the entry the
 *            ontology gate and every corpus census use) over every git-tracked
 *            html file admitted by `detectLanguageFromPath`. For each of the ten
 *            relationship types: the count, the files, and — the part that decides
 *            the question the master asked — the ORIGIN of every edge:
 *
 *              html-native     metadata.htmlSpecific && !metadata.htmlEmbedded
 *              embedded:<lang> metadata.htmlEmbedded (a JS/TS/CSS delegate)
 *              UNATTRIBUTED    neither — an edge with no owner, which is the
 *                              failure mode "a delegated edge that does not say
 *                              who wrote it"
 *
 *            It also measures the two channels `parseFile` returns that are not
 *            relationships at all (`imports`, `exports`), because html's
 *            `imports` claim and the CSS delegate's `exports` rows both live
 *            there, and per-type relationship counts would report neither.
 *
 *   PHASE 2  the rulings, on two instruments, chosen by the QUESTION — the same
 *            discipline `script/m14/ontology-coverage-gate.ts` states:
 *
 *            A: grammar inventory. For a type that needs a node type HTML does
 *               not have: enumerate every node type the PINNED tree-sitter-html
 *               grammar actually produces across the corpus. Absence from an
 *               enumeration is positive evidence, not a failure to find something.
 *
 *            B: parse-tree semantic count. For a type the LANGUAGE CAN express,
 *               where a grammar inventory is silent by construction. HTML's
 *               inline blocks are analysed with their OWN grammars, so a
 *               `class_declaration`, an `export_statement` or a
 *               `new_expression` inside a `<script>` is counted on the tree it
 *               was parsed with. A string or an HTML comment cannot fake a node.
 *
 * NO REGEX ANYWHERE IN THE MEASUREMENT. A text probe for "does HTML have
 * inheritance" matches `<div class="extends">`; the html doc records the same
 * lesson for bash (a telnet IAC word list matched a `class voice` probe). Both
 * instruments above read the parse tree.
 *
 * CLI
 *   npx tsx validation/m14/probes/html/ontology-census.mts
 *   npx tsx validation/m14/probes/html/ontology-census.mts --repo vuejs
 *   npx tsx validation/m14/probes/html/ontology-census.mts --repo vuejs --no-blocks
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile as workerParseFile } from "../../../../src/ast/pool-worker"
import { ASTEngine } from "../../../../src/ast/engine"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

/** The ten, read as a literal here because the gate's list is not exported. Any
 *  disagreement with `ASTEngine.RelationshipType` is checked by the ENUM check at
 *  the bottom of this file, which reads the enum out of engine.ts. */
const TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type T = (typeof TYPES)[number]

const argv = process.argv.slice(2)
const arg = (name: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`) || a === `--${name}`)
  if (!hit) return null
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : ""
}
const onlyRepo = arg("repo")
/**
 * WHICH ENTRY POINT, and why it matters more than it looks.
 *
 * `--entry=worker` (the default) is `src/ast/pool-worker.ts` — what indexing
 * calls and what `script/m14/ontology-coverage-gate.ts` measures, so it is the
 * right instrument for COUNTS.
 *
 * `--entry=engine` is `ASTEngine.parseFile` — the analyzer's own result before
 * the worker reshapes it for the store, and the only entry that still carries
 * `symbol.metadata`. That is not a curiosity: the worker REBUILDS each symbol's
 * metadata from a whitelist of CSS and Markdown keys, so `htmlSpecific`,
 * `htmlEmbedded`, `embeddedLang`, `tagName`, `isAddressable` and `attributes`
 * do not survive it. An ORIGIN census run through the worker therefore
 * classifies every html symbol as unattributed, and reports the lane's own
 * symbols as a delegate's. Measured, not assumed — the first run of this probe
 * did exactly that and read 0 html-native symbols across 1,185 documents.
 *
 * Relationship METADATA is not whitelisted, so origins and counts of
 * relationships agree between the two entries; only symbols differ.
 */
const entry = (arg("entry") ?? "worker") === "engine" ? "engine" : "worker"
const parseFile = entry === "engine"
  ? ((abs: string, dir: string): Promise<any> => ASTEngine.parseFile(abs, readFileSync(abs, "utf8"), { projectPath: dir }) as Promise<any>)
  : workerParseFile
const wantBlocks = arg("no-blocks") === null
const outPath = arg("out")

// --------------------------------------------------------------------------
// corpus: git-tracked files, admitted by the SAME detector the engine uses.
// --------------------------------------------------------------------------
interface File { repo: string; dir: string; rel: string; abs: string; text: string }
const files: File[] = []
const repoDirs = onlyRepo ? [onlyRepo] : readdirSync(CORPUS_ROOT)
for (const entry of repoDirs) {
  const dir = path.join(CORPUS_ROOT, entry)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      const st = statSync(abs)
      if (!st.isFile() || st.size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "html") continue
    files.push({ repo: entry, dir, rel, abs, text })
  }
}
files.sort((a, b) => (a.abs < b.abs ? -1 : 1))

// --------------------------------------------------------------------------
// PHASE 1 — what production actually emits, and who owns each edge.
// --------------------------------------------------------------------------
type Origin = "html-native" | "embedded" | "UNATTRIBUTED"
interface TypeRow {
  total: number
  byOrigin: Record<Origin, number>
  files: Set<string>
  /** confidence -> count */
  confidence: Record<string, number>
  /** evidenceClass -> count */
  evidenceClass: Record<string, number>
  /** sub-1.0 edges carrying no machine-readable reason code (honesty §4.1) */
  subThresholdNoReasonCode: number
  subThreshold: number
  /** targets that bind to a symbol in the same document */
  resolvedToSymbol: number
  /** targets that are an absolute URL (a real external resource) */
  resolvedToScheme: number
  /** targets that look like a project path (`/a.js`, `a.js`, `../a.js`, `#x`) */
  resolvedToPath: number
  /** targets that are none of the above */
  unresolved: number
  unresolvedExamples: string[]
  /** edges whose target is a placeholder literal rather than a document or a
   *  symbol — the standing-rule-R7 shape (`javascript:`, a bare `#…`) */
  placeholderLiteral: number
  placeholderExamples: string[]
  /** label histogram read from metadata, so a mislabelled edge is visible */
  labels: Record<string, number>
  /** confidence histogram PER ORIGIN — the honesty §4.1 question is "what does
   *  THIS analyzer publish below threshold", and a delegate's 0.6 is not it. */
  nativeConfidence: Record<string, number>
  nativeSubThreshold: number
  nativeSubThresholdNoReasonCode: number
  /** html-native edges at the 0.9 hyperlink tier, with the labels they carry */
  nativeTier09: Record<string, number>
  examples: string[]
}
const rows = new Map<T, TypeRow>()
const row = (t: T): TypeRow => {
  let r = rows.get(t)
  if (!r) {
    r = {
      total: 0, byOrigin: { "html-native": 0, embedded: 0, UNATTRIBUTED: 0 }, files: new Set(),
      confidence: {}, evidenceClass: {}, subThresholdNoReasonCode: 0, subThreshold: 0,
      resolvedToSymbol: 0, resolvedToScheme: 0, resolvedToPath: 0, unresolved: 0, unresolvedExamples: [],
      placeholderLiteral: 0, placeholderExamples: [], labels: {},
      nativeConfidence: {}, nativeSubThreshold: 0, nativeSubThresholdNoReasonCode: 0, nativeTier09: {},
      examples: [],
    }
    rows.set(t, r)
  }
  return r
}

const channel = { imports: 0, exports: 0, exportsStamped: 0, exportsUnstamped: 0, importFiles: new Set<string>() }
const symbolInvariants = {
  files: 0, emptyName: 0, whitespaceName: 0, duplicateNameInFile: 0,
  unknownOwner: 0, filesWithUnknownOwner: new Set<string>(), lineBeyondEof: 0, emptyOwner: 0,
  // Split by origin, because the doc's "0 empty / 0 whitespace / 0 duplicate" claim
  // is about the ANALYZER'S OWN symbols, and a delegate symbol that collides with
  // one of them is a different fact. Reporting the split is what makes the two
  // claims distinguishable instead of one number covering both.
  nativeEmptyName: 0, nativeWhitespaceName: 0, nativeDuplicate: 0,
  embeddedEmptyName: 0, embeddedWhitespaceName: 0, embeddedDuplicate: 0,
  whitespaceExamples: [] as string[], duplicateExamples: [] as string[],
  nativeNamesCollideWithEmbedded: 0,
}
let unavailableJs = 0
let threw = 0
const threwExamples: string[] = []
const relNoLine = { total: 0, nonPositive: 0, examples: [] as string[] }
const embeddedByLang: Record<string, number> = {}
const parseErrors = { filesWithErrors: 0, errors: 0 }
let bytes = 0

let cursor = 0
async function worker(): Promise<void> {
  while (true) {
    const i = cursor++
    if (i >= files.length) return
    const f = files[i]
    bytes += f.text.length
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
    } catch (e) {
      threw++
      if (threwExamples.length < 6) threwExamples.push(`${f.repo}/${f.rel}: ${(e as Error).message}`)
      continue
    }
    const label = `${f.repo}/${f.rel}`
    const md = r?.metadata ?? {}
    if (Array.isArray(md.unavailableEmbeddedLangs) && md.unavailableEmbeddedLangs.includes("js")) unavailableJs++
    if (Array.isArray(r?.errors) && r.errors.length > 0) { parseErrors.filesWithErrors++; parseErrors.errors += r.errors.length }

    // ---- symbols: the identity invariants (R7 + the doc's 0/0/0 claim) --------
    const syms: any[] = Array.isArray(r?.symbols) ? r.symbols : []
    symbolInvariants.files++
    const names = new Set<string>()
    const nativeNames = new Set<string>()
    let fileHasUnknownOwner = false
    // Two passes: `contains` names the owner, and a delegate symbol's owner can be
    // a sibling that appears later in the merged list, so a single forward pass
    // reports every such owner as "unknown" and manufactures a defect that is not
    // there. First collect every name the file publishes, then ask.
    const allNames = new Set<string>()
    for (const s of syms) allNames.add(typeof s?.name === "string" ? s.name : "")
    for (const s of syms) {
      const n = typeof s?.name === "string" ? s.name : ""
      const sm = s?.metadata ?? {}
      const native = sm.htmlSpecific === true && sm.htmlEmbedded !== true
      if (native) nativeNames.add(n)
      if (n.length === 0) {
        symbolInvariants.emptyName++
        if (native) symbolInvariants.nativeEmptyName++
        else symbolInvariants.embeddedEmptyName++
      } else if (hasSpace(n)) {
        symbolInvariants.whitespaceName++
        if (native) symbolInvariants.nativeWhitespaceName++
        else symbolInvariants.embeddedWhitespaceName++
        if (symbolInvariants.whitespaceExamples.length < 8) symbolInvariants.whitespaceExamples.push(`${label} ${JSON.stringify(n)} (${native ? "html" : "delegate"})`)
      }
      if (names.has(n)) {
        symbolInvariants.duplicateNameInFile++
        if (native) symbolInvariants.nativeDuplicate++
        else symbolInvariants.embeddedDuplicate++
        if (symbolInvariants.duplicateExamples.length < 8) symbolInvariants.duplicateExamples.push(`${label}: ${JSON.stringify(n)} (${native ? "html" : "delegate"})`)
      }
      names.add(n)
      if (typeof s?.ownerName === "string") {
        if (s.ownerName.length === 0) symbolInvariants.emptyOwner++
        else if (!allNames.has(s.ownerName)) { symbolInvariants.unknownOwner++; fileHasUnknownOwner = true }
      }
      if (typeof s?.range?.startLine === "number" && typeof s?.range?.endLine === "number") {
        const eof = f.text.split("\n").length
        if (s.range.startLine < 1 || s.range.endLine > eof) symbolInvariants.lineBeyondEof++
      }
    }
    // A native name that a delegate symbol also takes is a cross-channel collision:
    // two different declarations, one name, and the store keys symbols by name.
    for (const n of nativeNames) {
      if (n.length === 0) continue
      let count = 0
      for (const s of syms) if (s?.name === n) count++
      if (count > 1) symbolInvariants.nativeNamesCollideWithEmbedded++
    }
    if (fileHasUnknownOwner) symbolInvariants.filesWithUnknownOwner.add(label)

    // ---- relationships -------------------------------------------------------
    for (const rel of (Array.isArray(r?.relationships) ? r.relationships : []) as any[]) {
      const t = String(rel?.type ?? rel?.relationshipType ?? "").toLowerCase() as T
      if (!TYPES.includes(t)) { unknownLabel(rel?.type); continue }
      const r2 = row(t)
      const m = rel?.metadata ?? {}
      const origin: Origin = m.htmlEmbedded ? "embedded" : m.htmlSpecific ? "html-native" : "UNATTRIBUTED"
      r2.byOrigin[origin]++
      r2.total++
      if (r2.files.size < 400) r2.files.add(label)
      if (r2.examples.length < 3) r2.examples.push(`${label}:${rel?.line_number ?? "-"} ${rel?.source} -> ${rel?.target}`)
      const conf = typeof rel?.confidence === "number" ? rel.confidence : null
      const ck = conf === null ? "ABSENT" : String(conf)
      r2.confidence[ck] = (r2.confidence[ck] ?? 0) + 1
      if (conf !== null && conf < 1) {
        r2.subThreshold++
        if (typeof m.confidenceReason !== "string" || m.confidenceReason.length === 0) r2.subThresholdNoReasonCode++
      }
      if (origin === "html-native") {
        r2.nativeConfidence[ck] = (r2.nativeConfidence[ck] ?? 0) + 1
        if (conf !== null && conf < 1) {
          r2.nativeSubThreshold++
          if (typeof m.confidenceReason !== "string" || m.confidenceReason.length === 0) r2.nativeSubThresholdNoReasonCode++
          if (conf === 0.9) {
            const key = typeof m.resourceType === "string" ? m.resourceType : (m.isFormEndpoint === true ? "form-endpoint" : "navigation")
            r2.nativeTier09[key] = (r2.nativeTier09[key] ?? 0) + 1
          }
        }
      }
      const ec = typeof m.evidenceClass === "string" ? m.evidenceClass : "ABSENT"
      r2.evidenceClass[ec] = (r2.evidenceClass[ec] ?? 0) + 1
      if (typeof m.resourceType === "string") r2.labels[`${m.evidenceClass ?? "-"}/${m.resourceType}`] = (r2.labels[`${m.evidenceClass ?? "-"}/${m.resourceType}`] ?? 0) + 1
      else if (m.isNavigation === true) r2.labels["navigation"] = (r2.labels["navigation"] ?? 0) + 1
      else if (m.isFormEndpoint === true) r2.labels["form-endpoint"] = (r2.labels["form-endpoint"] ?? 0) + 1
      else if (m.isLabelAssociation === true) r2.labels["label-association"] = (r2.labels["label-association"] ?? 0) + 1
      else if (m.isInternalAnchor === true) r2.labels["internal-anchor"] = (r2.labels["internal-anchor"] ?? 0) + 1
      else r2.labels["unclassified"] = (r2.labels["unclassified"] ?? 0) + 1

      relNoLine.total++
      if (typeof rel?.line_number !== "number") { relNoLine.nonPositive++; if (relNoLine.examples.length < 5) relNoLine.examples.push(`${label} ${t}`) }
      else if (rel.line_number <= 0) { relNoLine.nonPositive++; if (relNoLine.examples.length < 5) relNoLine.examples.push(`${label} ${t}:${rel.line_number}`) }

      // ---- RESOLUTION: does the target bind to anything a consumer can join?
      const target = typeof rel?.target === "string" ? rel.target : ""
      if (names.has(target)) r2.resolvedToSymbol++
      else if (hasScheme(target)) r2.resolvedToScheme++
      else if (looksLikePath(target)) r2.resolvedToPath++
      else {
        r2.unresolved++
        if (r2.unresolvedExamples.length < 6) r2.unresolvedExamples.push(`${label}:${rel?.line_number ?? "-"} ${sourceOf(rel)} -> ${JSON.stringify(target)}`)
      }
      if (isPlaceholder(target)) {
        r2.placeholderLiteral++
        if (r2.placeholderExamples.length < 6) r2.placeholderExamples.push(`${label}:${rel?.line_number ?? "-"} ${JSON.stringify(target)}`)
      }
      if (origin === "embedded") {
        const lang = String(m.embeddedLang ?? "?")
        embeddedByLang[`${t}/${lang}`] = (embeddedByLang[`${t}/${lang}`] ?? 0) + 1
      }
    }

    // ---- the two non-relationship channels -----------------------------------
    for (const imp of (Array.isArray(r?.imports) ? r.imports : []) as any[]) {
      channel.imports++
      channel.importFiles.add(label)
      const m = imp?.metadata ?? {}
      if (m.htmlEmbedded) embeddedByLang[`imports-channel/${String(m.embeddedLang ?? "?")}`] = (embeddedByLang[`imports-channel/${String(m.embeddedLang ?? "?")}`] ?? 0) + 1
    }
    for (const ex of (Array.isArray(r?.exports) ? r.exports : []) as any[]) {
      channel.exports++
      const m = ex?.metadata ?? {}
      if (m.htmlEmbedded && typeof m.embeddedLang === "string") channel.exportsStamped++
      else {
        channel.exportsUnstamped++
        if (channel.exportsUnstamped <= 6) console.log(`  [unstamped export] ${label}: ${JSON.stringify({ name: ex?.name, metadata: ex?.metadata })}`)
      }
    }
  }
}
const strayLabels = new Map<string, number>()
function unknownLabel(t: unknown): void {
  const k = String(t)
  strayLabels.set(k, (strayLabels.get(k) ?? 0) + 1)
}
function hasSpace(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 32 || c === 9 || c === 10 || c === 13 || c === 12) return true
  }
  return false
}
function hasScheme(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i)
    if (c === 58) {
      const f = v.charCodeAt(0)
      return i > 0 && ((f >= 65 && f <= 90) || (f >= 97 && f <= 122))
    }
    const alpha = (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
    const digit = c >= 48 && c <= 57
    if (!alpha && !digit && c !== 43 && c !== 45 && c !== 46) return false
  }
  return false
}
function looksLikePath(v: string): boolean {
  if (v.length === 0) return false
  const c0 = v.charCodeAt(0)
  if (c0 === 35 /* # */) return v.length > 1 // an in-document fragment that did not resolve
  if (c0 === 47 /* / */) return true
  if (c0 === 46 /* . */) return true
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i)
    if (c === 47) return true // any slash
    if (c === 46 && i > 0) return true // any dot after position 0 — an extension
  }
  return false
}
function isPlaceholder(v: string): boolean {
  return v === "javascript:" || v === "#" || v.length === 0
}
function sourceOf(rel: any): string {
  return String(rel?.source ?? "?")
}

await Promise.all(Array.from({ length: 6 }, () => worker()))

// --------------------------------------------------------------------------
// PHASE 2 — the rulings, on the parse tree.
// --------------------------------------------------------------------------
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
function loadWasm(name: string): Uint8Array {
  return readFileSync(path.join(ROOT, "wasm", name))
}
const htmlParser = new P()
htmlParser.setLanguage(await L.load(loadWasm("tree-sitter-html.wasm")))
const blockParsers: Record<string, any> = {}
for (const [lang, wasm] of [["js", "tree-sitter-javascript.wasm"], ["ts", "tree-sitter-typescript.wasm"], ["tsx", "tree-sitter-typescript.wasm"], ["css", "tree-sitter-css.wasm"]] as const) {
  if (blockParsers[lang]) continue
  try {
    const p = new P()
    p.setLanguage(await L.load(loadWasm(wasm)))
    blockParsers[lang] = p
  } catch { blockParsers[lang] = null }
}

/** INSTRUMENT A — every node type the pinned html grammar produces. */
const grammarNodeTypes = new Map<string, number>()
for (const f of files) {
  const t = htmlParser.parse(f.text)
  if (!t) continue
  visit(t.rootNode)
  t.delete?.()
}
function visit(n: any): void {
  grammarNodeTypes.set(n.type, (grammarNodeTypes.get(n.type) ?? 0) + 1)
  for (let i = 0; i < n.childCount; i++) visit(n.child(i))
}

/**
 * INSTRUMENT B — semantic counts on the inline blocks' OWN trees.
 *
 * SCOPED PER GRAMMAR, and that scoping is the whole point of the second list.
 * The first run of this probe counted `call_expression` 9 times in `vuejs` and
 * reported every hit in a `<style>` body — because tree-sitter-css ALSO has a
 * `call_expression`, for `var()` and `url()`. A node name is only meaningful
 * against the grammar that produced it, so a probe that ignores that manufactures
 * the construct it is looking for. Every probe below therefore declares the
 * languages it may match, and a hit is recorded only on a block whose grammar is
 * one of them.
 */
const BLOCK_PROBES: { node: string; langs: string[]; label: string }[] = [
  { node: "class_declaration", langs: ["js", "ts", "tsx"], label: "a type declaration (`extends`/`implements`/`overrides` need one)" },
  { node: "class_heritage", langs: ["js", "ts", "tsx"], label: "a supertype clause" },
  { node: "extends_clause", langs: ["js", "ts", "tsx"], label: "an extends clause" },
  { node: "implements_clause", langs: ["js", "ts", "tsx"], label: "an implements clause" },
  { node: "method_definition", langs: ["js", "ts", "tsx"], label: "a member declaration (`overrides` needs one)" },
  { node: "function_declaration", langs: ["js", "ts", "tsx"], label: "a function declaration (`calls` needs one)" },
  { node: "call_expression", langs: ["js", "ts", "tsx"], label: "an invocation" },
  { node: "new_expression", langs: ["js", "ts", "tsx"], label: "a constructor call (`instantiates` needs one)" },
  { node: "export_statement", langs: ["js", "ts", "tsx"], label: "an export statement (`exports` needs one)" },
  { node: "import_statement", langs: ["js", "ts", "tsx"], label: "an import statement (`imports` needs one)" },
  { node: "class_selector", langs: ["css"], label: "a CSS rule selector (this is what a CSS delegate publishes as `exports`)" },
]
const blockHits = new Map<string, { occurrences: number; files: number; examples: string[]; blocks: number }>()
const blockLangBytes: Record<string, number> = {}
const blockFilesByLang: Record<string, Set<string>> = {}
if (wantBlocks) {
  for (const b of BLOCK_PROBES) blockHits.set(b.node, { occurrences: 0, files: 0, examples: [], blocks: 0 })
  const { ASTEngine } = await import("../../../../src/ast/engine")
  const extractor = ASTEngine.extractHtmlEmbeddedBlocks
  const blockFileOf = new Map<string, Set<string>>()
  for (const f of files) {
    const tree = htmlParser.parse(f.text)
    if (!tree) continue
    let blocks: any[]
    try { blocks = extractor(tree.rootNode, f.text) } catch { tree.delete?.(); continue }
    const label = `${f.repo}/${f.rel}`
    for (const b of blocks) {
      const p = blockParsers[b.lang]
      if (!p) continue
      blockLangBytes[b.lang] = (blockLangBytes[b.lang] ?? 0) + b.body.length
      blockFilesByLang[b.lang] = blockFilesByLang[b.lang] ?? new Set<string>()
      blockFilesByLang[b.lang].add(label)
      const sub = p.parse(b.body)
      if (!sub) continue
      for (const probe of BLOCK_PROBES) {
        if (!probe.langs.includes(b.lang)) continue
        const h = blockHits.get(probe.node)!
        h.blocks++
        let n = 0
        const count = (node: any) => {
          if (node.type === probe.node) n++
          for (let i = 0; i < node.childCount; i++) count(node.child(i))
        }
        count(sub.rootNode)
        if (n > 0) {
          h.occurrences += n
          if (!h.files) h.files = 0
          const seen = blockFileOf.get(probe.node) ?? new Set<string>()
          if (!seen.has(label)) { seen.add(label); h.files++ }
          blockFileOf.set(probe.node, seen)
          if (h.examples.length < 4) h.examples.push(`${label}:${b.startLine} (${b.lang})`)
        }
      }
      sub.delete?.()
    }
    tree.delete?.()
  }
}

// --------------------------------------------------------------------------
// ENUM cross-check: this file's list of ten against engine.ts.
// --------------------------------------------------------------------------
function enumValues(): string[] {
  const src = readFileSync(path.join(ROOT, "src", "ast", "engine.ts"), "utf8")
  const body = src.slice(src.indexOf("export enum RelationshipType"))
  const end = body.indexOf("\n  }")
  const out = new Set<string>()
  for (const m of body.slice(0, end).matchAll(/=\s*"([^"]+)"/g)) out.add(m[1])
  return [...out].sort()
}
const enumList = enumValues()
const enumAgrees = enumList.length === TYPES.length && TYPES.slice().sort().join(",") === enumList.join(",")

// --------------------------------------------------------------------------
// report
// --------------------------------------------------------------------------
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
/**
 * The ruling table this probe measures against. A verdict here is only reachable
 * with a number behind it, so the table carries the number and the files it came
 * from — the same contract `ontology-coverage-gate.ts` demands of the shared
 * gate's `RULED` rows, kept local because that file is master's. An EMPTY entry
 * prints as "no ruling recorded", which is the honest reading of a type that has
 * neither an emission nor a written reason: an open verdict, not a pass.
 */
const RULINGS: Record<string, string> = {}

console.log("=".repeat(118))
console.log(`HTML ONTOLOGY CENSUS — ${files.length} admitted html documents, ${reposSeen()} repositories, ${(bytes / 1024).toFixed(0)} KiB`)
console.log(`corpus root: ${CORPUS_ROOT}${onlyRepo ? ` (repo=${onlyRepo})` : ""}`)
console.log(`entry: ${entry === "engine" ? "ASTEngine.parseFile (symbol metadata intact)" : "pool-worker parseFile (the index/shape entry; symbol metadata whitelisted)"}`)
console.log(`runtime: ${process.versions.node} / ${process.execPath.includes("bun") ? "bun" : "node"}`)
console.log("=".repeat(118))
console.log(`ENUM cross-check vs src/ast/engine.ts: ${enumAgrees ? "AGREES (" + enumList.join(", ") + ")" : "DISAGREES — this file's ten vs " + enumList.join(", ")}`)
console.log("")
console.log(`${w("type", 14)}${w("total", 10)}${w("html-native", 12)}${w("embedded", 10)}${w("UNATTR", 9)}${w("files", 8)}${w("conf<1", 8)}${w("no-reason", 10)}${w("resolved", 20)}verdict`)
console.log("-".repeat(118))
for (const t of TYPES) {
  const r = rows.get(t)
  if (!r || r.total === 0) {
    const ruled = RULINGS[t]
    console.log(`${w(t, 14)}${w("0", 10)}${w("-", 12)}${w("-", 10)}${w("-", 9)}${w("-", 8)}${w("-", 8)}${w("-", 10)}${w("-", 20)}${ruled ? `RULED — ${ruled}` : "NOT EMITTED — no ruling recorded"}`)
    continue
  }
  const resolved = r.resolvedToSymbol + r.resolvedToScheme + r.resolvedToPath
  console.log(
    `${w(t, 14)}${w(r.total.toLocaleString(), 10)}${w(r.byOrigin["html-native"].toLocaleString(), 12)}${w(r.byOrigin.embedded.toLocaleString(), 10)}` +
    `${w(r.byOrigin.UNATTRIBUTED.toLocaleString(), 9)}${w(r.files.size.toLocaleString(), 8)}${w(r.subThreshold.toLocaleString(), 8)}${w(r.subThresholdNoReasonCode.toLocaleString(), 10)}` +
    `${w(`${resolved.toLocaleString()}/${(resolved / r.total * 100).toFixed(1)}%`, 20)}EMITTED`,
  )
}
console.log("-".repeat(118))
console.log(`channels (NOT relationship types): imports ${channel.imports.toLocaleString()} rows over ${channel.importFiles.size} files · exports ${channel.exports.toLocaleString()} rows (${channel.exportsStamped} stamped to a delegate, ${channel.exportsUnstamped} UNSTAMPED)`)
console.log(`embedded edges by type/lang: ${Object.entries(embeddedByLang).sort().map(([k, v]) => `${k}=${v}`).join("  ") || "none"}`)
console.log(`runtime seam: ${unavailableJs}/${files.length} documents reported metadata.unavailableEmbeddedLangs=["js"] — the JS delegate did not load in THIS process`)
console.log(`symbol invariants over ${symbolInvariants.files} files: empty=${symbolInvariants.emptyName} whitespace=${symbolInvariants.whitespaceName} duplicate=${symbolInvariants.duplicateNameInFile} unknown-owner=${symbolInvariants.unknownOwner} (in ${symbolInvariants.filesWithUnknownOwner.size} files) line-beyond-EOF=${symbolInvariants.lineBeyondEof}`)
console.log(`  split by origin — html-native: empty=${symbolInvariants.nativeEmptyName} whitespace=${symbolInvariants.nativeWhitespaceName} duplicate=${symbolInvariants.nativeDuplicate} · delegate: empty=${symbolInvariants.embeddedEmptyName} whitespace=${symbolInvariants.embeddedWhitespaceName} duplicate=${symbolInvariants.embeddedDuplicate}`)
if (symbolInvariants.whitespaceExamples.length) console.log(`  whitespace-bearing names, first 8: ${symbolInvariants.whitespaceExamples.join("  ")}`)
if (symbolInvariants.duplicateExamples.length) console.log(`  duplicate names, first 8 files: ${symbolInvariants.duplicateExamples.join("  ")}`)
console.log(`html-native confidence per type: ${[...rows].filter(([, r]) => r.byOrigin["html-native"] > 0).map(([t, r]) => `${t}{${Object.entries(r.nativeConfidence).sort().map(([k, v]) => `${k}:${v}`).join(",")}} sub1.0=${r.nativeSubThreshold} noReasonCode=${r.nativeSubThresholdNoReasonCode}`).join("  ")}`)
console.log(`  the 0.9 hyperlink/form tier by carrier: ${[...rows].flatMap(([, r]) => Object.entries(r.nativeTier09).map(([k, v]) => `${k}=${v}`)).join(" ") || "none on this corpus"}`)
console.log(`files with a symbol whose ownerName is not a symbol in the same file: ${[...symbolInvariants.filesWithUnknownOwner].slice(0, 8).join("  ")}`)
console.log(`relationship lines: ${relNoLine.nonPositive}/${relNoLine.total} absent or <= 0 ${relNoLine.examples.length ? "e.g. " + relNoLine.examples.join(" | ") : ""}`)
console.log(`parseFile threw on ${threw} documents ${threwExamples.length ? "e.g. " + threwExamples.join(" | ") : ""}`)
if (strayLabels.size) console.log(`labels outside the ten: ${[...strayLabels].map(([k, v]) => `${k}=${v}`).join(", ")}`)
console.log("")
console.log("RESOLUTION DETAIL (target binds to: a symbol in the document / an absolute URL / a path / nothing)")
for (const t of TYPES) {
  const r = rows.get(t)
  if (!r || r.total === 0) continue
  console.log(`  ${w(t, 14)}symbol=${r.resolvedToSymbol}  scheme=${r.resolvedToScheme}  path=${r.resolvedToPath}  UNRESOLVED=${r.unresolved}${r.unresolvedExamples.length ? "  e.g. " + r.unresolvedExamples[0] : ""}`)
  if (r.placeholderExamples.length) console.log(`  ${w("", 14)}placeholder-literal endpoints=${r.placeholderLiteral}  e.g. ${r.placeholderExamples.slice(0, 3).join("  ")}`)
  console.log(`  ${w("", 14)}confidence ${Object.entries(r.confidence).sort().map(([k, v]) => `${k}:${v}`).join(" ")}`)
  console.log(`  ${w("", 14)}evidenceClass ${Object.entries(r.evidenceClass).sort().map(([k, v]) => `${k}:${v}`).join(" ")}`)
}
console.log("")
console.log("INSTRUMENT A — grammar inventory of the PINNED tree-sitter-html grammar over the whole corpus")
console.log(`  distinct node types: ${grammarNodeTypes.size}`)
console.log(`  ${[...grammarNodeTypes].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`)
const WOULD_MEAN: Record<string, string[]> = {
  extends: ["class_declaration", "interface_declaration", "trait_declaration", "struct_declaration", "inheritance_specifier"],
  implements: ["implements_clause", "extends_clause", "superclass", "interface_implementation"],
  overrides: ["member_declaration", "method_declaration", "method_definition", "redefinition"],
  instantiates: ["new_expression", "object_creation_expression", "constructor_invocation"],
  calls: ["call_expression", "invocation_expression", "function_call"],
  exports: ["export_statement", "export_declaration"],
  imports: ["import_statement", "include_statement"],
}
for (const [t, nodes] of Object.entries(WOULD_MEAN)) {
  const present = nodes.filter((n) => grammarNodeTypes.has(n))
  console.log(`  ${w(t, 14)}${present.length === 0 ? `0 of ${nodes.length} present` : `PRESENT: ${present.join(", ")}`}`)
}
if (wantBlocks) {
  console.log("")
  console.log(`INSTRUMENT B — the inline blocks on their OWN grammars (${Object.entries(blockLangBytes).map(([k, v]) => `${k}=${(v / 1024).toFixed(0)}KiB/${blockFilesByLang[k]?.size ?? 0}files`).join(", ")})`)
  console.log("  the construct is counted on the tree the DELEGATE parses it with, so a string cannot fake it,")
  console.log("  and each probe is scoped to the grammars that can produce that node name (css has a call_expression too)")
  for (const b of BLOCK_PROBES) {
    const h = blockHits.get(b.node)!
    console.log(`  ${w(b.node, 24)}${h.occurrences.toLocaleString().padStart(7)} occurrences / ${h.files} files / ${h.blocks} ${b.langs.join("|")} blocks — ${b.label}${h.examples.length ? "  e.g. " + h.examples[0] : ""}`)
  }
}
function reposSeen(): number {
  return new Set(files.map((f) => f.repo)).size
}
/**
 * The ruling table this probe measures against.
 */
void RULINGS

if (outPath) {
  const json = {
    corpus: { root: CORPUS_ROOT, repo: onlyRepo, entry, files: files.length, bytes, repos: reposSeen(), runtime: process.versions.node },
    types: Object.fromEntries([...rows].map(([t, r]) => [t, {
      ...r, files: [...r.files],
    }])),
    channels: channel,
    embeddedByLang,
    symbolInvariants: { ...symbolInvariants, filesWithUnknownOwner: [...symbolInvariants.filesWithUnknownOwner] },
    relNoLine,
    instrumentA: { distinct: grammarNodeTypes.size, nodeTypes: Object.fromEntries(grammarNodeTypes) },
    instrumentB: wantBlocks ? Object.fromEntries([...blockHits]) : null,
    blockLangBytes,
  }
  writeFileSync(outPath, JSON.stringify(json, null, 2))
  console.log(`\nwrote ${outPath}`)
}