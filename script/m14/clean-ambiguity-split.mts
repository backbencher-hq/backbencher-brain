/**
 * clean-ambiguity-split — WHY an incoming target is ambiguous, per type, with counts.
 *
 * ## The question
 *
 * `script/m14/incoming-check.ts` reports `ambiguousTargets` per type. It resolves a
 * target string against a `name -> distinct KINDS` index, so its ambiguous count is the
 * number of target strings published under two or more DIFFERENT KINDS. This lane's
 * declaration dump shows a second, larger ambiguity that instrument cannot see: one file
 * declaring the same name four times under one kind (`Data/Array/Strict.dcl`, four
 * `class` symbols named `!a`, lines 18/20/21/23 — the `instance Show|Eq|Ord|Appendable
 * {!a}` family). Four candidates for a reverse walk, and a kind-keyed index calls that
 * unambiguous. Both numbers are printed, and they are never added: different questions
 * over the same edges.
 *
 * ## An ambiguous edge is ONE edge
 *
 * It is ONE edge that the reverse walk attributes to ONE of N declarations — not N
 * edges. So the count cannot be lowered by emitting fewer edges, and a "fix" that drops
 * edges to move it is not a fix. What moves it is the analyzer naming which declaration
 * it meant.
 *
 * ## Resolution is measured under BOTH rules, and the difference is a finding
 *
 *   BARE   exact key only. This is what `incoming-check.ts` does, and on `imports` it
 *          reports 100% unresolved in every language, because a Clean import target is
 *          spelled `Module:Item` or `Module:*` and the bare key is not a published name.
 *          A column that is always maximal carries no information.
 *   STORE  the three strategies the store itself uses (`parallel-indexer.ts:2734`):
 *          the exact key, the leaf after the last `:`, and the leaf after the first `.`.
 *          This is what a reverse walk matching targets actually does.
 * Both are printed per type. The gap between them is instrument bias, not a lane defect,
 * and reporting only one of them would misattribute it.
 *
 * ## Both endpoints are classified
 *
 * The brief asks about incoming targets, and the target is where the reverse walk breaks.
 * The SOURCE is the same failure mirrored — an edge whose source names four declarations
 * is attributed to one of them by the same unnamed rule — and the lane's worst naming
 * defect (`!a`) sits on sources, not targets. Reporting only targets would hide the
 * defect the lane can actually fix, so both sides are counted and kept apart.
 *
 * ## The split, and which parts are the lane's to repair
 *
 *   A  SCOPE          several declarations of one name inside ONE file — a local
 *                     `where`/`let`/`with` binding, two instances named after a type
 *                     expression, a polymorphic instance member against a class member.
 *                     The lane owns the NAME. The published-symbol contract owns the
 *                     scope field, and there is none: `scope` is ABSENT on all 63,052
 *                     symbols measured, so a consumer cannot use one even if it existed.
 *   B  MODULE         one declaration per file, N files. Clean has no cross-module
 *                     overloading, so every `map` in every module is a legal distinct
 *                     declaration and a bare target cannot say which. The lane can read
 *                     the module: its `imports` edges already name the modules in scope.
 *   C  NAME CONTRACT  one name, two or more KINDS. Clean's namespaces let a class and a
 *                     function share a spelling. The published name is not a unique
 *                     identifier and no lane can make it one.
 *   ABSENT            the name does not occur as a token on the source line that declares
 *                     it, at all. Not a name-shape guess: the declaration's own line is
 *                     read and searched for the name.
 *   NOT-BOUND         the name DOES occur on that line, but not in the position where the
 *                     language binds a definition — it is a type mention, a type argument,
 *                     or a field type. Reported apart from ABSENT because the earlier
 *                     single `UNSPELLED` bucket said "absent from their own declaration
 *                     line" for both, and for this one that sentence is false: the name is
 *                     right there. The distinction matters because the two have different
 *                     fixes — an ABSENT name is an invented row, a NOT-BOUND name is a
 *                     declaration the analyzer attached to the wrong line or the wrong
 *                     kind.
 *   QNAME-ALIAS       the extra candidates come from indexing a symbol's `qualifiedName`
 *                     into the same map as its `name`. Ambiguity the INSTRUMENT creates;
 *                     reported apart so it is not charged to a lane.
 *
 * ## What this file does not do
 *
 * It does not decide which of two same-named declarations an edge MEANT. That is a
 * resolution question, and answering it here would be the classifier grading its own
 * measurement. It counts candidates and names files; the decision is left to a reader
 * with the source in front of them.
 *
 * Usage:
 *   npx tsx script/m14/clean-ambiguity-split.mts --in <identity-dir>
 *          [--json out.json] [--examples N]
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]
const BUCKETS = ["ABSENT", "NOT_BOUND", "A_SCOPE", "B_MODULE", "C_NAME_CONTRACT", "QNAME_ALIAS", "UNIQUE", "UNRESOLVED", "SELF"] as const
type Bucket = (typeof BUCKETS)[number]

const argv = process.argv.slice(2)
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : "" }
const IN_DIR = arg("--in")
const JSON_OUT = arg("--json")
const EXAMPLES = Number(arg("--examples") ?? 10) || 10
const PHANTOMS_OUT = arg("--phantoms-out")
if (!IN_DIR) {
  console.error("usage: npx tsx script/m14/clean-ambiguity-split.mts --in <identity-dir> [--json out] [--examples N]")
  process.exit(2)
}

const files = fs.statSync(IN_DIR).isDirectory()
  ? fs.readdirSync(IN_DIR).filter((f) => f.startsWith("identity-") && f.endsWith(".ndjson")).sort()
  : [path.basename(IN_DIR)]
if (files.length === 0) { console.error(`no identity-<shard>.ndjson under ${IN_DIR}`); process.exit(2) }

type Decl = { name: string; kind: string; qname: string; line: number; owner: string; file: string; vis: string }
const declsByName = new Map<string, Decl[]>()
const declsByQName = new Map<string, Decl[]>()
const filesSeen = new Set<string>()
const edges: { t: number; src: string; tgt: string; file: string; line: number; conf: number; disc: string }[] = []
let declarations = 0

const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]) }

for (const f of files) {
  for (const line of fs.readFileSync(path.join(IN_DIR, f), "utf8").split("\n")) {
    const t = line.trim()
    if (!t) continue
    const rec = JSON.parse(t) as { f: string; s: unknown[][]; r: unknown[][] }
    filesSeen.add(rec.f)
    for (const s of rec.s) {
      const d: Decl = { name: String(s[0]), kind: String(s[1]), qname: String(s[2]), line: Number(s[3]) || 0, owner: String(s[4]), file: rec.f, vis: String(s[5]) }
      declarations++
      if (!d.kind || !d.name) continue
      push(declsByName, d.name, d)
      if (d.qname && d.qname !== d.name) push(declsByQName, d.qname, d)
    }
    for (const r of rec.r) edges.push({ t: Number(r[0]), src: String(r[1]), tgt: String(r[2]), file: rec.f, line: Number(r[3]) || 0, conf: Number(r[4]), disc: String(r[5]) })
  }
}

// ---------------------------------------------------------------- resolution
/** The store's own three strategies (parallel-indexer.ts:2734), in the store's order. */
function keysFor(target: string): { exact: boolean; colon: boolean; dot: boolean } {
  const colon = target.includes(":") ? target.slice(target.lastIndexOf(":") + 1) : ""
  const dot = target.includes(".") ? target.slice(target.indexOf(".") + 1) : ""
  return { exact: target.length > 0, colon: colon.length > 0 && colon !== target, dot: dot.length > 0 && dot !== target && dot !== colon }
}

