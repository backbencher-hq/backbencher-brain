/**
 * GO ENDPOINT RESOLUTION — does an emitted edge name real symbols at BOTH ends?
 *
 * ## Why this file exists, and why file-scope resolution is the wrong question
 *
 * `go-ontology-census.ts` measures resolution at FILE scope and the numbers are
 * low by construction: on shard 0 of go-stdlib, `calls` resolved at both ends
 * 29.8% of the time and `uses` 44.7%. That is not a defect rate. A Go call edge
 * whose target is `strings.ToUpper` names a real exported function of a real
 * stdlib package, and the file that CALLS it declares nothing of the sort. A
 * file-scope test convicts every cross-package reference in the language, which
 * is the same instrument error `validation/m60/target-spelling-register.json`
 * records for two earlier runs ("the first two runs convicting 154 `Null` and
 * 22 `Unknown`/`Anonymous` values were all real members of powershell and
 * fsharp").
 *
 * So the question is not "does the name appear in this file" but "does the name
 * bind to a declaration SOMEWHERE THE PROJECT CAN SEE", and Go's scopes are a
 * LADDER. This instrument walks it in the order Go itself resolves, and reports
 * where each endpoint lands:
 *
 *   S1 declared-in-this-file   a package-scope declaration in the same file
 *   S2 written-in-this-file    any identifier the file writes (a parameter, a
 *                              local, a struct field read) - the file's real
 *                              lexical universe, which the analyzer's SYMBOL
 *                              table deliberately does not contain
 *   S3 declared-in-this-package  any file in the same DIRECTORY declares it.
 *                              Go's package scope spans files, and a per-file
 *                              analyzer cannot see that
 *   S4 declared-in-an-imported-package  an import THIS file writes resolves to
 *                              a package that declares it
 *   S5 declared-somewhere-in-corpus  some other package in the corpus declares
 *                              it - real, but NOT reachable from this file
 *                              without an import, so it is a weaker positive
 *   U  unresolved              no scope in the corpus binds it. This is the only
 *                              bucket that is a finding
 *
 * `imports` is scored differently and the difference is stated rather than
 * smoothed: its target is a MODULE PATH, not a name, so the question is whether
 * the path names a package the corpus contains. `overrides` is scored on BOTH
 * halves of `Receiver.Method`, because a dotted endpoint can never match a
 * single-identifier symbol table and reporting 0% resolution for a type whose
 * endpoints resolve perfectly is the instrument being wrong.
 *
 * ## WHAT IT DOES AND DOES NOT ESTABLISH
 *
 * It establishes that emitted endpoints bind to declarations that exist, at a
 * measured rate per type, with the scope named. It does NOT establish that the
 * index binds them: `brain_relationship.source_symbol_id` / `target_symbol_id`
 * are assigned by the indexer, which is a separate component, and this pass
 * never opens a database. The gap between "the name is declared" and "the row
 * carries the id" is the indexer's to answer.
 *
 * ## NO REGEX
 *
 * Zero regular expressions, by the lane's standing rule. Every string predicate
 * is a char scan and the tree is walked through node/cursor APIs only.
 *
 * ## USAGE
 *   npx tsx script/m14/go-endpoint-resolution.ts --out resolved.json [--files=N] [--repo=a,b]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1]
  const j = process.argv.find((a) => a.startsWith(`${flag}=`))
  return j ? j.slice(flag.length + 1) : dflt
}
const REPOS = (argOf("--repo", "go-stdlib") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const OUT = argOf("--out")
/** How many FILES to score. The corpus INDEX is always complete; only the
 *  per-file draw is a sample, and the sample size is reported so the rate is
 *  never quoted without its denominator. 1,500 files over 11,789 is 12.7%. */
const WANT = Number(argOf("--files", "1500"))
const MAX_BYTES = 512 * 1024
const SKIP = new Set((process.env.BB_GO_SKIP ?? "").split(",").map((s) => s.trim()).filter(Boolean))

// ── no-regex string helpers ─────────────────────────────────────────────────
const isAllDigits = (s: string): boolean => {
  if (s.length === 0) return false
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c < 48 || c > 57) return false }
  return true
}
const stripPrefix = (s: string, p: string): string => (s.startsWith(p) ? s.slice(p.length) : s)
const isAllDigitsOrUnderscoreOrStar = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c === 95 || c === 42) continue; if (c < 48 || c > 57) return false }
  return s.length > 0
}

