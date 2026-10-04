/**
 * M14 ONTOLOGY CENSUS — lua.
 *
 * Three phases, three instruments, and no phase reads another phase's answer:
 *
 *   1 PRODUCTION   every count comes from `parseFile` (src/ast/pool-worker.ts),
 *                  the production entry point — NOT `analyze()`, which skips the
 *                  pool-worker stages (noise filters, garbage-target filter,
 *                  truncation, enhancements). Talls: relationship type per file,
 *                  SymbolKind values, empty names, `unknown` endpoints, endpoint
 *                  resolution per type, confidence distribution.
 *   2 INVENTORY    instrument A for the ONTOLOGY gate — every node type the
 *                  wired grammar actually produces across the corpus.
 *   3 PROBES       instrument B — construct counts on the parse tree, for types
 *                  the language CAN express and a text probe cannot find.
 *
 * PHASE 3 IS THE PART THAT DECIDES THE VERDICTS, so each probe states what it
 * counts and what a non-zero count would mean. A probe that matches a SHAPE
 * rather than a ROLE is the failure mode the workstream doc records (a
 * `["k"] = 1` table key read as a filename, `class voice` in a telnet word list
 * read as a class declaration), so every probe below is anchored on a grammar
 * role — the callee field, the declaration name field, a variable_list child —
 * and never on a token sequence.
 *
 * Usage:
 *   npx tsx script/m60/lua-ontology-census.ts --cap 400 --out validation/m60/lua/ontology-census.json
 *   npx tsx script/m60/lua-ontology-census.ts --full
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, statSync, readdirSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const arg = (k: string, d?: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const FULL = process.argv.includes("--full")
const CAP = Number(arg("--cap", "400"))
const OUT = path.resolve(ROOT, arg("--out", "validation/m60/lua/ontology-census.json")!)

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

// ─────────────────────────────────────────────────────────── corpus
interface CorpusFile { repo: string; rel: string; abs: string }
function corpusFiles(): { files: CorpusFile[]; repos: Record<string, { tracked: number; drawn: number }> } {
  const files: CorpusFile[] = []
  const repos: Record<string, { tracked: number; drawn: number }> = {}
  for (const e of readdirSync(CR).sort()) {
    const dir = path.join(CR, e)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    let tracked: string[]
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.lua"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean).sort()
    } catch { continue }
    repos[e] = { tracked: tracked.length, drawn: 0 }
    // Deterministic sample: the tracked list is already sorted, so the first N
    // are a fixed set — not a random one, and the same on every machine. The
    // first N are also the shallowest paths, which biases toward entry points;
    // `--full` removes the cap and is the number the report quotes.
    const drawn = FULL ? tracked : tracked.slice(0, CAP)
    repos[e].drawn = drawn.length
    for (const rel of drawn) files.push({ repo: e, rel, abs: path.join(dir, rel) })
  }
  return { files, repos }
}

// ─────────────────────────────────────────────────────────── phase 1
interface TypeRow {
  edges: number
  files: number
  repos: Record<string, number>
  bothResolved: number
  sourceResolved: number
  targetResolved: number
  neitherResolved: number
  targetIsUnknownLiteral: number
  sourceIsUnknownLiteral: number
  confidenceUnder07: number
  confidenceValues: Record<string, number>
  metadataRelationshipType: Record<string, number>
  evidenceClass: Record<string, number>
  lineNumberPresent: number
  unresolvedTargetExamples: string[]
  resolvedExamples: string[]
  labelShape: Record<string, number>
}

function newRow(): TypeRow {
  return {
    edges: 0, files: 0, repos: {}, bothResolved: 0, sourceResolved: 0, targetResolved: 0,
    neitherResolved: 0, targetIsUnknownLiteral: 0, sourceIsUnknownLiteral: 0,
    confidenceUnder07: 0, confidenceValues: {}, metadataRelationshipType: {}, evidenceClass: {},
    lineNumberPresent: 0, unresolvedTargetExamples: [], resolvedExamples: [], labelShape: {},
  }
}

interface SymbolRow { total: number; kinds: Record<string, number>; emptyName: number; unknownKind: number; examples: Record<string, string> }

const byType = new Map<Type, TypeRow>(ALL_TYPES.map((t) => [t, newRow()]))
const otherTypes = new Map<string, { edges: number; files: number; examples: string[] }>()
const kindRows: SymbolRow = { total: 0, kinds: {}, emptyName: 0, unknownKind: 0, examples: {} }
const endpointsUnknown = { edges: 0, examples: [] as string[] }
/** M60 LUA-46: edges produced by pool-worker's regex FALLBACK rather than by the
 * tree-sitter analyzer. See the call site for why they are counted apart. */
