/**
 * M60 LUA — the INCOMING audit: what reaches a lua declaration, and whether the
 * reverse walk can find it.
 *
 * ## WHY THIS EXISTS
 *
 * `src/lsp/impact.ts` walks reverse dependencies by SCANNING OUTGOING EDGES AND
 * MATCHING TARGETS. No inbound edge is stored; the schema holds none. So the
 * reverse walk is exactly as good as the target-matching, and two things follow
 * that are this lane's problem rather than the traversal code's:
 *
 *   1 A TARGET THAT RESOLVES TO MORE THAN ONE PUBLISHED SYMBOL. The reverse walk
 *     picks one by a rule nobody chose. An ambiguous target is ONE edge
 *     attributed to ONE declaration; counting it as N is how a name collision
 *     becomes wrong refactoring advice.
 *   2 A HOPELESS-STRING TARGET — an external package, a filesystem path, a
 *     builtin, a dynamic dispatch — is indistinguishable from a declaration that
 *     was simply never indexed. On one sample these looked identical in a count
 *     and were opposite findings.
 *
 * Neither is visible in the edge COUNT, so neither is in the census. This
 * instrument answers both, and answers them per relationship type.
 *
 * ## THE THREE QUESTIONS, AND THE BUCKET FOR EACH
 *
 * B — AMBIGUITY, closed where the language can close it.
 *     `published-ambiguous` means two or more of THIS FILE's symbols carry the
 *     name. That is what a name-only resolver sees. Lua's lexical scoping says
 *     more, and the published symbols carry what it needs: every symbol has
 *     `startLine`/`endLine` and `scope`. A candidate must COVER the edge's line.
 *     So an ambiguous name can be split three ways:
 *
 *       lexically-unique    exactly one candidate covers the line. The binding
 *                          is DETERMINATE and the ambiguity is an artifact of
 *                          resolving by name alone. Nothing is wrong with the
 *                          edge; the walker's resolution rule is what is weak.
 *       lexically-inner-wins  more than one covers the line. Lua's innermost
 *                          binding wins, so the target is still determinate —
 *                          by a rule, not by luck.
 *       genuinely-ambiguous  candidates cover the line and the innermost rule
 *                          does not separate them: two SYMBOLS at the same
 *                          scope and overlapping lines. This is the only class
 *                          in which the edge cannot name one declaration, and it
 *                          is the count this instrument exists to bound.
 *
 * C — EXTERNAL vs NEVER-INDEXED. Resolution here is per-file by construction
 *     (a Lua chunk is not a module and no symbol is named after a file), so this
 *     instrument ALSO indexes every name declared ANYWHERE in the draw. A target
 *     no file declares is then split by whether it is in the Lua 5.4 base
 *     library — a DECLARED list transcribed from the reference manual, stated as
 *     such, not derived from the corpus. The claim this number supports is
 *     therefore "named in the documented stdlib surface", and nothing wider.
 *
 * D — RESOLUTION per type, with the denylist loss separated out.
 *     `keepSymbol` is imported from pool-worker and CALLED, not re-implemented,
 *     so the denylist bucket is what the pipeline does rather than a copy of it
 *     that could drift. That bucket exists because `keepSymbol`'s UNIVERSAL
 *     denylist carries `unknown`, `self` and `root`, which are legal Lua
 *     identifiers — so an edge can point at a symbol the pipeline DELETED.
 *     pool-worker.ts is shared (§8); this lane measures the effect and reports
 *     it rather than editing it.
 *
 * ## NO REGEX
 *
 * Every classification is a name comparison against a set or a node-type test.
 * There is no pattern matching over file text anywhere in this file. The draw is
 * `git ls-files '*.lua'` per repo, sorted, capped by --files, and every run
 * records a `drawDigest` so two runs can be told apart.
 *
 * ## USAGE
 *
 *   npx tsx script/m60/lua-incoming-audit.ts --files 400 --out validation/m60/lua/incoming-audit.json
 *
 * Exit 0 always: this reports, it does not gate. The numbers are the report.
 */