// ── corpus admission (tracked files only) ──────────────────────────────────
type File = { repo: string; dir: string; rel: string; abs: string; pkgDir: string }
const files: File[] = []
const revisions: Record<string, string> = {}
for (const e of REPOS) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { revisions[e] = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > MAX_BYTES) continue } catch { continue }
    if (SKIP.has(`${e}/${rel}`)) continue
    if (detectLanguageFromPath(abs) !== "go") continue
    files.push({ repo: e, dir, rel, abs, pkgDir: path.dirname(abs) })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : a.repo + "/" + b.rel > b.repo + "/" + b.rel ? 1 : 0))
// The draw is EVEN across the sorted corpus rather than the first N, because
// go-stdlib sorts by directory and the first N would be one subtree
// (`cmd/...`), which is the most interface-heavy part of the tree and would
// report a resolution rate for `cmd` and call it a corpus rate.
const stride = Math.max(1, Math.floor(files.length / WANT))
const draw: File[] = []
for (let i = 0; i < files.length && draw.length < WANT; i += stride) draw.push(files[i])
console.log(`go endpoint resolution — repos ${REPOS.join(",")}  admitted ${files.length}  drawn ${draw.length} (stride ${stride})`)

// ── the corpus index, built with web-tree-sitter only (no analyzer, no pool) ──
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-go.wasm"))))

function firstNamed(n: any, types: string[]): any {
  if (!n) return undefined
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && types.indexOf(c.type) !== -1) return c }
  return undefined
}
const stripQuoteEnds = (s: string): string => {
  let out = s
  if (out.length) { const f = out.charCodeAt(0); if (f === 34 || f === 96) out = out.slice(1) }
  if (out.length) { const l = out.charCodeAt(out.length - 1); if (l === 34 || l === 96) out = out.slice(0, out.length - 1) }
  return out
}
/** A package's IMPORT PATH from the corpus layout: go-stdlib keeps the module
 *  under `src/`, and a vendored copy's path has `vendor/` dropped by the
 *  compiler. Both spellings are registered. */
function importPathKeys(rel: string): string[] {
  const keys: string[] = []
  const push = (r: string) => { const i = r.lastIndexOf("/"); if (i > 0) keys.push(r.slice(0, i)) }
  push(stripPrefix(rel, "src/"))
  if (rel.startsWith("vendor/")) push(stripPrefix(rel, "vendor/"))
  const i = rel.indexOf("/")
  if (i > 0 && rel.startsWith("vendor/", i + 1)) push(rel.slice(i + 1))
  return keys
}

type FileFacts = {
  declared: Set<string>
  written: Set<string>
  imports: Map<string, string>
}
const factsByAbs = new Map<string, FileFacts>()
/** package DIRECTORY -> names declared at its package scope */
const pkgNames = new Map<string, Set<string>>()
/** corpus IMPORT PATH -> names declared by the package at that path */
const pathNames = new Map<string, Set<string>>()
/** every declared name in the corpus, for the weakest positive scope */
const corpusNames = new Set<string>()

const IDENTITY_NODES = new Set(["identifier", "type_identifier", "field_identifier", "package_identifier", "label_name", "label"])

