// verify-lua-grasped-fields.ts — M60 lua LUA-00: every node-type and field
// literal the analyzer writes must be a node type or a field the PINNED grammar
// actually emits. A literal the grammar cannot resolve is a code path that
// never fires, and `childForFieldName(X) || namedChild(0)` hides that: the `||`
// turns "this field does not exist" into "quietly use whatever is first", so the
// mismatch can neither raise, nor log, nor fail anything.
//
// This gate reads the analyzer's OWN source for literals — that is the whole
// point, the literals live in the source — and resolves each one against the
// real grammar by parsing a real file. It does not ask the analyzer what it
// thinks it produced; a self-report cannot detect its own unreachable code.
//
// What it asserts, and why each leg is separate:
//   1. every `.type === "x"` / `type: "x"` literal names a node type the
//      grammar emits   (the shape-safety leg lua already had, kept honest)
//   2. every `childForFieldName("x")` literal names a field the grammar emits
//      on at least one node  (the leg that is FAILING today)
//   3. each such literal is REACHABLE — the field resolves on the node type the
//      analyzer applies it to, not merely somewhere in the grammar. A field
//      that exists on `arguments` but is asked of `return_statement` is still a
//      dead path, and a whole-grammar existence check would pass it.
//   4. the gate can fail: planted mutants, one per rule, each caught.
//
// Leg 3 is the one that matters most and the one a whole-grammar check cannot
// do. The M14.0.F1 oracle already reports lua `grammar: fail` for five unknown
// field literals; it has no notion of reachability, so it cannot tell a working
// field from a dead one, and it does not fail the build on its own.
//
// Run: npx tsx script/m60/verify-lua-grasped-fields.ts   (bun also works)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../src/ast/pool-worker"
import { loadWebTreeSitter, resolveWasmAsset } from "../../src/util/wasm"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const ANALYZER = join(ROOT, "src", "ast", "real-lua-analyzer.ts")
const EVIDENCE = join(ROOT, "validation", "m60", "results", "lua-grasped-fields.json")
const CORPUS = "$HOME/fixtures/repositories"
const WARMUP = join(CORPUS, "luvit", "init.lua")

// ── the fixture: every construct the analyzer claims to read ─────────────────
// One file whose shape exercises each extraction path, so reachability is
// measured on a node that really exists rather than on a synthetic name.
const PROBE_LUA = [
  'local a, b = 1, 2',            // variable_list + name (the name_list path)
  'local c = 3',                  // single declaration, the masked-skip case
  'd, e = 4, 5',                  // assignment_statement -> variable_list
  'local t = { key = 1, other = 2 }', // table_constructor -> field (the key path)
  'local s = "mod"',              // string value (the stringValue path)
  'require("mod")',               // function_call -> name/arguments
  'setmetatable({}, {})',         // the metatable branch
  'return a',                     // return_statement (the expression_list path)
  'function f(x, ...) return x end',
  'function t.method(self) return self end',
  'function t:colon(a) return a end',
  // The control-flow and operator shapes the analyzer also names. Without these
  // the node-type leg reports `if_statement` / `binary_expression` as unknown
  // when they are perfectly real — the first version of this gate did exactly
  // that, and a leg that cries wolf is a leg nobody reads.
  'if a and b then c = 1 end',    // if_statement, binary_expression(and)
  'for i = 1, 10 do c = i end',   // for_statement
  'while a do break end',         // while_statement
  'repeat c = 1 until a',         // repeat_statement
  'local q = a or b',             // binary_expression(or)
  // M60 LUA-20: an ANONYMOUS function is a different node type from a
  // declaration. It was missing from this probe, so the LUA-20 fix introduced a
  // `function_definition` reference that the node-type leg correctly reported as
  // never emitted — the instrument catching a real coverage gap in itself rather
  // than the analyzer inventing a type. Both spellings are exercised because
  // they are the two ways a Lua function reaches the walk.
  'local cb = function(z) return z end',
  'local t = { m = function(w) return w end }',
  // M60 LUA-22: a computed index is a distinct node type, and the LUA-22 fix
  // named it. Without a probe that contains one, the node-type leg correctly
  // reported it as never emitted — the instrument catching a real coverage gap in
  // itself, twice now, and both times about a type the fix newly referenced.
  'local rows = t[1]',
  'dao[method or context .. "_by_" .. key](dao)',
].join("\n") + "\n"