let fallbackEdges = 0
let fallbackFiles = 0
const fallbackByType: Record<string, number> = {}
const exportsCensus = { filesWithExports: 0, exportEntries: 0, topNames: {} as Record<string, number> }
const importsCensus = { filesWithImports: 0, importEntries: 0, topModules: {} as Record<string, number> }
const perRepo = {} as Record<string, { files: number; symbols: number; relationships: number; parseErrorFiles: number }>
let parseErrorFiles = 0
let parseErrorExamples: string[] = []
const started = Date.now()

const { files, repos } = corpusFiles()
console.log(`census: ${files.length} lua files drawn from ${Object.keys(repos).length} repos (cap=${FULL ? "none" : CAP})`)

let idx = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const label = `${f.repo}/${f.rel}`
    let r: any
    try { r = await parseFile(f.abs, path.join(CR, f.repo)) } catch {
      parseErrorFiles++
      if (parseErrorExamples.length < 8) parseErrorExamples.push(`${label}: threw`)
      continue
    }
    const row = perRepo[f.repo] ?? (perRepo[f.repo] = { files: 0, symbols: 0, relationships: 0, parseErrorFiles: 0 })
    row.files++
    if (r.fallback === true) fallbackFiles++
    if ((r.errors?.length ?? 0) > 0) { parseErrorFiles++; row.parseErrorFiles++ }

    const symbols: any[] = r.symbols ?? []
    row.symbols += symbols.length
    kindRows.total += symbols.length
    const names = new Set<string>()
    for (const s of symbols) {
      const nm = typeof s?.name === "string" ? s.name : ""
      if (!nm) {
        kindRows.emptyName++
        if (kindRows.examples.emptyName === undefined) kindRows.examples.emptyName = label
      } else names.add(nm)
      const kind = typeof s?.kind === "string" ? s.kind : String(s?.kind)
      kindRows.kinds[kind] = (kindRows.kinds[kind] ?? 0) + 1
      if (!kind || kind === "unknown" || kind === "undefined") {
        kindRows.unknownKind++
        // `JSON.stringify(undefined)` is the JS value `undefined`, and assigning
        // it to an object property makes JSON.stringify DROP the key — which is
        // how the first run reported unknownKind 9 with an empty example map.
        const k = `unknownKind:${label}:${String(s?.name)}`
        if (kindRows.examples[k] === undefined) kindRows.examples[k] = `kind=${String(s?.kind)} ownerName=${String(s?.ownerName)} meta=${JSON.stringify(s?.metadata ?? null)}`
      }
    }

    const rels: any[] = r.relationships ?? []
    row.relationships += rels.length
    const seenTypes = new Set<Type>()
    for (const rel of rels) {
      const t = String(rel?.type ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) {
        const o = otherTypes.get(t) ?? { edges: 0, files: 0, examples: [] }
        o.edges++
        if (o.examples.length < 3) o.examples.push(`${label}: ${rel?.source} -> ${rel?.target}`)
        otherTypes.set(t, o)
        continue
      }
      const tr = byType.get(t)!
      tr.edges++
      tr.repos[f.repo] = (tr.repos[f.repo] ?? 0) + 1
      seenTypes.add(t)
      const src = String(rel?.source ?? "")
      const tgt = String(rel?.target ?? "")
      if (src === "unknown") tr.sourceIsUnknownLiteral++
      if (tgt === "unknown") tr.targetIsUnknownLiteral++
      if (src === "unknown" || tgt === "unknown") {
        endpointsUnknown.edges++
        if (endpointsUnknown.examples.length < 8) endpointsUnknown.examples.push(`${label}: ${rel?.source} -[${t}]-> ${rel?.target}`)
      }
      const sOk = names.has(src)
      const tOk = names.has(tgt)
      if (sOk) tr.sourceResolved++
      if (tOk) tr.targetResolved++
      if (sOk && tOk) tr.bothResolved++
      if (!sOk && !tOk) tr.neitherResolved++
      if (!tOk && tr.unresolvedTargetExamples.length < 5) tr.unresolvedTargetExamples.push(`${label}: ${src} -> ${tgt}`)
      if (tOk && tr.resolvedExamples.length < 5) tr.resolvedExamples.push(`${label}: ${src} -> ${tgt}`)
      const conf = typeof rel?.confidence === "number" ? rel.confidence : null
      const cs = conf === null ? "absent" : String(conf)
      tr.confidenceValues[cs] = (tr.confidenceValues[cs] ?? 0) + 1
      if (conf !== null && conf < 0.7) tr.confidenceUnder07++
      const mrt = String(rel?.metadata?.relationshipType ?? "absent")
      tr.metadataRelationshipType[mrt] = (tr.metadataRelationshipType[mrt] ?? 0) + 1
      const ec = String(rel?.metadata?.evidenceClass ?? "absent")
      tr.evidenceClass[ec] = (tr.evidenceClass[ec] ?? 0) + 1
      // M60 LUA-46: WHICH PRODUCER made the edge. `parseFile` catches a
      // grammar-load failure and returns `extractFallback`'s output with
      // `{success: true, errors: [], fallback: true}` — a regex TEXT extractor, not
      // the tree-sitter analyzer. Its relationships carry `metadata: {line, method}`
      // and NO `evidenceClass`, which is what the `absent` bucket above is made of:
      // measured at 7 of 303,203 edges, every one of them from a file that reported
      // `Incompatible language version 0. Compatibility range 13 through 15.`
      // (pool-worker.ts:1145). Counting them as lua analyzer output would attribute
      // another component's heuristics to this lane, so they are tallied apart and
      // the per-type totals are reported BOTH ways.
      if (r.fallback === true) {
        fallbackEdges++
        fallbackByType[t] = (fallbackByType[t] ?? 0) + 1
      }
      if (typeof rel?.line_number === "number") tr.lineNumberPresent++
      // Label shape: is the target a bare name, a dotted path, or something else?
      const shape = /^[A-Za-z_][A-Za-z0-9_]*$/.test(tgt) ? "bare"
        : /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(tgt) ? "dotted"
          : /^[A-Za-z_][A-Za-z0-9_]*:[A-Za-z_][A-Za-z0-9_]*$/.test(tgt) ? "colon"
            : tgt.includes("\n") ? "multiline" : tgt.includes("(") || tgt.includes(" ") ? "payload" : "other"
      tr.labelShape[shape] = (tr.labelShape[shape] ?? 0) + 1
    }
    for (const t of seenTypes) byType.get(t)!.files++

    const ex: any[] = r.exports ?? []
    if (ex.length) exportsCensus.filesWithExports++
    exportsCensus.exportEntries += ex.length
    for (const e of ex) {
      const n = String(e?.name ?? "")
      if (!n) exportsCensus.examples_unnamed = (exportsCensus.examples_unnamed ?? 0) + 1
      else exportsCensus.topNames[n] = (exportsCensus.topNames[n] ?? 0) + 1
    }
    const im: any[] = r.imports ?? []
    if (im.length) importsCensus.filesWithImports++
    importsCensus.importEntries += im.length
    for (const e of im) {
      const n = String(e?.module ?? "")
      if (n) importsCensus.topModules[n] = (importsCensus.topModules[n] ?? 0) + 1
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))
const productionMs = Date.now() - started