function factsFor(f: File, wantWritten: boolean): FileFacts | undefined {
  let text: string
  try { text = readFileSync(f.abs, "utf8") } catch { return undefined }
  const t = parser.parse(text)
  if (!t) return undefined
  const out: FileFacts = { declared: new Set(), written: new Set(), imports: new Map() }
  // Go's rule: a SourceFile's DIRECT named children are package scope.
  for (let i = 0; i < t.rootNode.namedChildCount; i++) {
    const d = t.rootNode.namedChild(i)
    if (!d) continue
    if (d.type === "function_declaration" || d.type === "method_declaration") {
      const nm = d.childForFieldName?.("name"); if (nm) out.declared.add(String(nm.text))
      continue
    }
    if (d.type === "type_declaration" || d.type === "type_alias") {
      for (let j = 0; j < d.namedChildCount; j++) {
        const ts = d.namedChild(j)
        if (!ts || (ts.type !== "type_spec" && ts.type !== "type_alias")) continue
        const nm = ts.childForFieldName?.("name"); if (nm) out.declared.add(String(nm.text))
      }
      continue
    }
    if (d.type === "const_declaration" || d.type === "var_declaration") {
      for (let j = 0; j < d.namedChildCount; j++) {
        const sp = d.namedChild(j)
        if (!sp || (sp.type !== "const_spec" && sp.type !== "var_spec")) continue
        for (let k = 0; k < sp.namedChildCount; k++) {
          const id = sp.namedChild(k)
          if (id && id.type === "identifier") out.declared.add(String(id.text))
        }
      }
    }
  }
  // Every identifier WRITTEN in the file, which is the honest file-scope
  // universe: a `uses` target can be a package-level `var` the analyzer's
  // symbol table drops, and a rule that only saw symbols would convict it.
  //
  // COLLECTED ONLY FOR DRAWN FILES, and that is a memory decision with a
  // number behind it: the identifier surface of go-stdlib is ~5.9M strings, and
  // retaining it for 11,789 files alongside a census that is already running on
  // the same box is how the first version of this instrument would have taken
  // the box down. `score()` only ever asks a file about ITS OWN identifiers, so
  // the corpus-wide pass needs nothing but the package-scope declarations.
  if (wantWritten) {
    const walk = (n: any) => {
      if (IDENTITY_NODES.has(n.type)) out.written.add(String(n.text ?? ""))
      if (n.type === "import_spec") {
        const p = stripQuoteEnds(String(n.childForFieldName?.("path")?.text ?? ""))
        if (p.length) out.imports.set(p, p)
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
    }
    walk(t.rootNode)
  }
  for (const n of out.declared) out.written.add(n)
  t.delete?.()
  if (wantWritten) factsByAbs.set(f.abs, out)
  const ps = pkgNames.get(f.pkgDir) ?? new Set<string>()
  for (const n of out.declared) { ps.add(n); corpusNames.add(n) }
  pkgNames.set(f.pkgDir, ps)
  for (const k of importPathKeys(f.rel)) {
    const ss = pathNames.get(k) ?? new Set<string>()
    for (const n of out.declared) ss.add(n)
    pathNames.set(k, ss)
  }
  return out
}

const drawnAbs = new Set(draw.map((f) => f.abs))
const t0 = Date.now()
// Pass 1: the corpus-wide index, declarations only.
for (const f of files) factsFor(f, drawnAbs.has(f.abs))
console.log(`index built: ${pkgNames.size} package dirs, ${pathNames.size} import paths, ${corpusNames.size} distinct declared names, ${Date.now() - t0} ms`)
// Pass 2: the drawn files' full identifier universe, from the already-parsed
// corpus walk rather than a second read of 11,789 files.
for (const f of draw) factsByAbs.get(f.abs) ?? factsFor(f, true)

// ── scoring ────────────────────────────────────────────────────────────────
type Scope = "S1-file-decl" | "S2-file-written" | "S3-package" | "S4-imported-package" | "S5-corpus-somewhere" | "U-unresolved"
const score = (value: string, facts: FileFacts, pkgDir: string, imports: Map<string, string>): Scope => {
  if (value.length === 0) return "U-unresolved"
  if (facts.declared.has(value)) return "S1-file-decl"
  if (facts.written.has(value)) return "S2-file-written"
  if (pkgNames.get(pkgDir)?.has(value)) return "S3-package"
  for (const ip of imports.keys()) {
    for (const key of [ip, stripPrefix(ip, "vendor/")]) if (pathNames.get(key)?.has(value)) return "S4-imported-package"
  }
  if (corpusNames.has(value)) return "S5-corpus-somewhere"
  return "U-unresolved"
}

type Row = {
  edges: number
  files: number
  source: Record<Scope, number>
  target: Record<Scope, number>
  /** both endpoints land in S1..S4, i.e. a scope THIS file can actually see */
  bothReachable: number
  /** neither endpoint is reachable from this file's scopes */
  neitherReachable: number
  unresolvedSamples: string[]
  /** `imports` only: does the target path name a package the corpus holds? */
  importPathInCorpus: number
  importPathExternal: number
  /** `overrides` only: each half of `Receiver.Method` resolved on its own */
  overrideReceiverResolved: number
  overrideMethodResolved: number
}
const rows = new Map<Type, Row>()
for (const t of ALL_TYPES) {
  rows.set(t, {
    edges: 0, files: 0,
    source: { "S1-file-decl": 0, "S2-file-written": 0, "S3-package": 0, "S4-imported-package": 0, "S5-corpus-somewhere": 0, "U-unresolved": 0 },
    target: { "S1-file-decl": 0, "S2-file-written": 0, "S3-package": 0, "S4-imported-package": 0, "S5-corpus-somewhere": 0, "U-unresolved": 0 },
    bothReachable: 0, neitherReachable: 0, unresolvedSamples: [],
    importPathInCorpus: 0, importPathExternal: 0, overrideReceiverResolved: 0, overrideMethodResolved: 0,
  })
}
let symbols = 0
let relationships = 0
const sampled: string[] = []
let idx = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= draw.length) return
    const f = draw[i]
    const facts = factsByAbs.get(f.abs)
    if (!facts) continue
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    symbols += (r?.symbols ?? []).length
    relationships += (r?.relationships ?? []).length
    const label = `${f.repo}/${f.rel}`
    const seenFiles = new Set<Type>()
    for (const x of r?.relationships ?? []) {
      const t = String(x.type ?? x.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      const row = rows.get(t)!
      row.edges++
      seenFiles.add(t)
      const src = String(x.source ?? "")
      const tgt = String(x.target ?? "")
      const ss = score(src, facts, f.pkgDir, facts.imports)
      const ts = t === "imports"
        ? (pathNames.has(tgt) || pathNames.has(stripPrefix(tgt, "vendor/")) ? "S4-imported-package" : "U-unresolved")
        : score(tgt, facts, f.pkgDir, facts.imports)
      row.source[ss]++
      row.target[ts]++
      if (t === "imports") {
        if (ts === "S4-imported-package") row.importPathInCorpus++
        else row.importPathExternal++
      }
      if (t === "overrides") {
        // `Receiver.Method` can never match a single-identifier table, so score
        // the halves separately or report a type as 0% resolved that is not.
        const d = tgt.lastIndexOf(".")
        if (d > 0) {
          const recv = tgt.slice(0, d), meth = tgt.slice(d + 1)
          if (score(recv, facts, f.pkgDir, facts.imports) !== "U-unresolved") row.overrideReceiverResolved++
          const mset = pkgNames.get(f.pkgDir)
          let found = false
          for (const [, names] of pkgNames) if (names.has(meth)) { found = true; break }
          if (found) row.overrideMethodResolved++
          void mset
        }
      }
      const reach = (s: Scope) => s !== "U-unresolved" && s !== "S5-corpus-somewhere"
      if (reach(ss) && reach(ts)) row.bothReachable++
      else if (!reach(ss) && !reach(ts)) {
        row.neitherReachable++
        if (row.unresolvedSamples.length < 8) row.unresolvedSamples.push(`${label} ${JSON.stringify(src)} -> ${JSON.stringify(tgt)} src=${ss} tgt=${ts}`)
      }
      if (sampled.length < 4000) sampled.push(`${t}\t${src}\t${tgt}\t${label}`)
    }
    for (const tt of seenFiles) rows.get(tt)!.files++
  }
}
await Promise.all(Array.from({ length: Number(process.env.BB_GO_RESOLVE_WORKERS ?? "3") }, () => worker()))

