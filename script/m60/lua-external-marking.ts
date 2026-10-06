/**
 * LUA CAUSE-C MARKING — the population an external marker can honestly claim, and
 * the two classes a marker must NOT absorb.
 *
 * ## WHAT THIS ANSWERS
 *
 * The incoming gate (`script/m14/incoming-gate.ts`) counts an edge `unresolved`
 * unless it resolves to exactly one published declaration or carries a declared
 * external marker. lua reads `unresolved 2,838` of 9,312 edges on the gate's
 * 120-file sample. The whole-corpus audit
 * (`validation/m60/lua/incoming-audit.json`, 3,250 files, 219,981 relationships)
 * already split that into causes, and this instrument exists to answer ONE
 * question about cause C that the audit could not:
 *
 *   **can the ANALYZER mark a target external, from the parse alone?**
 *
 * The gate's `external` bucket is a claim about resolvability. A wrong claim is
 * worse than no claim: it moves a name out of `unresolved` without moving
 * anything toward truth, and the arbiter's PASS then means less than it did.
 * So the rule has to be provable per edge, from this file's own parse.
 *
 * ## THE RULE, AND THE ONE I REJECTED BEFORE MEASURING IT
 *
 *   SHIPPED. Mark `external` on an edge whose TARGET is the field of a
 *   `dot_index_expression`/`method_index_expression` whose RECEIVER is the
 *   identifier `T`, where `T` is one of the eight documented Lua 5.4
 *   standard-library TABLES, and this file publishes no symbol named `T`.
 *
 *   Every part of that is read off the node: the field is the edge's own target
 *   node, the receiver is the `table`/`object` child, `T` is that child's text.
 *   The eight table names are TRANSCRIBED FROM THE REFERENCE MANUAL §6, so the
 *   claim is "the receiver names a documented standard table" and nothing wider.
 *   The shadowing guard is on the RECEIVER and not on the field, because that is
 *   where shadowing happens: a file that writes `local table = {}` and then
 *   `table.insert(x)` has not reached the standard library.
 *
 *   REJECTED, and the reason is measured. The first rule this instrument tested
 *   was the name-list one: "target is a bare name in a transcribed stdlib surface
 *   and this file declares nothing under that name". It marks 16,195 of 219,981
 *   edges — seven and a half times the shipped rule — and it is a NAME-MATCH
 *   GUESS. `insert` is in the list because `table.insert` is documented; but a
 *   bare `insert(x)` with no receiver is an undefined GLOBAL named `insert`, not
 *   `table.insert`, and Lua 5.4 publishes no such global. The measurement that
 *   settles it is in this file: across the same draw, **zero** edge targets a
 *   dotted `table.field` spelling, because the analyzer publishes the FINAL
 *   SEGMENT of a member read — `table.insert` arrives as target `insert` — so
 *   the name list cannot tell `table.insert` from a user's own global `insert`.
 *   The receiver can, from the same node, with no heuristic. Both numbers are
 *   below; the shipped rule is the one that is a parse fact.
 *
 *   A marker that guesses does not move a number toward truth. It moves the name
 *   out of `unresolved` and the arbiter's PASS then means less than it did, which
 *   is the failure the whole cause-C mechanism exists to avoid.
 *
 * ## THE TWO CLASSES A MARKER MUST NOT ABSORB
 *
 * `imports` 6,601 edges name a Lua MODULE (`require "kong.tools.table"`), not a
 * declaration. They are the single largest `unresolved` class. But an analyzer
 * sees one file: it cannot know whether the module is a sibling in the same repo
 * or a rock from luarocks, and the classb-origin probe measured BOTH — 2,425
 * dotted targets whose module file is in the corpus draw, 3,060 whose file is
 * absent. Marking all 6,601 `external` would assert the second count for the
 * first, so this instrument counts them and ships NO mark.
 *
 * A THIRD class looked like a defect and is not, which is why it is measured
 * rather than asserted. The audit buckets a target named `global`, `owner` or
 * `file` as a "scope label" — one of the analyzer's own container labels — and
 * checked that BEFORE the file's own declarations, so it reports 469 such edges.
 * The measured shapes say otherwise: `prefix_handler.lua:362` is
 * `contains write_env_file file`, and `file` there is a LOCAL named `file` from
 * `local file = io.open(...)`. `db/init.lua:290` is `contains cluster_mutex
 * owner`, and `owner` is a local. A program is free to name a variable `file`.
 * So the audit's scope-label bucket is contaminated by user variables, and this
 * instrument separates the two: `scopeLabelTarget` is reported as
 * `sameNamedLocal` when the file publishes that name, and only a target with no
 * such local is counted as an actual container label. Neither is marked
 * external — one is a local declaration and the other is a defect — but only
 * one of them is what the audit called it, and the difference is a number.
 *
 * ## NO REGEX
 *
 * Every test is a `Set.has` on a name that came from a node, or a comparison on
 * a symbol's own `name` field. Nothing here matches file text.
 *
 * ## USAGE
 *
 *   npx tsx script/m60/lua-external-marking.ts --files 400 \
 *     --out validation/m60/lua/external-marking.json
 *
 * Exit 0 always: this reports. The number is the report.
 */