const keyCache = new Map<string, string[]>()
function keys(target: string): string[] {
  const hit = keyCache.get(target)
  if (hit) return hit
  const k = keysFor(target)
  const out = [target]
  if (k.colon) out.push(target.slice(target.lastIndexOf(":") + 1))
  if (k.dot) { const d = target.slice(target.indexOf(".") + 1); if (!out.includes(d)) out.push(d) }
  keyCache.set(target, out)
  return out
}

/** Every declaration the store's rules reach for `target`, deduped, plus how it matched. */
const candCache = new Map<string, { decls: Decl[]; matchedBy: string[] }>()
function candidates(target: string): { decls: Decl[]; matchedBy: string[] } {
  const hit = candCache.get(target)
  if (hit) return hit
  const seen = new Set<string>()
  const decls: Decl[] = []
  const matchedBy: string[] = []
  for (const key of keys(target)) {
    const byName = declsByName.get(key)
    const byQ = declsByQName.get(key)
    if (!byName && !byQ) continue
    matchedBy.push(key === target ? "exact" : `leaf(${key})`)
    for (const d of [...(byName ?? []), ...(byQ ?? [])]) {
      const id = `${d.file}:${d.line}:${d.kind}:${d.name}:${d.qname}`
      if (seen.has(id)) continue
      seen.add(id)
      decls.push(d)
    }
  }
  const out = { decls, matchedBy }
  candCache.set(target, out)
  return out
}

// ---------------------------------------------------------------- the DEFINITION test
//
// Two questions are asked of every declaration's own source line, and they have different
// answers and different owners:
//
//   ABSENT     the name does not occur on that line at all            -> an invented row
//   NOT-BOUND  the name occurs there, but not where the language binds a definition
//              -> a real declaration, attached to the wrong line or the wrong kind
//
// An earlier version of this file asked one question and reported one bucket, under the
// name UNSPELLED, with the note "ALL N candidates are absent from their own declaration
// line". That sentence is false for the NOT-BOUND half — `string_table_offset` is on the
// line that flagged it, inside a `#` comment — so the bucket is split rather than the
// note reworded.
//
// This test needs the file on disk, and the dump records paths CORPUS-RELATIVE. That is
// not a detail: the first run of this test read 0 of 2,181 files, every lookup was
// ENOENT, and the bucket printed 0 — a clean-looking measurement of a test that never ran.
// So the report prints the resolver, how many probes ran, and how many landed, because a
// bucket whose denominator is 0 is not a result.
const INTRODUCERS = ["module", "instance", "class", "definition", "implementation", "system", "derive", "special", "infixl", "infixr", "generic", "where", "abstract", "constructor"]
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** A `/ * ... * /` comment, which Clean's corpus puts between an introducer and its name. */
const GAP = "(?:\\s|/\\*.*?\\*/)+"
/**
 * DOES THE NAME OCCUR AS A TOKEN ON THIS LINE AT ALL?
 *
 * This is the weaker of the two tests, and it is kept separate because the two buckets it
 * feeds have different fixes. `implementation   module /* *\/ someLib.TestModule` puts a
 * comment between the introducer and the name; a word-boundary test that stops at the
 * comment reports a name absent from a line that contains it.
 */