// ─────────────────────────────────────────────────────────── grammar
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-lua.wasm"))))

// ───────────────────��─────────────── phase 2: instrument A (node inventory)
const nodeTypes = new Map<string, number>()
const nodeFiles = new Map<string, number>()
let errorNodeFiles = 0
let errorNodes = 0
let missingNodes = 0
let parseFailures: string[] = []
const trees = new Map<string, any>()
for (const f of files) {
  let text: string
  try { text = readFileSync(f.abs, "utf8") } catch { continue }
  let t: any
  try { t = parser.parse(text) } catch (e) { parseFailures.push(`${f.repo}/${f.rel}: ${e}`); continue }
  if (!t) { parseFailures.push(`${f.repo}/${f.rel}: null tree`); continue }
  const label = `${f.repo}/${f.rel}`
  trees.set(label, { tree: t, text })
  let fileHadError = false
  const v = (n: any) => {
    nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)
    if (!nodeFiles.has(n.type)) nodeFiles.set(n.type, 0)
    if (n.type === "ERROR") { errorNodes++; fileHadError = true }
    if (n.isMissing) missingNodes++
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) v(c) }
  }
  v(t.rootNode)
  if (fileHadError) errorNodeFiles++
}
nodeTypes.forEach((n, k) => nodeFiles.set(k, n))

// ─────────────────────────────────────────────────────────── phase 3: instrument B probes
//
// Every probe is written against the SHAPE THE GRAMMAR PRODUCES. Where a probe's
// rule is not self-evident from the node types it reads, the measurement that
// established the shape is named in its comment.

function childOfType(n: any, type: string): any {
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c?.type === type) return c }
  return undefined
}
function stringValueOf(n: any): string | undefined {
  if (!n || n.type !== "string") return undefined
  const t = String(n.text ?? "").trim()
  if (t.length >= 2) { const f = t[0], l = t[t.length - 1]; if ((f === '"' || f === "'") && f === l) return t.slice(1, -1) }
  if (t.startsWith("[[") && t.endsWith("]]")) return t.slice(2, -2)
  return t
}
/** The name-bearing head of a function_declaration, and its receiver head. */
function declName(n: any): { label: string; owner?: string; member?: string } | undefined {
  const nm = n.childForFieldName?.("name") ?? n.namedChild(0)
  if (!nm) return undefined
  if (nm.type === "identifier") return { label: nm.text }
  if (nm.type === "dot_index_expression" || nm.type === "method_index_expression") {
    const first = nm.namedChild(0)
    const last = nm.namedChild(nm.namedChildCount - 1)
    const owner = first?.type === "identifier" ? first.text : first?.text?.split(".")[0]
    return { label: nm.text, owner, member: last?.type === "identifier" ? last.text : undefined }
  }
  return { label: nm.text }
}