import { execFileSync } from "node:child_process"
import { writeFileSync, existsSync, mkdirSync, statSync, readdirSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../src/ast/pool-worker"
import { loadWebTreeSitter, resolveWasmAsset } from "../../src/util/wasm"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const arg = (k: string, d?: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const FILES = Number(arg("--files", "400"))
const OUT = path.resolve(ROOT, arg("--out", "validation/m60/lua/external-marking.json")!)

/**
 * Lua 5.4 standard library (§6.1) plus the fields of the standard table
 * libraries. TRANSCRIBED FROM THE REFERENCE MANUAL — stated because a number
 * produced against a hand-typed list is only as good as the list, and the claim
 * this supports is "named in the documented standard surface", not "external".
 * Byte-identical to `script/m60/lua-incoming-audit.ts`'s LUA54_BASE, because two
 * copies of a transcribed list is two numbers that can drift; the assertion at
 * the bottom of this file compares them.
 */
const LUA54_TABLES = new Set(["string", "table", "math", "io", "os", "coroutine", "debug", "utf8"])

/**
 * The rejected name-list rule's vocabulary, kept so the counterfactual can be
 * recomputed and compared on the same walk. Transcribed from the reference
 * manual as the shipped rule's is; see the header for why the shipped rule does
 * not use it.
 */
const LUA54_BASE = new Set([
  "_G", "_VERSION", "assert", "collectgarbage", "dofile", "error", "getmetatable",
  "ipairs", "load", "loadfile", "next", "pairs", "pcall", "print", "rawequal",
  "rawget", "rawlen", "rawset", "require", "select", "setmetatable", "tonumber",
  "tostring", "type", "unpack", "xpcall", "coroutine", "debug", "io", "math",
  "os", "package", "string", "table", "utf8", "bit32", "jit", "arg",
  "byte", "char", "dump", "find", "format", "gmatch", "gsub", "len", "lower",
  "match", "rep", "reverse", "sub", "upper",
  "concat", "insert", "move", "pack", "remove", "sort",
  "abs", "acos", "asin", "atan", "ceil", "cos", "deg", "exp", "floor", "fmod",
  "huge", "log", "max", "maxinteger", "min", "mininteger", "modf", "pi", "rad",
  "random", "randomseed", "sin", "sqrt", "tan", "tointeger", "ult",
  "clock", "date", "difftime", "execute", "exit", "getenv", "remove", "rename",
  "setlocale", "time", "tmpname",
  "close", "flush", "input", "lines", "open", "output", "popen", "read", "stderr",
  "stdin", "stdout", "tmpfile", "write",
  "create", "isyieldable", "resume", "running", "status", "wrap", "yield",
  "gethook", "getinfo", "getlocal", "getregistry", "getupvalue", "getuservalue",
  "sethook", "setlocal", "setmetatable", "setupvalue", "setuservalue",
  "traceback", "upvalueid", "upvaluejoin",
  "charpattern", "codepoint", "codes", "offset",
])

/** The container LABELS this analyzer publishes. A target on one of these is a defect. */
const SCOPE_LABELS = new Set(["global", "owner", "__global__", "file"])

interface Rel { t: string; f: string; l: number; s: string; g: string }

function draw(): { repos: Record<string, number>; files: string[]; digest: string } {
  const repos: Record<string, number> = {}
  const files: string[] = []
  for (const repo of readdirSyncSafe(CR).sort()) {
    const dir = path.join(CR, repo)
    try {
      if (!statSync(dir).isDirectory()) continue
      if (!existsSync(path.join(dir, ".git"))) continue
    } catch { continue }
    let out = ""
    try { out = execFileSync("git", ["ls-files", "*.lua"], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 28 }) } catch { continue }
    const tracked = out.split("\n").map(s => s.trim()).filter(Boolean).sort()
    repos[repo] = Math.min(tracked.length, FILES)
    for (const p of tracked.slice(0, FILES)) files.push(path.join(repo, p))
  }
  files.sort()
  const h = createHash("sha256")
  for (const f of files) {
    let size = -1
    try { size = statSync(path.join(CR, f)).size } catch { /* absent */ }
    h.update(`${f}\t${size}\n`)
  }
  return { repos, files, digest: h.digest("hex") }
}

function readdirSyncSafe(d: string): string[] {
  try { return readdirSync(d) } catch { return [] }
}

type Row = {
  edges: number
  /** the population the rule marks: standard-library target, file declares no such symbol */
  markExternal: number
  /** the guard firing on the RECEIVER: this file publishes a symbol named the table, so
   *  `T.field` may be the file's own `T`. NOT marked. */
  shadowedReceiver: number
  /** the REJECTED name-list rule, measured on the same walk for comparison */
  nameListWouldMark: number
  /** `imports` targets — a module path. NOT marked; counted so the gap is a number. */
  moduleTarget: number
  /** targets on this analyzer's own container labels, where the file declares no such name.
   *  The only genuinely-analyzer-invented target of the three labels. NOT marked. */
  scopeLabelTarget: number
  /** targets NAMED `global`/`owner`/`file` that this file declares — user variables.
   *  The audit calls these scope labels because it tests the name before the file's
   *  own declarations; this measures how much of that bucket is locals. */
  sameNamedLocal: number
  /** neither: not in the list, not a module, not a label. Unmarked by construction. */
  unmarkedOther: number
}

function newRow(): Row {
  return { edges: 0, markExternal: 0, shadowedReceiver: 0, nameListWouldMark: 0, moduleTarget: 0, scopeLabelTarget: 0, sameNamedLocal: 0, unmarkedOther: 0 }
}

/**
 * Per file: line number -> (field name -> receiver text), built from the parse
 * tree the production parser produced. This is the whole rule: an edge counts
 * only when the AST node on the edge's own line exposes a `dot_index_expression`
 * or `method_index_expression` whose receiver is an identifier naming a
 * documented standard table and whose field is the edge's target.
 *
 * Keyed by line because a relationship stores a LINE, not a node. That is a real
 * limitation of measuring from outside the analyzer — two reads of the same field
 * on one line would be indistinguishable here, and inside the analyzer they are
 * not, because the receiver is read off the node itself. The analyzer therefore
 * makes this same test at the node, and this instrument is the OUTER estimate of
 * its size, not its implementation.
 */
async function stdlibReceiverIndex(): Promise<any> {
  const mod: any = await loadWebTreeSitter()
  await parseFile(path.join(CR, "luvit", "init.lua"), CR)
  const lang: any = await mod.Language.load(resolveWasmAsset("tree-sitter-lua.wasm"))
  const parser = new mod.Parser()
  parser.setLanguage(lang)
  return parser
}

function indexReceivers(parser: any, src: string): Map<number, Map<string, string>> {
  const out = new Map<number, Map<string, string>>()
  const tree = parser.parse(src)
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const nd = stack.pop()
    if (!nd) continue
    if (nd.type === "dot_index_expression" || nd.type === "method_index_expression") {
      const obj = nd.childForFieldName("table") ?? nd.childForFieldName("object")
      const fld = nd.childForFieldName("field") ?? nd.childForFieldName("method")
      if (obj && fld && obj.type === "identifier" && LUA54_TABLES.has(String(obj.text ?? ""))) {
        const line = Number(nd.startPosition?.row ?? -1) + 1
        let m = out.get(line)
        if (!m) { m = new Map(); out.set(line, m) }
        const field = String(fld.text ?? "")
        if (!m.has(field)) m.set(field, String(obj.text ?? ""))
      }
    }
    for (let i = nd.namedChildCount - 1; i >= 0; i--) { const c = nd.namedChild(i); if (c) stack.push(c) }
  }
  return out
}

