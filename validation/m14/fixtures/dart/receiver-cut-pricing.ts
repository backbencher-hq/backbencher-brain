/**
 * PRICE LEVER 3 — the bare-member rows whose receiver the run never typed.
 *
 * WHAT LEVER 3 IS, as the gate's own marker table states it at HEAD (arm13, 2026-10-12):
 *
 *   calls  { receiverCause }                 216,573 ambiguous of 416,322 rows
 *   uses   { isMemberRead, receiverCause }   231,130 ambiguous of 280,491 rows
 *   uses   { isInterpolationRead }            72,390 ambiguous
 *   uses   { isBareRead, qualifier }          27,531 ambiguous  (Lever 1, not this)
 *   uses   { isGlobalRead }                   22,125 ambiguous  (Lever 4, not this)
 *
 * The first two rows are this instrument's population: edges the analyzer left spelled as a BARE
 * member name and labelled with the reason its receiver could not be qualified. The label's VALUE
 * is produced inside `qualifiedTarget` (src/ast/real-dart-analyzer.ts) at the branch that decides,
 * so there is no second copy of the qualification rule to drift from this pricing:
 *
 *   receiverUnnamed           the head has no plain name text: a call result, an index expression,
 *                             a cascade, a chain LINK, or a bare callee with no receiver at all
 *   receiverTypeUnknown       a lowercase head — a VALUE whose declared type the run did not
 *                             resolve: the receiver-typing gap
 *   receiverMemberOutsideRun  the type is visible and does not declare the member (the DECLARING
 *                             type — a superclass, a mixin — is outside the run)
 *   libraryScopeCallee        the bare name is a library-scope declaration of this file: not a
 *                             receiver question at all
 *
 * WHAT THE PRICE IS. Not "how many are ambiguous" — that is the gate's column — but: **of the bare
 * rows, how many have a receiver whose declared type the run could NAME, and of those, how many
 * declare the member so a spelling would BIND?** The evidence tiers, each read off the file:
 *
 *   TYPE NAMED, MEMBER IN FILE   the head's declaration in the same file carries a type (an
 *                                annotation, a constructor initializer, a cast) and the type's own
 *                                members in this file carry the member → binds with NO index.
 *   TYPE NAMED, MEMBER NOT SEEN  the type name is recoverable; the member is not among that type's
 *                                members in this file → the pass names the type; binding is then an
 *                                INDEX question, reported separately and never merged in.
 *   NO TYPE AT THE SITE          nothing in the file names the head's type (an untyped `var`, a
 *                                `dynamic`) → no spelling reaches it.
 *
 * THE HEAD IS READ OFF THE SITE LINE, and that is the instrument's stated weakness: the analyzer's
 * edge carries the ENCLOSING symbol as `source`, not the receiver text, so this re-reads the line
 * the edge came from (`line_number` is the leaf's line) and walks back over the receiver expression.
 * For a line holding several member reads the extraction can pick the wrong one, which is why
 * `--dump` prints the line, the head it read, the recovered type AND the matched declaration: read
 * them; the extraction is a measurement, not an assumption.
 *
 * Run:
 *   npx tsx validation/m14/fixtures/dart/receiver-cut-pricing.ts --sample=1500
 *   npx tsx validation/m14/fixtures/dart/receiver-cut-pricing.ts --all
 *   npx tsx validation/m14/fixtures/dart/receiver-cut-pricing.ts --sample=200 --dump=100
 *
 * A stride sample measures a SHARE of the analyzer's own labels (a per-site fact) and is labelled as
 * such; it does NOT state a resolution rate, which the gate's own header says a stride cannot
 * answer. The population is the gate's — tracked, present, `.dart`, <= 1 MB — walked from the same
 * corpus root, and it is PRINTED on every run so the two can be compared.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024

const argv = process.argv.slice(2)
const ALL = argv.includes("--all")
const sampleArg = argv.find((a) => a.startsWith("--sample="))
const SAMPLE = sampleArg ? Number(sampleArg.slice("--sample=".length)) : 1500
const dumpArg = argv.find((a) => a.startsWith("--dump="))
const DUMP = dumpArg ? Number(dumpArg.slice("--dump=".length)) : 25
const only = argv.find((a) => a.startsWith("--repo="))?.slice("--repo=".length).split(",")

const ID = /^[a-z_$][A-Za-z0-9_$]*$/i

// ---------------------------------------------------------------------------------------------
// THE READERS — their own functions so the CONTROLS call the rules the corpus walk calls.
// ---------------------------------------------------------------------------------------------

/** Comments and string literals replaced by spaces (newlines kept) — a `// final Foo bar` must not
 *  read as a declaration and `'Foo.x'` must not either. Deliberately simple; its limits are why the
 *  dump rows are read by eye. */
