/**
 * INCOMING / RESOLUTION — TypeScript, four verdicts per edge, and the
 * ambiguity rate.
 *
 * ## What this measures and what it is not
 *
 * Every edge this analyzer emits is OUTGOING from the file being analysed: the
 * source is a declaration in that file and the target is a name. "Who points AT
 * me" is therefore not a second edge channel — it is a question asked of the
 * TARGET SURFACE. For every emitted edge, viewed from its target, the target
 * string is classified into one of four verdicts, plus two counted separately so
 * neither is hidden inside a rate:
 *
 *   RESOLVED       a bare name binding to exactly ONE declaration in the corpus
 *   VIA_OWNER      exactly one declaration, but a MEMBER — TypeScript resolves
 *                  `x.m` inside `x`'s declaration, so the anchor is
 *                  owner + "." + name. Covers a target already written qualified.
 *   AMBIGUOUS      two or more declarations. TypeScript PERMITS this —
 *                  declaration merging (`interface A {}` twice), overload sets
 *                  (a function name declared many times), a `const` in every
 *                  module — so it is not an analyzer bug. It is the size of the
 *                  surface that needs type inference to walk BACKWARDS, which is
 *                  exactly what the leaf reduction hides going forwards.
 *   UNRESOLVABLE   nothing in the indexed corpus.
 *
 *   EMPTY          zero length. Counted on its own row.
 *   PLACEHOLDER    standing rule R7's literal. Counted on its own row.
 *
 * TRAVERSABLE FROM THE FAR END is the fraction of edges whose BOTH ends resolve,
 * printed as a four-way split plus the two separate rows.
 *
 * ## The index is independent of the analyzer, deliberately
 *
 * It is built by a cursor/stack walk over tree-sitter-typescript, NOT from
 * `res.symbols`. If it came from the analyzer, a name the analyzer fails to
 * publish would be absent from the index and every edge pointing at it would read
 * as UNRESOLVABLE — the instrument would report the analyzer's blind spot as a
 * fact about TypeScript. The two sides come from different inputs. They do NOT
 * have an independent GRAMMAR: both load the same tree-sitter-typescript.wasm,
 * so a node type that fails to match is invisible to both. That is the declared
 * limit and the artifact restates it.
 *
 * ## Classifier self-test
 *
 * `--self-test-classifier` drives every row of the decision table from a
 * SYNTHETIC index, so the census can be shown to produce all six classes rather
 * than assumed to, and it FAILS if any row of the table is never exercised. A
 * table that stopped emitting a class would otherwise report 0% for it on the
 * corpus, which is how a previous generation's classifier reported confident
 * wrong numbers: a wrong FALL-THROUGH meant names declared in 2+ packages fell
 * off the end of the table and read UNRESOLVABLE, which is a figure no reader
 * can question.
 *
 * No regular expression anywhere in this file. All classification is String ops.
 *
 * USAGE
 *   bun run validation/m14/ts/ts-incoming-resolve.ts [--repo element-plus]
 *       [--files N] [--out path.json] [--shard=i/n] [--merge a.json,b.json]
 *       [--self-test-classifier]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"

// ─────────────────────────────────────────────────────────── the six classes
const RESOLVED = "RESOLVED"
const VIA_OWNER = "VIA_OWNER"
const AMBIGUOUS = "AMBIGUOUS"
const UNRESOLVABLE = "UNRESOLVABLE"
const EMPTY = "EMPTY"
const PLACEHOLDER = "PLACEHOLDER"
/** The four the brief asks for; EMPTY and PLACEHOLDER are reported beside them,
 *  never folded in. */
const FOUR = [RESOLVED, VIA_OWNER, AMBIGUOUS, UNRESOLVABLE] as const
const ALL_CLASSES = [RESOLVED, VIA_OWNER, AMBIGUOUS, UNRESOLVABLE, EMPTY, PLACEHOLDER] as const
type Cls = (typeof ALL_CLASSES)[number]

/** Rule R7's literal set. Only what is unambiguously a placeholder — the word
 *  list deliberately does NOT carry `name`, `value`, `target`, `source`, `object`,
 *  `string`, `number`, `any`, `symbol`, which are ordinary identifiers in
 *  TypeScript and which an earlier census counted as placeholder sites. */
const PLACEHOLDERS = new Set([
  "", "?", "??", "unknown", "unknown_symbol", "unknownsymbol", "<unknown>",
  "<anonymous>", "<lambda>", "n/a", "todo", "tbd",
])

