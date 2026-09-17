// script/m59/matrix-tool-language.ts — M59.MTX
//
// THE MISSING INSTRUMENT. Every previous "the tools are verified" round measured
// the tool SURFACE (M48: descriptions, twins, parity pairs) or latency/adoption
// (M50). Neither can catch a wrong ANSWER. This one asks, per (tool, language),
// on a real index of real code:
//
//     what did the tool say, what does the SOURCE say, and where do they differ?
//
// and it takes the primitive's side seriously: for every reported callee it also
// computes what grep would see — the raw textual occurrences — and classifies
// them, because "grep found 12, our tool found 5" is only a defeat if the 12
// contains real call sites the tool cannot see. Text mentions (comments, strings,
// other same-named symbols) are not calls, and nobody has ever classified them.
//
// The tool surface is the REAL one: the actual MCP handlers (`createToolHandlers()`),
// called exactly as an agent's client calls them, output parsed from the same
// text the agent receives. Not an internal function standing in for the tool.
//
// Cells, per language:
//   bb_graph          → callers with call sites
//   bb_analyze        → mode=callers (the tool the opencode session used)
//   grep (baseline)   → raw textual occurrences, then classified into real calls
//
// Verdicts per cell, never conflated:
//   consistent        a reported site's claimed line really calls the callee
//   WRONG LINE        a reported site's line does not call it (the opencode killer)
//   UNKNOWN (null)    the tool declared the line unknown — honest, not a failure
//   MISSED            the source has a real call line the tool did not report
//   grep-only         a textual mention that is NOT a call (the primitive's noise)
//
// Honesty rules:
//   - Expected values come from the slice's own text. The predicate is a
//     NECESSARY condition (a lower bound): a "consistent" verdict is not proof of
//     correctness, and the script never prints one as such.
//   - The predicate has an inline self-test; if it drifts, the run aborts.
//   - An in-run mutation corrupts one stored line and PROVES the audit goes red.
//   - Every run writes its own evidence file with the exact command.
//
// Usage:
//   npx tsx script/m59/matrix-tool-language.ts                     # all mapped languages
//   npx tsx script/m59/matrix-tool-language.ts --langs=scala,kotlin
//   npx tsx script/m59/matrix-tool-language.ts --files=200         # slice cap per language

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync, copyFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { execSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS = "$HOME/fixtures/repositories"
const OUT = (() => {
  // --out= keeps half-sweeps from clobbering each other's evidence; the halves
  // are merged by script/m59/merge-matrix-halves.ts and the merged file records
  // that it came from more than one run.
  const arg = process.argv.find((a) => a.startsWith("--out="))
  return arg
    ? path.resolve(ROOT, arg.split("=")[1])
    : path.join(ROOT, "validation/m59/results/matrix-tool-language.json")
})()
const DATA_ROOT = mkdtempSync(path.join(tmpdir(), "m59-mtx-data-"))
process.env.BB_DATA_DIR = DATA_ROOT

const CAP = Number(process.argv.find((a) => a.startsWith("--files="))?.split("=")[1] ?? 250)
const ONLY = process.argv
  .find((a) => a.startsWith("--langs="))
  ?.split("=")[1]
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)

// One real repo per line-emitting language, chosen from fixtures/repositories by
// what is actually there (counts measured, not assumed).
const LANGS: Array<{ lang: string; repo: string; ext: string[] }> = [
  { lang: "scala", repo: "cats-effect", ext: [".scala"] },
  { lang: "kotlin", repo: "Exposed", ext: [".kt"] },
  { lang: "java", repo: "clojure", ext: [".java"] },
  { lang: "groovy", repo: "geb", ext: [".groovy"] },
  { lang: "typescript", repo: "graphql-js", ext: [".ts"] },
  { lang: "javascript", repo: "proxicall", ext: [".js"] },
  { lang: "vue", repo: "vue-element-admin", ext: [".vue"] },
  { lang: "svelte", repo: "shadcn-svelte", ext: [".svelte"] },
  { lang: "xml", repo: "phpunit", ext: [".xml"] },
]