export function blankLiterals(src: string): string {
  let out = ""
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") { out += " "; i++ } continue }
    if (c === "/" && src[i + 1] === "*") {
      let depth = 1; out += "  "; i += 2
      while (i < src.length && depth > 0) {
        if (src[i] === "/" && src[i + 1] === "*") { depth++; out += "  "; i += 2; continue }
        if (src[i] === "*" && src[i + 1] === "/") { depth--; out += "  "; i += 2; continue }
        out += src[i] === "\n" ? "\n" : " "; i++
      }
      continue
    }
    if (c === "'" || c === '"') {
      const triple = src[i + 1] === c && src[i + 2] === c
      const q = src[i]; const eaten = triple ? 3 : 1; out += " ".repeat(eaten); i += eaten
      while (i < src.length) {
        if (src[i] === "\\") { out += "  "; i += 2; continue }
        if (triple && src[i] === q && src[i + 1] === q && src[i + 2] === q) { out += "   "; i += 3; break }
        if (!triple && src[i] === q) { out += " "; i++; break }
        out += src[i] === "\n" ? "\n" : " "; i++
      }
      continue
    }
    out += c; i++
  }
  return out
}

export type Site = { head: string | null; shape: string; receiver: string }

/** The receiver expression before the member's LAST dot on this line, and its shape. Walks back
 *  over the receiver through one level of `()`/`[]` so `xs[0].v`, `f().v` and `w..v` are classified
 *  by SHAPE rather than by a guessed identifier. A member with no receiver on the line is
 *  `bareCallee` (a top-level call or read), which is a different question from a receiver. */
export function readSite(line: string, member: string): Site {
  const esc = member.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`\\.\\s*${esc}\\b`, "g")
  let idx = -1
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) idx = m.index
  if (idx >= 0) {
    let i = idx - 1
    if (i >= 0 && (line[i] === "?" || line[i] === "!")) i--
    if (i >= 0 && line[i] === ".") return { head: null, shape: "cascade", receiver: ".." }
    let start = i
    let depth = 0
    while (start >= 0) {
      const c = line[start]
      if (c === ")" || c === "]") { depth++; start--; continue }
      if (c === "(" || c === "[") { if (depth === 0) break; depth--; start--; continue }
      if (depth > 0) { start--; continue }
      if (/[A-Za-z0-9_$.?]/.test(c)) { start--; continue }
      break
    }
    const recv = line.slice(start + 1, i + 1).trim()
    if (recv) {
      if (recv.endsWith(")")) return { head: null, shape: "callResult", receiver: recv }
      if (recv.endsWith("]")) return { head: null, shape: "index", receiver: recv }
      const last = recv.split(".").pop() ?? ""
      if (last === "this") return { head: "this", shape: "this", receiver: recv }
      if (last === "super") return { head: "super", shape: "super", receiver: recv }
      if (!ID.test(last)) return { head: null, shape: "notPlain", receiver: recv }
      return { head: last, shape: recv.includes(".") ? "chained" : "plain", receiver: recv }
    }
  }
  // No receiver written. Is the member on the line at all as a bare call/read?
  const bare = new RegExp(`(?:^|[^A-Za-z0-9_$.])${esc}\\s*\\(`)
  if (bare.test(line)) return { head: null, shape: "bareCallee", receiver: "" }
  return { head: null, shape: "notOnLine", receiver: "" }
}