interface Probe { id: string; question: string; instrument: "B:parse-tree-count"; occurrences: number; files: number; examples: string[]; means: string; buckets?: Record<string, { occurrences: number; files: number; examples: string[] }> }
const probes: Probe[] = []
function probe(
  id: string,
  question: string,
  means: string,
  run: (root: any, label: string, hits: string[]) => void,
  /**
   * Optional bucket split. A probe that counts three DIFFERENT constructs into one
   * number cannot be falsified per construct, and the only honest way to read
   * "127 occurrences" when 126 of them are one shape and 1 is another is to split
   * it. The bucket is the first space-delimited token of the hit, so a probe
   * author writes the bucket into the label and gets per-bucket counts for free.
   */
  withBuckets?: boolean,
) {
  const hits: string[] = []
  const hitFiles = new Set<string>()
  const hitFileByBucket = new Map<string, Set<string>>()
  for (const [label, { tree }] of trees) {
    const before = hits.length
    run(tree.rootNode, label, hits)
    if (hits.length > before) {
      hitFiles.add(label)
      if (withBuckets) {
        for (let i = before; i < hits.length; i++) {
          const b = hits[i].split(" ")[0]
          const set = hitFileByBucket.get(b) ?? new Set<string>()
          set.add(label)
          hitFileByBucket.set(b, set)
        }
      }
    }
  }
  const row: Probe = { id, question, instrument: "B:parse-tree-count", occurrences: hits.length, files: hitFiles.size, examples: hits.slice(0, 6), means }
  if (withBuckets) {
    row.buckets = {}
    for (const bucket of [...hitFileByBucket.keys()].sort()) {
      const ex = hits.filter((h) => h.split(" ")[0] === bucket)
      row.buckets[bucket] = { occurrences: ex.length, files: hitFileByBucket.get(bucket)!.size, examples: ex.slice(0, 4) }
    }
  }
  probes.push(row)
}

// B1 — a SECOND declaration of a name already declared in the same file.
// Grammar fact: `function_declaration` carries the name in its `name` field, and
// Lua resolves the file's chunk-level names last-wins, so the second definition
// replaces the first. Counted per (file, label) because that is the unit Lua's
// own scoping uses.
probe("B1-override-redefinition",
  "does one file declare the same function name twice?",
  "a redefinition: the later `function X` replaces the earlier one in the same chunk",
  (root, label, hits) => {
    const seen = new Map<string, number>()
    const visit = (n: any) => {
      if (n.type === "function_declaration") {
        const d = declName(n)
        if (d?.label) {
          const c = (seen.get(d.label) ?? 0) + 1
          seen.set(d.label, c)
          if (c === 2) hits.push(`${label}: ${d.label} redefined at L${n.startPosition.row + 1}`)
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c) }
    }
    visit(root)
  })

