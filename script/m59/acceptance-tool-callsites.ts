// script/m59/acceptance-tool-callsites.ts — M59.ACC
//
// THE STANDING INSTRUMENT for "what does bb_graph actually answer about call
// sites?" — the question #822/#823 were about, and the one every future
// analyzer wave must be measured against. Four parts, each able to fail:
//
//   A. FIXTURE per line-emitting language — one caller invoking one callee 4
//      times on 4 known lines. The TOOL (graphTraversal — bb_graph's engine,
//      not the DB) must return all 4, at those 4 lines. Expected values come
//      from the fixture text, never from the index.
//   B. FIXTURE per line-less language — the tool must report line: null. A
//      substituted declaration line here is the #823 defect returning.
//   C. REAL CORPUS — for the callees with the most incoming calls, every site
//      the tool reports is checked against (i) the DB row it claims (rowId →
//      line_number) and (ii) the caller's SOURCE (the token must be written on
//      the claimed line), and the tool's site COUNT per caller file is compared
//      against a CONSERVATIVE lower bound derived from that file's text.
//   D. MUTATION, in-run RED/GREEN — a sampled callee's audit is clean, one of
//      its stored lines is corrupted, the SAME audit must turn red, the row is
//      restored, and the audit must turn clean again. No `|| true` anywhere: a
//      harness that cannot fail proves nothing.
//
// Scope, declared in the output rather than implied: Part C's lower bound is a
// NECESSARY condition (it undercounts on purpose, so a mismatch is a real
// missing site but a match is not proof of completeness), and languages whose
// analyzer emits no line are reported separately — their sites cannot be told
// apart yet, and are never counted as passing.
//
// Usage:
//   npx tsx script/m59/acceptance-tool-callsites.ts                       # fresh index
//   M59_ACCEPT_DATA=/tmp/m59-data-xxxx npx tsx ... --reuse                # reuse an index
//   npx tsx ... --repo=$HOME/fixtures/repositories/some-repo

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const DATA = process.env.M59_ACCEPT_DATA ?? mkdtempSync(path.join(tmpdir(), "m59-acc-data-"))
const REUSE = process.argv.includes("--reuse") && !!process.env.M59_ACCEPT_DATA
// SAFETY: Part D corrupts and deletes rows (then restores them). If the process
// dies mid-mutation, the index it pointed at is left wrong. Refuse to run
// against anything that is not clearly a throwaway data dir.
const TMP = tmpdir()
if (!DATA.startsWith(TMP) && !DATA.startsWith("/tmp/") && !process.argv.includes("--allow-mutations-on-this-index")) {
  console.error(
    `REFUSING TO RUN: ${DATA} is not a temp data dir, and this harness mutates rows (Part D).\n` +
      `Point M59_ACCEPT_DATA at a throwaway directory, or pass --allow-mutations-on-this-index if you accept that.`,
  )
  process.exit(2)
}
process.env.BB_DATA_DIR = DATA

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const REPO_ARG = process.argv.find((a) => a.startsWith("--repo="))?.slice("--repo=".length)
const REPO = REPO_ARG ?? "$HOME/fixtures/repositories/cats-effect"

let failures = 0
let checks = 0