function nameOnLine(text: string, name: string): boolean {
  const n = name.trim()
  if (!n) return false
  const bare = esc(n)
  return new RegExp(`(^|[^\\w])${bare}([^\\w]|$)`).test(text) || text.includes(`(${n})`)
}
/**
 * IS THIS NAME BOUND AS A DEFINITION ON THIS LINE?
 *
 * Five earlier definitions of this test were wrong in ways that each read as a clean
 * measurement, so the rule is stated exactly, and each rule below cites the corpus line
 * that forced it. A name is BOUND when it is
 *
 *   (a) the FIRST TOKEN of the line, ignoring indentation    — `map :: !a -> !a`
 *   (b) immediately after a clause separator `;` or `where` — `f x = 1; g y = 2`
 *   (c) immediately after an introducer keyword             — `class Eq a`, `module foo`
 *   (d) an operator written parenthesised, at the head of the line or before a definition
 *       operator                                           — `(==) a b`, `(THEN) a f :== f a`
 *   (e) immediately before `::`                             — `{ symbol_name :: !String }`
 *
 * (d) and (e) each carry a guard, and both guards were added because the unguarded form
 * reported a type mention as a declaration:
 *
 *   (d) unguarded, `(Whole str)` on the right of an `=` read as a declaration of `Whole`.
 *       Guarded by requiring the parenthesised name at the HEAD of the line, which is
 *       where `(==) a b` writes an instance member — 151 of the 156 `method`/`module`/
 *       `property` flags were this guard being absent, and all 151 are `\t(==) A B`.
 *   (e) unguarded, `printPagePerPage :: !Bool !Bool` read as a declaration of `Bool` from
 *       the field TYPE. Guarded to the name immediately preceding `::`.
 *
 * (e) also accepts a name whose `::` wrapped onto the NEXT line, because Clean's own
 * corpus writes record fields that way (`windowhandle.dcl:97` is
 * `,	gamewindowFullScreen` and line 98 is `:: !Bool`) and both rows are the field.
 *
 * (c) accepts a comment between the introducer and the name: `eastwood` ships
 * `implementation   module /* *\/ someLib.TestModule` and the name IS the module.
 *
 * Everything else on that line — a mention inside a type expression, a type argument, a
 * field type — is a MENTION, and a symbol published under a mention's name is a phantom.
 * The residual false-positive family this definition admits is a `let` binding that does
 * not start its line; it is counted and named rather than argued away.
 */
