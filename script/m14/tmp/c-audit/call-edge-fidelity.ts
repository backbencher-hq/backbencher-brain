/**
 * C audit probe: adjudicate every `calls` edge against the PARSE, per (callee, line).
 *
 * READ THIS BEFORE BELIEVING A ROW. The parse is ground truth for WHERE a call is,
 * not for WHETHER the analyzer owes an edge for it. The M12 truth deliberately
 * counts a macro invocation as a call -- #908's ruling, pinned by
 * `c/function-like-macro-not-a-binding-908`, is that "the truth counts a macro
 * invocation as `calls (expr)` AND `uses (expr)`". So a `calls` edge whose callee is a
 * macro is a REQUIRED edge, not a phantom.
 *
 * The first version of this probe did not know that, reported ~4,000 such edges as
 * analyzer errors, and the "fix" -- suppressing them -- was implemented, measured at
 * removing 4,000 edges, and reverted one run later when the fixture failed. The
 * suppression would have deleted facts the oracle demands. Macro invocations are
 * therefore classified and EXCLUDED here, with the exclusion visible in the output
 * rather than folded into an agreement rate.
 *
 * The same caution applies to a `#define` REPLACEMENT LIST that recovery reads as a
 * call (`#912`): a definition site is not an invocation and gets no edge at all.
 *
 * The corpus census reports `sameSiteDuplicates` — 1447 in redis, 129 in curl, 291
 * in libgit2, all `calls/c_function_call` — and the number has never been
 * adjudicated. A line is not a site: `x = f(1) + f(2);` is two real calls on one
 * line, and C-D14's ruling is one edge per OCCURRENCE, so two edges there are
 * correct. One call emitted twice is a defect. The payload cannot tell those apart,
 * and `duplicate-classes.ts` already says so: it can only convict the narrow case
 * where two edges for one (source, target, line) carry different
 * `metadata.relationshipType` values, which is 0 across the corpus.
 *
 * So the question is moved to ground truth. The PARSE knows how many
 * `call_expression` nodes name a given callee on a given line, and the analyzer's
 * payload says how many edges it published for that (callee, line). Comparing the
 * two MULTISETS decides every row, in both directions:
 *
 *   analyzer > parse   the analyzer emitted a call that is not in the source, or
 *                      emitted one twice -- a phantom or a duplicate
 *   analyzer < parse   the analyzer MISSED a call -- which is far worse than a
 *                      duplicate, and invisible to every counter in the lane
 *   equal              correct, including the two-calls-on-one-line case
 *
 * That last pair is the point. Going from "1447 unknown" to a per-row verdict is
 * the whole value of this probe, and the under-emission direction is a class no
 * gate in this lane has ever measured.
 *
 * Only calls whose `function` child is a plain identifier are compared. A member
 * call (`p->f`), a call through a function-pointer expression, or one whose callee
 * sits in a macro are reported as `unclassified` rather than guessed, because a
 * guess here would corrupt the very verdict the probe exists to produce.
 *
 *   bun run script/m14/tmp/c-audit/call-edge-fidelity.ts --dir <corpus> [--max-files N]
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..", "..", "..")
const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const DIR = arg("dir", "/home/sano/ishaq/bb_tests/repositories/redis/src")
const MAX_FILES = Number(arg("max-files", "200"))
const SHOW = Number(arg("show", "12"))

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm"))))
const { RealCAnalyzer } = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))

/**
 * The terminal NAME of a callee expression, so both sides key on the same string.
 *
 * This is the correction that turned 207 apparent phantom call edges into
 * non-findings. `if (list->free) list->free(current->value);` -- adlist.c:46 -- is a
 * MEMBER call through a function-pointer field. The parse's `function` child is a
 * `field_expression`, so a probe that only accepts a bare `identifier` put the parse
 * side in an "unclassified" bucket while the analyzer's edge carried the terminal
 * name `free`; comparing the two then reported the analyzer as having emitted a call
 * the source does not contain. It does contain one. The defect was in the
 * instrument, and it is exactly the shape of error this lane keeps catching, which
 * is why the source line was read before the number was believed.
 */