// ── the source predicate (necessary condition only) ─────────────────────────
// Mirrors script/m59/acceptance-tool-callsites.ts `calledLines`. Kept as a copy
// WITH the same self-test rather than an import, because importing that module
// executes its top-level run. If this drifts, the self-test below fails the run.
const DECL_KEYWORDS = [
  "fun", "def", "void", "int", "long", "double", "float", "boolean", "bool", "char", "byte", "short",
  "String", "Object", "public", "private", "protected", "internal", "static", "final", "abstract",
  "synchronized", "native", "override", "open", "suspend", "operator", "inline", "external", "function",
]

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Replace quoted spans with spaces so strings cannot fake code or open a comment. */
function stripStrings(line: string): string {
  let out = ""
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === "\\") {
        out += "  "
        i++
        continue
      }
      if (ch === quote) {
        quote = null
        out += ch
        continue
      }
      out += " "
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch
      out += ch
      continue
    }
    out += ch
  }
  return out
}

/** Lines that unambiguously CALL `token`. Undercounts on purpose. */
function calledLines(lines: string[], token: string): number[] {
  // A declaration line and a call line are NOT mutually exclusive: scala writes
  // `override def print[A](a: A)(...): F[Unit] = log(` — one line, one
  // declaration (print) AND one real call (log). The first shape of this
  // predicate suppressed the whole line on any declaration keyword, and so
  // accused 6 CORRECT scala sites of being on the wrong line (log x4, one x2).
  // That was the instrument's own lie; it was caught before being reported.
  const occurrencesOf = (line: string) => {
    let n = 0
    let idx = line.indexOf(token)
    while (idx !== -1) {
      const before = idx === 0 ? "" : line[idx - 1]
      if (!/[A-Za-z0-9_$]/.test(before)) {
        let j = idx + token.length
        // TYPE-APPLIED / GENERIC CALL: `delay[F[Option[B]]] {` (scala),
        // `foo[Bar](x)`, `Collections.<String>emptyList()`, `useQuery<Data>(x)`.
        // MapRef.scala:230 is a real `delay` call written exactly that way, and
        // this predicate's ignorance of the form accused a CORRECT site of being
        // on the wrong line — instrument lie #6, caught before it was reported.
        const open =
          line[j] === "[" ? "[" : line[j] === "<" && line[j - 1] !== undefined && !/\s/.test(line[j - 1]) ? "<" : null
        if (open) {
          const close = open === "[" ? "]" : ">"
          let depth = 0
          let k = j
          let end = -1
          while (k < line.length && k - j < 120) {
            const ch = line[k]
            if (ch === open) depth++
            else if (ch === close) {
              depth--
              if (depth === 0) {
                end = k
                break
              }
            } else if (close === ">" && /[;)}{]/.test(ch)) break // `a < b)` is a comparison, not a type argument
            k++
          }
          if (end !== -1) j = end + 1
        }
        while (line[j] === " ") j++
        // `(` is a call; so are scala/kotlin's brace form (`x.map { … }`,
        // `dbQuery {`, `Users.insert {`) and TS/JS's optional call
        // (`children?.()`). Matching only `token(` alone accused 16 correct
        // scala `map` sites and 16 correct kotlin `dbQuery`/`insert` sites.
        if (line[j] === "(") n++
        else if (line[j] === "{" && line[j + 1] !== "}") n++
        else if (line[j] === "?" && line[j + 1] === ".") {
          let k = j + 2
          while (line[k] === " ") k++
          if (line[k] === "(") n++
        }
      }
      idx = line.indexOf(token, idx + 1)
    }
    return n
  }
  /** Does this line DECLARE `token`, as opposed to calling it? */
  const declaredHere = (line: string) => {
    let i = line.indexOf("(")
    while (i !== -1) {
      let j = i - 1
      while (j >= 0 && line[j] === " ") j--
      const nameEnd = j
      while (j >= 0 && /[A-Za-z0-9_$]/.test(line[j])) j--
      if (j !== nameEnd && line.slice(j + 1, nameEnd + 1) === token) {
        const head = line.slice(0, j + 1)
        let kwEnd = -1
        for (const kw of DECL_KEYWORDS) {
          // WORD BOUNDARIES. `lastIndexOf("Object")` matched inside `trxObject`,
          // `String` inside `StringSeq`, `char` inside `chart`, `boolean` inside
          // `(boolean)` — and turned correct call lines into "declarations"
          // (java count/invoke/create, kotlin getCurrentTransaction, vue init).
          let at = head.lastIndexOf(kw)
          while (at !== -1) {
            const before = at === 0 ? "" : head[at - 1]
            const after = head[at + kw.length] ?? ""
            if (!/[A-Za-z0-9_$]/.test(before) && !/[A-Za-z0-9_$]/.test(after)) break
            at = head.lastIndexOf(kw, at - 1)
          }
          if (at !== -1 && at + kw.length > kwEnd) kwEnd = at + kw.length
        }
        if (kwEnd === -1) return false
        const between = head.slice(kwEnd)
        // A declaration names its symbol directly after the type/keyword:
        // `int x(`, `Object[] x(`, `fun x(`. Anything that puts a receiver, an
        // assignment, a call, a block or a statement-end between the keyword and
        // the name means the name is not what is being declared here — which is
        // how `new Object[args.count()]` stops reading as a declaration of
        // `count` (the run's own self-test caught this).
        if (!/[=().;{}]/.test(between)) return true
      }
      i = line.indexOf("(", i + 1)
    }
    return false
  }
  const out: number[] = []
  let inBlockComment = false
  lines.forEach((raw, i) => {
    // Strip string literals BEFORE comment handling: a `/*` inside a string used
    // to open a block comment that swallowed the rest of the file (typescript
    // build-npm.ts lost 5 correct sites exactly this way), and `foo(` inside a
    // string is not a call.
    let line = stripStrings(raw)
    if (inBlockComment) {
      const end = line.indexOf("*/")
      if (end === -1) return
      line = line.slice(end + 2)
      inBlockComment = false
    }
    if (/^\s*(\/\/|\*|#|--)/.test(line)) return
    while (line.includes("/*")) {
      const start = line.indexOf("/*")
      const end = line.indexOf("*/", start + 2)
      if (end === -1) {
        line = line.slice(0, start)
        inBlockComment = true
        break
      }
      line = line.slice(0, start) + " " + line.slice(end + 2)
    }
    const inline = line.indexOf("//")
    if (inline !== -1) line = line.slice(0, inline)
    const occ = occurrencesOf(line)
    if (occ === 0) return
    // A lone occurrence that IS the declared name is a declaration, not a call.
    // Two occurrences mean the declared name and a real call share one line, so
    // the line counts.
    if (occ === 1 && declaredHere(line)) return
    out.push(i + 1)
  })
  return out
}

/** Every line that merely MENTIONS the token — what a raw text search returns. */
function mentionLines(lines: string[], token: string): number[] {
  const re = new RegExp(`(^|[^\\w])${escapeRe(token)}($|[^\\w])`)
  const out: number[] = []
  lines.forEach((l, i) => {
    if (re.test(l)) out.push(i + 1)
  })
  return out
}

function selfTest(): Record<string, boolean> {
  return {
    declarationNotCounted: calledLines(["fun target() { return 1 }"], "target").length === 0,
    kotlinDeclarationNotCounted: calledLines(["  fun target(): Int = 1"], "target").length === 0,
    callCounted: calledLines(["  val a = target()"], "target").length === 1,
    qualifiedCallCounted: calledLines(["  io.unsafeRunSync()"], "unsafeRunSync").length === 1,
    subwordNotCounted: calledLines(["  retarget()"], "target").length === 0,
    commentNotCounted: calledLines(["// target()"], "target").length === 0,
    blockCommentNotCounted: calledLines(["/*", " target()", "*/"], "target").length === 0,
    mentionCountedByRawSearchButNotAsCall: mentionLines(["// target()"], "target").length === 1 && calledLines(["// target()"], "target").length === 0,
    // Added after the sweep accused 81 correct sites: each case below is a real
    // shape from real corpus code that the first predicate got wrong.
    scalaBraceCallCounted: calledLines(["  F.deferred[Unit].map { signal => 1 }"], "map").length === 1,
    kotlinBraceCallCounted: calledLines(["  TransactionManager.current().dbQuery {"], "dbQuery").length === 1,
    optionalCallCounted: calledLines(["{@render children?.()}"], "children").length === 1,
    keywordSubstringIsNotDeclaration: calledLines(["    Object[] argvals = new Object[args.count()];"], "count").length === 1,
    interfaceSubstringIsNotDeclaration: calledLines(["  transaction = trxObject.getCurrentTransaction() ?: error()"], "getCurrentTransaction").length === 1,
    declarationWithCallOnSameLineIsACall: calledLines(["  override def print[A](a: A)(implicit S: Show[A]): F[Unit] = log("], "log").length === 1,
    callInsideStringIsNotACall: calledLines(['  val s = "foo()"'], "foo").length === 0,
    scalaTypeAppliedBraceCallCounted: calledLines(["        delay[F[Option[B]]] {"], "delay").length === 1,
    scalaTypeAppliedParenCallCounted: calledLines(["  val x = foo[Bar](baz)"], "foo").length === 1,
    genericParenCallCounted: calledLines(["  const { data } = useQuery<Data>(key)"], "useQuery").length === 1,
    comparisonIsNotATypeArgument: calledLines(["  if (a < b) {"], "a").length === 0,
    lessThanWithoutSpaceIsNotACall: calledLines(["  if(x<y) return"], "x").length === 0,
    unterminatedLookingCommentInStringDoesNotSwallowTheFile: calledLines(['  val s = "/*"', "  target()"], "target").length === 1,
  }
}

/** The site audit. Factored out of the sweep so the in-run mutation re-runs it. */
function auditEdges(edges: any[], callee: string, linesOf: (rel: string) => string[]) {
  let consistent = 0
  let wrongLine = 0
  let unknown = 0
  let notCheckable = 0
  const wrongSamples: string[] = []
  for (const e of edges) {
    if (!e.callSite || !e.callSite.file || e.callSite.line === null || e.callSite.line === undefined) {
      unknown++
      continue
    }
    const rel = String(e.callSite.file).replace(/^\.\//, "")
    const src = linesOf(rel)
    // A site inside a file that is NOT in the slice cannot be checked from here.
    // Calling that a wrong line would be this instrument's own lie.
    if (src.length === 0) {
      notCheckable++
      continue
    }
    if (calledLines(src, callee).includes(Number(e.callSite.line))) consistent++
    else {
      wrongLine++
      if (wrongSamples.length < 3) {
        wrongSamples.push(`${rel}:${e.callSite.line} — source line: ${(src[Number(e.callSite.line) - 1] ?? "<missing>").trim().slice(0, 90)}`)
      }
    }
  }
  return { consistent, wrongLine, unknown, notCheckable, wrongSamples }
}

type Cell = {
  lang: string
  repo: string
  callee: string
  tool: string
  sites: number
  consistent: number
  wrongLine: number
  unknownLine: number
  missed: number | null
  missedUpperBound: number
  missedSamples?: string[]
  /** The tool's own truncation flag: a cell sitting at the SQL cap is a floor,
   *  not a complete answer. Presented as `truncated` so 200 never reads as "all". */
  truncated?: boolean
  truncationReason?: string
  nameMultiplicity: number
  grepMentions: number
  grepRealCalls: number
  grepOnlyNoise: number
  notCheckable?: number
  detail?: string
  notMeasurable?: string
}

// The instrument must copy a slice the PRODUCT would actually index. Files under
// a `test/` directory are excluded by ParallelIndexerConfig.skipPatterns
// (`/\/test\//`, matched against the project-relative path). With --files=60 the
// slice landed entirely inside cats-effect's `src/test/**`, discovery returned
// 0 files, and the sweep printed WRONG=0 — a green over an empty world, which is
// precisely the failure this milestone exists to kill. These names mirror the
// product's directory-level exclusions (a faithful subset); the guards in main()
// refuse to emit any verdict if the slice still comes out empty.
const SKIP_DIRS = new Set([
  ".git", "node_modules", "build", "target", "dist", "out", ".gradle", "__pycache__", "vendor",
  "test", "perf", "Microbenchmarks", "wwwroot", "testassets", "benchmarkapps", "testData",
  "coverage", "generated", "__generated__",
])

function collectFiles(root: string, exts: string[], cap: number): string[] {
  const found: string[] = []
  const stack = [root]
  while (stack.length && found.length < cap) {
    const dir = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const e of [...entries].sort()) {
      if (found.length >= cap) break
      if (SKIP_DIRS.has(e)) continue
      const p = path.join(dir, e)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) stack.push(p)
      else if (st.size > 0 && st.size < 400_000 && exts.some((x) => p.endsWith(x))) found.push(p)
    }
  }
  return found
}