// B2 — an inherited member REDEFINED on the subclass.
// The chain is `setmetatable(Derived, Mt)` with `Mt.__index = Base`, so the probe
// first collects every table's declared members, then every `__index` supertype
// link, then intersects. Without the intersection the count would be every
// method in the corpus, which is a shape count, not a role count.
probe("B2-override-inherited",
  "does a table inherit from another declared table via __index AND redefine one of the base's members?",
  "an override in the family's sense: the subclass's member replaces the inherited one",
  (root, label, hits) => {
    const members = new Map<string, Set<string>>()
    const tables = new Set<string>()
    const bases = new Map<string, Set<string>>()
    const mtIndex = new Map<string, string>()
    const visit = (n: any) => {
      if (n.type === "function_declaration") {
        const d = declName(n)
        if (d?.owner) {
          if (!members.has(d.owner)) members.set(d.owner, new Set())
          if (d.member) members.get(d.owner)!.add(d.member)
          tables.add(d.owner)
        }
      }
      if (n.type === "assignment_statement" || n.type === "variable_declaration") {
        const inner = n.type === "variable_declaration" ? n.namedChild(0) : n
        const list = inner?.type === "assignment_statement" ? childOfType(inner, "variable_list") : (inner?.type === "variable_list" ? inner : undefined)
        const values = inner?.type === "assignment_statement" ? inner.namedChild(1) : undefined
        const value = values?.namedChild(0)
        if (list && value?.type === "table_constructor") {
          for (let i = 0; i < list.namedChildCount; i++) {
            const id = list.namedChild(i)
            if (id?.type !== "identifier") continue
            tables.add(id.text)
            for (let j = 0; j < value.namedChildCount; j++) {
              const f = value.namedChild(j)
              if (f?.type !== "field") continue
              const key = f.childForFieldName?.("name")
              const idx = f.namedChild(1)
              if (key?.text === "__index" && idx?.type === "identifier") mtIndex.set(id.text, idx.text)
            }
          }
        }
      }
      if (n.type === "function_call") {
        const fn = n.childForFieldName?.("name")
        if (fn?.type === "identifier" && fn.text === "setmetatable") {
          const args = n.childForFieldName?.("arguments")
          const a0 = args?.namedChild(0)
          const a1 = args?.namedChild(1)
          const tname = a0?.type === "identifier" ? a0.text : (a0?.type === "dot_index_expression" || a0?.type === "method_index_expression" ? a0.text : undefined)
          if (!tname) return
          tables.add(tname)
          const base = a1?.type === "identifier"
            ? mtIndex.get(a1.text)
            : (a1?.type === "table_constructor" ? (() => {
                for (let j = 0; j < a1.namedChildCount; j++) {
                  const f = a1.namedChild(j)
                  if (f?.type !== "field") continue
                  if (f.childForFieldName?.("name")?.text === "__index") {
                    const idx = f.namedChild(1)
                    if (idx?.type === "identifier") return idx.text
                  }
                }
                return undefined
              })() : undefined)
          if (base) {
            if (!bases.has(tname)) bases.set(tname, new Set())
            bases.get(tname)!.add(base)
            tables.add(base)
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c) }
    }
    visit(root)
    for (const [sub, bs] of bases) {
      const subMembers = members.get(sub)
      if (!subMembers) continue
      for (const base of bs) {
        const baseMembers = members.get(base)
        if (!baseMembers) continue
        for (const m of subMembers) if (baseMembers.has(m)) hits.push(`${label}: ${sub}.${m} overrides ${base}.${m}`)
      }
    }
  })

// B3 — a MEMBER READ: `M.field` / `obj:m` / `M["f"]` in a position that is not
// a call, a declaration name, an assignment target or a field key.
// Excluded roles, each for a stated reason:
//   - the callee of a function_call  → that is a `calls` edge already
//   - the `name` field of a function_declaration → that is a member DECLARATION
//   - the LHS of an assignment_statement → that is a WRITE
//   - the key of a `field` → that is a table-literal key, a declaration
probe("B3-member-read",
  "does the corpus read a member of a table without calling it?",
  "a `references` edge: a dependency on a NAME that may be declared in another file",
  (root, label, hits) => {
    const visit = (n: any) => {
      if (n.type === "dot_index_expression" || n.type === "method_index_expression" || n.type === "bracket_index_expression") {
        const parent = n.parent
        const pt = parent?.type
        const isCallee = pt === "function_call" && (parent.childForFieldName?.("name") === n || parent.namedChild(0) === n)
        const isDeclName = (pt === "function_declaration") && parent.childForFieldName?.("name") === n
        const isAssignTarget = pt === "assignment_statement" && parent.namedChild(0) === n
        const isFieldKey = pt === "field" && parent.childForFieldName?.("name") === n
        if (!isCallee && !isDeclName && !isAssignTarget && !isFieldKey) {
          let member: string | undefined
          if (n.type === "bracket_index_expression") {
            const f = n.childForFieldName?.("field")
            member = f?.type === "string" ? stringValueOf(f) : undefined
          } else {
            const last = n.namedChild(n.namedChildCount - 1)
            member = last?.type === "identifier" ? last.text : undefined
          }
          if (member) hits.push(`${label}: ${n.text} (L${n.startPosition.row + 1})`)
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c) }
    }
    visit(root)
  })

// B4 — a BARE NAME used as a value: an `identifier` that is not a callee, a
// declared name, an assignment target, a field key, a receiver of an index
// expression, a parameter, or the value half of a local declaration.
// `local x = 1` is a DECLARATION, so its name is excluded; `y = x` reads `x`.
probe("B4-bare-name-read",
  "does the corpus read a bare identifier as a value?",
  "a `uses` edge: the file depends on a binding by name",
  (root, label, hits) => {
    const visit = (n: any) => {
      if (n.type === "identifier") {
        const p = n.parent
        const pt = p?.type
        let role = "value"
        if (pt === "function_call") role = (p.childForFieldName?.("name") === n || p.namedChild(0) === n) ? "callee" : "argument"
        else if (pt === "variable_list") role = "declared"
        else if (pt === "assignment_statement") role = p.namedChild(0) === n ? "assign-target" : "value"
        else if (pt === "field") role = (p.childForFieldName?.("name") === n) ? "field-key" : "value"
        else if (pt === "function_declaration" && p.childForFieldName?.("name") === n) role = "declared"
        else if (pt === "dot_index_expression" || pt === "method_index_expression" || pt === "bracket_index_expression") role = (p.namedChild(0) === n) ? "receiver" : "member"
        else if (pt === "parameters") role = "parameter"
        else if (pt === "do_statement" || pt === "while_statement" || pt === "repeat_statement" || pt === "elseif_statement" || pt === "return_statement" || pt === "expression_list") role = "value"
        if (role === "value" || role === "argument") hits.push(`${label}: ${n.text} (${role}, L${n.startPosition.row + 1})`)
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c) }
    }
    visit(root)
  })