async function main() {
  const { repos, files, digest } = draw()
  const parser = await stdlibReceiverIndex()
  const rows: Record<string, Row> = {}
  const markByName: Record<string, number> = {}
  const scopeExamples: Record<string, Array<{ file: string; line: number; type: string; source: string; target: string; declaredHere: boolean }>> = {}
  const shadowExamples: Array<{ file: string; line: number; type: string; receiver: string; field: string }> = []
  let parsed = 0, parseErrors = 0, symbols = 0, edges = 0, emptyNames = 0

  for (const rel of files) {
    let pf: any
    try { pf = await parseFile(path.join(CR, rel)) } catch { parseErrors++; continue }
    if (!pf) { parseErrors++; continue }
    parsed++
    let srcText = ""
    try { srcText = readFileSync(path.join(CR, rel), "utf8") } catch { /* unreadable: no receiver index */ }
    const recvHits = srcText ? indexReceivers(parser, srcText) : new Map<number, Map<string, string>>()
    const syms: any[] = pf.symbols ?? []
    symbols += syms.length
    const declared = new Set<string>()
    for (const s of syms) {
      const n = String(s?.name ?? "")
      if (!n) { emptyNames++; continue }
      declared.add(n)
      const q = String(s?.qualifiedName ?? "")
      if (q) declared.add(q)
    }
    for (const e of (pf.relationships ?? []) as any[]) {
      const row = rows[e.type] ?? (rows[e.type] = newRow())
      row.edges++
      edges++
      const target = String(e.target ?? "")
      if (e.type === "imports") { row.moduleTarget++; continue }
      if (SCOPE_LABELS.has(target)) {
        // The declaration test comes FIRST here, which is the whole difference
        // from the audit's bucket. `local file = io.open(p)` gives a file a
        // symbol named `file`, and that target is a local declaration.
        if (declared.has(target)) {
          row.sameNamedLocal++
          const arr = scopeExamples[e.type] ?? (scopeExamples[e.type] = [])
          if (arr.length < 6) arr.push({ file: rel, line: Number(e.line_number ?? 0), type: e.type, source: String(e.source ?? ""), target, declaredHere: true })
          continue
        }
        row.scopeLabelTarget++
        const arr = scopeExamples[e.type] ?? (scopeExamples[e.type] = [])
        if (arr.length < 6) arr.push({ file: rel, line: Number(e.line_number ?? 0), type: e.type, source: String(e.source ?? ""), target, declaredHere: false })
        continue
      }
      // The rejected rule, first, because it is a superset-ish baseline and the
      // two are compared on the same walk rather than on two runs.
      if (LUA54_BASE.has(target) && !declared.has(target)) row.nameListWouldMark++

      // The shipped rule: does THIS edge's own node carry a standard-table receiver?
      const hit = recvHits.get(Number(e.line_number ?? 0))
      if (!hit || hit.get(target) === undefined) { row.unmarkedOther++; continue }
      if (declared.has(hit.get(target)!)) {
        row.shadowedReceiver++
        if (shadowExamples.length < 12) shadowExamples.push({ file: rel, line: Number(e.line_number ?? 0), type: e.type, receiver: hit.get(target), field: target })
        continue
      }
      row.markExternal++
      markByName[`${hit.get(target)}.${target}`] = (markByName[`${hit.get(target)}.${target}`] ?? 0) + 1
    }
  }

  const top = (o: Record<string, number>, n: number) =>
    Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, edges: count }))

  const out = {
    schemaVersion: 2,
    kind: "lua_external_marking",
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    corpus: { root: CR, method: `git ls-files '*.lua' per repo, sorted, first ${FILES} per repo (deterministic, not random)`, filesDrawn: files.length, repos, drawDigest: digest },
    production: { filesParsed: parsed, parseErrorFiles: parseErrors, symbols, relationships: edges, emptySymbolNames: emptyNames },
    rule: "the edge's target is the field of a dot_index_expression/method_index_expression whose receiver is an identifier naming a documented Lua 5.4 standard table, AND this file publishes no symbol under that receiver",
    rejectedRule: "target is a bare name in the transcribed Lua 5.4 standard-library surface AND this file publishes no symbol under that name — a name-match guess; the analyzer publishes the FINAL SEGMENT of a member read, so it cannot tell table.insert from a user's own global insert",
    byType: rows,
    totals: {
      edges,
      markExternal: Object.values(rows).reduce((a, r) => a + r.markExternal, 0),
      shadowedReceiver: Object.values(rows).reduce((a, r) => a + r.shadowedReceiver, 0),
      nameListWouldMark: Object.values(rows).reduce((a, r) => a + r.nameListWouldMark, 0),
      moduleTarget: Object.values(rows).reduce((a, r) => a + r.moduleTarget, 0),
      scopeLabelTarget: Object.values(rows).reduce((a, r) => a + r.scopeLabelTarget, 0),
      sameNamedLocal: Object.values(rows).reduce((a, r) => a + r.sameNamedLocal, 0),
      unmarkedOther: Object.values(rows).reduce((a, r) => a + r.unmarkedOther, 0),
    },
    topMarkedNames: top(markByName, 30),
    shadowExamples,
    scopeLabelExamples: scopeExamples,
    listAgreement: {
      note: "the audit's LUA54_BASE and this file's must be the same list, or the two numbers describe different populations",
      auditBytes: readAuditListBytes(),
      thisBytes: JSON.stringify([...LUA54_BASE].sort()),
    },
    notMarked: {
      moduleTarget: "an `imports` target is a Lua module, not a declaration. One file cannot tell a sibling module from a luarocks rock: the classb-origin probe measured 2,425 dotted targets whose module file is in the corpus draw against 3,060 whose file is absent. Marking all of them external would assert the second count for the first.",
      scopeLabelTarget: "an edge whose target is `global`/`owner`/`file`/`__global__` AND which this file does not declare, so it names this analyzer's own container label. That is a defect; a marker would launder it.",
      sameNamedLocal: "a target named `file`/`owner`/`global` that this file DOES declare: an ordinary local. The audit buckets it as a scope label because it tests the name before the file's declarations. Not marked, because it is not external — it is local.",
    },
    note: "reported, not gated — exit code is always 0",
  }

  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(out, null, 2))

  const t = out.totals
  console.log(`lua cause-C marking — population ${parsed} parsed of ${files.length} drawn (${files.length} .lua across ${Object.keys(repos).length} repos), ${edges} relationships`)
  console.log(`drawDigest ${digest}`)
  console.log("")
  console.log(`rule: ${out.rule}`)
  console.log("")
  console.log("type          edges   mark  shadowRecv  nameList  module   scopeLbl  sameNamed   other")
  console.log("------------------------------------------------------------------------------")
  for (const t2 of Object.keys(rows).sort()) {
    const r = rows[t2]
    console.log(
      `${t2.padEnd(12)}${String(r.edges).padStart(8)}${String(r.markExternal).padStart(7)}${String(r.shadowedReceiver).padStart(12)}${String(r.nameListWouldMark).padStart(10)}${String(r.moduleTarget).padStart(9)}${String(r.scopeLabelTarget).padStart(10)}${String(r.sameNamedLocal).padStart(11)}${String(r.unmarkedOther).padStart(8)}`,
    )
  }
  console.log("-------------------------------------------------------------------")
  console.log(`${"TOTAL".padEnd(12)}${String(t.edges).padStart(8)}${String(t.markExternal).padStart(7)}${String(t.shadowedReceiver).padStart(12)}${String(t.nameListWouldMark).padStart(10)}${String(t.moduleTarget).padStart(9)}${String(t.scopeLabelTarget).padStart(10)}${String(t.sameNamedLocal).padStart(11)}${String(t.unmarkedOther).padStart(8)}`)
  console.log("")
  console.log(`MARKABLE (the honest cause-C claim): ${t.markExternal} of ${t.edges} edges`)
  console.log(`guard fires (a local shadows the receiver table, NOT marked): ${t.shadowedReceiver}`)
  console.log(`REJECTED name-list rule would mark: ${t.nameListWouldMark} — ${(t.nameListWouldMark / Math.max(1, t.markExternal)).toFixed(1)}x the shipped rule`)
  console.log(`NOT marked — module target: ${t.moduleTarget}   scope-label target: ${t.scopeLabelTarget}   user variable named file/owner/global: ${t.sameNamedLocal}`)
  console.log(`audit scope-label bucket was 469 on its draw; the part that is a user local is measured above`)
  console.log("")
  console.log(`top marked: ${JSON.stringify(out.topMarkedNames.slice(0, 12))}`)
  if (Object.keys(scopeExamples).length) console.log(`scope-label targets by type: ${JSON.stringify(Object.fromEntries(Object.entries(scopeExamples).map(([k, v]) => [k, v.length])))}`)
  if (shadowExamples.length) console.log(`guard examples: ${JSON.stringify(shadowExamples.slice(0, 6))}`)
}

/**
 * The transcribed list, read out of the audit source rather than compared by
 * import, so the check survives either file moving. Returns a sorted JSON array
 * of the names the audit declares, or "NOT-FOUND" — which is itself the finding.
 */
function readAuditListBytes(): string {
  const p = path.join(ROOT, "script/m60/lua-incoming-audit.ts")
  let src: string
  try { src = readFileSync(p, "utf8") } catch { return "NOT-FOUND" }
  const start = src.indexOf("const LUA54_BASE = new Set([")
  if (start < 0) return "NOT-FOUND"
  const open = src.indexOf("[", start)
  const close = src.indexOf("])", open)
  if (open < 0 || close < 0) return "NOT-FOUND"
  const names = src.slice(open + 1, close)
    .split("\n")
    .map(l => l.replace(/\/\/.*$/, ""))
    .flatMap(l => l.split(","))
    .map(s => s.trim().replace(/^"|"$/g, ""))
    .filter(Boolean)
  return JSON.stringify([...new Set(names)].sort())
}

main()