export type Recovered = {
  type: string | null
  how: string
  evidence: string
  /** 1-based line of the matched declaration, when the index has one. */
  line?: number
  /** How many declaration-shaped matches this head has in the file. */
  decls?: number
  /** EVERY declaration of this head, in file order — see `buildDeclIndex`. Present only on the
   *  entry the index returns, and only when the head is declared more than once or was carried
   *  forward by a later `put`. */
  all?: Recovered[]
}

/** THE DECLARATION INDEX FOR ONE FILE — built in ONE pass, because a per-row scan of the whole
 *  blanked source was the instrument's own cost (the first 1,500-file run spent its whole window
 *  re-scanning megabytes per row and was killed before printing). Rules, in order:
 *
 *   annotation  `Type head` / `Type? head` / `final Type head` / `late Type head` / `Type<...> head`
 *   ctor        `head = Type(` / `head = new Type(` / `head = const Type(`
 *   cast        `head = <expr> as Type`
 *
 *  `var head = …` and `dynamic head` DECLINE by name (`var` is the dynamic spelling), and an
 *  annotation beats an initializer beats a cast. The matched declaration travels with the answer so
 *  the dump can be audited rather than believed.
 *
 *  EVERY declaration of a head is kept (`all`), not just the first, because a head name repeats —
 *  measured on a dump row: `expect(hover.elementKind, …)` was recovered as `HoverInformation` from a
 *  callback parameter `(HoverInformation hover)` in the SAME FILE while the site's own `hover` is
 *  `var hover = await prepareHover(…)`, an await result no type names. A first-match index cannot
 *  tell those apart and silently reports the collision as a success; keeping all declarations lets
 *  `pickDecl` choose the NEAREST PRECEDING one and lets the report count the collision class
 *  outright. */