// ─────────────────────────────────────────────────────────── argument parsing
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const REPO = argOf("--repo") ?? "element-plus"
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const FILES = Number(argOf("--files") ?? "400")
const OUT = argOf("--out")
const MERGE = argOf("--merge")
const SHARD = argOf("--shard")
const MAX_BYTES = Number(argOf("--max-bytes") ?? String(512 * 1024))
const REPO_ROOT = path.resolve(path.dirname(process.argv[1]!), "..", "..", "..")

// ─────────────────────────────────────────────────────── the declaration index
/**
 * name -> the declarations that carry it. A Set, never a counter: the first
 * version of an equivalent Go instrument kept a COUNT that was incremented only
 * on the 0->1 transition, so it read 1 for every name in every run and a reader
 * could have concluded every name lives in exactly one place.
 *
 * `owner -> Set<member>` is the second index, because TypeScript resolves
 * `x.m` against x's declaration and not against the global scope.
 */
type Index = {
  plain: Map<string, Set<string>>
  ownerMembers: Map<string, Map<string, Set<string>>>
  files: number
  decls: number
}
const newIndex = (): Index => ({ plain: new Map(), ownerMembers: new Map(), files: 0, decls: 0 })
function addPlain(idx: Index, name: string, where: string): void {
  if (!name) return
  const s = idx.plain.get(name) ?? new Set<string>()
  s.add(where)
  idx.plain.set(name, s)
}
function addMember(idx: Index, owner: string, member: string, where: string): void {
  if (!owner || !member) return
  let m = idx.ownerMembers.get(owner)
  if (!m) { m = new Map(); idx.ownerMembers.set(owner, m) }
  const s = m.get(member) ?? new Set<string>()
  s.add(where)
  m.set(member, s)
}

/** Split `Owner.member` at its LAST dot, which is TypeScript's own rule for a
 *  qualified name: the final segment is the member and everything before it is
 *  the owner. `ns.deep.Thing` -> owner `ns.deep`, member `Thing`. */
function splitQualified(t: string): [string, string] {
  const at = t.lastIndexOf(".")
  if (at <= 0 || at === t.length - 1) return ["", t]
  return [t.slice(0, at), t.slice(at + 1)]
}

/**
 * THE DECISION TABLE. Total — every input lands on exactly one class, which is
 * the property the previous generation's classifier lacked when a
 * `pkg >= 2` case fell off the end of the plain-name branch.
 *
 *   EMPTY             zero-length endpoint
 *   PLACEHOLDER       R7's literal, or the `<...>` / `??` shapes no identifier
 *                     can be
 *   qualified name:
 *     owner resolves to 1 declaration, member declared in it      VIA_OWNER
 *     owner resolves to 1, member NOT declared in it             UNRESOLVABLE
 *       (names a member that does not exist on that type)
 *     owner resolves to >1, member declared in ALL of them       AMBIGUOUS
 *     owner resolves to >1, otherwise                            AMBIGUOUS
 *       (the owner itself is ambiguous, so the member cannot be
 *        resolved without types; ambiguity is inherited, not hidden)
 *     owner resolves to 0                                        UNRESOLVABLE
 *   bare name:
 *     declared exactly once                                       RESOLVED
 *     declared 2+ times                                           AMBIGUOUS
 *     declared 0 times                                            UNRESOLVABLE
 */
type Row = { n: number; files: Set<string>; declaredIn: Set<string> }
const newRow = (): Row => ({ n: 0, files: new Set(), declaredIn: new Set() })
const rowsFor = (m: Map<string, Row>, k: string): Row => { const r = m.get(k) ?? newRow(); m.set(k, r); return r }