// B5 — every `return` shape at FILE SCOPE (not inside a function body). This is
// the instrument for `exports`: a Lua module's surface is what a file-scope
// `return` names, and the shapes below are the whole vocabulary of it.
probe("B5-export-shapes",
  "what does a file-scope `return` name?",
  "an `exports` edge: the module's surface, nameable only when the name is written",
  (root, label, hits) => {
    const visit = (n: any, inFunction: boolean) => {
      if (n.type === "function_declaration" || n.type === "function_definition") {
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c, true) }
        return
      }
      if (n.type === "return_statement" && !inFunction) {
        const values = childOfType(n, "expression_list")
        const t = values?.namedChild(0)
        let shape = "empty"
        let detail = ""
        if (!t) shape = "empty"
        else if (t.type === "table_constructor") {
          let named = 0
          for (let i = 0; i < t.namedChildCount; i++) {
            const f = t.namedChild(i)
            if (f?.type !== "field") continue
            const key = f.childForFieldName?.("name")
            if (key?.type === "identifier") { named++; if (named <= 3) detail += (detail ? "," : "") + key.text }
          }
          shape = `table_constructor(${named} named members)`
        } else if (t.type === "identifier") { shape = "identifier"; detail = t.text }
        else if (t.type === "string") { shape = "string"; detail = stringValueOf(t) ?? "" }
        else if (t.type === "function_call") { shape = "function_call"; detail = t.childForFieldName?.("name")?.text ?? "" }
        else if (t.type === "function_definition") { shape = "anonymous-function" }
        else if (t.type === "binary_expression") { shape = "expression" }
        else shape = t.type
        hits.push(`${label}: ${shape}${detail ? " -> " + detail : ""}`)
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c, inFunction) }
    }
    visit(root, false)
  })

// B6 — the `implements` probe, on the tree: every metatable `__index` link (the
// language's ONLY conformance-to-another-type mechanism) and every class-library
// call. A non-zero count here is a SUPER-TYPE link, which the analyzer already
// publishes as `extends`; `implements` would assert a protocol the language has
// no syntax for.
probe("B6-supertype-links",
  "does the corpus express a conformance relation that is not a supertype link?",
  "n/a — this probe counts the supertype links themselves, so its non-zero count is the reason `implements` is RULED rather than emitted: the relation Lua can express is already `extends`",
  (root, label, hits) => {
    const visit = (n: any) => {
      if (n.type === "function_call") {
        const fn = n.childForFieldName?.("name")
        const text = fn?.text ?? ""
        const args = n.childForFieldName?.("arguments")
        if (text === "setmetatable" || text === "setmetatable2" || /^(class|subclass|extend|derive|new)$/.test(text)) {
          const a1 = args?.namedChild(1)
          hits.push(`${label}: ${text}(${(args?.namedChildCount ?? 0)} args) L${n.startPosition.row + 1}`)
        } else if (/\.(subclass|extend|derive|super)$|:subclass|:extend|:derive|:super$/.test(text)) {
          hits.push(`${label}: ${text} L${n.startPosition.row + 1}`)
        }
      }
      if (n.type === "field") {
        const key = n.childForFieldName?.("name")
        if (key?.text === "__index" || key?.text === "__metatable") hits.push(`${label}: field ${key.text} L${n.startPosition.row + 1}`)
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c) }
    }
    visit(root)
  })

// B7 — a CONSTRUCTOR the analyzer's `instantiates` rule declines: a call of a
// DECLARED TABLE by bare name (`Buffer(...)`). Lua OOP tables are callable
// through `__call`, so this IS a construction; the analyzer's rule only fires on
// `Table:new` / `Table.constructor` / `Table.new`.
probe("B7-bare-table-call",
  "does the corpus construct by calling a declared table directly?",
  "a construction the current `instantiates` rule declines",
  (root, label, hits) => {
    const declared = new Set<string>()
    const calls: Array<{ name: string; line: number; nargs: number }> = []
    const visit = (n: any) => {
      if (n.type === "function_declaration") {
        const d = declName(n)
        if (d?.owner) declared.add(d.owner)
      }
      if (n.type === "assignment_statement" || n.type === "variable_declaration") {
        const inner = n.type === "variable_declaration" ? n.namedChild(0) : n
        const list = inner?.type === "assignment_statement" ? childOfType(inner, "variable_list") : (inner?.type === "variable_list" ? inner : undefined)
        const values = inner?.type === "assignment_statement" ? inner.namedChild(1) : undefined
        if (list && values?.namedChild(0)?.type === "table_constructor") {
          for (let i = 0; i < list.namedChildCount; i++) { const id = list.namedChild(i); if (id?.type === "identifier") declared.add(id.text) }
        }
      }
      if (n.type === "function_call") {
        const fn = n.childForFieldName?.("name")
        if (fn?.type === "identifier" && fn.text !== "require") {
          const args = n.childForFieldName?.("arguments")
          calls.push({ name: fn.text, line: n.startPosition.row + 1, nargs: args?.namedChildCount ?? 0 })
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c) }
    }
    visit(root)
    for (const c of calls) if (declared.has(c.name)) hits.push(`${label}: ${c.name}(...) L${c.line}`)
  })