async function main() {
  const st = selfTest()
  const stOk = Object.values(st).every(Boolean)
  console.log(`predicate self-test: ${JSON.stringify(st)}`)
  if (!stOk) {
    console.error("FATAL: the source predicate cannot be trusted — verdicts would be meaningless")
    process.exit(1)
  }

  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

  const handlers: any = createToolHandlers()
  const cells: Cell[] = []
  const languages: any[] = []

  for (const spec of LANGS) {
    if (ONLY && !ONLY.includes(spec.lang)) continue
    const repoPath = path.join(CORPUS, spec.repo)
    if (!existsSync(repoPath)) {
      console.log(`\n=== ${spec.lang} (${spec.repo}) — SKIPPED: repo not present ===`)
      continue
    }

    // A SLICE, declared as such: the whole repo would make the sweep an hours-long
    // run, and the claim is about answering from real code, not about scale.
    const files = collectFiles(repoPath, spec.ext, CAP)
    const proj = mkdtempSync(path.join(tmpdir(), `m59-mtx-${spec.lang}-`))
    for (const f of files) {
      const rel = path.relative(repoPath, f)
      const dest = path.join(proj, rel)
      mkdirSync(path.dirname(dest), { recursive: true })
      copyFileSync(f, dest)
    }

    // ── instrument self-check: every real call line must be addressable ──────
    // If the paths the scan produces cannot equal the paths the tool reports, the
    // `missed` number is meaningless. Assert the shapes agree on a file the tool
    // itself named, before any verdict is printed for this language.
    if (files.length > 0) {
      const probeRel = path.relative(repoPath, files[0])
      if (probeRel.startsWith("..") || path.isAbsolute(probeRel)) {
        console.error(`FATAL: ${spec.lang} — slice paths are not project-relative; "missed" would be garbage`)
        process.exitCode = 1
        continue
      }
    }

    // An empty slice is NOT a pass (see SKIP_DIRS above).
    if (files.length === 0) {
      console.error(`FATAL: ${spec.lang} (${spec.repo}) — the slice is empty; no verdict is possible`)
      process.exitCode = 1
      continue
    }

    const pid = getProjectId(proj) as any
    const t0 = Date.now()
    await indexProjectParallel(pid, proj, {})
    const secs = ((Date.now() - t0) / 1000).toFixed(0)
    const db: any = await BrainDatabase.getRawInstance(pid)

    const totals = db
      .prepare(
        `SELECT COUNT(*) total, SUM(line_number=0) zero, SUM(line_number IS NULL) nul, SUM(line_number>0) real
         FROM brain_relationship`,
      )
      .get() as any

    // A world with no relationships would let every cell pass vacuously.
    if (!totals.total) {
      console.error(
        `FATAL: ${spec.lang} (${spec.repo}) — ${files.length} files copied but the indexer wrote 0 relationships; every verdict below would be meaningless`,
      )
      process.exitCode = 1
      continue
    }

    console.log(`\n=== ${spec.lang} — ${spec.repo}: ${files.length} files indexed in ${secs}s ===`)
    console.log(`    relationships total=${totals.total} zero=${totals.zero ?? 0} null=${totals.nul ?? 0} withLine=${totals.real ?? 0}`)

    const topCallees = db
      .prepare(
        `SELECT s.name name, s.id id, COUNT(*) n
         FROM brain_relationship r JOIN brain_symbol s ON s.id = r.target_symbol_id
         WHERE r.relationship_type IN ('calls','call')
         GROUP BY s.name ORDER BY n DESC LIMIT 8`,
      )
      .all() as Array<{ name: string; id: string; n: number }>

    const sourcesByFile = new Map<string, string[]>()
    const linesOf = (rel: string): string[] => {
      if (!sourcesByFile.has(rel)) {
        const p = path.join(proj, rel)
        sourcesByFile.set(rel, existsSync(p) ? readFileSync(p, "utf8").split("\n") : [])
      }
      return sourcesByFile.get(rel)!
    }

    // ── the real tool surface (hoisted: the mutation below re-runs the audit) ──
    const callTool = async (name: string, args: any) => {
      const res: any = await handlers[name](args, { projectId: pid, projectPath: proj })
      const text = res?.content?.[0]?.text ?? ""
      try {
        return { parsed: JSON.parse(text), text }
      } catch {
        return { parsed: null, text }
      }
    }

    const langCells: Cell[] = []
    for (const c of topCallees) {

      // How many DISTINCT symbols carry this name in the index. Text counting is
      // only meaningful when the answer is 1: `sleep`, `set`, `println`, `one` are
      // names many unrelated symbols share, so "every line mentioning it" is NOT
      // "every site of the symbol the tool resolved". Without this, the instrument
      // would report hundreds of phantom misses — the mirror of the grep-vs-tool
      // argument nobody has ever settled.
      const nameMultiplicity = (db.prepare(`SELECT COUNT(*) n FROM brain_symbol WHERE name = ?`).get(c.name) as any).n as number

      const graph = await callTool("bb_graph", { symbol: c.name, maxDepth: 1 })
      const edges: any[] = graph.parsed?.callers ?? []
      // The engine nests it: graphTraversal returns summary.{truncated,truncationReason}
      // (graph-engine.ts:341-350). Reading the top level made every capped cell look
      // complete — 200 returned vs 3,437 real call lines for `ret1` with no signal.
      const truncated = graph.parsed?.summary?.truncated === true
      const truncationReason = graph.parsed?.summary?.truncationReason ?? undefined
      const sites = edges
        .filter((e) => e.callSite && e.callSite.file)
        .map((e) => ({ rel: String(e.callSite.file).replace(/^\.\//, ""), line: e.callSite.line, from: e.from }))

      // The SAME audit the in-run mutation re-runs below — factored out so the
      // mutation proves "this verdict can go red", not that an SQL count moved.
      const audit = auditEdges(edges, c.name, linesOf)
      const { consistent, wrongLine, unknown, notCheckable } = audit

      // ── what the source says (the necessary-condition lower bound) ───────────
      // EVERY slice file is scanned, so "missed" is measured against the whole
      // slice and not only against the files the tool happened to name.
      const realCallLines: Array<{ rel: string; line: number }> = []
      const allMentions: Array<{ rel: string; line: number }> = []
      for (const f of files) {
        // PROJECT-relative, exactly how the tool reports callSite.file. This used
        // to be path.relative(proj, f) with f an absolute CORPUS path, which
        // produced strings like "../../home/…/cats-effect/…": path.join(proj, rel)
        // still normalized back to the real file, so the counts looked plausible,
        // while the reported/real line sets could NEVER intersect. `missed` was
        // therefore always the whole set (117 of 117 for liftF, 47 of 47 for
        // complete — exact equality is the tell). Instrument lie #7.
        const rel = path.relative(repoPath, f)
        const src = linesOf(rel)
        for (const l of calledLines(src, c.name)) realCallLines.push({ rel, line: l })
        for (const l of mentionLines(src, c.name)) allMentions.push({ rel, line: l })
      }
      const reported = new Set(sites.map((s) => `${s.rel}:${s.line}`))
      const missedList = realCallLines.filter((r) => !reported.has(`${r.rel}:${r.line}`))
      const missed = missedList.length
      // Samples make the "missed" number auditable by a human: three real source
      // lines the tool did not report, together with the code on them.
      const missedSamples = missedList
        .slice(0, 3)
        .map((r) => `${r.rel}:${r.line} — ${(linesOf(r.rel)[r.line - 1] ?? "<missing>").trim().slice(0, 90)}`)
      const grepOnly = allMentions.filter((m) => !realCallLines.some((r) => r.rel === m.rel && r.line === m.line)).length

      // ── bb_analyze, the tool the opencode session actually used ──────────────
      // BOUNDED. bb_analyze callers runs graphTraversal at maxDepth=3; on a
      // common name that is minutes of work (the kotlin run was killed at 300s
      // after printing only 2 of 8 cells). An agent has a timeout too, so a tool
      // that cannot answer in 20s is recorded as NOT ANSWERING — never as slow
      // success and never as a hang that stalls the whole sweep.
      const analyze = await Promise.race([
        callTool("bb_analyze", { target: c.name, mode: "callers" }),
        new Promise<{ parsed: null; text: string }>((resolve) => setTimeout(() => resolve({ parsed: null, text: "__TIMEOUT__" }), 20_000)),
      ])
      let analyzeNote: string
      if (analyze.text === "__TIMEOUT__") analyzeNote = "NO ANSWER within 20s (maxDepth=3 traversal on a common name)"
      else if (!analyze.parsed) analyzeNote = `output is not JSON (${analyze.text.slice(0, 60)}…)`
      else {
        const n = analyze.parsed?.nodes ? Object.keys(analyze.parsed.nodes).length : null
        const anySite = JSON.stringify(analyze.parsed).match(/callSite/g)?.length ?? 0
        analyzeNote = `nodes=${n ?? "?"} callSite fields=${anySite}`
      }

      const cell: Cell = {
        lang: spec.lang,
        repo: spec.repo,
        callee: c.name,
        tool: "bb_graph",
        sites: sites.length,
        consistent,
        wrongLine,
        unknownLine: unknown,
        notCheckable,
        nameMultiplicity,
        missed: nameMultiplicity === 1 ? missed : null,
        missedUpperBound: missed,
        grepMentions: allMentions.length,
        grepRealCalls: realCallLines.length,
        grepOnlyNoise: grepOnly,
        detail: audit.wrongSamples.length ? audit.wrongSamples.join(" | ") : undefined,
        missedSamples: missedSamples.length ? missedSamples : undefined,
        truncated,
        truncationReason,
      }
      langCells.push(cell)
      if (analyzeNote) cell.detail = `${cell.detail ? cell.detail + " || " : ""}bb_analyze: ${analyzeNote}`
      console.log(
        `    callee ${c.name.padEnd(28)} sites=${String(sites.length).padStart(4)}${truncated ? " TRUNCATED" : ""} consistent=${String(consistent).padStart(4)} WRONG=${String(wrongLine).padStart(3)} unknown=${String(unknown).padStart(4)} notCheckable=${String(notCheckable).padStart(3)} missed=${nameMultiplicity === 1 ? String(missed).padStart(3) : "AMBIG(" + nameMultiplicity + ")"} | grep mentions=${String(allMentions.length).padStart(5)} realCalls=${String(realCallLines.length).padStart(4)} noise=${String(grepOnly).padStart(4)} | ${analyzeNote}`,
      )
    }

    // ── in-run mutation: corrupt one stored line; the AUDIT must go red ──────
    // The first version compared SQL row counts at two lines and could never
    // fail (clean=1, corrupted=1, restored=1 → "caught: false" in every cell of
    // the first sweep). A mutation that cannot turn the verdict red is the
    // "200 → 200 → 200" tautology again. This one re-runs the REAL audit for the
    // same callee, on a row whose file is inside the slice, and requires the
    // consistent count to drop and then recover exactly.
    // Prefer a small cell (fast), but NEVER skip: the java slice put every cell
    // at the 200-row cap, so the previous `consistent < 100` filter silently
    // skipped the mutation entirely (`mutation: {"ran":false}`) and the run
    // proved nothing about its own red-ability.
    const sample =
      langCells.find((c) => c.consistent > 0 && c.consistent < 100 && c.callee) ??
      langCells.find((c) => c.consistent > 0 && c.callee)
    let mutation: any = { ran: false }
    if (sample) {
      const row = db
        .prepare(
          `SELECT r.id, r.line_number ln, f.relative_path rel
           FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.target_symbol_id
           JOIN brain_symbol src ON src.id = r.source_symbol_id
           JOIN brain_file f ON f.id = src.file_id
           WHERE s.name = ? AND r.line_number > 0 AND r.relationship_type IN ('calls','call')
           LIMIT 1`,
        )
        .get(sample.callee) as any
      const inSlice = row && existsSync(path.join(proj, String(row.rel)))
      if (inSlice) {
        const auditNow = async () => {
          const g = await callTool("bb_graph", { symbol: sample.callee, maxDepth: 1 })
          return auditEdges(g.parsed?.callers ?? [], sample.callee, linesOf)
        }
        const before = await auditNow()
        // Far past EOF for that file: cannot be a call of anything, so a correct
        // tool MUST surface it as a wrong line.
        db.prepare(`UPDATE brain_relationship SET line_number = ? WHERE id = ?`).run(row.ln + 1_000_000, row.id)
        const during = await auditNow()
        db.prepare(`UPDATE brain_relationship SET line_number = ? WHERE id = ?`).run(row.ln, row.id)
        const after = await auditNow()
        mutation = {
          ran: true,
          callee: sample.callee,
          rowId: row.id,
          file: row.rel,
          originalLine: row.ln,
          consistentBefore: before.consistent,
          consistentDuring: during.consistent,
          consistentAfter: after.consistent,
          wrongBefore: before.wrongLine,
          wrongDuring: during.wrongLine,
          wrongAfter: after.wrongLine,
          caught: during.consistent < before.consistent && after.consistent === before.consistent && after.wrongLine === before.wrongLine,
        }
      }
    }
    console.log(`    mutation: ${JSON.stringify(mutation)}`)
    cells.push(...langCells)
    languages.push({
      lang: spec.lang,
      repo: spec.repo,
      // Proves "the same slice" instead of assuming it: two runs whose
      // fingerprint AND relationship totals match were measured on the same
      // world, so any difference in the cells below is the TOOL's, not the
      // corpus's. (Two earlier scala runs both reported 19,082 relationships but
      // different per-callee counts — that claim needed this field.)
      sliceFingerprint: createHash("sha1")
        .update(files.map((f) => path.relative(repoPath, f)).sort().join("\n"))
        .digest("hex"),
      filesIndexed: files.length,
      indexSeconds: Number(secs),
      relationships: totals,
      mutation,
      topCallees: topCallees.length,
    })
  }

  const agg = {
    cells: cells.length,
    wrongLine: cells.reduce((a, c) => a + c.wrongLine, 0),
    missed: cells.reduce((a, c) => a + (c.missed ?? 0), 0),
    missedUpperBound: cells.reduce((a, c) => a + c.missedUpperBound, 0),
    ambiguousCells: cells.filter((c) => c.nameMultiplicity > 1).length,
    consistent: cells.reduce((a, c) => a + c.consistent, 0),
    unknownLine: cells.reduce((a, c) => a + c.unknownLine, 0),
    grepMentions: cells.reduce((a, c) => a + c.grepMentions, 0),
    grepRealCalls: cells.reduce((a, c) => a + c.grepRealCalls, 0),
    grepOnlyNoise: cells.reduce((a, c) => a + c.grepOnlyNoise, 0),
  }

  console.log("\n=== MATRIX SUMMARY (bb_graph x language, real index, source-derived) ===")
  for (const l of languages) {
    const lc = cells.filter((c) => c.lang === l.lang)
    console.log(
      `${l.lang.padEnd(11)} ${l.repo.padEnd(18)} files=${String(l.filesIndexed).padStart(4)} cells=${String(lc.length).padStart(3)} consistent=${String(lc.reduce((a, c) => a + c.consistent, 0)).padStart(5)} WRONG=${String(lc.reduce((a, c) => a + c.wrongLine, 0)).padStart(3)} unknown=${String(lc.reduce((a, c) => a + c.unknownLine, 0)).padStart(4)} missed=${String(lc.reduce((a, c) => a + (c.missed ?? 0), 0)).padStart(4)}`,
    )
  }
  console.log(
    `TOTAL cells=${agg.cells} consistent=${agg.consistent} WRONG=${agg.wrongLine} unknown=${agg.unknownLine} missed=${agg.missed} | grep mentions=${agg.grepMentions} of which realCalls=${agg.grepRealCalls} noise=${agg.grepOnlyNoise}`,
  )

  const payload = {
    probe: "M59.MTX",
    at: new Date().toISOString(),
    command: process.argv.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" "),
    commit: (() => {
      try {
        return String(execSync("git rev-parse HEAD", { cwd: ROOT })).trim()
      } catch {
        return null
      }
    })(),
    scope: `bb_graph driven through the REAL MCP handler, on ${CAP}-file slices of real corpus repos; bb_analyze cells recorded as output-shape notes; predicate is a NECESSARY condition (lower bound), so "consistent" is never proof of correctness`,
    predicateSelfTest: st,
    dataRoot: DATA_ROOT,
    languages,
    cells,
    aggregate: agg,
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(payload, null, 2))
  console.log(`\nevidence: ${path.relative(ROOT, OUT)}`)

  if (languages.length === 0 || cells.length === 0) {
    console.error("FATAL: no language produced a measurable world — this run is not evidence of anything")
    process.exitCode = 1
  }
  if (agg.wrongLine > 0) {
    console.log(`\n${agg.wrongLine} WRONG-LINE site(s) found — the tool reported a position that does not call the callee.`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error("MATRIX ERROR:", e?.stack ?? e)
  process.exitCode = 1
})