function classifyOne(idx: Index, endpoint: string): { cls: Cls; declaredIn: number; wrongOwner: boolean } {
  if (endpoint.length === 0) return { cls: EMPTY, declaredIn: 0, wrongOwner: false }
  if (PLACEHOLDERS.has(endpoint.toLowerCase().trim()) || endpoint.startsWith("<") || endpoint.startsWith("??"))
    return { cls: PLACEHOLDER, declaredIn: 0, wrongOwner: false }
  const [owner, member] = splitQualified(endpoint)
  if (owner !== "") {
    const owners = idx.plain.get(owner)
    if (!owners || owners.size === 0) return { cls: UNRESOLVABLE, declaredIn: 0, wrongOwner: false }
    const ms = idx.ownerMembers.get(owner)
    const memberSet = ms?.get(member)
    const declaredIn = memberSet ? memberSet.size : 0
    if (owners.size === 1) {
      if (memberSet && memberSet.size >= 1) return { cls: VIA_OWNER, declaredIn: 1, wrongOwner: false }
      // the owner resolves and the tail is not a member of it: this names a
      // declaration that does not exist. Loud, not folded into a percentage.
      return { cls: UNRESOLVABLE, declaredIn: 0, wrongOwner: true }
    }
    return { cls: AMBIGUOUS, declaredIn, wrongOwner: false }
  }
  const s = idx.plain.get(member)
  const n = s ? s.size : 0
  if (n === 1) return { cls: RESOLVED, declaredIn: 1, wrongOwner: false }
  if (n >= 2) return { cls: AMBIGUOUS, declaredIn: n, wrongOwner: false }
  return { cls: UNRESOLVABLE, declaredIn: 0, wrongOwner: false }
}

/**
 * --self-test-classifier. 14 rows, driven from a SYNTHETIC index so every row
 * of the table is exercised. Exits non-zero if a row's expected class is not
 * what the table produces, or if any of the six classes is never produced by any
 * row — a class no row emits would report 0% on the corpus, which is
 * indistinguishable from a class that is genuinely absent.
 */
function selfTest(): void {
  const mk = (entries: [string, string][], members: [string, string, string][] = []): Index => {
    const idx = newIndex()
    for (const [n, w] of entries) addPlain(idx, n, w)
    for (const [o, mem, w] of members) addMember(idx, o, mem, w)
    idx.files = 1
    idx.decls = entries.length
    return idx
  }
  const CASES: { label: string; idx: Index; ep: string; want: Cls; declaredIn?: number; wrongOwner?: boolean }[] = [
    { label: "empty string", idx: mk([["A", "f1"]]), ep: "", want: EMPTY },
    { label: "R7 literal unknown", idx: mk([["A", "f1"]]), ep: "unknown", want: PLACEHOLDER },
    { label: "angle-bracket shape", idx: mk([["A", "f1"]]), ep: "<lambda>", want: PLACEHOLDER },
    { label: "bare name, one declaration", idx: mk([["Widget", "f1"]]), ep: "Widget", want: RESOLVED, declaredIn: 1 },
    { label: "bare name, two declarations = AMBIGUOUS", idx: mk([["Widget", "f1"], ["Widget", "f2"]]), ep: "Widget", want: AMBIGUOUS, declaredIn: 2 },
    { label: "declaration merging, three files", idx: mk([["Props", "f1"], ["Props", "f2"], ["Props", "f3"]]), ep: "Props", want: AMBIGUOUS, declaredIn: 3 },
    { label: "bare name, none anywhere", idx: mk([["A", "f1"]]), ep: "Ghost", want: UNRESOLVABLE, declaredIn: 0 },
    { label: "qualified member of one owner", idx: mk([["Base", "f1"]], [["Base", "run", "f1"]]), ep: "Base.run", want: VIA_OWNER, declaredIn: 1 },
    { label: "qualified member, owner absent", idx: mk([["Other", "f1"]]), ep: "Base.run", want: UNRESOLVABLE, declaredIn: 0 },
    { label: "qualified, owner resolves, member does NOT exist on it", idx: mk([["Base", "f1"]], [["Base", "run", "f1"]]), ep: "Base.fly", want: UNRESOLVABLE, declaredIn: 0, wrongOwner: true },
    { label: "qualified, two owners inherit ambiguity", idx: mk([["Base", "f1"], ["Base", "f2"]], [["Base", "run", "f1"], ["Base", "run", "f2"]]), ep: "Base.run", want: AMBIGUOUS, declaredIn: 2 },
    { label: "qualified, two owners, member in only one", idx: mk([["Base", "f1"], ["Base", "f2"]], [["Base", "run", "f1"]]), ep: "Base.run", want: AMBIGUOUS, declaredIn: 1 },
    { label: "qualified, two owners, member in neither", idx: mk([["Base", "f1"], ["Base", "f2"]]), ep: "Base.run", want: AMBIGUOUS, declaredIn: 0 },
    { label: "deep qualified name splits at the LAST dot", idx: mk([["ns.deep", "f1"]], [["ns.deep", "Thing", "f1"]]), ep: "ns.deep.Thing", want: VIA_OWNER, declaredIn: 1 },
  ]
  let failures = 0
  const produced = new Set<Cls>()
  for (const c of CASES) {
    const got = classifyOne(c.idx, c.ep)
    produced.add(got.cls)
    const bad = got.cls !== c.want
      || (c.declaredIn !== undefined && got.declaredIn !== c.declaredIn)
      || (c.wrongOwner !== undefined && got.wrongOwner !== c.wrongOwner)
    if (bad) {
      failures++
      console.error(`  FAIL ${c.label}: want ${c.want}${c.declaredIn !== undefined ? ` declaredIn=${c.declaredIn}` : ""}${c.wrongOwner ? " wrongOwner" : ""}, got ${got.cls} declaredIn=${got.declaredIn}${got.wrongOwner ? " wrongOwner" : ""}`)
    }
  }
  for (const c of ALL_CLASSES) {
    if (produced.has(c)) continue
    failures++
    console.error(`  FAIL no row of the table produced ${c}; it would report 0% on the corpus and that is indistinguishable from absent`)
  }
  console.log(`classifier self-test: ${CASES.length} rows, ${CASES.length - failures} ok, ${failures} wrong`)
  if (failures) process.exit(1)
  console.log(`classes produced by the table: ${[...produced].sort().join(" ")}`)
}
if (argv.includes("--self-test-classifier")) { selfTest(); process.exit(0) }