// B8 — the CORRECTED cross-table inheritance probe, and the reason B2's single hit
// is not evidence of anything.
//
// B2 reported exactly 1 occurrence: kong/spec/01-unit/01-db/11-declarative_lmdb_spec.lua
// "_lmdb.get overrides _lmdb.get". Read the file and the DERIVED and the BASE are
// both `_lmdb` — it is SELF-inheritance. The source is
// `local _lmdb_mt = { __index = _lmdb }` at L76 and `setmetatable(_lmdb, _lmdb_mt)`
// at L83: `_lmdb_mt` is a metatable whose `__index` points back at `_lmdb`, so
// resolving the link faithfully yields `_lmdb -> _lmdb`. B2 read the second
// argument's `__index` without noticing it was the derived table's own name, and a
// self-link still LOOKS like an override, so it reported one.
//
// That is the workstream's named failure mode — a probe that matches a SHAPE rather
// than a ROLE, the same class as a `["k"] = 1` table key read as a filename — and it
// is recorded here rather than deleted, because a probe whose count went to zero
// with no explanation is indistinguishable from a probe that was quietly widened.
//
// B8 counts the three things separately, and a count of 0 in the first bucket is
// what licenses the ruling:
//   crossTable    derived != base, both declared tables -> a REAL override site
//   selfLink      derived == base -> the B2 artifact, counted so it stays visible
//   derivedIsSelf the derived side is `self`, i.e. the table is only reachable
//                 through a constructor's return value. Nothing in the parse tree
//                 says which table that is, so no analyzer can close this edge
//                 without evaluating the constructor, and this probe measures how
//                 often the corpus writes it that way.
probe("B8-inheritance-cross-table",
  "does one DECLARED table inherit from a DIFFERENT declared table, and is the derived side nameable?",
  "a real cross-table override site (crossTable), the B2 self-link artifact (selfLink), and the `setmetatable(self, …)` form whose derived table has no name at the call site (derivedIsSelf)",
  (root, label, hits) => {
    // Metatable variable -> the table its `__index` names.
    const metatableIndex = new Map<string, string>()
    const declaredTables = new Set<string>()
    const indexField = (table: any): string | undefined => {
      if (table?.type !== "table_constructor") return undefined
      for (let i = 0; i < table.namedChildCount; i++) {
        const f = table.namedChild(i)
        if (f?.type !== "field") continue
        const key = f.childForFieldName?.("name") ?? f.namedChild(0)
        const value = f.namedChild(1)
        if (key?.text === "__index" && value?.type === "identifier") return value.text
      }
      return undefined
    }
    const sites: Array<{ derived: string | undefined; second: any; line: number }> = []
    const visit = (n: any) => {
      if (n.type === "function_declaration") {
        const d = declName(n)
        if (d?.owner) declaredTables.add(d.owner)
      }
      if (n.type === "variable_declaration" || n.type === "assignment_statement") {
        const inner = n.type === "variable_declaration" ? n.namedChild(0) : n
        if (inner?.type === "assignment_statement") {
          const list = inner.namedChild(0)
          const values = inner.namedChild(1)
          const table = values?.type === "expression_list" ? values.namedChild(0) : null
          for (let i = 0; i < (list?.namedChildCount ?? 0); i++) {
            const id = list?.namedChild(i)
            if (id?.type === "identifier") {
              declaredTables.add(id.text)
              const base = indexField(table)
              if (base) metatableIndex.set(id.text, base)
            }
          }
        }
      }
      if (n.type === "function_call") {
        const fn = n.childForFieldName?.("name")
        if (fn?.type === "identifier" && (fn.text === "setmetatable" || fn.text === "setmetatable2")) {
          const args = fn ? n.childForFieldName?.("arguments") : null
          sites.push({ derived: args?.namedChild(0)?.type === "identifier" ? args.namedChild(0).text : args?.namedChild(0)?.text, second: args?.namedChild(1), line: n.startPosition.row + 1 })
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c) }
    }
    visit(root)
    for (const s of sites) {
      if (!s.derived) continue
      const base = s.second?.type === "identifier"
        ? (metatableIndex.get(s.second.text) ?? s.second.text)
        : indexField(s.second)
      if (!base) continue
      if (s.derived === "self") { hits.push(`derivedIsSelf ${label}: ${s.derived} -> ${base} L${s.line}`); continue }
      if (s.derived === base) { hits.push(`selfLink ${label}: ${s.derived} -> ${base}`); continue }
      if (declaredTables.has(s.derived) && declaredTables.has(base)) hits.push(`crossTable ${label}: ${s.derived} -> ${base}`)
      else hits.push(`unresolvedBase ${label}: ${s.derived} -> ${base} (base is not a declared table here)`)
    }
  },
  true)