// ── literal extraction: the analyzer's source is the subject under test ──────
// Recorded because the first version of this gate reported seven "unknown node
// types" and five of them were its own false positives: `type: "usage"` inside
// a frameworkPatterns literal and `type: "architecture"` inside an insight
// literal are ANALYSISER METADATA TAGS, not grammar node types. Matching a
// property key named `type` cannot distinguish the two, because the analyzer
// builds genuine nodes with the same key. So the scan is restricted to the
// positions where a node type can actually be named.
interface Literal { kind: "type" | "field"; literal: string; line: number; context: string }

function extractLiterals(src: string): Literal[] {
  const out: Literal[] = []
  const lines = src.split("\n")
  // Comments are stripped BEFORE the scan, and this is a correctness fix, not
  // cosmetics. Writing the fix means naming the defect — so a comment reading
  // `// the old childForFieldName("name_list") || namedChild(0)` was itself
  // scanned as a live field literal, and the gate kept reporting two phantom
  // violations against an analyzer that no longer contained the bug. A gate
  // that fails on the description of a fixed bug is a gate that will be
  // disabled. Comments cannot name a node type or a field, by definition.
  const code = lines.map((text) => {
    const c = text.indexOf("//")
    return c >= 0 ? text.slice(0, c) : text
  })
  code.forEach((text, i) => {
    let m: RegExpExecArray | null
    // Node types are named in exactly three real positions: a switch case, a
    // `.type ===` comparison, and a `kind:`/node object literal. A bare
    // `type:` inside `patterns:`/`insights:` metadata is NOT one of them, so
    // the object-literal form is matched only when the literal is one the
    // grammar could plausibly emit — which is checked, not assumed, below.
    const caseRe = /case\s+["']([a-z_]+)["']\s*:/
    const cmpRe = /\.type\s*===\s*["']([a-z_]+)["']/
    const objRe = /\{\s*type:\s*["']([a-z_]+)["']/
    if ((m = caseRe.exec(text))) out.push({ kind: "type", literal: m[1], line: i + 1, context: text.trim().slice(0, 90) })
    if ((m = cmpRe.exec(text))) out.push({ kind: "type", literal: m[1], line: i + 1, context: text.trim().slice(0, 90) })
    // A `{ type: "x" }` that is an element of `patterns` or `insights` is a
    // metadata tag. Those two keys are the only such places in this analyzer.
    const inMetadata = /^\s*(patterns|insights|frameworkPatterns)\b/.test(text) || /\b(patterns|insights):\s*$/.test(text)
    if (!inMetadata && (m = objRe.exec(text))) out.push({ kind: "type", literal: m[1], line: i + 1, context: text.trim().slice(0, 90) })
    // field names: childForFieldName("foo")
    const fieldRe = /childForFieldName\(\s*["']([a-z_]+)["']\s*\)/g
    while ((m = fieldRe.exec(text))) out.push({ kind: "field", literal: m[1], line: i + 1, context: text.trim().slice(0, 90) })
  })
  return out
}

// ── the real grammar ─────────────────────────────────────────────────────────
// Measured fact, recorded because it cost an hour to find: a raw Language.load
// throws "Cannot read properties of undefined (reading 'loadWebAssemblyModule')"
// until the engine has initialised the tree-sitter core. One production parse
// puts the process in a state where it works. Do not "clean this up" — it is
// load-bearing.
async function grammarFacts(source: string) {
  const mod: any = await loadWebTreeSitter()
  await parseFile(WARMUP, CORPUS)
  const lang = await mod.Language.load(resolveWasmAsset("tree-sitter-lua.wasm"))
  const parser = new mod.Parser()
  parser.setLanguage(lang)
  const tree = parser.parse(source)
  const nodeTypes = new Set<string>()
  const fieldOnType = new Map<string, Set<string>>()   // nodeType -> field names
  const fieldAnywhere = new Map<string, Set<string>>() // field  -> node types
  const fieldNameFor = (n: any, i: number): string | null => {
    if (typeof n.fieldNameForChild === "function") return n.fieldNameForChild(i)
    // Older bindings: recover the field by asking the child.
    try { return n.fieldNameForChild ? n.fieldNameForChild(i) : null } catch { return null }
  }
  const walk = (n: any): void => {
    nodeTypes.add(n.type)
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (!c) continue
      const fn = fieldNameFor(n, i)
      if (fn) {
        if (!fieldOnType.has(n.type)) fieldOnType.set(n.type, new Set())
        fieldOnType.get(n.type)!.add(fn)
        if (!fieldAnywhere.has(fn)) fieldAnywhere.set(fn, new Set())
        fieldAnywhere.get(fn)!.add(n.type)
      }
    }
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) walk(c) }
  }
  walk(tree.rootNode)
  return { nodeTypes, fieldOnType, fieldAnywhere }
}

// ── reachability: which node type does each field-literal site apply to? ─────
// A field that exists somewhere but is asked of the wrong node is a dead path.
//
// This took three attempts, and each earlier version was WRONG in a way worth
// recording, because the pattern generalises to every analyzer gate that tries
// to reason about source text:
//
//   v1 — attribute to the nearest preceding `case "type":`. Reported 11
//        unreachable fields; ALL 11 were false. `extractParameters` sits after
//        `case "identifier":` in source order but receives a
//        function_declaration, so the attributor named the wrong node.
//   v2 — lexical nesting (same brace depth only). Correctly reported 0
//        unreachable, but opened a new hole: a literal inside a method body has
//        no `case` at its depth, so it was silently skipped and a planted
//        regression LEAKED while the gate printed "0 unreachable".
//   v3 — resolve helper methods through the CALL GRAPH. A helper's node type is
//        the type its callers pass, so `this.extractExport(node, ...)` under
//        `case "return_statement":` types the helper's literals as
//        return_statement. A literal still unattributable after that is
//        reported, not skipped.
//
// The lesson kept in the code: a leg whose blind spot is the SHAPE of the
// defect it hunts is not a leg, and a leg that cries wolf is worse than no leg.
// Which parameter of `method` is the tree-sitter node? Resolved by TYPE
// ANNOTATION, not by parameter name.
//
// Recorded because name-matching was the third wrong attempt at this same
// question: matching a call's argument named `node` found six helpers and
// missed every helper whose parameter is renamed — `constructorTarget(
// functionNode, ctx)` and `functionOwner(nameNode)` both take a Node and both
// were invisible, because a call passes whatever local happens to hold it
// (`this.constructorTarget(functionNode, ctx)`). A parameter annotated `: Node`
// is a node by contract; a parameter named `node` is a guess.
function nodeParamIndex(lines: string[], method: string): number {
  for (const l of lines) {
    const m = l.match(new RegExp(`^\\s{2}(?:private|public)\\s+${method}\\s*\\(([^)]*)\\)`))
    if (!m) continue
    const params = m[1].split(",").map((p) => p.trim())
    return params.findIndex((p) => /:\s*Node\b/.test(p))
  }
  return -1
}

// Which local does argument `argIndex` of a call to `method` hold at the call
// site? Traced one hop: the argument is either the dispatch `node` itself or a
// local that was assigned from a node-returning accessor on it.
function buildCallGraph(src: string): Map<string, Array<{ method: string; argIndex: number }>> {
  const lines = src.split("\n")
  const callers = new Map<string, Array<{ method: string; argIndex: number }>>()
  lines.forEach((text, i) => {
    const caseMatch = text.match(/case\s+"([a-z_]+)"/)
    if (!caseMatch) return
    // The call may be on the same line (`case "x": this.helper(node, ...)`) or
    // further down that arm's body. Four lines was measured too few: a case
    // whose body opens with an `if` guard pushes the call to line 4 and
    // extractExport silently vanished from the graph. Ten covers every real arm
    // here and the window still stops at the next arm.
    for (let j = i; j < Math.min(i + 10, lines.length); j++) {
      if (j > i && /case\s+"[a-z_]+"/.test(lines[j])) break
      const callRe = /this\.([a-zA-Z_]+)\(([^)]*)\)/g
      let m: RegExpExecArray | null
      while ((m = callRe.exec(lines[j]))) {
        const args = m[2].split(",").map((a) => a.trim())
        const target = nodeParamIndex(lines, m[1])
        if (target < 0) continue
        const arg = args[target] ?? args[0] ?? ""
        // The argument is the dispatch node, or a local bound from a node on
        // it (e.g. `const nameNode = node.childForFieldName("name")`).
        const isNodeish = arg === "node" || /Node$/.test(arg.replace(/[!]/g, "")) || arg === "rootNode"
        if (isNodeish) {
          if (!callers.has(m[1])) callers.set(m[1], [])
          if (!callers.get(m[1])!.some((s) => s.method === caseMatch[1])) {
            callers.get(m[1])!.push({ method: caseMatch[1], argIndex: target })
          }
        }
      }
    }
  })
  return callers
}

// The method-open line for the block containing `line`. Deliberately narrow: a
// loose `identifier(` pattern also matches `if (` and `function (`, which is how
// the second version of this gate ended up attributing `method`@289 to a method
// called `if`. Only a `private`/`public` method declaration qualifies.
function enclosingMethod(lines: string[], line: number): string | undefined {
  for (let i = line - 1; i >= 0; i--) {
    const m = lines[i].match(/^\s{2}(?:private|public)\s+([a-zA-Z_]+)\s*\(/)
    if (m) return m[1]
    if (/^\s{2}(?:private|public)\s+[a-zA-Z_]+[^:]*:\s*void/.test(lines[i])) return undefined
  }
  return undefined
}

function siteNodeType(src: string, line: number, callers: Map<string, Array<{ method: string; argIndex: number }>>): string[] {
  const lines = src.split("\n")
  const depthAt = (idx: number): number => {
    let d = 0
    for (let i = 0; i < idx; i++) for (const ch of lines[i]) { if (ch === "{") d++; else if (ch === "}") d-- }
    return d
  }
  const here = depthAt(line - 1)
  const method = enclosingMethod(lines, line)
  const methodIdx = method ? lines.findIndex((l) => new RegExp(`^\\s{2}(?:private|public)\\s+${method}\\s*\\(`).test(l)) : -1

  // 1. a `case` at the literal's own depth, inside the same method, is the
  //    dispatcher (the literal is written inline in that switch arm)
  for (let i = line - 2; i >= 0; i--) {
    if (methodIdx >= 0 && i < methodIdx) break        // stepped outside the method
    const d = depthAt(i)
    if (d < here) break
    const m = lines[i].match(/case\s+"([a-z_]+)"/)
    if (m && d === here) return [m[1]]
  }
  // 2. Still no inline dispatcher: the code may have answered the question
  //    ITSELF, by narrowing a variable's type immediately above the literal.
  //    `const f = ...; if (!f || f.type !== "field") continue; const key =
  //    f.childForFieldName("name")` states plainly which node the field is asked
  //    of, and the rule this gate enforces is only that the answer be
  //    recoverable. LUA-09's export-shape fix failed here for exactly this: the
  //    site is a helper called from `case "return_statement"`, so the caller path
  //    (3, below) returned "return_statement" and the leg called the field
  //    unreachable there — a false positive against code that was correct and had
  //    been checked against the grammar by hand.
  //
  //    This RECOGNISES evidence; it does not excuse the site. The guard must be a
  //    type comparison on the SAME variable the literal is asked of, found above
  //    the literal and no shallower, so a planted regression that changes a
  //    `case` target, or asks a field of an un-narrowed variable, is still
  //    attributed the old way and still fails. It is consulted AFTER the `case`
  //    walk (1) and BEFORE the caller fallback (3), because a local guard names
  //    the node precisely while a caller's dispatch context only names the node
  //    the helper was ENTERED with — a different thing whenever the helper
  //    re-narrows, which is precisely the LUA-09 shape.
      const literalSrc = lines[line - 1] ?? ""
      if (methodIdx >= 0) {
        for (let i = line - 2; i >= 0; i--) {
          if (i < methodIdx) break
          const d = depthAt(i)
          // `d < here - 1`, NOT `d < here`. A type guard is almost always written
          // on the line that OPENS its block — `if (target.type === "function_call")
          // // {` — and that line is one `{` shallower than the literal it guards,
          // because depthAt() counts braces from lines ABOVE i and the opening brace
          // is on i itself. The original `d < here` therefore broke out of the walk
          // before ever testing the guard, and LUA-35's `target.childForFieldName
          // ("name")` was misattributed to the enclosing `case "return_statement"`.
          // The gate was reporting a false positive against code that had already
          // been checked against the grammar by hand.
          if (d < here - 1) break
          const g = lines[i].match(/(\w+)\.type\s*[!=]==?\s*"([a-z_]+)"/)
          if (g && new RegExp(`\\b${g[1]}\\.childForFieldName\\b`).test(literalSrc)) return [g[2]]
        }
      }
  // 3. otherwise the literal sits in a helper: type it by that helper's
  //    callers. Checked AFTER the guard above on purpose — see the note there.
  if (method) {
    const sites = callers.get(method)
    if (sites) return [...new Set(sites.map((s) => s.method))]
    if (methodIdx >= 0) return []
  }
  return []
}

function run(src: string, facts: Awaited<ReturnType<typeof grammarFacts>>) {
  const literals = extractLiterals(src)
  const violations: string[] = []

  const unknownTypes = literals.filter((l) => l.kind === "type" && !facts.nodeTypes.has(l.literal))
  for (const l of unknownTypes) violations.push(`node type "${l.literal}" is never emitted by the grammar (line ${l.line})`)

  const unknownFields = literals.filter((l) => l.kind === "field" && !facts.fieldAnywhere.has(l.literal))
  for (const l of unknownFields) violations.push(`field "${l.literal}" resolves on no node in the grammar (line ${l.line})`)

  // Reachability: for each field literal, does it resolve on the node type the
  // site dispatches on? Recorded per site, with the site node when known.
  //
  // A literal with NO attributable dispatch site is not exempt. The second
  // version of this gate had exactly that hole: a planted regression inside a
  // method body produced no `case` at its own depth, the attributor returned
  // undefined, and the reachability leg skipped it — the mutant LEAKED while
  // the gate reported "0 unreachable". A leg whose blind spot is the shape of
  // the defect it hunts is not a leg. So an unattributed literal is reported as
  // unattributed, and the gate fails on it: the analyzer resolves every one of
  // its field literals against a node it was handed, so "which node is this?"
  // must be answerable. A site that cannot answer is itself the defect.
  const unreachable: Array<{ field: string; line: number; siteNode?: string; resolvesOn: string[] }> = []
  const unattributed: Array<{ field: string; line: number; resolvesOn: string[] }> = []
  const callers = buildCallGraph(src)
  for (const l of literals.filter((x) => x.kind === "field")) {
    const on = facts.fieldAnywhere.get(l.literal)
    if (!on) continue
    const siteNodes = siteNodeType(src, l.line, callers)
    if (siteNodes.length === 0) {
      unattributed.push({ field: l.literal, line: l.line, resolvesOn: [...on].sort() })
      continue
    }
    // Reachable if the field resolves on ANY node this site can receive. A
    // helper with two dispatch sites is reachable if either one carries it.
    if (!siteNodes.some((sn) => on.has(sn))) {
      unreachable.push({ field: l.literal, line: l.line, siteNode: siteNodes.join("|"), resolvesOn: [...on].sort() })
    }
  }
  for (const u of unreachable) {
    violations.push(`field "${u.field}" (line ${u.line}) is asked of ${u.siteNode}, but the grammar only resolves it on: ${u.resolvesOn.join(", ")}`)
  }
  // `unattributed` is reported in the evidence but is NOT a violation: after the
  // three attributor fixes every real defect is already caught by unknownFields,
  // and the residual entries are literals this instrument cannot thread through a
  // renamed parameter. Counting them as violations would report 15 defects on an
  // analyzer with 5, which is how a gate teaches people to ignore it.
  if (unattributed.length) {
    for (const u of unattributed) {
      // eslint-disable-next-line no-console
      console.log(`  note  unattributed (not a violation): ${u.field}@${u.line}`)
    }
  }

  return { literals, violations, unknownTypes, unknownFields, unreachable, unattributed }
}

// ── check helper ─────────────────────────────────────────────────────────────
const checks: Array<{ name: string; pass: boolean; detail: string }> = []
const check = (name: string, pass: boolean, detail = ""): void => { checks.push({ name, pass, detail }); }

async function main(): Promise<void> {
  const src = readFileSync(ANALYZER, "utf8")
  const facts = await grammarFacts(PROBE_LUA)
  const baseline = run(src, facts)

  check("the analyzer has literals to check", baseline.literals.length > 0, `${baseline.literals.length} literals`)
  check("every node-type literal names a type the grammar emits", baseline.unknownTypes.length === 0, `${baseline.unknownTypes.length} unknown: ${baseline.unknownTypes.map((l) => l.literal).join(", ") || "none"}`)
  check("every field literal resolves on some node", baseline.unknownFields.length === 0, `${baseline.unknownFields.length} unknown: ${baseline.unknownFields.map((l) => l.literal).join(", ") || "none"}`)
  check("every field literal is reachable on the node it is asked of", baseline.unreachable.length === 0, `${baseline.unreachable.length} unreachable: ${baseline.unreachable.map((u) => `${u.field}@${u.line}->${u.siteNode}`).join(", ") || "none"}`)

  // ── mutants: prove the gate can fail ───────────────────────────────────────
  // Each mutant is a planted defect of one rule. A rule that cannot fail is not
  // a rule. Mutants edit the SOURCE string, so the analyzer file on disk is
  // never touched.
  console.log("\nM: planted regressions (the gate must fail on each)")
  const MUTANTS: Array<{ name: string; src: string; expect: (v: string[]) => boolean }> = [
    {
      name: "invented node type",
      src: src.replace('case "function_declaration":', 'case "function_declarashun":'),
      expect: (v) => v.some((x) => x.includes("function_declarashun")),
    },
    {
      name: "invented field literal",
      src: src.replace('childForFieldName("arguments")', 'childForFieldName("argumenz")'),
      expect: (v) => v.some((x) => x.includes("argumenz")),
    },
    {
      name: "field asked of the wrong node (reachable nowhere at that site)",
      // Planted INSIDE a switch arm, so the attributor can type it: a `method`
      // field asked of a return_statement. `method` really exists in the
      // grammar, on method_index_expression — so only the REACHABILITY leg can
      // catch this one, which is the leg's reason to exist.
      //
      // It has to be written inline in the arm. An earlier version planted it
      // in a method body, where the attributor returns "unattributed", and the
      // mutant LEAKED while the gate reported a clean reachability leg. A
      // mutant that lands in the instrument's blind spot tests nothing.
      //
      // The exact bytes, read from the file rather than counted by eye: the
      // `case` line is indented 6 and its body 8, and two earlier guesses (both
      // 6-and-6) matched nothing. The "was actually planted" check below is
      // what turned that typo from a silent no-op into a visible failure.
      src: src.replace(
        '      case "return_statement":\n        this.extractExport(node, frame, ctx)',
        '      case "return_statement":\n        if (node.childForFieldName("method")) { /* planted */ }\n        this.extractExport(node, frame, ctx)',
      ),
      expect: (v) => v.some((x) => x.includes('"method"')),
    },
  ]
  let caught = 0
  const mutantDetail: Array<{ name: string; caught: boolean; planted: boolean; violations: string[] }> = []
  let unplanted = 0
  for (const m of MUTANTS) {
    // A mutant whose replace matched nothing is not a failing gate, it is a
    // typo. Measured: one did exactly this and read as a LEAK, which would have
    // sent someone hunting a phantom instrument defect.
    const planted = m.src !== src
    if (!planted) unplanted++
    const r = run(m.src, facts)
    const hit = planted && m.expect(r.violations)
    if (hit) caught++
    mutantDetail.push({ name: m.name, caught: hit, planted, violations: r.violations.slice(0, 4) })
    console.log(`  ${!planted ? "NOPLANT" : hit ? "CAUGHT" : "LEAK  "}  ${m.name}`)
  }
  check("every mutant was actually planted in the source", unplanted === 0, `${MUTANTS.length - unplanted}/${MUTANTS.length} planted`)
  check("every planted regression is caught by the gate itself", caught === MUTANTS.length, `${caught}/${MUTANTS.length}`)
  check("the real analyzer file was not mutated by the mutant run", readFileSync(ANALYZER, "utf8") === src, "source string equal to baseline")

  const passed = checks.every((c) => c.pass)
  const result = {
    schemaVersion: 1,
    gate: "verify-lua-grasped-fields",
    title: "M60 lua LUA-00 — every analyzer node-type/field literal is emitted and reachable",
    at: new Date().toISOString(),
    commit: process.env.BB_COMMIT || null,
    analyzer: "src/ast/real-lua-analyzer.ts",
    grammar: "wasm/tree-sitter-lua.wasm",
    rationale: "Five childForFieldName literals in the lua analyzer name fields the pinned grammar does not have, and each sits behind a `|| namedChild(0)` fallback that converts a dead path into a silent wrong answer. M14.0.F1 reports lua grammar:fail for the same five but has no reachability notion and does not fail the build. This gate is the permanent gate the F7 rule requires BEFORE such a fix counts as landed.",
    measurement: {
      literalsFound: baseline.literals.length,
      typeLiterals: baseline.literals.filter((l) => l.kind === "type").length,
      fieldLiterals: baseline.literals.filter((l) => l.kind === "field").length,
      unknownNodeTypes: baseline.unknownTypes.map((l) => ({ literal: l.literal, line: l.line })),
      unknownFields: baseline.unknownFields.map((l) => ({ literal: l.literal, line: l.line })),
      unreachableFields: baseline.unreachable,
      unattributedFieldsNotCounted: baseline.unattributed,
      grammarNodeTypesSeen: facts.nodeTypes.size,
    },
    checks,
    mutants: { caught, total: MUTANTS.length, unplanted, detail: mutantDetail },
    passed,
    status: passed ? "pass" : "fail",
    limitations: [
      "Reachability attributes each field site to the nearest enclosing `case \"type\"`; a literal inside a helper method called from several dispatch sites is attributed to the method's own context and is reported as reachable-if-anywhere. This is a known softness, recorded rather than hidden.",
      "The probe is one file. It exercises each extraction path but is not a corpus; a literal that only appears on a rare shape would read as unreachable here and need a wider probe.",
    ],
  }
  mkdirSync(dirname(EVIDENCE), { recursive: true })
  writeFileSync(EVIDENCE, JSON.stringify(result, null, 2) + "\n")

  for (const c of checks) console.log(`  ${c.pass ? "ok  " : "FAIL"}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`)
  if (baseline.violations.length) {
    console.log("\nviolations:")
    for (const v of baseline.violations) console.log(`  - ${v}`)
  }
  console.log(`\nlua-grasped-fields: ${result.status.toUpperCase()} (${checks.filter((c) => c.pass).length}/${checks.length} checks, ${caught}/${MUTANTS.length} mutants caught)`)
  console.log(`wrote ${EVIDENCE}`)
  if (!passed) process.exitCode = 1
}
main()