import { execFileSync } from "node:child_process"
import { writeFileSync, existsSync, mkdirSync, statSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile, keepSymbol } from "../../src/ast/pool-worker"
import { parseWithAnalyzer } from "./lua-analyzer-direct"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const arg = (k: string, d?: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const FILES = Number(arg("--files", "400"))
const OUT = path.resolve(ROOT, arg("--out", "validation/m60/lua/incoming-audit.json")!)

/**
 * Lua 5.4 base library (§6.1) plus the fields of the standard table libraries
 * that this corpus actually names. TRANSCRIBED FROM THE REFERENCE MANUAL, NOT
 * DERIVED FROM THE CORPUS — stated here because a number produced against a
 * hand-typed list is only as good as the list, and the honest claim is "named in
 * the documented stdlib surface". Anything outside this set is reported as
 * `not-declared-anywhere` and is NOT claimed to be external.
 */
const LUA54_BASE = new Set([
  // 6.1 basic: _G, _VERSION, assert, collectgarbage, dofile, error, getfenv (5.1),
  // getmetatable, ipairs, load, loadfile, loadstring (5.1), module (5.1),
  // next, pairs, pcall, print, rawequal, rawget, rawlen, rawset, require,
  // select, setfenv (5.1), setmetatable, tonumber, tostring, type, unpack (5.1),
  // xpcall, coroutine, debug, io, math, os, package, string, table, utf8
  "_G", "_VERSION", "assert", "collectgarbage", "dofile", "error", "getmetatable",
  "ipairs", "load", "loadfile", "next", "pairs", "pcall", "print", "rawequal",
  "rawget", "rawlen", "rawset", "require", "select", "setmetatable", "tonumber",
  "tostring", "type", "unpack", "xpcall", "coroutine", "debug", "io", "math",
  "os", "package", "string", "table", "utf8", "bit32", "jit", "arg",
  // string.*
  "byte", "char", "dump", "find", "format", "gmatch", "gsub", "len", "lower",
  "match", "rep", "reverse", "sub", "upper",
  // table.*
  "concat", "insert", "move", "pack", "remove", "sort", "unpack",
  // math.*
  "abs", "acos", "asin", "atan", "ceil", "cos", "deg", "exp", "floor", "fmod",
  "huge", "log", "max", "maxinteger", "min", "mininteger", "modf", "pi", "rad",
  "random", "randomseed", "sin", "sqrt", "tan", "tointeger", "type", "ult",
  // os.*
  "clock", "date", "difftime", "execute", "exit", "getenv", "remove", "rename",
  "setlocale", "time", "tmpname",
  // io.*
  "close", "flush", "input", "lines", "open", "output", "popen", "read", "stderr",
  "stdin", "stdout", "tmpfile", "type", "write",
  // coroutine.*
  "close", "create", "isyieldable", "resume", "running", "status", "wrap", "yield",
  // debug.*
  "debug", "gethook", "getinfo", "getlocal", "getmetatable", "getregistry",
  "getupvalue", "getuservalue", "sethook", "setlocal", "setmetatable", "setupvalue",
  "setuservalue", "traceback", "upvalueid", "upvaluejoin",
  // utf8.*
  "char", "charpattern", "codepoint", "codes", "len", "offset",
])

/** Scope labels the analyzer uses for a container rather than a declaration. */
const SCOPE_LABELS = new Set(["global", "owner", "__global__", "file"])

interface Sym {
  name: string
  kind?: string
  scope?: string
  startLine?: number
  endLine?: number
}

function draw(): { repos: Record<string, string[]>; files: string[]; digest: string } {
  const repos: Record<string, string[]> = {}
  for (const repo of readdirSyncSafe(CR).sort()) {
    const dir = path.join(CR, repo)
    try {
      if (!statSync(dir).isDirectory()) continue
      if (!existsSync(path.join(dir, ".git"))) continue
    } catch { continue }
    let out = ""
    try { out = execFileSync("git", ["ls-files", "*.lua"], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 28 }) } catch { continue }
    const tracked = out.split("\n").map(s => s.trim()).filter(Boolean).sort()
    if (tracked.length === 0) { repos[repo] = []; continue }
    repos[repo] = tracked.slice(0, FILES).map(p => path.join(repo, p))
  }
  const files = Object.values(repos).flat().sort()
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

/** Where one endpoint's name lands. Mutually exclusive; the first match wins. */
type Bucket =
  | "published-unique"
  | "published-ambiguous"
  | "scope-label"
  | "module-path"
  | "stdlib-external"
  | "declared-then-denylisted"
  | "declared-elsewhere-in-corpus"
  | "not-declared-anywhere"

type TypeRow = {
  edges: number
  src: Record<Bucket, number>
  tgt: Record<Bucket, number>
  bothResolved: number
  // B
  lexicallyUnique: number
  lexicallyInnerWins: number
  genuinelyAmbiguous: number
  ambiguousNotLineBounded: number
  // D
  neverIndexedNames: Record<string, number>
  /** name -> edges, for targets pool-worker's keepSymbol deletes. Named, not a total. */
  denylistedNames: Record<string, number>
  /** up to 4 (file, line, type, source, target) per denylisted target name — the doc quotes these */
  denylistedExamples: Record<string, { file: string; line: number; type: string; source: string; target: string }[]>
}

function zeroBuckets(): Record<Bucket, number> {
  return {
    "published-unique": 0, "published-ambiguous": 0, "scope-label": 0,
    "module-path": 0, "stdlib-external": 0, "declared-then-denylisted": 0,
    "declared-elsewhere-in-corpus": 0, "not-declared-anywhere": 0,
  }
}

function newRow(): TypeRow {
  return {
    edges: 0, src: zeroBuckets(), tgt: zeroBuckets(), bothResolved: 0,
    lexicallyUnique: 0, lexicallyInnerWins: 0, genuinelyAmbiguous: 0,
    ambiguousNotLineBounded: 0, neverIndexedNames: {}, denylistedNames: {}, denylistedExamples: {},
  }
}

async function main() {
  const { repos, files, digest } = draw()
  console.log(`draw: ${files.length} lua files from ${Object.keys(repos).length} repos  digest=${digest.slice(0, 12)}`)

  const rows: Record<string, TypeRow> = {}
  // name -> files in which some symbol carries it. Built from the WHOLE draw, so a
  // target is "declared elsewhere" on a measured basis, never a guess.
  const declaredIn = new Map<string, Set<string>>()
  const perFile: { rel: string; syms: { name: string; kind?: string; scope?: string; startLine?: number; endLine?: number }[] }[] = []
  const droppedDecls: Record<string, number> = {}
  let parseErr = 0, relTotal = 0, symTotal = 0, emptyNames = 0

  for (const rel of files) {
    let r: any
    try { r = await parseFile(path.join(CR, rel), CR) } catch { parseErr++; continue }
    if (!r || r.fallback) continue
    const syms = (r.symbols ?? []) as Sym[]
    const rels = (r.relationships ?? []) as any[]
    symTotal += syms.length
    relTotal += rels.length
    for (const s of syms) {
      if (!s.name) { emptyNames++; continue }
      let set = declaredIn.get(s.name)
      if (!set) { set = new Set(); declaredIn.set(s.name, set) }
      set.add(rel)
    }
    perFile.push({ rel, syms })

    // Names the ANALYZER published that pool-worker's keepSymbol then removed, in
    // THIS file. Measured against the analyzer's own pre-filter output so the set is
    // the pipeline's deletions rather than a re-statement of the denylist.
    const droppedHere = new Set<string>()
    try {
      const pre = await parseWithAnalyzer(path.join(CR, rel))
      for (const s of (pre?.symbols ?? []) as any[]) {
        const nm = s?.name
        if (nm && !keepSymbol(s, "lua")) { droppedHere.add(String(nm)); droppedDecls[String(nm)] = (droppedDecls[String(nm)] ?? 0) + 1 }
      }
    } catch { /* a file the direct path cannot load contributes no deletions */ }

    const byName = new Map<string, Sym[]>()
    for (const s of syms) {
      if (!s.name) continue
      let arr = byName.get(s.name)
      if (!arr) { arr = []; byName.set(s.name, arr) }
      arr.push(s)
    }

    for (const e of rels) {
      const type = String(e.type ?? e.relationshipType ?? "?")
      const row = rows[type] ?? (rows[type] = newRow())
      row.edges++
      const line = Number(e.line_number ?? 0)

      // ── classify one endpoint
      const classify = (raw: unknown, isTarget: boolean): Bucket => {
        const name = typeof raw === "string" ? raw : String(raw ?? "")
        if (name === "") return "not-declared-anywhere"
        if (isTarget && type === "imports") return "module-path"
        if (SCOPE_LABELS.has(name)) return "scope-label"
        const local = byName.get(name)
        if (local && local.length === 1) return "published-unique"
        if (local && local.length > 1) {
          // B: does the language settle it? A candidate must cover the line.
          const covering = local.filter(s => {
            const a = Number(s.startLine ?? 0), b = Number(s.endLine ?? 0)
            if (!a || !b || !line) return false
            return a <= line && line <= b
          })
          if (covering.length === 0) { row.ambiguousNotLineBounded++; return "published-ambiguous" }
          // Innermost wins in Lua. Distinct scopes => the innermost is one symbol.
          const scopes = new Set(covering.map(s => String(s.scope ?? "")))
          if (scopes.size === 1) { row.lexicallyUnique++; return "published-ambiguous" }
          // Same-name symbols at nested scopes: the DEEPEST scope wins.
          const depths = covering.map(s => (s.scope === "global" ? 0 : 1))
          const maxDepth = Math.max(...depths)
          const innermost = covering.filter((_, i) => depths[i] === maxDepth)
          if (innermost.length === 1) { row.lexicallyInnerWins++ } else { row.genuinelyAmbiguous++ }
          return "published-ambiguous"
        }
        // Not published in THIS file. Now separate external from never-indexed.
        //
        // A name being ON the denylist is not the finding. `thread.self()` and
        // `Config.me` put `self`/`me` in the text and neither ever declared
        // anything, so the denylist deleted nothing there. The finding is narrower
        // and much worse: a DECLARATION this analyzer published that keepSymbol
        // then removed, which leaves an edge pointing at a node the pipeline
        // deleted. That needs the analyzer's PRE-FILTER symbol list to name, because
        // after the filter the declaration is indistinguishable from never having
        // existed — which is exactly why it survived wave 2.
        if (droppedHere.has(name)) return "declared-then-denylisted"
        if (LUA54_BASE.has(name)) return "stdlib-external"
        if (declaredIn.has(name)) return "declared-elsewhere-in-corpus"
        return "not-declared-anywhere"
      }

      const sb = classify(e.source ?? e.from, false)
      const tb = classify(e.target ?? e.to, true)
      row.src[sb]++
      row.tgt[tb]++
      if (sb === "published-unique" && tb === "published-unique") row.bothResolved++
      if (tb === "declared-then-denylisted") {
        const n = typeof (e.target ?? e.to) === "string" ? String(e.target ?? e.to) : "?"
        row.denylistedNames[n] = (row.denylistedNames[n] ?? 0) + 1
        const ex = row.denylistedExamples[n] ?? (row.denylistedExamples[n] = [])
        if (ex.length < 4) ex.push({
          file: rel, line, type,
          source: typeof (e.source ?? e.from) === "string" ? String(e.source ?? e.from) : "?",
          target: n,
        })
      }
      if (tb === "not-declared-anywhere") {
        const n = typeof (e.target ?? e.to) === "string" ? String(e.target ?? e.to) : "?"
        row.neverIndexedNames[n] = (row.neverIndexedNames[n] ?? 0) + 1
      }
    }
  }

  const top = (rec: Record<string, number>, n: number) =>
    Object.entries(rec).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ name: k, edges: v }))

  const artifact = {
    schemaVersion: 2,
    kind: "lua_incoming_audit",
    label: process.argv.includes("--label") ? arg("--label")! : "default",
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    corpus: {
      root: CR,
      method: `git ls-files '*.lua' per repo, sorted, first ${FILES} per repo (deterministic, not random)`,
      filesDrawn: files.length,
      repos: Object.fromEntries(Object.entries(repos).map(([k, v]) => [k, v.length])),
      drawDigest: digest,
    },
    production: {
      filesParsed: perFile.length,
      parseErrorFiles: parseErr,
      symbols: symTotal,
      emptyNames,
      relationships: relTotal,
      distinctDeclaredNames: declaredIn.size,
      declarationsPoolWorkerDeleted: Object.values(droppedDecls).reduce((a, b) => a + b, 0),
      declarationsPoolWorkerDeletedByName: droppedDecls,
      stdlibListIs: "transcribed from the Lua 5.4 reference manual; NOT derived from the corpus",
    },
    byType: rows,
    topDenylisted: Object.fromEntries(
      Object.keys(rows).map(t => [t, top(rows[t].denylistedNames, 15)]),
    ),
    denylistedExamples: Object.fromEntries(
      Object.keys(rows).map(t => [t, rows[t].denylistedExamples]),
    ),
    topNeverIndexed: Object.fromEntries(
      Object.keys(rows).map(t => [t, top(rows[t].neverIndexedNames, 15)]),
    ),
    note: "reported, not gated — exit code is always 0",
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n")

  console.log(`\nfiles ${perFile.length}  symbols ${symTotal}  relationships ${relTotal}  distinctNames ${declaredIn.size}`)
  console.log(`\ntype          edges   bothRes   amb:lexUniq  innerWins  GENUINE  denom-elsewhere  stdlib-ext  neverIdx`)
  console.log("-".repeat(108))
  for (const t of Object.keys(rows).sort()) {
    const r = rows[t]
    console.log(
      `${t.padEnd(13)} ${String(r.edges).padStart(6)}   ${String(r.bothResolved).padStart(6)}   ` +
      `${String(r.lexicallyUnique).padStart(9)}  ${String(r.lexicallyInnerWins).padStart(9)}  ` +
      `${String(r.genuinelyAmbiguous).padStart(7)}  ${String(r.tgt["declared-elsewhere-in-corpus"]).padStart(14)}  ` +
      `${String(r.tgt["stdlib-external"]).padStart(10)}  ${String(r.tgt["not-declared-anywhere"]).padStart(8)}`,
    )
  }
  const allDenyl: Record<string, number> = {}
  for (const t of Object.keys(rows)) for (const [k, v] of Object.entries(rows[t].denylistedNames)) allDenyl[k] = (allDenyl[k] ?? 0) + v
  console.log(`\nDECLARATIONS POOL-WORKER DELETED (analyzer published, keepSymbol dropped):`)
  console.log(`  total ${Object.values(droppedDecls).reduce((a, b) => a + b, 0)}  by name ${JSON.stringify(top(droppedDecls, 12))}`)
  console.log(`  NOTE "me" IS LEGITIMATE: it is not a reserved word in ANY language.`)
  console.log(`\nedges whose TARGET is such a deleted declaration:`)
  for (const t of Object.keys(rows).sort()) {
    const n = rows[t].tgt["declared-then-denylisted"]
    if (n) console.log(`  ${t.padEnd(13)} ${n}`)
  }
  console.log(`\nartifact: ${path.relative(ROOT, OUT)}`)
}

main()