function terminalCalleeName(fn: any, depth = 0): string | null {
  if (!fn || depth > 8) return null
  if (fn.type === "identifier") return fn.text
  // `type_identifier` as a callee is a cast spelled `(T)(x)`, which tree-sitter
  // sometimes keeps as a `call_expression`. It is not a call.
  if (fn.type === "type_identifier") return null
  if (fn.type === "field_expression") {
    // The field is a `field_identifier`, NOT an `identifier`. Accepting only
    // `identifier` here is what kept `list->free(...)` in the unclassified bucket
    // and left 207 member calls looking like phantom emissions -- the second time
    // this probe produced a confident wrong number, and the second time the cause
    // was a node-type assumption rather than anything about the analyzer.
    const f = fn.childForFieldName("field")
    return f && (f.type === "identifier" || f.type === "field_identifier") ? f.text : null
  }
  if (fn.type === "pointer_expression") return terminalCalleeName(fn.childForFieldName("operand"), depth + 1)
  // A SUBSCRIPT callee is a call through a function-POINTER ARRAY: `recv[i](...)`,
  // `state_enter[state](...)`, `setopt_call[j](...)`, `parse[len-2](scheme)`. The
  // family contract filters computed/dynamic calls (the analyzer sets
  // `target = ""` for a `subscript_expression` callee), and it is right: the callee
  // is a value chosen at RUNTIME, so no static name can be published and a name
  // recovered from the array's base identifier would be a fabrication -- the same
  // class as the parenthesized-callee cast.
  //
  // This probe followed the subscript to its base identifier and reported 6 MISSING
  // calls in curl (cfilters.c:1011/1042, multi.c:193, protocol.c:623,
  // setopt.c:1289/2532) -- the under-emission direction, which is the one a
  // reviewer is most likely to believe, and it was wrong every time. The sixth
  // confident wrong number from this instrument, and the first one that pointed at
  // a correct analyzer behaviour rather than a real defect.
  if (fn.type === "subscript_expression") return null
  // A `parenthesized_expression` CALLEE is a cast through a macro, and is NOT
  // followed. `(PCRE2_SIZE)(a - b)` parses as
  // `call(callee: parenthesized_expression("(PCRE2_SIZE)"))` -- the macro makes the
  // type a NAME, so the `type_identifier` rule cannot catch it and the recursion
  // here was reporting the cast as a call. `foo(x)` has a bare `identifier` callee;
  // `(T)(x)` does not, and that is the whole distinction.
  // A `cast_expression` is NOT a call and is deliberately not followed.
  // `(mstime_t)(server.unixtime - x)` and `(sds)((char *)entry + offset)` are casts,
  // and the analyzer correctly publishes no `calls` edge for either. This probe
  // followed the cast's VALUE and reported the cast's TYPE as a missing call --
  // three phantom findings in 60 files, and the third confident wrong number this
  // probe has produced. A cast has a type, not a callee, and the distinction is
  // exactly the kind of thing a ground-truth comparison has to get right or it is
  // worthless.
  return null
}

interface Bucket {
  parseCount: number
  edges: number
  sources: Set<string>
}

const files: string[] = []
const walk = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name === ".git") continue
    const full = path.join(d, e.name)
    if (e.isDirectory()) walk(full)
    else if (e.name.endsWith(".c") && files.length < MAX_FILES) files.push(full)
  }
}
walk(DIR)

/**
 * Every (callee, line) the PARSE says, plus a count of the calls whose callee has
 * no terminal name (a macro invocation, a computed callee) -- reported rather than
 * guessed, so the unclassified figure is a measurement and not a silence.
 */