export function buildDeclIndex(blank: string): Map<string, Recovered> {
  const out = new Map<string, Recovered>()
  const declared = new Map<string, number>()
  const put = (head: string, rec: Recovered): void => {
    declared.set(head, (declared.get(head) ?? 0) + 1)
    const cur = out.get(head)
    if (cur) {
      const all = cur.all ?? [cur]
      all.push(rec)
      cur.all = all
      if (cur.type) return
      out.set(head, { ...rec, all })
      return
    }
    out.set(head, rec)
  }
  let lineNo = 0
  for (const line of blank.split("\n")) {
    lineNo++
    for (const m of line.matchAll(/(?:^|[;{,(\s])(?:final|const|late|static)?\s*([A-Z][A-Za-z0-9_$]*)(?:<[^;()={}]*>)?\??\s+([a-z_$][A-Za-z0-9_$]*)\b/g)) {
      put(m[2], { type: m[1], how: "annotation", evidence: m[0].trim().slice(0, 90), line: lineNo })
    }
    for (const m of line.matchAll(/\b([a-z_$][A-Za-z0-9_$]*)\s*=\s*(?:new\s+|const\s+)?([A-Z][A-Za-z0-9_$]*)\s*(?:<|\(|;)/g)) {
      put(m[1], { type: m[2], how: "ctorInitializer", evidence: m[0].trim().slice(0, 90), line: lineNo })
    }
    for (const m of line.matchAll(/\b([a-z_$][A-Za-z0-9_$]*)\s*=\s*[^;]*?\bas\s+([A-Z][A-Za-z0-9_$]*)/g)) {
      put(m[1], { type: m[2], how: "cast", evidence: m[0].trim().slice(0, 90), line: lineNo })
    }
    for (const m of line.matchAll(/\b(?:var|dynamic)\s+([a-z_$][A-Za-z0-9_$]*)\b/g)) {
      put(m[1], { type: null, how: "declinedUntyped", evidence: m[0].trim().slice(0, 90), line: lineNo })
    }
  }
  for (const [head, n] of declared) { const e = out.get(head); if (e) e.decls = n }
  return out
}

/** THE DECLARATION THIS SITE'S HEAD MOST LIKELY IS: the last one written BEFORE the site, else the
 *  first. Line order is NOT scope — a name declared in an earlier function and one declared in this
 *  one are indistinguishable here — which is why the report also prints the row counts where the
 *  file declares the head EXACTLY ONCE (no choice to get wrong) and where a typed declaration of
 *  the same name exists but the nearest one is untyped (a measured collision). */
export function pickDecl(rec: Recovered | undefined, siteLine: number | undefined): Recovered {
  const none: Recovered = { type: null, how: "noDeclaration", evidence: "" }
  if (!rec) return none
  const all = (rec.all ?? [rec]).slice()
  if (siteLine === undefined || siteLine <= 0) return all[0] ?? none
  const before = all.filter((e) => (e.line ?? 0) > 0 && (e.line ?? 0) < siteLine)
  if (before.length > 0) return before.reduce((a, b) => ((b.line ?? 0) > (a.line ?? 0) ? b : a))
  const after = all.filter((e) => (e.line ?? 0) >= siteLine)
  return (after[0] ?? all[0]) ?? none
}

/** The declared TYPE of one value, read through the file's index. The 2-argument form keeps the
 *  FIRST declaration (the controls' rule); the report passes the site's line and gets the nearest
 *  preceding one. Kept as a function so the CONTROLS call the same rule the corpus walk calls. */
export function recoverType(text: string, head: string, siteLine?: number): Recovered {
  const built = buildDeclIndex(text)
  const rec = built.get(head)
  return rec ? pickDecl(rec, siteLine) : { type: null, how: "noDeclaration", evidence: "" }
}

// ---------------------------------------------------------------------------------------------
// CONTROLS — the readers must reach every class, or a spotless corpus would look the same.
// ---------------------------------------------------------------------------------------------
const failures: string[] = []
function expect(label: string, got: string, want: string): void {
  if (got !== want) failures.push(`control: ${label} -> ${got}, expected ${want}`)
}
{
  const r = (src: string, head: string) => { const x = recoverType(blankLiterals(src), head); return `${x.type}/${x.how}` }
  expect("annotation `final Foo ext`", r("class A { final Foo ext; }", "ext"), "Foo/annotation")
  expect("ctor initializer `ext = Bar()`", r("late x; ext = Bar();", "ext"), "Bar/ctorInitializer")
  expect("cast `ext = y as Baz`", r("ext = y as Baz;", "ext"), "Baz/cast")
  expect("untyped `var ext`", r("var ext = 3;", "ext"), "null/declinedUntyped")
  expect("a COMMENTED annotation is not a declaration", r("// final Foo ext;", "ext"), "null/noDeclaration")
  expect("a STRING 'Foo ext' is not a declaration", r("print('Foo ext');", "ext"), "null/noDeclaration")
  const s = (line: string, member: string) => { const x = readSite(line, member); return `${x.head}/${x.shape}` }
  expect("head of `ext.frob`", s("    return ext.frob(1);", "frob"), "ext/plain")
  expect("call-result receiver", s("  final v = makeThing().value;", "value"), "null/callResult")
  expect("index receiver", s("  final v = xs[0].value;", "value"), "null/index")
  expect("cascade receiver", s("  widget..name = 'x';", "name"), "null/cascade")
  expect("chain link receiver", s("  f(profile.requestData.bodyBytes);", "bodyBytes"), "requestData/chained")
  expect("bare callee (no receiver)", s("    group('x', () {});", "group"), "null/bareCallee")
  {
    const src = "var hover = await f();\nfinal int n = 1;\nvoid g(HoverInformation hover) { expect(hover.elementKind); }\n"
    const b = blankLiterals(src)
    const at = (head: string, line: number) => { const x = recoverType(b, head, line); return `${x.type}/${x.how}/${x.line}` }
    expect("nearest preceding declaration wins over the first", at("hover", 3), "null/declinedUntyped/1")
    expect("the same head at its own site is the annotated one", at("hover", 4), "HoverInformation/annotation/3")
    expect("a declaration AFTER the site is still used when none precedes", at("hover", 1), "null/declinedUntyped/1")
    const idx = buildDeclIndex(b)
    const all = idx.get("hover")?.all ?? []
    expect("every declaration of a head is kept", String(idx.get("hover")?.decls), "2")
    expect("the declaration list is complete", String(all.length), "2")
  }
  if (failures.length > 0) {
    console.error("PRICING SELF-TEST FAILED — the readers are not measuring what they claim:")
    for (const f of failures) console.error(`  ${f}`)
    process.exit(3)
  }
}
console.log("pricing self-test: PASS (each recovery class and each site shape reached)")

// ---------------------------------------------------------------------------------------------
// THE WALK — the gate's population.
// ---------------------------------------------------------------------------------------------
function repos(): string[] {
  const out: string[] = []
  let names: string[]
  try { names = readdirSync(CR) } catch { return out }
  for (const name of names.sort()) {
    if (only && !only.includes(name)) continue
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    out.push(name)
  }
  return out
}

function admit(dir: string): string[] {
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { return [] }
  const files: string[] = []
  for (const rel of tracked) {
    const base = rel.slice(rel.lastIndexOf("/") + 1).toLowerCase()
    if (!rel.toLowerCase().endsWith(".dart") && !(base === "dart" && detectLanguageFromPath(rel) === "dart")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    files.push(abs)
  }
  return files
}

const repoList = repos()
const allFiles: string[] = []
for (const r of repoList) allFiles.push(...admit(path.join(CR, r)))
allFiles.sort()
const stride = ALL ? 1 : Math.max(1, Math.floor(allFiles.length / SAMPLE))
const picked: string[] = []
for (let i = 0; i < allFiles.length && (ALL || picked.length < SAMPLE); i += stride) picked.push(allFiles[i])
console.log(`population: ${allFiles.length} admitted .dart files by the gate's rule, across ${repoList.length} repo(s)`)
console.log(`sample: ${picked.length} file(s) (stride ${stride}${ALL ? ", whole population" : ""})`)

type Row = { file: string; project: string; line: number; type: string; cause: string; target: string; member: string }
type FileIndex = { types: Set<string>; members: Set<string> }
const rows: Row[] = []
const index = new Map<string, FileIndex>()
let interpolationRows = 0
let parseFailed = 0
let degraded = 0

for (const f of picked) {
  const repo = repoList.find((r) => f.startsWith(path.join(CR, r) + path.sep)) ?? ""
  const root = path.join(CR, repo)
  let out: any
  try { out = await parseFile(f, root, { projectRoot: root } as any) } catch { parseFailed++; continue }
  if (out?.fallback === true || out?.metadata?.analysisVersion === "2.0-basic-fallback") degraded++
  const fi: FileIndex = index.get(f) ?? { types: new Set(), members: new Set() }
  for (const s of (out?.symbols ?? []) as any[]) {
    if (!s?.name) continue
    if (["class", "mixin", "enum", "extension", "extension type"].includes(String(s.kind ?? ""))) fi.types.add(String(s.name))
    if (s.ownerName) fi.members.add(`${s.ownerName}.${s.name}`)
  }
  index.set(f, fi)
  for (const rel of (out?.relationships ?? []) as any[]) {
    const md = rel.metadata ?? {}
    if (md.isInterpolationRead) interpolationRows++
    const cause = md.receiverCause
    if (!cause) continue
    const target = String(rel.target ?? "")
    rows.push({
      file: f, project: repo, line: Number(rel.line_number ?? 0), type: String(rel.type ?? ""),
      cause: String(cause), target, member: target.includes(".") ? target.slice(target.lastIndexOf(".") + 1) : target,
    })
  }
}
console.log(`parsed ${picked.length} file(s): ${parseFailed} parse failure(s), ${degraded} degraded (regex fallback)`)

// ---------------------------------------------------------------------------------------------
// THE REPORT.
// ---------------------------------------------------------------------------------------------
const byCauseType = new Map<string, number>()
for (const r of rows) {
  const k = `${r.type} · ${r.cause}`
  byCauseType.set(k, (byCauseType.get(k) ?? 0) + 1)
}
console.log(`\nBARE ROWS (metadata.receiverCause): ${rows.length} in the sample — by edge type and cause:`)
for (const [k, n] of [...byCauseType.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(46)} ${String(n).padStart(7)}  ${((n / rows.length) * 100).toFixed(1)}%`)
}
console.log(`\ninterpolation reads in the same sample: ${interpolationRows} row(s)`)

type Class = {
  n: number
  shapes: Map<string, number>
  plainN: number
  typed: number
  typedUnique: number
  typedCollision: number
  typedNearestUntyped: number
  typedPreceding: number
  typedFormParamList: number
  typedFormStatement: number
  typedFormOther: number
  boundInFile: number
  memberNotSeen: number
  typeNotDeclaredInFile: number
  declinedUntyped: number
  noDecl: number
  chainFirstLinkTyped: number
}
const perCause = new Map<string, Class>()
const newClass = (): Class => ({
  n: 0, shapes: new Map(), plainN: 0, typed: 0, typedUnique: 0, typedCollision: 0, typedNearestUntyped: 0, typedPreceding: 0, typedFormParamList: 0,
  typedFormStatement: 0, typedFormOther: 0, boundInFile: 0, memberNotSeen: 0,
  typeNotDeclaredInFile: 0, declinedUntyped: 0, noDecl: 0, chainFirstLinkTyped: 0,
})
const dumps: string[] = []
let dumped = 0
// Blanked text and its lines are read ONCE per file: the per-row scan is the report's cost, and
// re-blanking a 1 MB source for every row in it was the whole of the first run's ten minutes.
const blankedCache = new Map<string, string[]>()
const declCache = new Map<string, Map<string, Recovered>>()
/** The file's declaration index, built ONCE (see `buildDeclIndex`): the report's per-row work is
 *  then a Map lookup, and the first 1,500-file attempt — which re-scanned the whole source per row
 *  — is the reason this exists. */
const declOf = (file: string, lines: string[]): Map<string, Recovered> => {
  const hit = declCache.get(file)
  if (hit) return hit
  const built = buildDeclIndex(lines.join("\n"))
  declCache.set(file, built)
  return built
}
const blankOf = (file: string): string[] | null => {
  const hit = blankedCache.get(file)
  if (hit) return hit
  try {
    const lines = blankLiterals(readFileSync(file, "utf8")).split("\n")
    blankedCache.set(file, lines)
    return lines
  } catch { return null }
}

for (const r of rows) {
  if (r.line <= 0) continue
  const blankLines = blankOf(r.file)
  if (!blankLines) continue
  const decls = declOf(r.file, blankLines)
  const lineText = blankLines[r.line - 1] ?? ""
  const site = readSite(lineText, r.member)
  const c = perCause.get(r.cause) ?? newClass()
  c.n++
  c.shapes.set(site.shape, (c.shapes.get(site.shape) ?? 0) + 1)
  let rec: Recovered = { type: null, how: "notPlain", evidence: "" }
  if (site.shape === "plain" && site.head) {
    c.plainN++
    const entry = decls.get(site.head)
    rec = pickDecl(entry, r.line)
    const all = entry?.all ?? (entry ? [entry] : [])
    const typedAnywhere = all.some((e) => e.type !== null)
    if (rec.type) {
      c.typed++
      const dl = rec.line ?? 0
      if (dl > 0 && dl < r.line) c.typedPreceding++
      const ev = rec.evidence.trim()
      if (ev.startsWith("(")) c.typedFormParamList++
      else if (ev.startsWith("final") || ev.startsWith("late") || ev.startsWith("const") || ev.startsWith("static") || /^[A-Za-z]/.test(ev)) c.typedFormStatement++
      else c.typedFormOther++
      if ((entry?.decls ?? 1) === 1) c.typedUnique++
      else c.typedCollision++
      const fi = index.get(r.file)
      if (fi?.members.has(`${rec.type}.${r.member}`)) c.boundInFile++
      else if (fi?.types.has(rec.type)) c.memberNotSeen++
      else c.typeNotDeclaredInFile++
    } else if (typedAnywhere) {
      // a typed declaration of this head exists in the file, but it is not the one this site sees
      c.typedNearestUntyped++
    } else if (rec.how === "declinedUntyped") c.declinedUntyped++
    else c.noDecl++
  }
  if (site.shape === "chained" && site.receiver) {
    const first = site.receiver.split(".")[0]
    if (first && ID.test(first)) {
      const fr = decls.get(first)
      if (fr?.type) c.chainFirstLinkTyped++
    }
  }
  perCause.set(r.cause, c)
  {
    const ev = rec.type || rec.how !== "notPlain" ? `${rec.type ?? "none"} (${rec.how})${rec.evidence ? ` via \`${rec.evidence}\`` : ""}` : "n/a"
    dumps.push(`${r.cause}  ${r.type}  ${path.relative(CR, r.file)}:${r.line}  member=${r.member}  shape=${site.shape}  recv=${site.receiver || "-"}  type=${ev}\n      | ${lineText.trim().slice(0, 140)}`)
  }
}

const pct = (x: number, n: number) => `${((x / Math.max(1, n)) * 100).toFixed(1)}%`
console.log(`\nA TYPED-RECEIVER PASS, measured per cause (sample rows with a readable line):`)
for (const [cause, c] of [...perCause.entries()].sort((a, b) => b[1].n - a[1].n)) {
  const shapeStr = [...c.shapes.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ")
  console.log(`  ${cause}`)
  console.log(`      rows ${c.n} (${pct(c.n, rows.length)} of bare) · shapes: ${shapeStr}`)
  if (c.plainN > 0) {
    console.log(`      plain lowercase head: ${c.plainN} · type NAMED in file ${c.typed} (${pct(c.typed, c.n)}) · of those the head is declared EXACTLY ONCE ${c.typedUnique} (${pct(c.typedUnique, c.n)}) · declaration PRECEDES the site ${c.typedPreceding} (${pct(c.typedPreceding, c.typed)} of typed) · member on it IN FILE ${c.boundInFile} (${pct(c.boundInFile, c.n)}) · type in file/member not ${c.memberNotSeen} · type NOT in file ${c.typeNotDeclaredInFile}`)
    console.log(`      the namable types sit in: a parameter list ${c.typedFormParamList} (${pct(c.typedFormParamList, c.typed)} of typed) · a statement declaration ${c.typedFormStatement} (${pct(c.typedFormStatement, c.typed)}) · other ${c.typedFormOther}`)
  }
  console.log(`      declines: untyped var/final ${c.declinedUntyped} · no declaration found ${c.noDecl}${c.typedNearestUntyped ? ` · NEAREST DECLARATION UNTYPED while a typed same-name one exists ${c.typedNearestUntyped} (${pct(c.typedNearestUntyped, c.n)} — the collision class, and the reason the number below is an upper bound)` : ""}${c.chainFirstLinkTyped ? ` · chained rows whose FIRST link has an in-file type ${c.chainFirstLinkTyped}` : ""}`)
    if (c.typed > 0) console.log(`      of the ${c.typed} recovered: head declared EXACTLY ONCE ${c.typedUnique} (${pct(c.typedUnique, c.typed)} of recovered) · more than once ${c.typedCollision} (${pct(c.typedCollision, c.typed)} — which declaration it is cannot be decided from the file alone)`)
}
if (dumps.length > 0) {
  const step = Math.max(1, Math.floor(dumps.length / DUMP))
  const shown: string[] = []
  for (let i = 0; i < dumps.length && shown.length < DUMP; i += step) shown.push(dumps[i])
  console.log(`\nDUMP — ${shown.length} of ${dumps.length} candidate row(s), spread evenly (type= shows what matched):`)
  for (const d of shown) console.log(`  ${d}`)
}
console.log(`\nScope: a SHARE of the analyzer's own labels over ${picked.length} of ${allFiles.length} file(s).`)
console.log(`It does NOT state a resolution rate: the gate's header says a stride sample cannot answer one.`)