// ─────────────────────────────────────────────────────────── report
const artifact = {
  schemaVersion: 1,
  kind: "lua_ontology_census",
  at: new Date().toISOString(),
  commit: execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  corpus: {
    root: CR,
    method: `git ls-files '*.lua' per repo, sorted, first ${FULL ? "all" : CAP} per repo (deterministic, not random)`,
    filesDrawn: files.length,
    repos,
    grammarWasm: "wasm/tree-sitter-lua.wasm",
    nodeTypesProduced: nodeTypes.size,
    errorNodeFiles,
    errorNodes,
    missingNodes,
    parseFailures: parseFailures.slice(0, 5),
    parseFailuresCount: parseFailures.length,
  },
  production: {
    entryPoint: "src/ast/pool-worker.ts parseFile",
    wallMs: productionMs,
    filesWithParseErrors: parseErrorFiles,
    parseErrorExamples,
    relationshipsByType: Object.fromEntries([...byType].map(([t, r]) => [t, r])),
    otherRelationshipTypes: Object.fromEntries(otherTypes),
    symbols: kindRows,
    endpointsUnknown,
    fallbackProducer: {
      // pool-worker.ts `extractFallback` — a regex TEXT extractor that stands in for
      // the analyzer when the grammar fails to load, and returns `errors: []` so a
      // degraded parse is indistinguishable from a good one without this flag.
      files: fallbackFiles,
      edges: fallbackEdges,
      edgesByType: fallbackByType,
      note: "Counted separately so no lua number in this artifact is attributed to another component. The `absent` bucket in each type's evidenceClass tally IS this set.",
    },
    exportsCensus,
    importsCensus,
    perRepo,
  },
  probes,
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n")

const pc = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a")
console.log(`\nwall ${(productionMs / 1000).toFixed(1)}s  ·  parse-error files ${parseErrorFiles}  ·  node types ${nodeTypes.size}  ·  ERROR-node files ${errorNodeFiles} (${errorNodes} ERROR nodes, ${missingNodes} MISSING)`)
console.log("\nRELATIONSHIPS BY TYPE (production parseFile)")
console.log("type".padEnd(14) + "edges".padStart(9) + "files".padStart(7) + "src%".padStart(8) + "tgt%".padStart(8) + "both%".padStart(8) + "<0.7".padStart(6) + "unk".padStart(6) + "  top label shape")
for (const t of ALL_TYPES) {
  const r = byType.get(t)!
  const shape = Object.entries(r.labelShape).sort((a, b) => b[1] - a[1])[0]
  console.log(t.padEnd(14) + String(r.edges).padStart(9) + String(r.files).padStart(7) +
    pc(r.sourceResolved, r.edges).padStart(8) + pc(r.targetResolved, r.edges).padStart(8) + pc(r.bothResolved, r.edges).padStart(8) +
    String(r.confidenceUnder07).padStart(6) + String(r.targetIsUnknownLiteral + r.sourceIsUnknownLiteral).padStart(6) +
    "  " + (shape ? `${shape[0]} ${pc(shape[1], r.edges)}` : "-"))
}
console.log("\nother relationship types (outside the 10):", Object.keys(otherTypes).length ? JSON.stringify(Object.fromEntries([...otherTypes].map(([k, v]) => [k, v.edges]))) : "none")
console.log(`symbols ${kindRows.total}  empty-name ${kindRows.emptyName}  unknown-kind ${kindRows.unknownKind}`)
console.log("kinds:", JSON.stringify(Object.fromEntries(Object.entries(kindRows.kinds).sort((a, b) => b[1] - a[1]))))
console.log(`endpoints equal to literal "unknown": ${endpointsUnknown.edges}`, endpointsUnknown.examples.slice(0, 3))
console.log(`exports: ${exportsCensus.exportEntries} entries in ${exportsCensus.filesWithExports} files   imports: ${importsCensus.importEntries} entries in ${importsCensus.filesWithImports} files`)
console.log("\nINSTRUMENT A — node types the wired grammar produces across the corpus:", nodeTypes.size)
console.log([...nodeTypes.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" "))
console.log("\nINSTRUMENT B — parse-tree construct counts")
for (const p of probes) console.log(`  ${p.id.padEnd(28)} ${String(p.occurrences).padStart(7)} occurrences in ${String(p.files).padStart(5)} files   ${p.examples.slice(0, 2).join(" | ")}`)
for (const { tree } of trees.values()) tree.delete?.()
console.log(`\nartifact: ${path.relative(ROOT, OUT)}`)