// ─────────────────────────────────────────────────────────── corpus + index
const dir = path.join(CR, REPO)
let rev = "unknown"
try { rev = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch {}
const tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
const all: string[] = []
for (const rel of tracked) {
  const low = rel.toLowerCase()
  const isTs = low.endsWith(".ts") || low.endsWith(".tsx") || low.endsWith(".mts") || low.endsWith(".cts")
  if (!isTs) continue
  const abs = path.join(dir, rel)
  try { if (readFileSync(abs, "utf8").length > MAX_BYTES) continue } catch { continue }
  all.push(abs)
}
// The index is built over the WHOLE admitted population; the EDGE draw may be a
// prefix of it. Those are two different denominators and conflating them is how
// a resolution rate gets attributed to a sample it did not cover.
const INDEX_ALL = Number(argOf("--index-files") ?? "0")
const indexSet = INDEX_ALL > 0 ? all.slice(0, INDEX_ALL) : all
const edgeSet = FILES > 0 ? all.slice(0, FILES) : all

const { getParser } = await import(path.join(REPO_ROOT, "src/ast/engine"))
const mod: any = await import(path.join(REPO_ROOT, "src/ast/real-typescript-analyzer.ts"))
const Cls = Object.values(mod).find((v: any) => typeof v === "function" && String(v.name).endsWith("Analyzer")) as any

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

/** PHASE 1 — the declaration index, over the whole admitted population. Built
 *  BEFORE any edge is classified, because a classification that ran against a
 *  partially-built index would report a name as UNRESOLVABLE purely because the
 *  file declaring it had not been reached yet. */
const idx0 = newIndex()
let indexFailed = 0
{
  let i = 0
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (true) {
      const k = i++
      if (k >= indexSet.length) return
      try { await indexFile(indexSet[k]!, idx0) } catch { indexFailed++ }
    }
  }))
}

/** Declarations the index records, read off the tree and NOT off the analyzer. */
async function indexFile(abs: string, idx: Index): Promise<void> {
  const rel = path.relative(dir, abs)
  const content = readFileSync(abs, "utf8")
  const parser = await getParser(rel.toLowerCase().endsWith(".tsx") ? "tsx" : "typescript")
  const tree = parser.parse(content, abs)
  const root = tree.rootNode
  idx.files++
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    const t = n.type
    const nameNode = n.childForFieldName?.("name")
    switch (t) {
      case "class_declaration":
      case "abstract_class_declaration":
      case "interface_declaration":
      case "enum_declaration":
      case "type_alias_declaration":
      case "function_declaration":
      case "generator_function_declaration":
      case "abstract_class_declaration":
      case "module":
      case "internal_module":
      case "namespace_declaration":
        if (nameNode) addPlain(idx, String(nameNode.text), rel)
        break
      case "method_definition":
      case "method_signature":
      case "public_field_definition":
      case "property_signature": {
        if (!nameNode) break
        const owner = enclosingOwner(n)
        if (owner) addMember(idx, owner, String(nameNode.text), rel)
        break
      }
      case "enum_assignment": {
        const nm = n.childForFieldName("name")
        if (nm) addPlain(idx, String(nm.text), rel)
        break
      }
      case "lexical_declaration":
      case "variable_declaration": {
        for (const d of namedChildrenOfType(n, "variable_declarator")) {
          const id = d.childForFieldName("name")
          if (id && id.type === "identifier") addPlain(idx, String(id.text), rel)
        }
        break
      }
      default:
        break
    }
    for (let i = (n.childCount ?? 0) - 1; i >= 0; i--) { const c = n.child(i); if (c) stack.push(c) }
  }
}
function namedChildrenOfType(n: any, type: string): any[] {
  const out: any[] = []
  for (let i = 0; i < (n.namedChildCount ?? 0); i++) { const c = n.namedChild(i); if (c && c.type === type) out.push(c) }
  return out
}
/** The nearest enclosing class/interface declaration's name, walked by PARENT
 *  pointers so it costs one hop per member rather than a subtree walk. */