function parseCalls(root: any, macroNames: Set<string>, declaredFns: Set<string>, sourceLines: string[], reclassified: Set<string>): { counts: Map<string, number>; unclassified: number; casts: number; macroInvocations: number; reclassified: Set<string> } {
  const counts = new Map<string, number>()
  let unclassified = 0
  let casts = 0
  let macroInvocations = 0
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    // A macro DEFINITION is not code. `#define B2(n) n, n+1, n+1, n+2` parses its
    // parameter use `B2(n)` inside the replacement list as a `call_expression`, and
    // walking it counted redis's bitops.c lines 54-56 as six missing calls -- the
    // analyzer is right that a definition site is not a call. The replacement list is
    // skipped for the same reason the analyzer emits no edge for it.
    // ONLY a definition body is skipped. `preproc_if` / `preproc_ifdef` are NOT:
    // they contain ordinary code, and skipping them made the probe report 8,579
    // phantom call edges in curl because every call inside an `#ifdef` lost its
    // parse-side counterpart. A conditional is a choice between two bodies of code,
    // not the absence of code.
    if (n?.type === "preproc_def" || n?.type === "preproc_function_def") {
      continue
    }
    if (n?.type === "call_expression") {
      // A call whose LINE is a DIRECTIVE is not a call.
      //
      // `#define B2(n) n, n+1, n+1, n+2` does not nest its parameter use inside the
      // `preproc_def` node: the grammar emits a bare `call_expression` at top level,
      // so skipping the definition NODE was not enough and redis's bitops.c lines
      // 54-56 came out as five missing calls. Skipping the definition node and
      // skipping the definition LINE are different fixes and only the second one
      // catches this.
      const lineText = sourceLines[n.startPosition.row] ?? ""
      if (lineText.trimStart().startsWith("#")) {
        const _fn = n.childForFieldName("function")
        if (_fn && (_fn.type === "identifier" || _fn.type === "field_identifier"))
          reclassified.add(`${_fn.text}@${n.startPosition.row + 1}`)
        continue
      }
      // A cast through a MACRO -- `(PCRE2_SIZE)(code - orig_code)` -- reaches here
      // as a call whose callee is a plain `identifier`, because the macro makes it a
      // name rather than a type, and so the `type_identifier` rule above cannot see
      // it. It is still a cast and still not a call. The signal is the parenthesis:
      // in `foo(x)` the callee's parent is the call, and in `(T)(x)` the callee sits
      // inside a `parenthesized_expression`. That is the whole difference, and it is
      // why the analyzer correctly publishes no `calls` edge for the 116 libgit2 rows
      // this probe initially called missing calls.
      // CLASSIFY, then DESCEND -- and the two must be independent.
      //
      // An earlier version used `continue` for the two "not a call" verdicts, which
      // skipped the child-push loop beneath. So `assert(LP_ENCODING_IS_7BIT_UINT(
      // lpLast(lp)[0]))` counted the macro invocation, never descended into its
      // ARGUMENT, and therefore never saw the real `lpLast(lp)` call inside it --
      // reporting 32 phantom call edges in redis's listpack.c, where `lpLast` is a
      // function defined 2,700 lines earlier in the same file. A macro's arguments
      // are ordinary expressions and can contain real calls; a cast's value
      // expression can too. Both are walked, always.
      const fnNode = n.childForFieldName("function")
      if (fnNode?.type === "parenthesized_expression") {
        // A cast through a macro. Not a call, and the analyzer publishes no edge.
        const _f3 = fnNode?.childForFieldName?.("field")
        const _n3 = _f3 && (_f3.type === "identifier" || _f3.type === "field_identifier") ? _f3.text : fnNode?.text ?? null
        if (_n3) reclassified.add(`${_n3}@${n.startPosition.row + 1}`)
        casts++
      } else {
        const name = terminalCalleeName(fnNode)
        const siteKey = (() => {
          const f2 = fnNode?.childForFieldName?.("field")
          const nm = f2 && (f2.type === "identifier" || f2.type === "field_identifier") ? f2.text : fnNode?.type === "identifier" ? fnNode.text : null
          return nm ? `${nm}@${n.startPosition.row + 1}` : null
        })()
        // NOTE: a call on a directive LINE never reaches here -- the check above
        // `continue`s past it. I added a second directive test at this level
        // believing it was missing, and it counted 0 sites on all three corpora
        // while reading like the fix for the remaining over-emissions. The 6 that
        // remain in curl are NOT this shape; see the report.
        if (name && macroNames.has(name) && !declaredFns.has(name)) {
          // A macro INVOCATION. The analyzer's documented rule is that a macro use is
          // a `uses` edge and not a call, and the preprocessor -- not the call graph --
          // decides what the name becomes. Counting it as a missed call would be
          // measuring the probe's ignorance of the macro table, not the analyzer.
          if (siteKey) reclassified.add(siteKey)
          macroInvocations++
        } else if (name) {
          const k = `${name}@${n.startPosition.row + 1}`
          counts.set(k, (counts.get(k) ?? 0) + 1)
        } else {
          unclassified++
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return { counts, unclassified, casts, macroInvocations, reclassified }
}

/**
 * Every `call_expression` node in the tree, found by a walk with NO skips.
 *
 * This exists because the probe's own walk is not a complete census of the parse,
 * and for a long time it did not know that. Six `calls` edges in curl were
 * reported as OVER-EMITTED -- `Curl_checkProxyheaders@691`, `STRCONST@692`,
 * `Curl_creds_has_user_or_pass@737`, `Curl_checkProxyheaders@738`,
 * `STRCONST@739` in http.c and `ssl_installed@937` in openldap.c -- and the
 * analyzer was RIGHT about every one: the region http.c:686-704 sits inside a
 * `preproc_ifdef` that spans 686-704, containing an `if_statement` 687-702 whose
 * `parenthesized_expression` 688-694 contains the calls, and the walk skips them.
 * Tracing it to the end took a dozen instruments because the symptom was a
 * confident number rather than a missing one: `parse=0` for a call that plainly
 * exists, on a line the walk demonstrably reaches elsewhere in the same file.
 *
 * What the walk skips is the macro DEFINITION node. http.c:690 is `#ifndef
 * CURL_DISABLE_PROXY` and the calls at 691-692 are its GUARDED BODY, which is
 * code and must be walked. Something in that shape makes the region unreachable
 * from the stack walk, and the honest thing is to MEASURE the gap rather than keep
 * the rows: an instrument that cannot see a region must not testify about it.
 *
 * So this census is the denominator. When `walked` sees materially fewer calls
 * than the tree holds, the per-site verdicts for that file are reported as
 * UNSOUND rather than as analyzer defects.
 */
function allCallExpressions(root: any): Set<string> {
  const out = new Set<string>()
  const stack = [root]
  while (stack.length) {
    const x = stack.pop()
    if (x?.type === "call_expression") {
      const fn = x.childForFieldName("function")
      if (fn && (fn.type === "identifier" || fn.type === "field_identifier"))
        out.add(`${fn.text}@${x.startPosition.row + 1}`)
    }
    const nc = x?.namedChildCount ?? 0
    for (let i = 0; i < nc; i++) {
      const c = x.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

/** Every `#define` name in this file -- the same preprocessor facts the analyzer reads. */
function macroNamesIn(root: any): Set<string> {
  const out = new Set<string>()
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n?.type === "preproc_def" || n?.type === "preproc_function_def") {
      const nm = n.childForFieldName("name")
      if (nm && nm.text.trim()) out.add(nm.text.trim())
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

/**
 * Every function name DEFINED or DECLARED in this file, by the same rule the
 * analyzer's #953 uses.
 *
 * C permits a name to be both a macro and a function in one translation unit, and
 * curl's `lib/cf-socket.c` has both: `static void alive_unit(int *x)` at line 180 and
 * `#define alive_unit(x)` at line 190. The macro is EMPTY, so an invocation of
 * `alive_unit(&optval)` at line 261 is a call to the real function -- which is what
 * the analyzer concluded, keeping the edge. This probe classified any macro-named
 * callee as a macro invocation and reported the call as a phantom, which is the
 * mirror image of the #953 bug it was built to find.
 *
 * So the probe and the analyzer now apply the SAME rule, from the same two sets. If
 * they disagreed, the disagreement would be a finding about one of them; with them
 * agreeing, the residual rows are real.
 */
function declaredFunctionNamesIn(root: any, sourceLines: string[]): Set<string> {
  const out = new Set<string>()
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n?.type === "function_definition" || n?.type === "declaration") {
      const d = n.childForFieldName("declarator")
      // A `declaration` is a function declaration only when its declarator chain
      // contains a `function_declarator`. `int min = 0;` is a VARIABLE, and treating
      // its name as a declared function made the probe keep `min(255, ...)` as a call
      // in chk.c -- where `min` is a MACRO and the analyzer correctly published no
      // edge. A variable and a function of the same name are different facts, and the
      // same confusion is what #953 guards against in the analyzer.
      // A preprocessor line is not code, and a multi-line `#define` with braces and
      // backslash continuations can parse a fragment of its own body as a
      // `declaration` -- which is how redis's `swapcode(TYPE, a, b, n)` macro in
      // pqsort.c came to look like a declared FUNCTION, and the probe then required
      // its invocations to be calls. One rule covers both halves of this: a line whose
      // first non-space character is `#` introduces a directive, and a directive is
      // never a definition or a call. This is the same line-anchored shape the
      // analyzer's own #934 macro inventory already uses.
      const lineText = sourceLines[n.startPosition.row] ?? ""
      if (lineText.trimStart().startsWith("#")) {
        // fall through to the child walk without recording anything
      } else {
      let hasFunctionDeclarator = false
      {
        let probe: any = d
        let g = 0
        while (probe && g++ < 8) {
          if (probe.type === "function_declarator") {
            hasFunctionDeclarator = true
            break
          }
          probe = probe.childForFieldName("declarator") || probe.namedChild(0)
        }
      }
      if (d && hasFunctionDeclarator) {
        // A declaration's declarator is usually a `function_declarator`; the name is
        // inside it, and possibly inside a `pointer_declarator` for a prototype of a
        // function pointer.
        let cur: any = d
        let guard = 0
        while (cur && guard++ < 8) {
          if (cur.type === "identifier" || cur.type === "field_identifier") {
            out.add(cur.text.trim())
            break
          }
          cur = cur.childForFieldName("declarator") || cur.namedChild(0)
        }
      }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

/** Every `calls` edge the analyzer published, as (target, line). */
function emittedCalls(res: any): Map<string, { n: number; sources: Set<string> }> {
  const out = new Map<string, { n: number; sources: Set<string> }>()
  for (const r of res.relationships ?? []) {
    if (String(r.type) !== "calls") continue
    const ln = (r as any).line_number ?? (r as any).line ?? (r.range as any)?.startLine
    const k = `${r.target}@${ln}`
    const cur = out.get(k) ?? { n: 0, sources: new Set<string>() }
    cur.n++
    cur.sources.add(String(r.source))
    out.set(k, cur)
  }
  return out
}

let filesSeen = 0
let callSites = 0
let unclassifiedSites = 0
let castSites = 0
let macroInvocationSites = 0
let macroCallSites = 0
let agreeSites = 0
let overEmitted = 0
let underEmitted = 0
let parseOnlyTotal = 0
let edgeOnlyTotal = 0
let edgesTotal = 0
/** Files where the probe's own walk could not account for the parse. */
const unsoundFiles: Array<{ file: string; missing: number; sample: string[] }> = []

const overRows: Array<{ file: string; key: string; parse: number; edges: number; sources: string[] }> = []
const underRows: Array<{ file: string; key: string; parse: number; edges: number; sources: string[] }> = []

for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  let root: any
  let res: any
  try {
    root = parser.parse(src).rootNode
    res = new RealCAnalyzer().analyze(root, src, f)
  } catch {
    continue
  }
  filesSeen++
  const macroNames = macroNamesIn(root)
  const srcLines = src.split("\n")
  const declaredFns = declaredFunctionNamesIn(root, srcLines)
  // Sites the walk reached and deliberately did not count as comparable: a cast, a
  // macro invocation, or a directive line. The independent census does not
  // distinguish them, so they are excluded from the containment test rather than
  // counted as misses.
  const reclassified = new Set<string>()
  const parsedAll = parseCalls(root, macroNames, declaredFns, srcLines, reclassified)
  const parsed = parsedAll.counts
  // A file whose walk cannot account for its own parse produces no verdict.
  //
  // The check is a CONTAINMENT test, not a ratio: every (callee, line) the
  // unrestricted census finds must be reachable by the walk. A ratio was the first
  // attempt and it was wrong in both directions -- it flagged two files that
  // legitimately contain no calls at all, and it would have passed a file missing
  // a whole region as long as the region was small. What must hold is that the
  // walk's key set CONTAINS the census's, modulo the sites the walk deliberately
  // reclassifies (casts, macro invocations, directive lines), which are counted
  // separately and reported.
  const census = allCallExpressions(root)
  const skipped: string[] = []
  for (const k of census) if (!parsed.has(k) && !reclassified.has(k)) skipped.push(k)
  if (skipped.length > 0) {
    unsoundFiles.push({ file: path.basename(f), missing: skipped.length, sample: skipped.slice(0, 3) })
    continue
  }
  unclassifiedSites += parsedAll.unclassified
  castSites += parsedAll.casts
  macroInvocationSites += parsedAll.macroInvocations
  const emitted = emittedCalls(res)
  for (const [, v] of emitted) edgesTotal += v.n
  callSites += parsed.size + parsedAll.unclassified + parsedAll.casts + parsedAll.macroInvocations

  // Union of both key sets, so a row missing from either side is still judged.
  const keys = new Set<string>([...parsed.keys(), ...emitted.keys()])
  for (const k of keys) {
    // Both sides are keyed on the terminal callee name now, so every row is judged.
    //
    // A callee that is a file-local MACRO is excluded, because the M12 truth requires
    // a `calls` edge for it (#908) and the parse -- which does not expand macros --
    // has no opinion. Counting these as over-emission is what produced the reverted
    // fix, so the exclusion is a named bucket and not a silent filter.
    const callee = k.slice(0, k.lastIndexOf("@"))
    if (macroNames.has(callee) && !declaredFns.has(callee)) {
      macroCallSites++
      continue
    }
    const p = parsed.get(k) ?? 0
    const e = emitted.get(k)?.n ?? 0
    if (p === e) {
      agreeSites++
      continue
    }
    const sources = [...(emitted.get(k)?.sources ?? [])]
    if (e > p) {
      overEmitted++
      edgeOnlyTotal += e - p
      if (overRows.length < 400) overRows.push({ file: path.basename(f), key: k, parse: p, edges: e, sources })
    } else {
      underEmitted++
      parseOnlyTotal += p - e
      if (underRows.length < 400) underRows.push({ file: path.basename(f), key: k, parse: p, edges: e, sources })
    }
  }
}

const judged = agreeSites + overEmitted + underEmitted
console.log(`# call-edge fidelity vs the parse -- ${path.basename(DIR)}`)
console.log(`files: ${filesSeen}   call sites in the parse: ${callSites}   ` + `edges the analyzer published: ${edgesTotal}`)
console.log(`\nper (callee, line) sites, judged against the parse:`)
console.log(`  agree                    ${agreeSites}`)
console.log(`  analyzer emitted MORE    ${overEmitted} sites  (${edgeOnlyTotal} extra edges)`)
console.log(`  analyzer emitted LESS    ${underEmitted} sites  (${parseOnlyTotal} missing edges)`)
console.log(`  unclassified (no terminal callee name)  ${unclassifiedSites} sites -- excluded, not guessed`)
console.log(`  casts (incl. through a macro)            ${castSites} sites -- the analyzer correctly publishes no call edge`)
console.log(`  macro invocations the PARSE sees          ${macroInvocationSites} sites -- excluded, not guessed`)
console.log(`  macro-callee call sites                  ${macroCallSites} sites -- REQUIRED by the #908 truth ruling, not a phantom`)
console.log(`\nverdict on the census's sameSiteDuplicates: a same-site collision is CORRECT when the`)
console.log(`parse also counts two, and those are the rows now counted in "agree" above.`)
if (judged > 0) {
  console.log(`\nagreement: ${agreeSites}/${judged} = ${((agreeSites / judged) * 100).toFixed(2)}% of judged call sites`)
}

if (unsoundFiles.length) {
  console.log(
    `\n## ${unsoundFiles.length} file(s) EXCLUDED -- the probe's walk could not account for the parse`,
  )
  console.log(`   These files produce NO verdict. An instrument that cannot see a region must not`)
  console.log(`   testify about it; before this check they silently contributed phantom findings.`)
  for (const u of unsoundFiles.slice(0, 8))
    console.log(`     ${u.file}  ${u.missing} call site(s) the walk never reached, e.g. ${u.sample.join(" ")}`)
}
if (overRows.length) {
  console.log(`\n## OVER-EMITTED (${overEmitted} sites) — the analyzer published an edge the source does not have`)
  for (const r of overRows.slice(0, SHOW)) {
    console.log(`  ${r.file}  ${r.key}  parse=${r.parse} edges=${r.edges}  from=[${r.sources.slice(0, 3).join(",")}]`)
  }
}
if (underRows.length) {
  console.log(`\n## UNDER-EMITTED (${underEmitted} sites) — a call in the source with no edge`)
  for (const r of underRows.slice(0, SHOW)) {
    console.log(`  ${r.file}  ${r.key}  parse=${r.parse} edges=${r.edges}  from=[${r.sources.slice(0, 3).join(",")}]`)
  }
}