function check(name: string, ok: boolean, detail: string) {
  checks++
  if (ok) console.log(`  PASS  ${name}  ${detail}`)
  else {
    failures++
    console.log(`  FAIL  ${name}  ${detail}`)
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// ─────────────────────────────────────────────────────────────────────────────
// The conservative source lower bound: lines that unambiguously CALL `token`.
// Deliberately undercounts — a mention that slips through can only make the
// harness demand MORE sites, so the completeness check stays one-sided and can
// never excuse a missing site.
// ─────────────────────────────────────────────────────────────────────────────
const DECL_KEYWORDS = [
  "fun", "def", "void", "int", "long", "double", "float", "boolean", "bool", "char", "byte", "short",
  "String", "Object", "public", "private", "protected", "internal", "static", "final", "abstract",
  "synchronized", "native", "override", "open", "suspend", "operator", "inline", "external",
  // 3rd instrument defect (#855 round): javascript/typescript declare with
  // `function`, which no keyword here covered — the callee's own declaration
  // line was counted as a call site. Covered by the self-test below.
  "function",
]
const COMMENT_PREFIX = ["//", "*", "/*", "#", "--"]

// NOTE on the boundary: `.` is DELIBERATELY allowed on both sides. A qualified
// call (`io.unsafeRunSync()`, `IO.raiseError(...)`, `.as(ExitCode.Success)`) is a
// call to that name, and the first version of this harness excluded `.` — which
// accused 2,552 of 2,698 real sites of being on the wrong line. The same class of
// instrument defect script/m59/oracle-callsite.ts had with `$`; recorded here so
// it is not repeated a third time. Substrings are still excluded by the WORD
// boundary: `retarget()` does not match token `target` (asserted in the
// self-test below).
export function calledLines(lines: string[], token: string): number[] {
  const call = new RegExp(`(^|[^\\w])${escapeRe(token)}\\s*\\(`)
  const decl = new RegExp(`(^|\\s)(${DECL_KEYWORDS.join("|")})\\b[^;]*\\b${escapeRe(token)}\\s*\\(`)
  // 3rd instrument defect of the #855 round, found by moving typescript from
  // UNLINED to LINED: `fun`/`def`/`int`/`static` cover java/kotlin/scala/groovy/
  // python declarations, but javascript and typescript declare with `function`
  // and `const f = () => …`, neither of which was excluded — so the CALLEE'S OWN
  // DECLARATION LINE was counted as a call site and the harness demanded a site
  // the tool correctly does not report (`fixture has 5 call(s) on [1,3,4,5,6]`
  // for a source with 4 real calls). The assignment form is matched separately:
  // `target = (…)`/`target = async (…)`/`target = x =>` declare; `target(` calls;
  // and a `=` BEFORE the token (an initialisation like `val a = target()`) still
  // counts as a call — which is why the two are not merged into one regex.
  const declAssign = new RegExp(`(^|[^\\w])${escapeRe(token)}\\s*=\\s*(async\\s*)?(\\(|function\\b|\\w+\\s*=>)`)
  const out: number[] = []
  // BLOCK COMMENTS must be tracked across lines. Measured false accusations
  // before this: `/*def raceLeftCedeYields … F.pure(a)) <-> F.pure(Right(a))*/`
  // and `/*@Benchmark … task.unsafeRunSync() }*/` — the closing line does not
  // START with `*`, so a per-line prefix test missed them (5th instrument defect
  // of this round). Block comment state, inline `/* … */` stripped.
  let inBlock = false
  lines.forEach((raw, i) => {
    let text = raw
    if (inBlock) {
      const end = text.indexOf("*/")
      if (end === -1) return
      text = text.slice(end + 2)
      inBlock = false
    }
    let code = ""
    let rest = text
    for (;;) {
      const open = rest.indexOf("/*")
      if (open === -1) {
        code += rest
        break
      }
      code += rest.slice(0, open)
      const close = rest.indexOf("*/", open + 2)
      if (close === -1) {
        inBlock = true
        break
      }
      rest = rest.slice(close + 2)
    }
    const line = code.trim()
    if (!line) return
    if (COMMENT_PREFIX.some((p) => line.startsWith(p))) return
    const m = call.exec(line)
    if (!m) return
    const before = line.slice(0, m.index + m[0].length - token.length - 1)
    // A declaration names the token without assigning anything. If an `=` sits
    // before the token the line is an initialisation/call (`val a = target()`),
    // so it still counts as a call site.
    if (!before.includes("=") && (decl.test(line) || declAssign.test(line))) return
    out.push(i + 1)
  })
  return out
}

type Audit = {
  sites: number
  fabricated: number
  wrongLine: number
  missing: number
  missingFromIndex: number
  missingFromTool: number
  splitResolution: number
  fabricatedDetail: string[]
  missingDetail: string[]
  rowsAudited: Array<{ rowId: string; line: number | null; file: string }>
}

function emptyAudit(): Audit {
  return { sites: 0, fabricated: 0, wrongLine: 0, missing: 0, missingFromIndex: 0, missingFromTool: 0, splitResolution: 0, fabricatedDetail: [], missingDetail: [], rowsAudited: [] }
}

function addAudit(into: Audit, from: Audit) {
  into.sites += from.sites
  into.fabricated += from.fabricated
  into.wrongLine += from.wrongLine
  into.missing += from.missing
  into.missingFromIndex += from.missingFromIndex
  into.missingFromTool += from.missingFromTool
  into.splitResolution += from.splitResolution
  into.fabricatedDetail.push(...from.fabricatedDetail)
  into.missingDetail.push(...from.missingDetail)
  into.rowsAudited.push(...from.rowsAudited)
}

/** One callee, audited the way an agent would experience it: ask the tool, then
 *  check the answer against the tool's own row and against the source. */
function auditCallee(craw: any, traversal: any, calleeName: string): Audit {
  const a = emptyAudit()
  const rootId: string = traversal.root?.id
  // DIRECT edges only. `callers` deliberately also carries TRANSITIVE callers
  // (depth ≥ 1 — callers of the caller), and auditing those against the callee's
  // own name accused 1,559 correct edges of being wrong lines: `main → run` at
  // depth 1 is not a claim about `as` at all. Third instrument defect of this
  // round, same lesson as the other two — measure what the number means first.
  const edges = (traversal.callers ?? []).filter((x: any) => x.rowId && x.to === rootId && (x.depth ?? 0) === 0)
  const rowIds: string[] = edges.map((x: any) => x.rowId)
  // The row's OWN target name is the check token, not the queried callee: a
  // cascade member edge (`Foo` root, call to `Foo.bar`) legitimately names a
  // member, so the source line must be checked against that name.
  const rows = new Map<string, { line: number | null; token: string }>()
  if (rowIds.length) {
    const ph = rowIds.map(() => "?").join(",")
    for (const row of craw
      .prepare(
        `SELECT r.id, r.line_number ln, COALESCE(ts.name, r.target_external, '') tname
         FROM brain_relationship r LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
         WHERE r.id IN (${ph})`,
      )
      .all(...rowIds) as any[]) {
      rows.set(row.id, { line: row.ln ?? null, token: String(row.tname ?? "").split(".").pop() ?? "" })
    }
  }
  const perFileToken = new Map<string, { file: string; token: string; lines: number[] }>()

  for (const e of edges) {
    a.sites++
    const shown: number | null = e.callSite?.line ?? null
    const row = rows.get(e.rowId)
    if (!row || (row.line ?? null) !== shown) {
      a.fabricated++
      if (a.fabricatedDetail.length < 8)
        a.fabricatedDetail.push(`${calleeName}: rowId ${e.rowId} tool=${JSON.stringify(shown)} db=${JSON.stringify(row ? row.line : "NO ROW")}`)
      continue
    }
    a.rowsAudited.push({ rowId: e.rowId, line: shown, file: e.callSite?.file ?? "" })
    if (typeof shown !== "number" || shown < 1 || !row.token) continue
    const abs = path.join(REPO, e.callSite.file)
    const lines = existsSync(abs) ? readFileSync(abs, "utf8").split("\n") : []
    const srcLine = lines[shown - 1] ?? ""
    if (!new RegExp(`(^|[^\\w])\\$?${escapeRe(row.token)}([^\\w]|$)`).test(srcLine)) {
      a.wrongLine++
      if (a.fabricatedDetail.length < 8)
        a.fabricatedDetail.push(`${calleeName} → ${row.token}: ${e.callSite.file}:${shown} claims the call — source line is "${srcLine.trim().slice(0, 70)}"`)
    }
    const key = `${e.callSite.file}\u0000${row.token}`
    if (!perFileToken.has(key)) perFileToken.set(key, { file: e.callSite.file, token: row.token, lines: [] })
    perFileToken.get(key)!.lines.push(shown)
  }

  for (const { file, token, lines: shownLines } of perFileToken.values()) {
    const abs = path.join(REPO, file)
    if (!existsSync(abs)) continue
    const expect = calledLines(readFileSync(abs, "utf8").split("\n"), token)
    const distinct = new Set(shownLines).size
    if (expect.length <= distinct) continue
    // Before calling a site MISSING, rule out the benign cause: the tool answers
    // per RESOLVED SYMBOL (resolveGraphRoot picks one by name), while several
    // same-named symbols can live in one file. If the file's DB rows for this
    // token — under ANY resolved identity — already count the source's call
    // lines, the site is not lost, it is filed under another symbol. Only what
    // remains unexplained is reported as missing.
    const fileTokens = craw
      .prepare(
        `SELECT COUNT(DISTINCT r.line_number) c
         FROM brain_relationship r
         JOIN brain_symbol s ON s.id = r.source_symbol_id
         JOIN brain_file f ON f.id = s.file_id
         LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
         WHERE f.relative_path = ? AND r.relationship_type IN ('calls','call')
           AND (ts.name = ? OR r.target_external LIKE ? OR r.target_external = ?)`,
      )
      .get(file, token, `%.${token}`, token) as any
    const accounted = Number(fileTokens?.c ?? 0)
    if (accounted >= expect.length) {
      a.splitResolution++
      if (a.missingDetail.length < 12)
        a.missingDetail.push(`[accounted] ${token} in ${file}: source has ${expect.length} call line(s), the audited symbol reports ${distinct}, the file holds ${accounted} call-site line(s) for this token under other resolved identities — not a lost site`)
      continue
    }    a.missing += expect.length - distinct
    if (a.missingDetail.length < 12) {
      const shown = new Set(shownLines)
      const absent = expect.filter((l) => !shown.has(l))
      const lines = readFileSync(abs, "utf8").split("\n")
      // WHOSE gap is it? A source call with NO index row at all is the analyzer
      // lane's (emission). A source call whose row EXISTS but that the tool did
      // not report is OURS — that is the one this harness gates.
      const rowAt = craw.prepare(
        `SELECT COUNT(*) c FROM brain_relationship r
         JOIN brain_symbol s ON s.id = r.source_symbol_id JOIN brain_file f ON f.id = s.file_id
         LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
         WHERE f.relative_path = ? AND r.line_number = ?
           AND (ts.name = ? OR r.target_external LIKE ? OR r.target_external = ?)`,
      )
      let fromIndex = 0
      let fromTool = 0
      const absentText = absent
        .slice(0, 6)
        .map((l) => {
          const hasRow = Number((rowAt.get(file, l, token, `%.${token}`, token) as any)?.c ?? 0) > 0
          if (hasRow) fromTool++
          else fromIndex++
          return `${l}${hasRow ? "[row-exists-but-not-reported]" : "[no-index-row]"}="${(lines[l - 1] ?? "").trim().slice(0, 60)}"`
        })
        .join(" | ")
      a.missingFromIndex += fromIndex
      a.missingFromTool += fromTool
      a.missingDetail.push(
        `${token} in ${file}: source has ${expect.length} unambiguous call line(s), tool reports ${distinct}; absent ${JSON.stringify(absent)} — ${absentText}`,
      )
    }
  }
  return a
}

async function main() {
  const { execSync } = await import("node:child_process")
  const commit = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim()
  // Tracked files modified against that commit (untracked scratch excluded):
  // a non-zero value means the artifact is a WORKING-TREE measurement.
  const modifiedInputs = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("?? ")).length
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const { graphTraversal } = await import(path.join(ROOT, "src/intelligence/graph/graph-engine.ts"))

  console.log(`data dir : ${DATA}${REUSE ? " (reused)" : " (fresh index)"}`)
  console.log(`repo     : ${REPO}\n`)

  // ── the lower bound's own self-test: it must count real calls and refuse
  // mentions/declarations. A predicate that cannot be trusted voids Part C.
  const boundSelfTest = {
    declarationNotCounted: calledLines(["  fun target(): Int { return 1 }"], "target").length === 0,
    assignmentCounted: JSON.stringify(calledLines(["  val a = target()", "  val b = target()"], "target")) === JSON.stringify([1, 2]),
    commentNotCounted: calledLines(["  // target() is called here"], "target").length === 0,
    javaDeclarationNotCounted: calledLines(["  static int target() { return 1; }"], "target").length === 0,
    javaAssignmentCounted: calledLines(["    int a = target();"], "target").length === 1,
    blockCommentNotCounted: calledLines(["  /*def f() =", "    target(a) <-> target(b)*/"], "target").length === 0,
    inlineCommentStripped: calledLines(["  val a = target() // target() again"], "target").length === 1,
    codeAfterBlockCommentEndsCounted: calledLines(["/* c", "*/ val a = target()"], "target").length === 1,
    qualifiedCallCounted: calledLines(["  io.unsafeRunSync()", "  IO.raiseError(e)", "  .getOrElse(x)"], "getOrElse").length === 1,
    dollarPrefixedNameCounted: calledLines(['  $target(1)'], "target").length === 1,
    // Typescript declaration shapes must not count (defect 3 above).
    typescriptFunctionDeclarationNotCounted: calledLines(["export function target(): number { return 1 }"], "target").length === 0,
    typescriptArrowConstDeclarationNotCounted: calledLines(["export const target = () => 1"], "target").length === 0,
    typescriptAsyncArrowDeclarationNotCounted: calledLines(["const target = async (x: number) => x"], "target").length === 0,
    // …while the same name in a call position on an initialisation line still counts.
    typescriptInitialisationCallStillCounted: calledLines(["  const a = target()"], "target").length === 1,
  }
  const boundOk = Object.values(boundSelfTest).every(Boolean)
  check("lower-bound-predicate-self-test", boundOk, JSON.stringify(boundSelfTest))
  if (!boundOk) {
    console.error("FATAL: the lower bound cannot be trusted — Part C verdicts would be meaningless")
    process.exit(1)
  }

  // ── A + B: fixtures ───────────────────────────────────────────────────────
  const project = mkdtempSync(path.join(tmpdir(), "m59-acc-proj-"))
  mkdirSync(path.join(project, "src"), { recursive: true })

  // One callee name PER language fixture. Sharing `target` made the TS/Python
  // assertion read the JAVA caller's edges — resolveGraphRoot picks one symbol
  // per name, so a shared name silently measured the wrong fixture (the fourth
  // instrument defect of this round).
  const LINED = [
    { lang: "java", file: "F.java", callee: "targetJava", caller: "callerJava", src: (c: string, k: string) => `public class F {\n  static int ${c}() { return 1; }\n  static int ${k}() {\n    int a = ${c}();\n    int b = ${c}();\n    int c = ${c}();\n    int d = ${c}();\n    return a + b + c + d;\n  }\n}\n` },
    { lang: "kotlin", file: "F.kt", callee: "targetKt", caller: "callerKt", src: (c: string, k: string) => `fun ${c}(): Int { return 1 }\nfun ${k}(): Int {\n  val a = ${c}()\n  val b = ${c}()\n  val c = ${c}()\n  val d = ${c}()\n  return a + b + c + d\n}\n` },
    { lang: "scala", file: "F.scala", callee: "targetScala", caller: "callerScala", src: (c: string, k: string) => `object F {\n  def ${c}(): Int = 1\n  def ${k}(): Int = {\n    val a = ${c}()\n    val b = ${c}()\n    val c = ${c}()\n    val d = ${c}()\n    a + b + c + d\n  }\n}\n` },
    { lang: "groovy", file: "F.groovy", callee: "targetGroovy", caller: "callerGroovy", src: (c: string, k: string) => `class F {\n  static int ${c}() { return 1 }\n  static int ${k}() {\n    int a = ${c}()\n    int b = ${c}()\n    int c = ${c}()\n    int d = ${c}()\n    return a + b + c + d\n  }\n}\n` },
    // M59 (#855): the anonymous-member-INITIALISER shape, end-to-end. The callee
    // is called from the `val` initialisers of an anonymous class body, where the
    // analyzer's edge source is the anonymous type itself (`anonymous_Runnable`)
    // — a name the store's artifact filter refuses to persist
    // (src/ast/analysis-exclusions.ts). Before the index-layer fix both rows were
    // stored with a NULL source, so the tool could answer NO site here; on
    // cats-effect the same shape made it answer 3 of 4 real `liftF` call sites
    // (TimeT.scala:148). `from` must therefore be the innermost STOREABLE
    // enclosing symbol — this fixture's caller — or this check cannot pass. Only
    // `val` initialisers are used deliberately: a call from a `def` inside the
    // body attributes to that def's own storeable symbol and would exercise
    // nothing.
    //
    // 2026-09-17 — this fixture went RED at the #866 tree and the cause was
    // checked layer by layer (script/m59/probe-anon-init-regression.ts), not
    // assumed: the analyzer emits both calls, the store persists both with lines
    // 6/8, and the tool returns both — attributed to the anonymous body's field
    // members `a`/`b` (owner_symbol_id NULL), not to `callerScalaAnon`. So
    // membership here is "caller OR a symbol lexically inside the caller", and
    // the missing link is asserted separately by
    // `nested-site-source-reaches-the-caller` (declared known red) instead of
    // being hidden by loosening the site check.
    { lang: "scala-anon-initializer", file: "Fanon.scala", callee: "targetScalaAnon", caller: "callerScalaAnon", src: (c: string, k: string) => `object Fanon {\n  def ${c}(): Int = 1\n  def ${k}(): Unit =\n    new Runnable {\n      val a =\n        ${c}()\n      val b =\n        ${c}()\n    }\n}\n` },
    // M59 web round: typescript moved here from UNLINED. It stopped being an
    // "unknown line" language when the web line work landed (#825 family: the
    // ts lanes read 2074/2074 with 0 inconsistent), so the old membership was a
    // STALE expectation that failed this harness on every run after that round —
    // a red check that no longer described the product. Moving it converts the
    // assertion from "must stay null" to the stronger "reports every site".
    { lang: "typescript", file: "f.ts", callee: "targetTs", caller: "callerTs", src: (c: string, k: string) => `export function ${c}(): number { return 1 }\nexport function ${k}(): number {\n  const a = ${c}()\n  const b = ${c}()\n  const c = ${c}()\n  const d = ${c}()\n  return a + b + c + d\n}\n` },
  ]
  // Languages whose analyzers still emit NO call-site line: the tool must
  // report null rather than a substituted number (#823). python is the control
  // that keeps this state covered now that typescript has landed lines.
  const UNLINED = [
    { lang: "python", file: "f.py", callee: "targetPy", caller: "callerPy", src: (c: string, k: string) => `def ${c}():\n    return 1\n\ndef ${k}():\n    a = ${c}()\n    b = ${c}()\n    c = ${c}()\n    d = ${c}()\n    return a + b + c + d\n` },
  ]

  type Expectation = { lang: string; expectedLines: number[]; callee: string; caller: string; lined: boolean }
  const expectations: Expectation[] = []
  for (const f of LINED) {
    const src = f.src(f.callee, f.caller)
    writeFileSync(path.join(project, "src", f.file), src)
    expectations.push({ lang: f.lang, expectedLines: calledLines(src.split("\n"), f.callee), callee: f.callee, caller: f.caller, lined: true })
  }
  for (const f of UNLINED) {
    writeFileSync(path.join(project, "src", f.file), f.src(f.callee, f.caller))
    expectations.push({ lang: f.lang, expectedLines: [], callee: f.callee, caller: f.caller, lined: false })
  }

  const fpid = getProjectId(project) as any
  await indexProjectParallel(fpid, project, {})

  // ── fixture attribution helper ────────────────────────────────────────────
  // The tool's `from` is a symbol id. Before #866 a call from an anonymous
  // body's `val` initialiser was attributed to the innermost STOREABLE enclosing
  // symbol (the caller itself). #866 emits the body's field member as a real
  // symbol, so the same call is now attributed to that member (`a`, line 5) —
  // lexically INSIDE the caller. Membership must therefore be "the caller, or a
  // symbol contained within the caller's own line span", otherwise a correct
  // finer-grained answer is read as "the site vanished".
  const fraw: any = await BrainDatabase.getRawInstance(fpid)
  const symInfo = (id: string) =>
    fraw
      .prepare(`SELECT name, file_id, line_start, line_end, owner_symbol_id FROM brain_symbol WHERE id = ?`)
      .get(id) as
      | { name: string; file_id: string; line_start: number; line_end: number; owner_symbol_id: string | null }
      | undefined
  const callerSpans = new Map<string, { fileId: string; start: number; end: number } | null>()
  const callerSpanOf = (name: string) => {
    if (!callerSpans.has(name)) {
      const r = fraw
        .prepare(`SELECT file_id, line_start, line_end FROM brain_symbol WHERE name = ? ORDER BY line_start LIMIT 1`)
        .get(name) as any
      callerSpans.set(name, r ? { fileId: r.file_id, start: r.line_start, end: r.line_end } : null)
    }
    return callerSpans.get(name)!
  }
  let nestedSites = 0
  let nestedReachingCaller = 0
  let nestedUnreachable = 0

  const fixtureResults: any[] = []
  for (const e of expectations) {
    let t: any
    try {
      t = await graphTraversal(fpid, e.callee, {})
    } catch (err: any) {
      check(`${e.lang}-tool-answers`, false, `graphTraversal threw: ${err?.message}`)
      continue
    }
    const span = callerSpanOf(e.caller)
    const isDirect = (x: any) => String(x.from ?? "").includes(e.caller)
    const isNested = (x: any) => {
      const s = symInfo(String(x.from ?? ""))
      return !!(s && span && s.file_id === span.fileId && s.line_start >= span.start && s.line_end <= span.end)
    }
    const edges = (t.callers ?? []).filter((x: any) => isDirect(x) || isNested(x))
    const lines: Array<number | null> = edges.map((x: any) => x.callSite?.line ?? null)
    const known = [...new Set(lines.filter((l): l is number => typeof l === "number" && l > 0))].sort((a, b) => a - b)
    const nulls = lines.filter((l) => l === null).length
    const nested = edges.filter((x: any) => !isDirect(x) && isNested(x))
    nestedSites += nested.length
    for (const x of nested) {
      // Walk the owner chain up to the caller: the answer is only interpretable
      // if the agent can get from the reported source to the symbol it asked
      // about. A NULL owner is a dead end (this is what #866 leaves behind).
      let cur = symInfo(String(x.from))?.owner_symbol_id ?? null
      let reaches = false
      for (let hop = 0; hop < 12 && cur; hop++) {
        const s = symInfo(cur)
        if (!s) break
        if (s.name === e.caller) { reaches = true; break }
        cur = s.owner_symbol_id
      }
      if (reaches) nestedReachingCaller++
      else nestedUnreachable++
    }
    fixtureResults.push({ lang: e.lang, toolSites: edges.length, knownLines: known, nullLines: nulls, expectedLines: e.expectedLines, nestedSites: nested.length })

    if (e.lined) {
      check(
        `${e.lang}-tool-reports-every-site`,
        known.length === e.expectedLines.length && e.expectedLines.every((l) => known.includes(l)),
        `tool says ${edges.length} site(s) at ${JSON.stringify(known)}; fixture has ${e.expectedLines.length} call(s) on ${JSON.stringify(e.expectedLines)}`,
      )
    } else {
      check(
        `${e.lang}-unknown-stays-null`,
        edges.length > 0 && nulls === edges.length,
        `tool line(s) ${JSON.stringify(lines)} — expected null for every one (a number here is the #823 substitution)`,
      )
    }
  }

  // DECLARED KNOWN RED — do not delete and do not weaken. #855's fixture exists
  // to prove a call from an anonymous body's initialiser stays attributable to
  // the caller. #866 made the body's field members real symbols, so the site is
  // now attributed to the MEMBER — fine-grained but stored with
  // owner_symbol_id = NULL, so the answer names a generic symbol (`a`) that no
  // owner chain connects to the caller. The site is not lost (checked above,
  // containment); what is missing is the link that makes the answer readable.
  // Filed against the JVM/analyzer lane; this check stays red until it is fixed.
  check(
    "nested-site-source-reaches-the-caller",
    nestedUnreachable === 0,
    `${nestedSites} nested-source site(s); ${nestedReachingCaller} reach the caller by owner chain, ${nestedUnreachable} dead-end at a NULL owner`,
  )

  // ── C: the real corpus ────────────────────────────────────────────────────
  const rpid = getProjectId(REPO) as any
  if (!REUSE) {
    const t0 = Date.now()
    const stats = await indexProjectParallel(rpid, REPO, {})
    console.log(`\nindexed ${REPO}: files=${stats.totalFiles} rels=${stats.relationshipsFound} errors=${stats.errorFiles} in ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  } else {
    console.log(`\ncorpus: reusing the existing index for ${REPO}`)
  }
  const craw = await BrainDatabase.getRawInstance(rpid)

  const topCallees = craw
    .prepare(
      `SELECT ts.id tid, ts.name tname, COUNT(*) n
       FROM brain_relationship r JOIN brain_symbol ts ON ts.id = r.target_symbol_id
       WHERE r.relationship_type IN ('calls','call')
       GROUP BY ts.id ORDER BY n DESC LIMIT 12`,
    )
    .all() as Array<{ tid: string; tname: string; n: number }>

  const total = emptyAudit()
  const byCallee: any[] = []
  for (const c of topCallees) {
    let t: any
    try {
      t = await graphTraversal(rpid, c.tname, {})
    } catch {
      continue
    }
    const a = auditCallee(craw, t, c.tname)
    addAudit(total, a)
    byCallee.push({ callee: c.tname, incomingEdges: c.n, sites: a.sites, fabricated: a.fabricated, wrongLine: a.wrongLine, missing: a.missing })
  }

  console.log("\n=== C. real corpus: the tool's sites vs its own DB rows and the source ===")
  console.log(`  callees sampled        : ${byCallee.length}`)
  console.log(`  sites checked          : ${total.sites}`)
  console.log(`  fabricated/misreported : ${total.fabricated}`)
  console.log(`  wrong line vs source   : ${total.wrongLine}`)
  console.log(`  missing sites (lower bound): ${total.missing}  →  ${total.missingFromIndex} with NO index row (analyzer lane), ${total.missingFromTool} NOT reported by the tool (OURS)`)
  console.log(`  accounted by another same-named symbol: ${total.splitResolution}  (informational — see detail lines)`)
  for (const d of total.fabricatedDetail) console.log(`    ${d}`)
  for (const d of total.missingDetail) console.log(`    ${d}`)
  check("corpus-no-fabricated-lines", total.fabricated === 0, `${total.fabricated} of ${total.sites} sites showed a line their own row does not store`)
  check("corpus-no-wrong-lines", total.wrongLine === 0, `${total.wrongLine} of ${total.sites} sites are not written on the source line they claim`)
  check("corpus-no-missing-sites-from-the-tool", total.missingFromTool === 0, `${total.missingFromTool} site(s) exist in the index but the tool did not report them (our layer)`)
  if (total.missingFromIndex > 0)
    console.log(`\n  FINDING (analyzer lane, not gated here): ${total.missingFromIndex} source call site(s) have no index row at all — listed above with file:line`)

  // ── D: mutation, in-run RED/GREEN on the SAME audit ───────────────────────
  // Pick a callee whose audit is clean, then corrupt one of the rows THAT AUDIT
  // ACTUALLY READ (an earlier version took any row for the symbol, which was
  // often outside the audited set and the mutation proved nothing), re-audit,
  // require red, restore, require clean.
  // `sites < 100`: the tool's per-direction SQL is LIMIT 200, and a saturated
  // answer made the deletion mutation unreadable — after restoring the row it
  // could fall outside the window (measured: dbAfterDelete=0 but the row was
  // still absent post-restore, 200/200/200). Pick a callee with headroom.
  const candidate = byCallee.find((c) => c.sites > 0 && c.sites < 100 && c.fabricated === 0 && c.wrongLine === 0)
  let mutationRecord: any = { ran: false }
  if (candidate) {
    const before = auditCallee(craw, await graphTraversal(rpid, candidate.callee, {}), candidate.callee)
    const mid = before.rowsAudited[Math.floor(before.rowsAudited.length / 2)]
    const row = mid ? { id: mid.rowId, ln: mid.line } : null
    if (row && row.id) {
      // Corruption target: a LINE WITHOUT the token. A +7 shift is too gentle —
      // it landed on another mention of the same name and the audit stayed green
      // (measured: flatMap 73 → 80, both lines mention flatMap). Line 1 of the
      // file is a package/import/definition line in every language here, so the
      // source check must fire.
      craw.prepare("UPDATE brain_relationship SET line_number = 1 WHERE id = ?").run(row.id)
      const during = auditCallee(craw, await graphTraversal(rpid, candidate.callee, {}), candidate.callee)
      craw.prepare("UPDATE brain_relationship SET line_number = ? WHERE id = ?").run(Number(row.ln), row.id)
      const after = auditCallee(craw, await graphTraversal(rpid, candidate.callee, {}), candidate.callee)

      // Second mutation: delete one site row outright. The audit must SEE it.
      const victim2 = before.rowsAudited[0] ?? null
      let deletionRecord: any = { ran: false }
      if (victim2?.rowId) {
        const backup = craw.prepare("SELECT * FROM brain_relationship WHERE id = ?").get(victim2.rowId) as any
        craw.prepare("DELETE FROM brain_relationship WHERE id = ?").run(victim2.rowId)
        const stillInDb = Number((craw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE id = ?").get(victim2.rowId) as any)?.c ?? -1)
        const duringDel = auditCallee(craw, await graphTraversal(rpid, candidate.callee, {}), candidate.callee)
        const cols = Object.keys(backup)
        craw
          .prepare(`INSERT OR REPLACE INTO brain_relationship (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
          .run(...cols.map((c) => backup[c]))
        const afterDel = auditCallee(craw, await graphTraversal(rpid, candidate.callee, {}), candidate.callee)
        // Assert on the ROW, not the count. A count drop was the first attempt and
        // it stayed flat (200 → 200): the deleted site had a DUPLICATE row under a
        // different target spelling (#854), so removing one left the site visible.
        // "Is the deleted row still in the answer?" is precise and duplicate-proof.
        const hadBefore = true
        const goneDuring = !duringDel.rowsAudited.some((r) => r.rowId === victim2.rowId)
        const backAfter = afterDel.rowsAudited.some((r) => r.rowId === victim2.rowId)
        deletionRecord = {
          ran: true,
          callee: candidate.callee,
          rowId: victim2.rowId,
          sitesBefore: before.sites,
          sitesDuring: duringDel.sites,
          sitesAfter: afterDel.sites,
          rowAbsentDuringDeletion: goneDuring,
          rowCountInDbRightAfterDelete: stillInDb,
          rowPresentAfterRestore: backAfter,
          duplicateRowKeptTheSiteVisible: !goneDuring && duringDel.sites === before.sites,
        }
        check(
          "mutation-deleted-site-leaves-the-answer",
          hadBefore && goneDuring && backAfter,
          `row ${String(victim2.rowId).slice(-45)} dbAfterDelete=${stillInDb} answeredDuringDelete=${!goneDuring} answeredAfterRestore=${backAfter} (sites ${before.sites} → ${duringDel.sites} → ${afterDel.sites})`,
        )
      } else {
        check("mutation-deleted-site-leaves-the-answer", false, "no site row found to delete — the mutation could not run")
      }

      mutationRecord = {
        ran: true,
        callee: candidate.callee,
        rowId: row.id,
        line: row.ln,
        corruptedTo: 1,
        before: { fabricated: before.fabricated, wrongLine: before.wrongLine, sites: before.sites },
        during: { fabricated: during.fabricated, wrongLine: during.wrongLine, sites: during.sites },
        after: { fabricated: after.fabricated, wrongLine: after.wrongLine, sites: after.sites },
        deletion: deletionRecord,
      }
      check(
        "mutation-corrupted-line-turns-the-audit-red",
        before.fabricated === 0 && before.wrongLine === 0 && during.fabricated + during.wrongLine > 0,
        `${candidate.callee}: clean before (${before.fabricated}+${before.wrongLine}), red during (${during.fabricated}+${during.wrongLine}) after setting row ${row.id} to line 1 (was ${row.ln})`,
      )
      check(
        "mutation-restore-turns-it-clean-again",
        after.fabricated === 0 && after.wrongLine === 0,
        `${candidate.callee}: back to (${after.fabricated}+${after.wrongLine}) with the row restored to ${row.ln}`,
      )
    } else {
      check("mutation-corrupted-line-turns-the-audit-red", false, `no line-bearing row found for ${candidate.callee} to corrupt — the mutation could not run`)
    }
  } else {
    check("mutation-corrupted-line-turns-the-audit-red", false, "no clean sampled callee available to mutate — the mutation could not run")
  }

  const outDir = path.join(ROOT, "validation/m59/results")
  mkdirSync(outDir, { recursive: true })
  writeFileSync(
    path.join(outDir, "acceptance-tool-callsites.json"),
    JSON.stringify(
      {
        probe: "M59.ACC",
        at: new Date().toISOString(),
        command: process.argv.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" "),
        // M59 (#855): the artifact must name the code it measured, and say when
        // the tree it measured was NOT that commit — the same disclosure the M14
        // honesty gate demands of the differential evidence (`measured over
        // uncommitted code`). Without this the file was anonymous: it could not
        // be told apart from an artifact of a different indexer.
        commit,
        treeModifiedInputs: modifiedInputs,
        dataDir: DATA,
        reused: REUSE,
        repo: REPO,
        fixtures: fixtureResults,
        corpus: { ...total, byCallee },
        mutation: mutationRecord,
        lowerBoundSelfTest: boundSelfTest,
        scope: {
          necessaryNotSufficient: "the source lower bound undercounts on purpose; a match is not proof of completeness, a mismatch is proof of a missing site",
          lineLessLanguages: "typescript/python sites cannot be told apart until their analyzer emits a line (#825); Part B asserts only that the tool does not invent one",
        },
        status: failures === 0 ? "pass" : "fail",
        failures,
        checks,
      },
      null,
      2,
    ) + "\n",
  )
  console.log(`\nevidence: ${path.join(outDir, "acceptance-tool-callsites.json")}`)
  rmSync(project, { recursive: true, force: true })
  if (failures > 0) {
    console.error(`\nFAILED (${failures}/${checks}).`)
    process.exit(1)
  }
  console.log(`\nAll checks passed (${checks}).`)
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