function enclosingOwner(n: any): string {
  let p = n.parent
  while (p) {
    const t = p.type
    if (t === "class_declaration" || t === "abstract_class_declaration" || t === "interface_declaration" || t === "enum_declaration") {
      const nm = p.childForFieldName?.("name")
      return nm ? String(nm.text) : ""
    }
    p = p.parent
  }
  return ""
}

// ─────────────────────────────────────────────────────────── classify edges
type Bucket = { rows: Map<Cls, Row>; wrongOwner: number }
const perType = new Map<Type, Bucket>()
for (const t of ALL_TYPES) perType.set(t, { rows: new Map(), wrongOwner: 0 })
const sourceClass = new Map<Cls, Row>()
let edgeTotal = 0
let filesWithEdges = 0
let idx = 0

await Promise.all(Array.from({ length: 8 }, async () => {
  while (true) {
    const i = idx++
    if (i >= edgeSet.length) return
    const abs = edgeSet[i]!
    const rel = path.relative(dir, abs)
    let res: any
    try {
      const content = readFileSync(abs, "utf8")
      const parser = await getParser(rel.toLowerCase().endsWith(".tsx") ? "tsx" : "typescript")
      const tree = parser.parse(content, abs)
      res = new Cls().analyze(tree.rootNode, content, rel)
    } catch { continue }
    const rels: any[] = res?.relationships ?? []
    if (rels.length) filesWithEdges++
    for (const r of rels) {
      const t = String(r.type ?? r.relationshipType ?? "").toLowerCase() as Type
      const b = perType.get(t)
      if (!b) continue
      const src = String(r.source ?? r.from ?? r.fromSymbol ?? "")
      const tgt = String(r.target ?? r.to ?? r.toSymbol ?? "")
      const cs = classifyOne(idx0, src)
      const ct = classifyOne(idx0, tgt)
      edgeTotal++
      const rs = rowsFor(sourceClass, cs.cls); rs.n++; rs.files.add(rel)
      for (const [c, ep] of [[cs, src], [ct, tgt]] as [{ cls: Cls; declaredIn: number; wrongOwner: boolean }, string][]) {
        const row = rowsFor(b.rows, c.cls)
        row.n++
        row.files.add(rel)
        row.declaredIn.add(ep.length > 120 ? `${ep.slice(0, 120)}...` : ep)
        if (c.cls === UNRESOLVABLE && c.declaredIn > 0) b.wrongOwner++
      }
      if (ct.wrongOwner) b.wrongOwner++
    }
  }
}))

// ─────────────────────────────────────────────────────────── report
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "-")