function tokenPresent(text: string, name: string, nextLine?: string): boolean {
  const n = name.trim()
  if (!n) return false
  const bare = esc(n)
  const trimmed = text.replace(/^\s+/, "")
  // (a) first token. `:: Name` is Clean's type-definition form (`:: Int = Int`), and a
  // tab usually separates the two, so the first token may be `::` and the NAME the
  // second. Missing this form made all 4,375 `type` symbols read as phantoms, which is
  // the shape of an instrument that has never been right about the most regular
  // declaration in the language.
  const head = trimmed.startsWith("::") ? trimmed.slice(2).replace(/^\s+/, "") : trimmed
  const headRest = head.slice(n.length)
  if (head.startsWith(n) && (headRest === "" || /[\s({[<|=]/.test(headRest))) return true
  // (a2) the multi-line module header: `definition module ` on one line and the NAME on
  // the next. The name is genuinely declared; the symbol's `line` points at the
  // introducer. That is a finding about the SYMBOL, not a phantom, so it is excluded here
  // and reported as its own row.
  if (/^\s*(definition|implementation)\s+module\s*$/.test(text) && nextLine !== undefined) {
    const nx = nextLine.replace(/^\s+/, "")
    if (nx.startsWith(n) && (nx.length === n.length || /[\s({[<|=]/.test(nx.slice(n.length)))) return true
  }
  // (b) clause separator, (c) introducer. The separator is `\\s+`, not one space:
  // Clean's own corpus writes `implementation\tmodule\tStdEnv` and
  // `where\ttoString (Whole str) = str`, and a single-space rule reported both the
  // module and the method as invented. The gap allows a comment (see header).
  for (const kw of [";", ...INTRODUCERS]) {
    const re = new RegExp(`${esc(kw)}${GAP}${bare}`, "g")
    const m = re.exec(text)
    if (!m) continue
    const after = text[m.index + m[0].length] ?? ""
    if (after === "" || /[\s({[<|;,)=]/.test(after)) return true
  }
  // (d) an operator written parenthesised — how Clean writes an operator method and a
  // macro. Two accepted shapes, because both are declarations: the operator at the HEAD
  // of the line (`\t(==) NoTypes NoTypes`, an instance member), and the operator before
  // a definition operator (`(THEN) a f :== f a`).
  if (text.includes(`(${n})`) && (new RegExp(`^\\s*\\(${bare}\\)`).test(text) || /(^|\s)(:==|:=|=|\|)/.test(text))) return true
  // (e) a field or a typed local immediately before `::`, on this line or the next.
  if (new RegExp(`(^|[\\s,{|=])${bare}\\s*::`).test(text)) return true
  if (nextLine !== undefined && /^\s*(::|:)/.test(nextLine) && new RegExp(`(^|[\\s,{|=])${bare}\\s*$`).test(text)) return true
  // (f) a data constructor: `| RemoveInfo !Bool !IRState`, `= MenuItem MenuItemId ...`,
  // and the NULLARY alternative `| EmptySymbol;`, which is 66 of the 116 constructor
  // flags an earlier version of this rule produced by demanding a space or EOL after the
  // name. A nullary alternative is terminated by `;`, like every other Clean clause.
  // The line must also carry a definition operator, or `x = Foo` would read as a
  // declaration of `Foo` — which it is not.
  if (/(^|\s)(=|\|)/.test(text) && new RegExp(`(^|[\\s|={,])\\s*${bare}(\\s|;|$)`).test(text)) return true
  return false
}
const CR_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const absPathCache = new Map<string, string | null>()
function absolutePath(rel: string): string | null {
  const hit = absPathCache.get(rel)
  if (hit !== undefined) return hit
  const tries = path.isAbsolute(rel) ? [rel] : [path.resolve(CR_ROOT, rel), path.resolve(process.cwd(), rel)]
  let found: string | null = null
  for (const t of tries) { try { if (fs.statSync(t).isFile()) { found = t; break } } catch { /* next */ } }
  absPathCache.set(rel, found)
  return found
}
const srcCache = new Map<string, string[] | null>()
let lineReads = 0, lineReadsOk = 0
type Probe = { onLine: boolean; bound: boolean; text: string; next: string }
/** `NOFILE` means the source was not readable, which is a THIRD outcome and not a false. */
function probeLine(d: Decl): Probe | "NOFILE" {
  const abs = absolutePath(d.file)
  if (!abs) return "NOFILE"
  let lines = srcCache.get(abs)
  if (lines === undefined) {
    try { lines = fs.readFileSync(abs, "utf8").split("\n") } catch { lines = null }
    srcCache.set(abs, lines)
  }
  if (lines === null) return "NOFILE"
  const text = lines[d.line - 1]
  if (text === undefined) return "NOFILE"
  lineReads++
  const next = lines[d.line] ?? ""
  const bound = tokenPresent(text, d.name, next)
  if (bound) lineReadsOk++
  return { onLine: nameOnLine(text, d.name), bound, text, next }
}
const probeCache = new Map<Decl, Probe | "NOFILE">()
function probe(d: Decl): Probe | "NOFILE" {
  const hit = probeCache.get(d)
  if (hit !== undefined) return hit
  const r = probeLine(d)
  probeCache.set(d, r)
  return r
}
const spelledInLine = (d: Decl): boolean | "NOFILE" => { const p = probe(d); return p === "NOFILE" ? "NOFILE" : !p.bound }
const noFile = (d: Decl): boolean => probe(d) === "NOFILE"
// The definition of BOUND is at `tokenPresent`, with the rule-by-rule corpus evidence that
// forced each rule. The two findings that made the test positional rather than lexical are
// recorded here because they are the reason a reader should not "simplify" it back:
//
//   1 punctuation-adjacency alone — WRONG. `implementation module foo;` has `;` after
//     `foo` and the module IS declared there, so excluding `;` invents 474 phantom
//     modules.
//   2 the same test with `;` allowed — ALSO WRONG, in the other direction.
//     `instance UList Bool;` has no brackets and no `::`, and `Bool` is a type MENTION:
//     the declaration on that line is `UList`. Punctuation cannot tell a definition head
//     from a mention, because both are bare identifiers in the same sentence.
// ---------------------------------------------------------------- verdict per name
type Verdict = { bucket: Bucket; note: string; decls: number; kinds: number; files: number }
const verdictCache = new Map<string, Verdict>()

function verdictFor(target: string): Verdict {
  const hit = verdictCache.get(target)
  if (hit) return hit
  const { decls, matchedBy } = candidates(target)
  let v: Verdict
  if (decls.length === 0) {
    v = { bucket: "UNRESOLVED", note: `no declaration under ${keys(target).join(" | ")}`, decls: 0, kinds: 0, files: 0 }
  } else {
    const kinds = new Set(decls.map((d) => d.kind))
    const filesN = new Set(decls.map((d) => d.file)).size
    // Split the NOT-BOUND candidates by whether the name is on the line at all. A
    // declaration whose file could not be read is NOT counted as NOT-BOUND: it is a third
    // outcome, and folding it in would let an unreadable corpus manufacture phantoms.
    const unreadable = decls.filter((d) => noFile(d)).length
    const absent = decls.filter((d) => { const p = probe(d); return p !== "NOFILE" && !p.onLine }).length
    const notBound = decls.filter((d) => { const p = probe(d); return p !== "NOFILE" && p.onLine && !p.bound }).length
    const flagged = absent + notBound
    const tail = `${absent} absent from the line, ${notBound} on it but not bound, ${unreadable} file unreadable`
    if (flagged === decls.length && unreadable === 0 && absent > 0) {
      v = { bucket: "ABSENT", note: `ALL ${decls.length} candidates: the name does not occur on the line that declares it`, decls: decls.length, kinds: kinds.size, files: filesN }
    } else if (flagged === decls.length && unreadable === 0 && notBound > 0) {
      v = { bucket: "NOT_BOUND", note: `ALL ${decls.length} candidates: the name is on the line but not where the language binds a definition`, decls: decls.length, kinds: kinds.size, files: filesN }
    } else if (kinds.size > 1) {
      // Was the second kind contributed only by a qualifiedName match?
      const byNameKinds = new Set<string>()
      for (const k of keys(target)) for (const d of declsByName.get(k) ?? []) byNameKinds.add(d.kind)
      const onlyByQname = [...kinds].every((k) => !byNameKinds.has(k))
      const t2 = flagged > 0 ? `; ${tail}` : ""
      v = onlyByQname
        ? { bucket: "QNAME_ALIAS", note: `kind(s) ${[...kinds].sort().join("+")} reachable only through a qualifiedName (${matchedBy.join(", ")})`, decls: decls.length, kinds: kinds.size, files: filesN }
        : { bucket: "C_NAME_CONTRACT", note: `kinds ${[...kinds].sort().join("+")} over ${decls.length} declarations in ${filesN} files${t2}`, decls: decls.length, kinds: kinds.size, files: filesN }
    } else if (decls.length > 1) {
      const t2 = flagged > 0 ? `; ${tail}` : ""
      v = filesN === 1
        ? { bucket: "A_SCOPE", note: `${decls.length} declarations in ONE file: ${decls.map((d) => `${d.kind}@L${d.line}`).join(" ")}${t2}`, decls: decls.length, kinds: kinds.size, files: filesN }
        : { bucket: "B_MODULE", note: `${decls.length} declarations, one per file, across ${filesN} files${t2}`, decls: decls.length, kinds: kinds.size, files: filesN }
    } else {
      v = { bucket: "UNIQUE", note: `1 declaration (${decls[0].kind})`, decls: 1, kinds: 1, files: 1 }
    }
  }
  verdictCache.set(target, v)
  return v
}

// ---------------------------------------------------------------- tally
type Side = { edges: number; empty: number; bareRes: number; storeRes: number; self: number; buckets: Record<Bucket, number>; names: Record<string, Set<string>>; ambEdges: number }
const mkSide = (): Side => ({ edges: 0, empty: 0, bareRes: 0, storeRes: 0, self: 0, buckets: { ABSENT: 0, NOT_BOUND: 0, A_SCOPE: 0, B_MODULE: 0, C_NAME_CONTRACT: 0, QNAME_ALIAS: 0, UNIQUE: 0, UNRESOLVED: 0, SELF: 0 }, names: Object.fromEntries(BUCKETS.map((b) => [b, new Set<string>()])) as Record<string, Set<string>>, ambEdges: 0 })
/** incoming-check.ts's rule: the exact key, with a symbol's qualifiedName indexed beside its name. */
function resolvesBare(t: string): boolean { return declsByName.has(t) || declsByQName.has(t) }
const tgtSide: Record<string, Side> = Object.fromEntries(ALL_TYPES.map((t) => [t, mkSide()]))
const srcSide: Record<string, Side> = Object.fromEntries(ALL_TYPES.map((t) => [t, mkSide()]))
const kindPairs = new Map<string, number>()
const declCountHist = new Map<number, number>()
const samples: Record<Bucket, { t: string; src: string; tgt: string; file: string; line: number }[]> = Object.fromEntries(BUCKETS.map((b) => [b, []])) as Record<Bucket, { t: string; src: string; tgt: string; file: string; line: number }[]>
const confByBucket = new Map<Bucket, Map<number, number>>()
const noteFreq = new Map<string, { bucket: Bucket; note: string; edges: number }>()

for (const e of edges) {
  const t = ALL_TYPES[e.t]
  // target side (the incoming question)
  {
    const s = tgtSide[t]
    s.edges++
    if (!e.tgt) { s.empty++; s.buckets.UNRESOLVED++; s.names.UNRESOLVED.add("<empty>"); continue }
    if (e.src === e.tgt) { s.buckets.SELF++; s.self++; s.names.SELF.add(e.tgt); continue }
    if (resolvesBare(e.tgt)) s.bareRes++
    const v = verdictFor(e.tgt)
    if (v.decls > 0) s.storeRes++
    s.buckets[v.bucket]++
    s.names[v.bucket].add(e.tgt)
    if (v.bucket !== "UNIQUE" && v.bucket !== "UNRESOLVED") {
      s.ambEdges++
      const h = declCountHist.get(v.decls) ?? 0
      declCountHist.set(v.decls, h + 1)
      const nk = noteFreq.get(e.tgt)
      if (nk) nk.edges++
      else noteFreq.set(e.tgt, { bucket: v.bucket, note: v.note, edges: 1 })
      if (v.bucket === "C_NAME_CONTRACT") {
        const ds = candidates(e.tgt).decls
        const byKind = new Map<string, Set<string>>()
        for (const d of ds) { const st = byKind.get(d.kind) ?? new Set<string>(); st.add(d.file); byKind.set(d.kind, st) }
        const pair = [...byKind.entries()].sort((a, b) => b[1].size - a[1].size).map(([k, st]) => `${k}×${st.size}`).join(" + ")
        kindPairs.set(pair, (kindPairs.get(pair) ?? 0) + 1)
      }
      if (samples[v.bucket].length < 500) samples[v.bucket].push({ t, src: e.src, tgt: e.tgt, file: e.file, line: e.line })
      const cb = confByBucket.get(v.bucket) ?? new Map<number, number>()
      cb.set(e.conf, (cb.get(e.conf) ?? 0) + 1)
      confByBucket.set(v.bucket, cb)
    }
  }
  // source side (the mirrored failure)
  {
    const s = srcSide[t]
    s.edges++
    if (!e.src) { s.empty++; s.buckets.UNRESOLVED++; s.names.UNRESOLVED.add("<empty>"); continue }
    if (e.src === e.tgt) { s.buckets.SELF++; s.self++; s.names.SELF.add(e.src); continue }
    if (resolvesBare(e.src)) s.bareRes++
    const v = verdictFor(e.src)
    if (v.decls > 0) s.storeRes++
    s.buckets[v.bucket]++
    s.names[v.bucket].add(e.src)
  }
}

// ---------------------------------------------------------------- phantom declarations
//
// A SYMBOL-level count, over every declaration in the population, of symbols whose name is
// not bound as a definition on the line that declares it. This is a different question
// from the edge buckets above and it is the actionable one: a phantom symbol is a row in
// the store with a name the source did not declare, and every edge that matches that name
// by string can land on it. The edge buckets cannot see it — `Int` has 160 candidates, 3
// of them phantom, and an edge to `Int` is a perfectly good edge to the other 157.
//
// Rows carry WHICH of the two failures they are, because the fix differs, and a
// declaration whose file could not be read is reported on its own row rather than being
// called a phantom.
type Phantom = { d: Decl; line: string; why: "ABSENT" | "NOT_BOUND" }
const phantoms: Phantom[] = []
const phantomByKind = new Map<string, number>()
const phantomByName = new Map<string, number>()
const phantomByWhy = new Map<string, number>()
let unreadableDecls = 0
for (const ds of declsByName.values()) {
  for (const d of ds) {
    const p = probe(d)
    if (p === "NOFILE") { unreadableDecls++; continue }
    if (p.bound) continue
    phantoms.push({ d, line: p.text, why: p.onLine ? "NOT_BOUND" : "ABSENT" })
    phantomByKind.set(d.kind, (phantomByKind.get(d.kind) ?? 0) + 1)
    phantomByName.set(d.name, (phantomByName.get(d.name) ?? 0) + 1)
    phantomByWhy.set(p.onLine ? "NOT_BOUND" : "ABSENT", (phantomByWhy.get(p.onLine ? "NOT_BOUND" : "ABSENT") ?? 0) + 1)
  }
}

// ---------------------------------------------------------------- report
const w = (s: string | number, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
const pct = (a: number, b: number) => (b === 0 ? "  n/a" : `${((a / b) * 100).toFixed(1)}%`)
const fired = ALL_TYPES.filter((t) => tgtSide[t].edges > 0)
const tot = (side: Record<string, Side>): Side => ALL_TYPES.reduce((a, t) => {
  const r = side[t]
  a.edges += r.edges; a.empty += r.empty; a.bareRes += r.bareRes; a.storeRes += r.storeRes; a.self += r.self; a.ambEdges += r.ambEdges
  for (const b of BUCKETS) { a.buckets[b] += r.buckets[b]; for (const n of r.names[b]) a.names[b].add(n) }
  return a
}, mkSide())

console.log(`clean ambiguity split — ${filesSeen.size} files, ${declarations} declarations, ${edges.length} edges, ${fired.length}/10 types fired`)
console.log(`identity shards: ${files.length}   distinct published names: ${declsByName.size}   names with >1 declaration: ${[...declsByName.values()].filter((d) => d.length > 1).length}   distinct qualifiedNames: ${declsByQName.size}`)
console.log(`\nResolution is reported under BOTH rules. BARE = exact key only (what incoming-check.ts does).`)
console.log(`STORE = exact, leaf-after-colon, leaf-after-dot (what the store's own reverse walk does).`)

for (const [label, side] of [["TARGET SIDE (the incoming question)", tgtSide], ["SOURCE SIDE (the mirrored failure)", srcSide]] as [string, Record<string, Side>][]) {
  console.log(`\n${label}`)
  console.log([w("type", 13), w("edges", 8), w("unresBARE", 11), w("unresSTORE", 12), w("ambSTORE", 10), w("self", 6), ...["ABSENT", "NOTBND", "A_SCOPE", "B_MODULE", "C_CONTRACT", "QALIAS", "UNIQUE"].map((h) => w(h, 9))].join(""))
  console.log("-".repeat(134))
  for (const t of ALL_TYPES) {
    const r = side[t]
    if (r.edges === 0) { console.log(`${w(t, 13)}${w("0", 8)}NOT EMITTED`); continue }
    console.log([w(t, 13), w(r.edges, 8), w(r.edges - r.bareRes - r.self - r.empty, 11), w(r.edges - r.storeRes - r.self - r.empty, 12), w(r.ambEdges, 10), w(r.self, 6),
      w(r.buckets.ABSENT, 9), w(r.buckets.NOT_BOUND, 9), w(r.buckets.A_SCOPE, 9), w(r.buckets.B_MODULE, 9), w(r.buckets.C_NAME_CONTRACT, 9), w(r.buckets.QNAME_ALIAS, 9), w(r.buckets.UNIQUE, 9)].join(""))
  }
  const T = tot(side)
  console.log("-".repeat(134))
  console.log([w("ALL", 13), w(T.edges, 8), w(T.edges - T.bareRes - T.self - T.empty, 11), w(T.edges - T.storeRes - T.self - T.empty, 12), w(T.ambEdges, 10), w(T.self, 6),
    w(T.buckets.ABSENT, 9), w(T.buckets.NOT_BOUND, 9), w(T.buckets.A_SCOPE, 9), w(T.buckets.B_MODULE, 9), w(T.buckets.C_NAME_CONTRACT, 9), w(T.buckets.QNAME_ALIAS, 9), w(T.buckets.UNIQUE, 9)].join(""))
  void label
}

const T = tot(tgtSide), S = tot(srcSide)
console.log(`\nAMBIGUOUS EDGES BY CAUSE — target side, one edge and N candidate declarations, of ${T.edges} edges`)
for (const [b, desc] of [["ABSENT", "invented name: does not occur on the line that declares it"], ["NOT_BOUND", "the name is on that line, but not bound as a definition"], ["A_SCOPE", "N declarations of one name inside ONE file"], ["B_MODULE", "one declaration per file, N files (module-level reuse)"], ["C_NAME_CONTRACT", "one name, 2+ KINDS"], ["QNAME_ALIAS", "extra candidates reachable only via a qualifiedName"]] as [Bucket, string][]) {
  const n = T.buckets[b]
  console.log(`  ${w(b, 18)}${w(n, 8)}${pct(n, T.edges).padStart(8)}   names ${w(T.names[b].size, 7)} ${desc}`)
}
console.log(`  ${w("(unresolved)", 18)}${w(T.buckets.UNRESOLVED, 8)}${pct(T.buckets.UNRESOLVED, T.edges).padStart(8)}   names ${w(T.names.UNRESOLVED.size, 7)} no declaration under any of the three rules`)
console.log(`  ${w("(unique)", 18)}${w(T.buckets.UNIQUE, 8)}${pct(T.buckets.UNIQUE, T.edges).padStart(8)}   names ${w(T.names.UNIQUE.size, 7)} one declaration, one kind`)

console.log(`\nSAME SIX BUCKETS, SOURCE SIDE — of ${S.edges} edges`)
for (const b of ["ABSENT", "NOT_BOUND", "A_SCOPE", "B_MODULE", "C_NAME_CONTRACT", "QNAME_ALIAS"] as Bucket[]) {
  console.log(`  ${w(b, 18)}${w(S.buckets[b], 8)}${pct(S.buckets[b], S.edges).padStart(8)}   names ${w(S.names[b].size, 7)}`)
}

console.log(`\nPHANTOM DECLARATIONS — symbols whose name is not bound as a definition on the line that declares them`)
console.log(`  probe denominator: ${lineReads} declaration lines read, ${lineReadsOk} bound a name, ${unreadableDecls} declarations unreadable (not counted either way)`)
console.log(`  of ${declarations} declarations, ${phantoms.length} flagged (${phantoms.length === 0 ? 0 : (100 * phantoms.length / Math.max(1, lineReads)).toFixed(1)}% of lines read): ABSENT ${phantomByWhy.get("ABSENT") ?? 0}, NOT_BOUND ${phantomByWhy.get("NOT_BOUND") ?? 0}`)
for (const [k, n] of [...phantomByKind.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${w(k, 14)}${w(n, 7)}declarations`)
console.log(`  distinct phantom names: ${phantomByName.size}`)
console.log(`  top names: ${[...phantomByName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, c]) => `${n}×${c}`).join("  ")}`)
console.log(`  samples PER KIND — three per kind, declaration line printed beside the published name, so a reader can judge the test:`)
for (const kind of [...phantomByKind.keys()].sort()) {
  // both causes, not just the first, so a reader sees the family a kind actually has
  for (const p of phantoms.filter((x) => x.d.kind === kind).slice(0, 3)) {
    console.log(`    ${w(kind, 12)}${w(p.why, 11)}${p.d.file}:${p.d.line}  name ${JSON.stringify(p.d.name)}  |  ${p.line.trim().slice(0, 84)}`)
  }
}

// SELF-CHECK. Every flagged declaration is re-tested with the same function that
// flagged it, on the same line, in the same process. A count that its own test
// contradicts is not a count, and an instrument that cannot notice that about itself
// is the thing this file exists to be honest about. Non-zero here means the phantom
// figure below is an ARTEFACT of this run and must not be quoted.
const selfDisagree = phantoms.filter((x) => {
  const abs = absolutePath(x.d.file)
  const lines = abs ? srcCache.get(abs) : undefined
  return tokenPresent(x.line, x.d.name, lines?.[x.d.line] ?? "")
}).length
console.log(`\nSELF-CHECK — ${selfDisagree} of ${phantoms.length} flagged declarations are BOUND when the same test is re-run on the same line in this process`)
if (selfDisagree > 0) {
  console.log(`  examples:`)
  for (const x of phantoms.filter((y) => tokenPresent(y.line, y.d.name)).slice(0, 5)) console.log(`    ${x.d.kind} ${JSON.stringify(x.d.name)} ${x.d.file}:${x.d.line} | ${x.line.trim().slice(0, 70)}`)
}

if (PHANTOMS_OUT) {
  fs.writeFileSync(PHANTOMS_OUT, phantoms.map((x) => JSON.stringify({ why: x.why, kind: x.d.kind, name: x.d.name, file: x.d.file, line: x.d.line, src: x.line })).join("\n") + (phantoms.length ? "\n" : ""))
  console.log(`\nphantom evidence written: ${PHANTOMS_OUT} (${phantoms.length} rows — one per flagged declaration, source line beside it, so the count is re-derivable without re-running this file)`)
}

console.log(`\nC_NAME_CONTRACT — which KINDS share one name (distinct names by kind combination)`)
for (const [pair, n] of [...kindPairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`  ${w(n, 7)}${pair}`)

console.log(`\nCANDIDATE-COUNT HISTOGRAM — edges whose target name has N declarations (both sides counted once)`)
const hist = [...declCountHist.entries()].sort((a, b) => a[0] - b[0])
console.log(`  ${hist.length} distinct candidate counts; top by edge count:`)
for (const [n, c] of [...hist].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${w(n, 6)}declarations: ${w(c, 8)} edges`)

console.log(`\nCONFIDENCE BY CAUSE (target side) — a bucket of heuristic edges is a different claim from a bucket of parse facts`)
for (const [b, m] of [...confByBucket.entries()].sort()) console.log(`  ${w(b, 18)}${[...m.entries()].sort((a, b2) => b2[1] - a[1]).map(([c, n]) => `${c}×${n}`).join("  ")}`)

console.log(`\nTHE ${EXAMPLES} WORST NAMES BY EDGES ARRIVING AT A NAME WITH CANDIDATES`)
const worst = [...noteFreq.entries()].sort((a, b) => b[1].edges - a[1].edges)
for (const [name, x] of worst.slice(0, EXAMPLES)) console.log(`  ${w(name, 24)}${w(x.bucket, 16)}${w(x.edges, 7)}edges  ${x.note}`)

for (const b of ["ABSENT", "NOT_BOUND", "A_SCOPE", "C_NAME_CONTRACT", "QNAME_ALIAS"] as Bucket[]) {
  if (samples[b].length === 0) continue
  console.log(`\nSAMPLE EDGES — ${b} (${samples[b].length} collected)`)
  for (const r of samples[b].slice(0, EXAMPLES)) console.log(`  ${w(r.t, 13)}${r.file}:${r.line}  ${r.src} -> ${r.tgt}`)
}

if (JSON_OUT) {
  const sideJson = (side: Record<string, Side>) => Object.fromEntries(ALL_TYPES.map((t) => [t, {
    edges: side[t].edges, emptyEndpoints: side[t].empty,
    unresBare: side[t].edges - side[t].bareRes - side[t].self - side[t].empty,
    unresStore: side[t].edges - side[t].storeRes - side[t].self - side[t].empty,
    selfLoops: side[t].self, ambiguous: side[t].ambEdges,
    buckets: side[t].buckets, names: Object.fromEntries(BUCKETS.map((b) => [b, side[t].names[b].size])),
  }]))
  fs.writeFileSync(JSON_OUT, JSON.stringify({
    inDir: IN_DIR, shards: files, files: filesSeen.size, declarations, edges: edges.length,
    distinctNames: declsByName.size, namesWithMultipleDeclarations: [...declsByName.values()].filter((d) => d.length > 1).length,
    fired: fired.length, targetSide: sideJson(tgtSide), sourceSide: sideJson(srcSide),
    phantomDeclarations: phantoms.length,
    phantomByWhy: Object.fromEntries(phantomByWhy), unreadableDecls, linesRead: lineReads, linesBound: lineReadsOk,
    phantomEvidence: PHANTOMS_OUT ?? null,
    phantomByKind: Object.fromEntries([...phantomByKind.entries()].sort((a, b) => b[1] - a[1])),
    phantomKindByWhy: Object.fromEntries([...new Set(phantoms.map((x) => x.d.kind))].sort().map((k) => [k, Object.fromEntries(["ABSENT", "NOT_BOUND"].map((why) => [why, phantoms.filter((x) => x.d.kind === k && x.why === why).length]))])),
    phantomByName: Object.fromEntries([...phantomByName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200)),
    kindPairs: Object.fromEntries([...kindPairs.entries()].sort((a, b) => b[1] - a[1])),
    declCountHistogram: Object.fromEntries(hist),
    worst: worst.slice(0, 200).map(([name, x]) => ({ name, ...x })),
  }, null, 2))
  console.log(`\nJSON written: ${JSON_OUT}`)
}