const report = {
  schema: "go-endpoint-resolution/1",
  repos: REPOS,
  revisions,
  corpusAdmitted: files.length,
  filesDrawn: draw.length,
  drawStride: stride,
  drawRule: "even stride across the sorted tracked corpus, so the sample is not one subtree",
  skippedForParseBudget: [...SKIP].sort(),
  symbols,
  relationships,
  packageDirsIndexed: pkgNames.size,
  importPathsIndexed: pathNames.size,
  distinctDeclaredNames: corpusNames.size,
  wallMs: Date.now() - t0,
  rows: Object.fromEntries([...rows.entries()].map(([k, v]) => [k, v])),
}
console.log(`\nparseFile: ${draw.length} files, ${symbols.toLocaleString()} symbols, ${relationships.toLocaleString()} relationships`)
console.log(`\n${"type".padEnd(13)}${"edges".padStart(8)}${"bothReachable".padStart(15)}${"neitherReach".padStart(13)}   source scopes / target scopes`)
console.log("-".repeat(150))
for (const t of ALL_TYPES) {
  const r = rows.get(t)!
  const pct = r.edges === 0 ? "n/a" : `${((r.bothReachable / r.edges) * 100).toFixed(1)}%`
  const brief = (m: Record<Scope, number>) => `S1:${m["S1-file-decl"]} S2:${m["S2-file-written"]} S3:${m["S3-package"]} S4:${m["S4-imported-package"]} S5:${m["S5-corpus-somewhere"]} U:${m["U-unresolved"]}`
  console.log(`${t.padEnd(13)}${String(r.edges).padStart(8)}${pct.padStart(15)}${String(r.neitherReachable).padStart(13)}   src ${brief(r.source)}`)
  console.log(`${" ".repeat(13)}${" ".repeat(28)}   tgt ${brief(r.target)}`)
  if (t === "imports") console.log(`${" ".repeat(13)}   import path in corpus: ${r.importPathInCorpus}, external module: ${r.importPathExternal}`)
  if (t === "overrides") console.log(`${" ".repeat(13)}   half-scored: receiver resolved ${r.overrideReceiverResolved}, method name resolved ${r.overrideMethodResolved}`)
  if (r.unresolvedSamples.length) for (const u of r.unresolvedSamples.slice(0, 4)) console.log(`      unresolved: ${u}`)
}
if (OUT) { writeFileSync(OUT, JSON.stringify(report, null, 2)); console.log(`\nwrote ${OUT}`) }
process.exit(0)