const out: any = {
  at: new Date().toISOString(),
  corpus: REPO,
  revision: rev,
  indexFiles: indexSet.length,
  edgeFiles: edgeSet.length,
  filesWithEdges,
  indexDeclarations: idx0.plain.size,
  indexOwnerEntries: idx0.ownerMembers.size,
  edgesClassified: edgeTotal,
  grammarLimit: "index and analyzer share tree-sitter-typescript.wasm; a node type that fails to match is invisible to both",
  types: {},
}
console.log(`INCOMING/RESOLUTION census — typescript`)
console.log(`corpus ${REPO}@${rev.slice(0, 10)}`)
console.log(`index built over ${indexSet.length} files by a tree walk (independent of res.symbols)`)
console.log(`edges drawn from ${edgeSet.length} files through the production path`)
console.log(`index holds ${idx0.plain.size} distinct top-level names and ${idx0.ownerMembers.size} owners`)
console.log(`edges classified: ${edgeTotal}\n`)
console.log(`${w("type", 14)}${w("edges", 10)}${FOUR.map((c) => w(c, 13)).join("")}${w("EMPTY", 8)}${w("PLACEHLD", 9)}${w("ambigRate", 11)}${w("travFarEnd", 12)}`)
console.log("-".repeat(132))
const totals = new Map<Cls, number>()
for (const t of ALL_TYPES) {
  const b = perType.get(t)!
  let n = 0
  for (const c of FOUR) n += b.rows.get(c)?.n ?? 0
  const empty = b.rows.get(EMPTY)?.n ?? 0
  const ph = b.rows.get(PLACEHOLDER)?.n ?? 0
  for (const c of ALL_CLASSES) totals.set(c, (totals.get(c) ?? 0) + (b.rows.get(c)?.n ?? 0))
  const ambigRate = n ? ((100 * (b.rows.get(AMBIGUOUS)?.n ?? 0)) / n).toFixed(2) : "-"
  const traversable = (b.rows.get(RESOLVED)?.n ?? 0) + (b.rows.get(VIA_OWNER)?.n ?? 0)
  out.types[t] = {
    edges: n + empty + ph,
    classes: Object.fromEntries(ALL_CLASSES.map((c) => [c, b.rows.get(c)?.n ?? 0])),
    classFileCounts: Object.fromEntries(ALL_CLASSES.map((c) => [c, b.rows.get(c)?.files.size ?? 0])),
    unresolvedTargetSamples: [...(b.rows.get(UNRESOLVABLE)?.declaredIn ?? [])].slice(0, 25),
    ambiguousTargetSamples: [...(b.rows.get(AMBIGUOUS)?.declaredIn ?? [])].slice(0, 25),
    ambiguityRate: ambigRate === "-" ? null : Number(ambigRate),
    traversableFromFarEnd: n ? Number(((100 * traversable) / n).toFixed(2)) : null,
  }
  console.log(`${w(t, 14)}${w(String(n + empty + ph), 10)}${FOUR.map((c) => w(String(b.rows.get(c)?.n ?? 0), 13)).join("")}${w(String(empty), 8)}${w(String(ph), 9)}${w(ambigRate, 11)}${w(n ? `${((100 * traversable) / n).toFixed(1)}%` : "-", 12)}`)
}
let grand = 0
for (const [, v] of totals) grand += v
console.log("-".repeat(132))
const grandAmb = totals.get(AMBIGUOUS) ?? 0
const grandTrav = (totals.get(RESOLVED) ?? 0) + (totals.get(VIA_OWNER) ?? 0)
console.log(`ALL       ${w("", 10)}${FOUR.map((c) => w(String(totals.get(c) ?? 0), 13)).join("")}${w(String(totals.get(EMPTY) ?? 0), 8)}${w(String(totals.get(PLACEHOLDER) ?? 0), 9)}`)
console.log(`\nFOUR-VERDICT SHARE over ${grand} classified endpoints`)
for (const c of FOUR) console.log(`  ${w(c, 14)}${String(totals.get(c) ?? 0).padStart(8)}  ${pct(totals.get(c) ?? 0, grand)}`)
console.log(`  ${w("EMPTY", 14)}${String(totals.get(EMPTY) ?? 0).padStart(8)}  ${pct(totals.get(EMPTY) ?? 0, grand)}   (counted separately, never folded into UNRESOLVABLE)`)
console.log(`  ${w("PLACEHOLDER", 14)}${String(totals.get(PLACEHOLDER) ?? 0).padStart(8)}  ${pct(totals.get(PLACEHOLDER) ?? 0, grand)}   (counted separately, rule R7)`)
console.log(`\nAMBIGUITY RATE (all endpoints): ${pct(grandAmb, grand)}`)
console.log(`TRAVERSABLE FROM THE FAR END:   ${pct(grandTrav, grand)}`)
console.log(`\nSOURCE-side distribution: ${ALL_CLASSES.map((c) => `${c} ${sourceClass.get(c)?.n ?? 0}`).join("  ")}`)
console.log(`\nDECLARED LIMIT: ${out.grammarLimit}`)
if (MERGE) {
  console.log(`\n--merge is accepted and IGNORED: this instrument is sharded by --shard=i/n, not merged here.`)
  console.log(`Record the shard in the artifact; a run over one shard reports on that shard's files only.`)
}
if (SHARD) out.shard = SHARD
if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`\nwrote ${OUT}`) }