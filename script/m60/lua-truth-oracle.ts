// lua-truth-oracle.ts — M60 lua: an INDEPENDENT tree-derived truth for every
// relationship the lua analyzer emits, with the line each edge must carry, and
// a two-directional diff against the real analyzer over a real corpus.
//
// WHY THIS IS STANDALONE AND NOT A `lang === "lua"` CASE IN
// script/m14/differential.ts
// -----------------------------------------------------------------------
// The family harness (M14.0.F5) is where lua's `diff: n/a` in the M60 matrix
// comes from: deriveTreeEdges covers 30 languages and lua is not one of them.
// Adding the case there is the eventual goal, but that file is 14,219 lines and
// it was observed MODIFIED IN THE WORKING TREE by a co-agent working another
// lane while this was being written. Editing a shared file another agent is
// mid-edit is how lines get lost, so this instrument is standalone and the
// wiring is left as a separate, small, deliberate commit on a quiet tree.
//
// INDEPENDENCE, and its limit, stated plainly
// -------------------------------------------
// Truth is derived from the wasm PARSE TREE, not from the analyzer's output.
// That is what makes a missing edge visible: if truth came from the analyzer,
// a dropped edge would drop out of both sides and read as agreement.
//
// The limit is real and is not hidden: where the analyzer makes a POLICY
// choice rather than a structural one, the oracle has to mirror that policy or
// it will report a difference that is not a defect. Every such case is listed
// in MIRRORED_POLICY below with its reason, so a reader can see exactly where
// the two sides were made to agree by hand and judge whether that agreement is
// justified. A mirror is only legitimate when the policy is about WHAT to
// report (e.g. `require` is an import, not a call); it is NOT legitimate when
// it is about WHERE (e.g. "emit the edge only if the table was seen declared
// first") — that one is a structural claim and is measured, not mirrored.
//
// THE LINE RULE (M59 #825), derived here rather than imported
// ---------------------------------------------------------
// The line an edge carries is the line its NAME is written on, not the line the
// enclosing node opens on. java states the reason at
// real-java-analyzer.ts:967-971: an invocation starts at its RECEIVER, so
// `a.b()\n  .c()` puts c on the line a.b() opened on. The oracle computes
// `calleeLine` from the same tree the analyzer parses and does not import the
// analyzer's helper, so an error in that helper shows up as a LINE
// disagreement rather than being cancelled out by a shared import. The family
// harness imports shape rules from the analyzer on purpose (#917, #919); this
// instrument deliberately does NOT, for the line rule, so the two sides can
// disagree about it.
//
// Usage:
//   npx tsx script/m60/lua-truth-oracle.ts --repo kong --sample 200
//   npx tsx script/m60/lua-truth-oracle.ts --repo luvit
//   npx tsx script/m60/lua-truth-oracle.ts --repo kong --selftest
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { parseFile } from "../../src/ast/pool-worker"
import { parseWithAnalyzer } from "./lua-analyzer-direct"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const REPOS = "$HOME/fixtures/repositories"
const arg = (k: string, d?: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)

export interface TruthEdge { rel: string; label: string; from: string; target: string; line: number | null; rule: string }

// The pipeline's relationship denylist, IMPORTED not re-typed: pool-worker
// drops any relationship whose target leaf is in NOISE_TARGETS, and that set
// contains "type" and "text" — which are a Lua BUILTIN and an extremely common
// Lua identifier respectively. The import means a change to the set is measured
// here the day it is made, rather than when someone remembers this file.
let NOISE_TARGETS: Set<string> = new Set()
export function loadNoiseTargets(src: string): Set<string> {
  const m = src.match(/const NOISE_TARGETS = new Set\(\[([\s\S]*?)\]\)/)
  NOISE_TARGETS = new Set(m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [])
  return NOISE_TARGETS
}
const leafOf = (t: string): string => { const parts = t.split(":"); return parts[parts.length - 1] }

// ── MIRRORED_POLICY: every place the oracle agrees with the analyzer BY HAND ──
// Each entry must be a statement about WHAT is reported, never about WHERE.
// Anything structural is measured instead, and a disagreement is a finding.
export const MIRRORED_POLICY: Array<{ rule: string; why: string }> = [
  { rule: "require/module is `imports`, not `calls`", why: "A policy about the label a require carries. The EDGE still has to be found, so a dropped require still shows as missing." },
  { rule: "pcall/xpcall wrapping require is `imports`, and the pcall call itself is not a `calls` edge", why: "The wrapper is transport, not a call target the user asked about. Measured rather than assumed: lua's pcall is a stdlib wrapper, and the analyzer's choice is visible in its own source." },
  { rule: "a global function is `global` as its `from`", why: "The scope name for top level. Structural, but the alternative (inventing a file scope) would fabricate a node that does not exist." },
]

// ── the tree walk ────────────────────────────────────────────────────────────
// One recursive walk producing BOTH the truth edges and the declaration table
// the extends/instantiates rules need. Written as a plain recursion rather than
// the analyzer's explicit stack, deliberately: a shared traversal shape is how
// an oracle ends up sharing the defect it is meant to hunt.
interface Walk {
  edges: TruthEdge[]
  /** local variable names declared directly in each function scope */
  localsIn: Map<string, Set<string>>
  /** LUA-28: self-containment edges deliberately NOT derived. Reported, not hidden. */
  selfContainmentSkipped: number
  /** every table name bound to a table_constructor anywhere in the file */
  declaredTables: Set<string>
  /** ORA-4: scope -> its enclosing scope, so a name can be resolved up the chain */
  scopeParent: Map<string, string | undefined>
}

function calleeOf(call: any): { name: string; nameNode: any } | null {
  const n = call.childForFieldName("name") || call.namedChild(0)
  if (!n) return null
  if (n.type === "identifier") return { name: n.text, nameNode: n }
  if (n.type === "dot_index_expression" || n.type === "method_index_expression") {
    // The callee is the FIELD, which in this grammar is the LAST named child;
    // the first is the receiver. Using the first is the bug that made a
    // line-broken call report the receiver's line, so the oracle states it.
    const last = n.namedChildCount > 0 ? n.namedChild(n.namedChildCount - 1) : null
    if (last?.text) return { name: last.text, nameNode: last }
  }
  // M60 LUA-22: a computed index has no name. The oracle emitted the whole
  // expression as a truth edge, which is the same payload-as-a-name defect the
  // analyzer had — so the two agreed on a wrong answer and the differential
  // could not see it. Both sides now skip it, which is the point: an oracle that
  // shares a defect is worse than no oracle, because it launders the defect.
  //
  // LUA-27: this guard was DEAD CODE for the whole life of LUA-22, because it
  // tested for `table_index_expression` — a node type this grammar never emits.
  // The wired grammar builds `dao[method or context](x)` as
  // function_call > bracket_index_expression, and the ANALYZER's own LUA-22 fix
  // already corrected the name to `bracket_index_expression` with a comment
  // recording the mistake. The oracle's copy kept the wrong one, so every
  // computed-index call fell through to `return { name: n.text }` and the truth
  // side carried targets like `dao[method or context .. "_by_" .. endpoint_key]`
  // — a PROGRAM, not a name. 46 such edges on kong, all of them filed as analyzer
  // misses. A guard copied from another file and never re-measured against the
  // grammar is how a fixed defect stays fixed on one side and live on the other.
  // LUA-30: a LITERAL string index is a NAME, and it is the same name
  // `dao.rows()` gives — `dao["rows"]()` and `dao.rows()` call the same field.
  // LUA-27 stopped the whole `bracket_index_expression` class, which also stopped
  // the literal half of it. The two are indistinguishable BY TYPE (both are
  // bracket_index_expression) and distinguishable by the `field` child, measured:
  //   dao["rows"]()  field=string      -> the name is the unquoted content
  //   dao[1]()       field=number      -> an array index, not a name
  //   dao[k]()       field=identifier  -> a VARIABLE holding the key; which key
  //                                       is not statically knowable
  // Stated from the grammar rather than copied from the analyzer: the analyzer
  // independently reached the same rule in the same pass, and two sides reaching
  // one rule from one measurement is the only kind of agreement worth having.
  if (n.type === "bracket_index_expression") {
    const field = n.childForFieldName("field")
    if (field?.type !== "string") return null
    let content: any = null
    for (let j = 0; j < field.namedChildCount; j++) {
      const c = field.namedChild(j)
      if (c && c.type === "string_content") { content = c; break }
    }
    const name = content ? content.text : field.text.replace(/^["']|["']$/g, "")
    return name ? { name, nameNode: field } : null
  }
  // LUA-28: the same category error, one step further out. A call ON A CALL —
  // `json_array_iterator('{1, 2, 3}')()`, `sandbox.sandbox(...)()` — has a callee
  // that is itself a `function_call`, so the fallthrough named the inner call and
  // the truth side carried `json_array_iterator('{1, 2, 3}')` as a target. There
  // is no name there: what is called is the RESULT of a call, and nothing about
  // that is statically knowable. The analyzer drops these and is right.
  //
  // Stated as a WHITELIST rather than another blacklist entry, because two
  // blacklists in a row is how the dead guard above happened: each named a type
  // that had to be measured, and a type nobody re-measures stays wrong forever.
  // These four are the only callee forms that carry a name, and the grammar is
  // the authority for that list.
  if (n.type === "function_call" || n.type === "table_constructor" || n.type === "binary_expression" ||
      n.type === "parenthesized_expression" || n.type === "string" || n.type === "number") return null
  return { name: n.text, nameNode: n }
}

function firstStringArg(call: any): { value: string; node: any } | null {
  const args = call.childForFieldName("arguments")
  if (!args) return null
  const first = args.namedChild(0)
  if (!first || first.type !== "string") return null
  let text = first.text.trim()
  if (text.length >= 2) {
    const a = text[0]
    const z = text[text.length - 1]
    if ((a === '"' || a === "'") && a === z) text = text.slice(1, -1)
  }
  if (text.startsWith("[[") && text.endsWith("]]")) text = text.slice(2, -2)
  return { value: text, node: first }
}

function argAt(call: any, i: number): any {
  const args = call.childForFieldName("arguments")
  if (!args) return null
  return args.namedChild(i)
}

// A declaration's name has THREE parts, and conflating them is how this oracle
// first reported `contains global -> onKey` for `function Editor:onKey(key)`:
//
//   label  the name field's FULL text, e.g. "Editor:onKey", "M.new". This is
//          the scope a call inside the body is attributed to. The two readings
//          that are NOT the label are the field alone and the receiver alone.
//   name   the field alone — the method's own name, the symbol's name.
//   owner  the receiver, when the name is an index expression. The table that
//          owns the method.
//
// A method's symbol belongs to its receiver, and the edge that names it is
// `contains <receiver> -> <field>`. Attributing it to the enclosing scope is an
// ORACLE error, and it looked like an analyzer error for about ten minutes.
function functionNameOf(decl: any): { label: string; name: string; owner?: string; nameNode: any } | null {
  const n = decl.childForFieldName("name")
  if (!n) return null
  if (n.type === "identifier") return { label: n.text, name: n.text, nameNode: n }
  if (n.type === "dot_index_expression" || n.type === "method_index_expression") {
    const first = n.namedChild(0)
    const last = n.namedChildCount > 1 ? n.namedChild(n.namedChildCount - 1) : undefined
    if (last?.text) {
      return {
        label: n.text,
        name: last.text,
        owner: first?.type === "identifier" ? first.text : undefined,
        nameNode: last,
      }
    }
  }
  return null
}

// PRE-PASS: what names are tables in this file, independent of where they are
// declared relative to a call.
//
// The first version of this oracle collected `declaredTables` during the same
// walk that reads it, which made it order-dependent in exactly the way the
// ANALYZER is — so it could not see the analyzer's order dependence (LUA-06), it
// shared it. It also under-counted tables: it required a binding to a
// `table_constructor`, so `local Process = core.Emitter:extend()`
// (luvit/deps/childprocess.lua:42) was not a table, and 26 genuine
// `instantiates` edges on luvit were recorded as analyzer FABRICATIONS.
//
// A Lua class is a table by idiom, not by literal: a name is a table if it is
// bound to a table constructor, OR it is the receiver of a method declaration,
// OR it is the first argument of a setmetatable call. That is a property of the
// FILE, so it is computed in a pass that does not depend on traversal order.
function collectTables(root: any, out: Set<string>): void {
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "variable_declaration" || n.type === "assignment_statement") {
      const vl = n.type === "variable_declaration" ? n.namedChild(0)?.namedChild(0) : n.namedChild(0)
      const val = n.type === "variable_declaration" ? n.namedChild(0)?.namedChild(1)?.namedChild(0) : n.namedChild(1)?.namedChild(0)
      if (vl?.type === "variable_list" && val?.type === "table_constructor") {
        for (let i = 0; i < vl.namedChildCount; i++) { const id = vl.namedChild(i); if (id?.type === "identifier") out.add(id.text) }
      }
    }
    if (n.type === "function_declaration") {
      const nm = n.childForFieldName("name")
      if (nm && (nm.type === "dot_index_expression" || nm.type === "method_index_expression")) {
        const recv = nm.namedChild(0)
        if (recv?.type === "identifier") out.add(recv.text)
      }
    }
    if (n.type === "function_call") {
      const c = calleeOf(n)
      if (c && (c.name === "setmetatable" || c.name === "extend")) {
        const a0 = argAt(n, 0)
        if (a0?.type === "identifier") out.add(a0.text)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
}

// ORA-4, found by the analyzer being RIGHT and the oracle wrong: a name
// assigned in a NESTED function is a declaration only if it is not visible in
// any ENCLOSING scope. The oracle checked the innermost scope alone, so every
// upvalue assignment read as a new declaration and recall fell while the
// analyzer's behaviour was correct.
//
// Measured: luvit/deps/codec.lua declares `local paused = false` at L40 inside a
// `do ... end` block and assigns `paused = true` at L44 inside
// `function emitter:pause()`. That is an UPVALUE assignment, not a
// declaration — the analyzer skips it and is right. So the oracle resolves a
// name against the whole enclosing SCOPE CHAIN, which is what lexical scope
// means.
// M60 LUA-33: the ONE rule for "does this node carry a name", shared by the
// callee path (LUA-27/LUA-30) and the setmetatable path (LUA-33), so the two
// cannot drift the way `table_index_expression` did. Three forms carry a name;
// nil, a call, a binary expression and a table constructor do not.
function* walkNodes(node: any): Generator<any> {
  const stack = [node]
  while (stack.length) {
    const n = stack.pop()
    yield n
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
}

// ── METADATA TRUTH, derived from the tree and NOT from the analyzer ──────────
// M60 LUA-36. These are re-implementations of the CONTRACT, written from the
// grammar, so a disagreement is a question about which side is wrong rather than
// a comparison of one implementation with itself.

/**
 * Coroutines are counted as CREATIONS — `coroutine.create` and `coroutine.wrap` —
 * not as every call into the coroutine library. That is the contract the existing
 * gate states: a fixture with one `coroutine.create` and one `coroutine.wrap`
 * publishes `coroutineUsage: 2`, and those are two coroutines brought into
 * existence. `coroutine.resume` and `coroutine.yield` do not create anything, so
 * counting them answers a different question.
 *
 * This truth side got that wrong twice before it got it right, and both wrong
 * answers pointed at the ANALYZER. It first required `callee.type === "identifier"`,
 * which misses every real call because `coroutine.create` is a
 * `dot_index_expression` — so it reported `1 vs 0` on a file that plainly has one
 * `coroutine.create`. It then counted all four library functions, so it reported
 * `1 vs 2` on kong/init.lua, which has a `create` AND a `resume` and exactly one
 * coroutine. Both times the instrument was the thing that was wrong, and a truth
 * side that has to be corrected by looking at the code it is checking is a truth
 * side whose contract was never written down. This comment is that contract.
 *
 * The callee is matched by the standard name rule: identifier, or a dot/method
 * index whose text is the path.
 */
function countCoroutines(root: any): number {
  const CREATES = new Set(["coroutine.create", "coroutine.wrap"])
  let n = 0
  for (const node of walkNodes(root)) {
    if (node.type !== "function_call") continue
    for (let i = 0; i < node.childCount; i++) {
      const fn = typeof node.fieldNameForChild === "function" ? node.fieldNameForChild(i) : null
      if (fn !== "name") continue
      const name = nameBearing(node.child(i))
      if (name && CREATES.has(name)) n++
    }
  }
  return n
}

/**
/**
 * Any member access in the file — the MINIMUM evidence a framework claim needs,
 * and the whole of the LUA-04 contract in one decidable fact.
 *
 * The first version of this leg derived one framework from the tree (Neovim) and
 * counted every OTHER framework the analyzer legitimately knows as fabricated: 37
 * spurious "findings" across 68 files, every one of them this truth side being
 * too narrow rather than the analyzer being wrong. The fix is not to derive the
 * full framework table — that means COPYING it, and a copy agrees by construction
 * and proves nothing, which is the mirror trap this lane has paid for twice
 * (LUA-27, LUA-33). It is to ask the question that needs no table: does the file
 * contain a member access at all? LUA-04 claimed a framework from BARE
 * IDENTIFIERS, so a file whose only names are `use`, `setup` and `GetTime` has
 * none, and must claim nothing.
 */
function countMemberAccess(root: any): number {
  let n = 0
  for (const node of walkNodes(root)) {
    if (node.type === "dot_index_expression" || node.type === "method_index_expression") n++
  }
  return n
}

/**
 * M60 LUA-37: the RESOLVABLE source a `contains` edge must point at, tracked
 * alongside `scope` (the LABEL).
 *
 * The oracle walked one string, `scope`, and used it for two different jobs: the
 * scope a body belongs to, and the source of the containment edges inside it.
 * Those are not the same thing. `function fs.appendFile(...)` gives scope
 * "fs.appendFile" — right for scoping, and not a name any symbol is filed
 * under, because the method is filed as name `appendFile` with owner `fs`. Every
 * containment edge inside that body therefore read `fs.appendFile -> …` and
 * pointed at nothing, so a consumer walking symbol -> members could not follow
 * 22.6% of kong's edges and 1,352 of luvit's.
 *
 * The analyzer was fixed first and this had to follow, in lockstep, or the two
 * would simply disagree — which is what happened for one run (analyzer-attributable
 * 725, spurious 497) before this change. Two implementations of one rule must be
 * written from one measurement, and the measurement is the symbol table.
 */
let edgeSource: string | undefined

const forBoundVars = new Set<string>()
let loopCoincidence = 0
const loopCoincidenceSample: string[] = []

function nameBearing(node: any): string | undefined {
  if (!node) return undefined
  if (node.type === "identifier") return node.text
  if (node.type === "dot_index_expression" || node.type === "method_index_expression") return node.text
  return undefined
}

function visibleInChain(w: Walk, scope: string, name: string): boolean {
  let s: string | undefined = scope
  const seen = new Set<string>()
  while (s !== undefined && !seen.has(s)) {
    seen.add(s)
    if (w.localsIn.get(s)?.has(name)) return true
    s = w.scopeParent.get(s)
  }
  return false
}

function walk(node: any, scope: string, w: Walk, rel: string, fnDepth = 0): void {
  if (node.isMissing) return

  if (node.type === "variable_declaration") {
    // ORA-6: a variable_declaration has TWO shapes, and the oracle handled only
    // the first. Measured:
    //   local a, b = 1, 2  ->  variable_declaration > assignment_statement
    //                                    > variable_list + expression_list
    //   local solo         ->  variable_declaration > variable_list, and NO
    //                            assignment_statement at all
    //
    // So a bare `local x` was invisible to the oracle on BOTH counts: it emitted
    // no declaration edge for it, and it never registered `x` as a scope-local,
    // which made a LATER `x = something` read as a fresh declaration. The
    // analyzer skips that assignment (correctly — `x` is already declared), so
    // the two disagreed and the differential reported 30 unexplained edges and
    // 418 wrong lines against code that was RIGHT.
    //
    // This is the sixth time in this lane that the analyzer was correct and the
    // oracle was not (ORA-1, ORA-2, ORA-4, ORA-5, and now this). The pattern is
    // stable enough to state as a rule: a disagreement is a question about which
    // side is wrong, and the oracle is the side that has been wrong, because the
    // oracle is the thing being written to fit a hypothesis rather than to read
    // a grammar.
    //
    // The names live in a variable_list reached by TYPE, because this grammar has
    // no `name_list` field (LUA-00).
    const first = node.namedChild(0)
    const asg = first?.type === "assignment_statement" ? first : undefined
    const list = asg ? asg.namedChild(0) : (first?.type === "variable_list" ? first : undefined)
    if (list?.type === "variable_list") {
      for (let i = 0; i < list.namedChildCount; i++) {
        const id = list.namedChild(i)
        if (id?.type !== "identifier") continue
        // M60 LUA-25: file-scope locals MUST be registered here too, and were
        // not. The `if (scope !== "global")` guard skipped the bookkeeping while
        // still pushing the `contains` edge below, so `local prev_min_at` at
        // kong/cluster_events/init.lua:272 produced an edge but left
        // `localsIn.get("global")` empty. `visibleInChain` then walked
        // `poll` -> `global`, found nothing, and returned false — so the
        // upvalue WRITE at :286 was read as a fresh declaration and the oracle
        // demanded `contains poll -> prev_min_at`. The analyzer does not emit it
        // and is right: `prev_min_at` is a file-scope local that `poll` closes
        // over, not a local of `poll`.
        //
        // This is LUA-21's shape again, in the instrument. LUA-21 was an
        // upvalue assignment emitting a containment edge naming a symbol that
        // does not exist; it was fixed in the analyzer, and the oracle's
        // ORA-4 guard for the same case was blind to file scope the whole time.
        // 242 of kong's 290 analyzer-attributable missing edges are this one
        // missing line.
        if (!w.localsIn.has(scope)) w.localsIn.set(scope, new Set())
        w.localsIn.get(scope)!.add(id.text)
        // LUA-28: a scope cannot be a member of itself. `contains new_router ->
        // new_router` is incoherent on any reading — the scope IS the name — and
        // the analyzer's member-identity gate has a standing check that no
        // symbol duplicates its own owner. The oracle derived 5 such edges on
        // kong (`new_router` L426, `initialize` L36, `sleep_once_for_balancer_init`
        // L802 and two more), all filed as analyzer misses, and the analyzer was
        // right to omit every one. Skipped rather than emitted, and not silently:
        // the count is reported.
        const src = edgeSource ?? scope
        if (id.text !== src) w.edges.push({ label: "contains", from: src, target: id.text, line: id.startPosition.row + 1, rule: "local-decl", rel })
        else w.selfContainmentSkipped++
        // A bare `local x` carries no value, so there is nothing to test for a
        // table. A declaration WITH a value can bind a table, and the
        // `instantiates` rule depends on knowing which names those are.
        const v0 = asg ? asg.namedChild(1)?.namedChild(0) : undefined
        if (v0?.type === "table_constructor") w.declaredTables.add(id.text)
      }
    }
  }

  // M60 LUA-26 — DELIBERATELY NOT DERIVED, and the reason is a decision that has
  // not been made rather than a rule that was overlooked.
  //
  // A for-loop's control variables are bindings in Lua, and an earlier version
  // of this oracle DID derive `contains scope -> <loop var>` for both clause
  // forms (for_numeric_clause's `name` field, for_generic_clause's
  // variable_list). That produced 2,921 additional missing edges on kong and
  // read as 2,921 analyzer defects. It is not 2,921 defects, and the evidence
  // is a two-function probe:
  //
  //   local function sel(a)  for _, listener in ipairs(a) do print(listener) end end
  //   local function sel2(a) for _, listener in ipairs(a) do listener = a end end
  //
  // emits `sel2 -> listener` and NOT `sel -> listener`. The analyzer has no
  // for-clause declaration rule at all — for_statement appears in it once, as a
  // cyclomatic-complexity counter — so the sel2 symbol is manufactured by the
  // ASSIGNMENT, not by the loop. Which means the analyzer is not "missing" loop
  // variables by accident; it does not model them, consistently, and a file that
  // only READS a loop variable gets no symbol while one that ASSIGNS it does.
  //
  // So the question is not which side is wrong, it is whether loop variables
  // belong in the symbol graph at all. FOR: they are locals, and
  // `contains sel -> listener` is a true statement. AGAINST: the variable's
  // scope is the LOOP, not the function, so filing it under the function is
  // imprecise, and a binding that lives one iteration is rarely a navigation
  // target. That is a product decision about the symbol table's meaning, and the
  // oracle is not entitled to make it by deriving edges the analyzer never
  // claimed. Recorded as LUA-26, open, for the owner.
  //
  // It also explains this run's single UNEXPLAINED edge, which is the shape of a
  // real defect and was nearly recorded as one: the analyzer emits
  // `contains Schema:errors_to_string -> err` for `for _, err in pairs(...)`
  // in kong/db/schema/init.lua, where `err` is bound by no `local` — but it is
  // ASSIGNED at :2320 (`err = self:errors_to_string(err)`), and that assignment
  // is what creates the symbol. Two different routes to the same true edge. The
  // oracle is silent on the loop, so the agreement is a coincidence rather than
  // a derivation, which is why the edge showed up unexplained.

  if (node.type === "assignment_statement" && node.parent?.type !== "variable_declaration") {
    const vl = node.namedChild(0)
    if (vl?.type === "variable_list") {
      for (let i = 0; i < vl.namedChildCount; i++) {
        const id = vl.namedChild(i)
        if (id?.type !== "identifier") continue
        // ORA-4: a re-assignment of a name VISIBLE in this scope chain is not a
        // new declaration. Checked up the whole chain, because a closure assigns
        // its enclosing block's locals as UPVALUES and the analyzer is right to
        // skip those. The analyzer answers the same question with an inherited
        // frame, which is the same rule expressed structurally.
        if (visibleInChain(w, scope, id.text)) continue
        const src2 = edgeSource ?? scope
        if (id.text !== src2) w.edges.push({ label: "contains", from: src2, target: id.text, line: id.startPosition.row + 1, rule: "assign-decl", rel })
        else w.selfContainmentSkipped++
      }
    }
  }

  // M60 LUA-21: an ANONYMOUS function's parameters are bound in the ENCLOSING
  // scope — a nameless closure has no scope of its own to bind them in, and it
  // can see the enclosing one. The oracle did not do this, so `srv = server()`
  // inside a closure looked like a declaration and one genuine skip was reported
  // as a missing edge.
  if (node.type === "function_definition") {
    const ps = node.namedChild(0)
    if (ps?.type === "parameters") {
      for (let j = 0; j < ps.namedChildCount; j++) {
        const prm = ps.namedChild(j)
        if (prm?.type !== "identifier") continue
        if (scope !== "global") {
          if (!w.localsIn.has(scope)) w.localsIn.set(scope, new Set())
          w.localsIn.get(scope)!.add(prm.text)
        }
      }
    }
  }

  if (node.type === "function_declaration") {
    const fn = functionNameOf(node)
    if (fn) {
      // A method belongs to its RECEIVER, not to the enclosing scope.
      w.edges.push({ label: "contains", from: fn.owner ?? (edgeSource ?? scope), target: fn.name, line: fn.nameNode.startPosition.row + 1, rule: fn.owner ? "method-decl" : "fn-decl", rel })
      if (!w.localsIn.has(fn.label)) w.localsIn.set(fn.label, new Set())
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c?.type === "parameters") {
          for (let j = 0; j < c.namedChildCount; j++) {
            const p = c.namedChild(j)
            if (p?.type === "identifier") w.localsIn.get(fn.label)!.add(p.text)
          }
        }
      }
    }
  }

  if (node.type === "function_call") {
    const callee = calleeOf(node)
    if (callee) {
      const line = callee.nameNode.startPosition.row + 1
      if (callee.name === "require" || callee.name === "module") {
        const s = firstStringArg(node)
        if (s) w.edges.push({ label: "imports", from: scope, target: s.value, line, rule: "require", rel })
      } else if (callee.name === "pcall" || callee.name === "xpcall") {
        if (argAt(node, 0)?.text === "require") {
          const s = firstStringArg({ childForFieldName: (f: string) => (f === "arguments" ? { namedChild: (i: number) => argAt(node, i + 1) } : null) } as any)
          if (s) w.edges.push({ label: "imports", from: scope, target: s.value, line, rule: "pcall-require", rel })
        }
      } else {
        w.edges.push({ label: "calls", from: scope, target: callee.name, line, rule: "call", rel })
      }

      if (callee.name === "setmetatable") {
        const target = argAt(node, 0)
        const meta = argAt(node, 1)
        // M60 LUA-33: the relaxation that fixed LUA-18 overcorrected, and the
        // oracle became the mirror image of the defect it was correcting.
        //
        // LUA-18 retracted an `extends` over-fabrication claim: the oracle had
        // required `meta.type === "identifier"`, called 3 genuine edges
        // fabrications, and recorded the analyzer's precision as 0.7. The
        // correction — "the second argument of setmetatable is a table-valued
        // expression by definition" — was right about MEMBER expressions
        // (`Emitter.meta`) and wrong about everything else. Dropping the type
        // requirement entirely let `setmetatable(_G, nil)` derive
        // `extends _G -> nil` (5 sites on kong), `setmetatable(opts or {}, defaults)`
        // derive a SOURCE that is a binary expression, and
        // `setmetatable(env.ngx, getmetatable(ngx))` derive a call as a target.
        //
        // The rule is the LUA-32 one, which the analyzer adopted in the same pass
        // and this rule missed: an endpoint must be a NAME. identifier,
        // dot_index_expression and method_index_expression carry one; nil, a
        // binary expression, a call and a table constructor do not. `nil` is not a
        // superclass and `getmetatable(ngx)` is not a name.
        //
        // 16 kong edges were the difference, and they were the ORACLE's — the
        // analyzer was right to refuse all of them.
        const srcName = nameBearing(target)
        const mtName = nameBearing(meta)
        if (target && meta && target.type !== "table_constructor" && meta.type !== "table_constructor" && srcName && mtName) {
          w.edges.push({ label: "extends", from: srcName, target: mtName, line: meta.startPosition.row + 1, rule: "setmetatable", rel })
        }
      }

      if (["new", "constructor"].includes(callee.name)) {
        const recv = node.childForFieldName("name")
        const table = recv && (recv.type === "dot_index_expression" || recv.type === "method_index_expression")
          ? recv.namedChild(0)?.text : undefined
        // STRUCTURAL, NOT MIRRORED: the receiver must be a table in this FILE,
        // computed in an order-independent pre-pass. The analyzer gates the same
        // thing on traversal order (it had already walked past the declaration),
        // so any disagreement here is LUA-06 made visible rather than shared.
        if (table && w.declaredTables.has(table)) {
          w.edges.push({ label: "instantiates", from: scope, target: table, line, rule: "ctor", rel })
        }
      }
    }
  }

  // LUA-24: `fnDepth === 0` is the real test for "is this a module export", and
  // it is a different test from `scope === "global"`. The scope NAME can be
  // `global` inside an anonymous function, because an unnamed function
  // contributes no name; the depth cannot. Both are required: depth keeps an
  // in-function return out, and the scope check keeps the oracle from deriving
  // an export edge attributed to some other callable.
  if (node.type === "return_statement" && scope === "global" && fnDepth === 0) {
    const list = node.namedChild(0)
    const first = list?.namedChild(0)
    // Only `return <identifier>`: the oracle asserts what the analyzer's own
    // contract says it exports. `return {}` and `return require(...)` are
    // recorded as NOT exported by both sides, and if that is wrong the fix is a
    // finding, not a mirror.
    if (first?.type === "identifier") {
      w.edges.push({ label: "exports", from: "global", target: first.text, line: first.startPosition.row + 1, rule: "return-id", rel })
    }
    // M60 LUA-09: a returned table literal names its own members, and the
    // analyzer now publishes them. This branch was added at the same time, and
    // it is a MIRROR — which is the whole risk of this instrument. If the two
    // sides are wrong together, the differential reports agreement. So the
    // independent check on this rule is not the oracle at all: it is
    // script/m60/lua-export-census.ts, which derives the same expectation from
    // the grammar by a different walk and compares it to the analyzer over 1,508
    // corpus files. The oracle's job is only to keep the PIPELINE-side truth
    // complete so the LUA-14 gap is measured at its true size — it was
    // understating it as 500 edges when the census derives 1,579.
    //
    // Only the `name` FIELD of a member is read. A positional entry has none,
    // and publishing it would mean inventing a name, so the oracle refuses to
    // derive one for the same reason the analyzer does.
    // M60 LUA-35: `return setmetatable(M, mt)` publishes M. The module's surface
    // IS M; the metatable is an attribute OF M, not a second export. Without this
    // on the truth side the three kong files that genuinely name M read as
    // fabricated exports — the analyzer right and the oracle calling it a defect,
    // which is the failure this lane keeps having to undo.
    else if (first?.type === "function_call") {
      let callNameNode: any = null
      for (let i = 0; i < first.childCount; i++) {
        const fn = typeof first.fieldNameForChild === "function" ? first.fieldNameForChild(i) : null
        if (fn === "name") callNameNode = first.child(i)
      }
      if (callNameNode?.text === "setmetatable") {
        const a0 = argAt(first, 0)
        const named = nameBearing(a0)
        if (named) w.edges.push({ label: "exports", from: "global", target: named, line: a0.startPosition.row + 1, rule: "return-setmetatable", rel })
      }
    }
    else if (first?.type === "table_constructor") {
      for (let i = 0; i < first.namedChildCount; i++) {
        const f = first.namedChild(i)
        if (!f || f.type !== "field") continue
        const key = f.childForFieldName("name")
        if (!key) continue
        let name: string | undefined
        if (key.type === "identifier") name = key.text
        else if (key.type === "string") {
          // The unquoted text lives in the `content` child; falling back to the
          // raw text would publish `"k"` with its quotes.
          let content: any = null
          for (let j = 0; j < key.namedChildCount; j++) {
            const c = key.namedChild(j)
            if (c && c.type === "string_content") { content = c; break }
          }
          name = content ? content.text : key.text.replace(/^["']|["']$/g, "")
        }
        if (!name) continue
        w.edges.push({ label: "exports", from: "global", target: name, line: key.startPosition.row + 1, rule: "return-table-member", rel })
      }
    }
  }

  // The scope a body belongs to is the name field's FULL TEXT, so a method
  // `Editor:onKey` and a local `function onKey` are DIFFERENT scopes. Using the
  // field alone collapses them and then dedups calls from two unrelated
  // functions into one edge — which is how 6 real call sites became 2 edges
  // with one wrong line each.
  // A function opens a scope; a `do ... end` block does NOT (Lua has no block
  // scope for locals), so a `local` inside `do ... end` belongs to the enclosing
  // function — which is exactly why `paused` is visible inside emitter:pause.
  const childScope = node.type === "function_declaration" || node.type === "function_definition"
    ? (functionNameOf(node)?.label ?? scope)
    : scope
  // The resolvable source: the member's OWN name for a method, the function's own
  // name otherwise, and the enclosing one for an anonymous closure.
  const childEdgeSource = node.type === "function_declaration" || node.type === "function_definition"
    ? (functionNameOf(node)?.name ?? edgeSource ?? "global")
    : edgeSource
  const prevEdgeSource = edgeSource
  edgeSource = childEdgeSource
  if (childScope !== scope) w.scopeParent.set(childScope, scope)
  // M60 LUA-24: an ANONYMOUS function must still count as a function for
  // anything that asks "is this lexically inside a function?", even though it
  // contributes no scope NAME. `functionNameOf` returns null when there is no
  // `name` field, so `childScope` above stays the enclosing scope and the body
  // was walked as if it were file scope — which made the oracle derive
  // `exports global -> v` for `return v` inside `for n, v in pairs(h) do`, and
  // 218 such edges across kong. The analyzer does not publish them, and it is
  // right: that is LUA-20, the same defect this lane fixed in the analyzer, here
  // in the instrument, and invisible until LUA-09 made exports measurable at all.
  //
  // Tracked as a depth rather than as a scope name on purpose. Giving the
  // anonymous function a synthetic scope name (`<anon@L113>`) would fix exports
  // AND silently change every `contains`/`calls` edge inside it, because those
  // carry the scope as their source. Depth answers only the question the export
  // rule actually asks, and leaves the other labels byte-identical.
  const childDepth = node.type === "function_declaration" || node.type === "function_definition" ? fnDepth + 1 : fnDepth
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c) walk(c, childScope, w, rel, childDepth)
  }
  edgeSource = prevEdgeSource
}

export function deriveLuaTruth(root: any, rel = ""): TruthEdge[] {
  const w: Walk = { edges: [], localsIn: new Map(), declaredTables: new Set(), scopeParent: new Map([["global", undefined]]), selfContainmentSkipped: 0 }
  collectTables(root, w.declaredTables)
  walk(root, "global", w, rel)
  // A set, because the analyzer's edge identity is (label, from, target): N call
  // sites of one callee are ONE stored edge. Collapsing here keeps the
  // comparison about PRESENCE. Per-site information is a separate finding
  // (LUA-01b) and is measured by count, not by this set.
  const seen = new Set<string>()
  return w.edges.filter((e) => {
    const k = `${e.label}\u001f${e.from}\u001f${e.target}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

const key = (e: { label: string; from: string; target: string }) => `${e.label}\u001f${e.from}\u001f${e.target}`

async function main(): Promise<void> {
  const repo = arg("--repo", "kong")
  const repoRoot = join(REPOS, repo)
  const sampleArg = arg("--sample")
  const selftest = process.argv.includes("--selftest")
  // The default artifact name must distinguish EVERY way the file set can be
  // narrowed, not just --sample. It did not: a `--files` run and a full-corpus run
  // both wrote `lua-truth-oracle-kong.json`, so the corpus mutation harness —
  // which runs ~10 narrowed passes and passes no --out — overwrote the
  // authoritative corpus artifact with a 14-file slice, and that slice was
  // committed as the corpus result. `filesDrawn: 14` in a file named for 1,309
  // is exactly the kind of quiet mislabel this lane keeps catching elsewhere.
  const filesArg0 = arg("--files")
  const sliceTag = sampleArg ? `-${sampleArg}` : filesArg0 ? `-files${filesArg0.replace(/\W+/g, "")}` : ""
  const outPath = arg("--out", join(ROOT, "validation", "m60", "results", `lua-truth-oracle-${repo}${sliceTag}.json`))

  let files = execFileSync("git", ["-C", repoRoot, "ls-files", "*.lua", "*.luau"], { encoding: "utf8", maxBuffer: 1 << 28 })
    .trim().split("\n").filter(Boolean)
  if (sampleArg) files = files.slice(0, Number(sampleArg))
  // --files <path> : a newline-separated list of corpus-relative paths. Added for
  // the corpus mutation harness, which must fire on a construct rather than on
  // whatever happens to sort first: the first 25 kong files contain ZERO
  // call-on-call and ZERO literal-index calls, so a mutation harness pointed at
  // them measures nothing and reports its mutants as SURVIVING when they simply
  // had no trigger. "Inconclusive" and "survived" are different facts and the
  // harness has to be able to tell them apart.
  const filesArg = filesArg0
  if (filesArg) {
    const want = new Set(readFileSync(filesArg, "utf8").split("\n").map((x) => x.trim()).filter(Boolean))
    const keep = files.filter((f) => want.has(f.replace(`${repoRoot}/`, "")) || want.has(f))
    if (keep.length === 0) {
      console.error(`--files matched none of ${files.length} corpus files; check the list is repo-relative`)
      process.exit(2)
    }
    files = keep
  }

  loadNoiseTargets(readFileSync(join(ROOT, "src", "ast", "pool-worker.ts"), "utf8"))
  const { loadWebTreeSitter, resolveWasmAsset } = await import("../../src/util/wasm")
  const mod: any = await loadWebTreeSitter()
  // The engine initialises the tree-sitter core lazily on its first parse; a raw
  // Language.load before that throws. One throwaway production parse enters a
  // known-good state.
  await parseFile(join(REPOS, "luvit", "init.lua"), REPOS)
  const lang: any = await mod.Language.load(resolveWasmAsset("tree-sitter-lua.wasm"))
  const parser = new mod.Parser()
  parser.setLanguage(lang)

  const LABELS = ["calls", "contains", "extends", "instantiates", "imports", "exports"] as const

  const truth = new Map<string, TruthEdge>()
  const observed = new Map<string, any>()
  // LUA-31: which labels the pipeline DISCARDS, PROVEN rather than inferred.
  // The direct path costs a second parse per file, so the probe is capped, and the
  // cap is reported with the verdict: a conclusion drawn from 150 files and
  // presented as a property of 1,309 is the quiet extrapolation this lane keeps
  // catching itself doing.
  const DUAL_SAMPLE_CAP = 150
  const dualProvesDiscard = new Set<string>()
  const dualAgrees = new Set<string>()
  let dualMeasured = 0
  let exportTruth = 0, exportHit = 0, exportSpurious = 0, exportFilesProbed = 0
  // M60 LUA-34: the DIRECT-path relationship comparison. Counters are declared
  // beside the export ones because they answer the same question for a different
  // payload, and `spurious` is the leg that catches a target the tree never
  // derived — which is precisely what a payload target is.
  let relTruth = 0, relHit = 0, relSpurious = 0, relFilesProbed = 0
  let disclosureFiles = 0, disclosureCount = 0
  let metaCoroutines = 0, metaFrameworks = 0, metaHit = 0, metaSpurious = 0, metaScoreSum = 0, metaScoreFiles = 0
  const metaMissed: string[] = []
  const metaExtra: string[] = []
  const metaScoreSet = new Set<number>()
  const relMissed: string[] = []
  const relExtra: string[] = []
  const directRelTruth = new Set<string>()
  const exportMissed: string[] = []
  const exportExtra: string[] = []
  const exportTruthNames = new Set<string>()
  const perLabelTruth = new Map<string, number>()
  const perLabelObs = new Map<string, number>()
  const missingSamples: any[] = []
  const unexplainedSamples: any[] = []
  const lineMismatchSamples: any[] = []
  let lineChecked = 0
  let lineExact = 0
  let parseErrors = 0

  for (const rel of files) {
    const abs = join(repoRoot, rel)
    let src: string
    try { src = readFileSync(abs, "utf8") } catch { continue }
    if (!src.trim()) continue

    const tree = parser.parse(src)
    if (tree.rootNode.hasError) { parseErrors++; continue }
    // Every name bound by a for-clause in THIS file, used only for the LUA-26
    // exemption above. Structural: read off the tree, not matched by name.
    forBoundVars.clear()
    for (const n of walkNodes(tree.rootNode)) {
      if (n.type === "for_numeric_clause") {
        const id = n.childForFieldName("name")
        if (id?.type === "identifier") forBoundVars.add(id.text)
      } else if (n.type === "for_generic_clause") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c?.type !== "variable_list") continue
          for (let j = 0; j < c.childCount; j++) {
            const fn = typeof c.fieldNameForChild === "function" ? c.fieldNameForChild(j) : null
            if (fn !== "name") continue
            const id = c.child(j)
            if (id?.type === "identifier") forBoundVars.add(id.text)
          }
        }
      }
    }
    for (const e of deriveLuaTruth(tree.rootNode, rel)) {
      truth.set(`${rel}|${key(e)}`, e)
      if (e.label === "exports") exportTruthNames.add(`${rel}|${e.target}`)
      directRelTruth.add(`${rel}|${e.label}\u001f${e.from}\u001f${e.target}`)
    }

    const r: any = await parseFile(abs, repoRoot)
    if (r.errors?.length) parseErrors++
      for (const e of r.relationships ?? []) {
        const k = `${rel}|${e.type}\u001f${e.source}\u001f${e.target}`
        if (!observed.has(k)) observed.set(k, { ...e, rel })
        perLabelObs.set(e.type, (perLabelObs.get(e.type) ?? 0) + 1)
      }
      // M60: the observed side never read `exports`, so this leg had never
      // observed the label at all — and said so as 1,582 MISSING exports on the
      // full kong corpus.
      //
      // The direct leg compares the same truth and reports 318/318, because
      // `parseWithAnalyzer` returns an analyzer result whose `exports` IS read
      // (line ~1081). The pipeline leg reads only `r.relationships`, and a Lua
      // module's surface is an ARRAY on the result, not a relationship, so nothing
      // ever entered `observed` under `exports` and every export truth edge was
      // unmatched by construction.
      //
      // This stayed quiet for as long as it did because LUA-14 was open: the dual
      // probe found `exports` present on the direct path and absent from the
      // pipeline, correctly labelled them `pipelineDiscardedLabel`, and the
      // accounting treated a known discard as an accounted-for loss. Fixing LUA-14
      // — forwarding `exports` from the worker — removed the discard label, and the
      // SAME 1,580 edges immediately reappeared as `missingFromAnalyzer`, i.e. as
      // "the analyzer is missing them". The analyzer was not missing anything:
      // `parseFile` returns every one of them, verified at
      // `verify-lua-output-coverage` (kong exports 1587 emitted, 0 lost).
      //
      // So the leg was not measuring the pipeline's export surface at all, and once
      // the pipeline actually carried exports the gap turned into a false alarm
      // pointing at a non-existent bug — the mirror image of the failure this lane
      // exists to prevent, which is excusing edges by inferring. Both directions of
      // a wrong observed set are wrong; the fix is to read the field that exists.
      //
      // The row shape is `{name, isDefault, range:{startLine..}}` — there is no
      // top-level `line` and none is needed here, because `key()` keys on
      // label/from/target only. A returned table's members and a `return <ident>`
      // both have no declaration site, which is the export invariant the fixture
      // runner enforces; that is a separate check and is not duplicated here.
      for (const ex of r.exports ?? []) {
        const k = `${rel}|exports\u001fglobal\u001f${ex.name}`
        if (!observed.has(k)) {
          // The line is passed through, read from where an export row actually keeps
          // it. An export row is `{name, isDefault, range:{startLine..}}` — there is
          // no top-level `line` and no `line_number` — so a synthesised row without
          // this field reads as `observedLine: null` and the M60 line check scores
          // every export wrong. That is 1,582 false line failures, the same
          // field-shape mistake as the missing count above, one layer down: the
          // label is absent from `observed` entirely, then the line is absent from
          // the row that fills it.
          //
          // `?? null` and never 0 or -1, per the M60 line rule: an absent line is a
          // fact to record, not a number to invent.
          const line = ex.range?.startLine ?? ex.line_number ?? ex.line ?? null
          observed.set(k, { type: "exports", source: "global", target: ex.name, rel, line })
        }
        perLabelObs.set("exports", (perLabelObs.get("exports") ?? 0) + 1)
      }
    for (const e of deriveLuaTruth(tree.rootNode, rel)) perLabelTruth.set(e.label, (perLabelTruth.get(e.label) ?? 0) + 1)

    // ── LUA-31: PROVE which labels the pipeline discards; never infer it ───────
    // A label the pipeline emitted zero times across the corpus used to be
    // classified "structurally undeliverable", i.e. excused. That inference fails
    // in the one direction that matters most: if the analyzer emits NOTHING for a
    // label, the pipeline also emits nothing, the label looks discarded, and every
    // truth edge for it is excused. A collapsed analyzer and a dropped field become
    // indistinguishable.
    //
    // Caught by mutation, not by reading. Neutering addContainsRelationships —
    // dropping EVERY synthesized contains edge — moved kong's missing from 3 to 47
    // on a 5-file slice and STILL reported `analyzer=0`, with all 47 filed as
    // pipeline-discarded. The differential passed a totally broken analyzer, which
    // is the exact failure this lane exists to prevent, committed by the very fix
    // that was supposed to improve the split.
    //
    // So the verdict must be evidence. Parse the same file through the DIRECT path
    // too: a label is discarded only where the analyzer supplies it and the
    // pipeline does not, on that same file. Absence on both sides is not evidence.
    if (dualMeasured < DUAL_SAMPLE_CAP) {
      dualMeasured++
      const direct: any = await parseWithAnalyzer(abs)
      const dLabels = new Set<string>()
      for (const e of direct.relationships ?? []) if (e.type) dLabels.add(e.type)
      if ((direct.exports ?? []).length > 0) dLabels.add("exports")
      const pLabels = new Set<string>()
      for (const e of r.relationships ?? []) if (e.type) pLabels.add(e.type)
      if ((r.exports ?? []).length > 0) pLabels.add("exports")
      for (const l of dLabels) {
        if (pLabels.has(l)) dualAgrees.add(l)
        else dualProvesDiscard.add(l)
      }
      for (const l of pLabels) dualAgrees.add(l)

      // ── exports on the DIRECT path, because the pipeline cannot see them ────
      // LUA-14 drops the `exports` field at the worker boundary, so every export
      // comparison this instrument makes through parseFile is a comparison against
      // an empty set. That is not a weak signal, it is NO signal: a corpus
      // mutation that deletes the entire returned-table export branch (LUA-09) or
      // republishes every in-function return as a file export (LUA-20) leaves the
      // pipeline output byte-identical, because the pipeline was never carrying
      // exports to begin with. Both mutants SURVIVED the corpus differential for
      // exactly that reason.
      //
      // So exports get their own comparison against the same tree-derived truth,
      // read through parseWithAnalyzer. This is the same measurement
      // script/m60/lua-export-census.ts makes, and having it here as well as there
      // was the duplication that let the two drift apart into a 218-edge
      // disagreement (LUA-24). One instrument, two paths, one truth.
      // M60 LUA-35: the DISCLOSURE count. A nameless module surface is recorded
      // rather than published, and nothing in this instrument could see whether
      // that record existed — so the disclosure half of the fix was untestable and
      // its mutant would have read as surviving. Counted here, per file, from the
      // direct path, and reported. A disclosure is a claim about the file, so it
      // has to be measured like one.
      disclosureFiles++
      disclosureCount += (direct.metadata?.unpublishedSurface ?? []).length

      const dExports = new Set<string>((direct.exports ?? []).map((e: any) => e.name))
      for (const e of deriveLuaTruth(tree.rootNode, rel)) {
        if (e.label !== "exports") continue
        exportTruth++
        if (dExports.has(e.target)) exportHit++
        else if (exportMissed.length < 25) exportMissed.push(`${e.target} (${e.rule}, L${e.line}) ${rel}`)
      }
      for (const n of dExports) {
        if (!exportTruthNames.has(`${rel}|${n}`)) {
          let anyTruth = false
          for (const e of deriveLuaTruth(tree.rootNode, rel)) if (e.label === "exports" && e.target === n) { anyTruth = true; break }
          if (!anyTruth) { exportSpurious++; if (exportExtra.length < 25) exportExtra.push(`${n} ${rel}`) }
        }
      }
      // ── metadata on the DIRECT path (M60 LUA-36) ──────────────────────────
      // Four of this lane's fixed defects are METADATA defects — LUA-02 (a
      // coroutine count that was structurally always zero), LUA-04 (framework
      // detection firing on bare identifiers), LUA-10 (a score rewarding a branch
      // the analyzer never detects) and LUA-11 (constant "measurements"). Each has
      // a dedicated gate and NONE had a corpus-scale test, because this
      // instrument compared relationships and exports and nothing else. A defect
      // class the differential cannot see is a defect class with one test instead
      // of two, and one test is what let LUA-02 ship.
      //
      // The truth side is derived from the TREE, independently: coroutines are
      // counted by finding `coroutine.create` / `coroutine.wrap` call nodes, and
      // the framework rule is re-implemented from the contract rather than
      // copied from the analyzer. Copying it would be the mirror trap this lane
      // has hit repeatedly (LUA-27, LUA-33) — agreement between two copies of one
      // idea is not evidence.
      const m = direct.metadata ?? {}
      const tCoro = countCoroutines(tree.rootNode)
      metaCoroutines++
      if ((m.coroutineUsage ?? 0) === tCoro) metaHit++
      else if (metaMissed.length < 20) metaMissed.push(`coroutineUsage ${m.coroutineUsage} vs tree ${tCoro}  ${rel}`)

      // LUA-04, tested as the CONTRACT and not as a reimplementation. The first
      // version of this leg derived one framework from the tree — Neovim — and
      // counted every OTHER framework the analyzer legitimately knows as
      // fabricated: 37 spurious "findings" on 68 files, all of them my truth side
      // being too narrow rather than the analyzer being wrong. Deriving the full
      // framework table would mean COPYING it, and a copy agrees by construction
      // and proves nothing — the mirror trap, LUA-27 and LUA-33.
      //
      // So the test is the one that does not need the table: a framework claim
      // requires a MEMBER ACCESS somewhere in the file. LUA-04 claimed a framework
      // from BARE IDENTIFIERS, so a file whose only names are `use`, `setup` and
      // `GetTime` has no member access and must claim nothing. That is the defect,
      // it is decidable from the tree alone, and it needs no table.
      const claimsFrameworks = ((m.detectedFrameworks ?? []).length > 0)
      const hasMemberAccess = countMemberAccess(tree.rootNode) > 0
      metaFrameworks++
      if (claimsFrameworks && !hasMemberAccess) {
        metaSpurious++
        if (metaExtra.length < 20) metaExtra.push(`frameworks ${JSON.stringify(m.detectedFrameworks)} claimed with ZERO member accesses in the file  ${rel}`)
      } else if (claimsFrameworks !== hasMemberAccess && !claimsFrameworks) {
        // a file with member accesses that claims nothing is legitimate (a struct
        // literal is a member access and no framework), so only the claiming
        // direction is a check.
        metaHit++
      } else metaHit++

      // LUA-10 / LUA-11: the score must MOVE with the file. A score that is 80 on
      // an innocent file and 85 on a complex one is a measurement; one that is 85
      // everywhere is a constant wearing a number. Measured across the probed
      // files, not asserted on one fixture.
      const s = m.architecturalScore
      if (typeof s === "number") { metaScoreSum += s; metaScoreFiles++; metaScoreSet.add(s) }

      exportFilesProbed++

      // ── relationships on the DIRECT path, for the same reason as exports ────
      // M60 LUA-34. The export comparison above exists because the pipeline drops
      // the whole field. The SAME blindness exists for relationships and it is
      // worse, because the filter is not a missing field — it is a CONTENT rule.
      // pool-worker rejects any relationship target containing a NEWLINE, so an
      // edge whose target is a multi-line payload is deleted on the way to the
      // store. The differential reads relationships through the pipeline, so such
      // an edge is simply ABSENT: indistinguishable from one that was never
      // derived.
      //
      // That is not hypothetical. LUA-32 was exactly this defect — `setmetatable(X,
      // { … })` publishing a five-line table constructor as the extends target —
      // and it survived an entire lane of review reading `extends 103/103, zero
      // missing, zero unexplained`. It was found only by a direct-vs-pipeline seam
      // probe comparing the two paths per file, which is a diagnostic, not a gate.
      //
      // Measured on a 42-file slice by mutation: reintroducing the LUA-32 payload
      // moves NO number this instrument reports. Missing, unexplained, line
      // accuracy and direct-path exports are all byte-identical. A mutant that
      // provably changes the analyzer's output (15 of 260 corpus files change)
      // and provably changes nothing the differential can see is the definition
      // of a blind spot, and it is the last one in this instrument.
      //
      // So relationships get the same two-path treatment: the analyzer's own
      // output against the same tree-derived truth, with no pipeline filter in
      // between. `spurious` is the leg that matters here — a payload target the
      // truth never derives is exactly what LUA-32 produced.
      const directKeys = new Set<string>()
      for (const e of direct.relationships ?? []) {
        if (!e.type) continue
        const k = `${e.type}\u001f${e.source}\u001f${e.target}`
        directKeys.add(k)
        if (directRelTruth.has(`${rel}|${k}`)) continue
        // The ONE exemption, and it is structural rather than by name. LUA-26 is
        // open: the oracle deliberately derives no edge for a for-loop's control
        // variable, because whether one belongs in the symbol graph is a product
        // decision. The analyzer, meanwhile, emits `contains <fn> -> <var>` for
        // such a variable whenever the loop body also ASSIGNS it — the assignment
        // creates the symbol, and the for-clause is not why the edge exists. On
        // kong that is exactly one edge, `contains Schema:errors_to_string -> err`
        // at kong/db/schema/init.lua, and it is a true statement reached by a
        // different route than the one the oracle does not take.
        //
        // Exempted on the STRUCTURAL test — the target is bound by a for-clause
        // somewhere in this file — not by matching the name. A name-based
        // exemption would be a hole shaped exactly like the next bug; this one is
        // closed the moment the loop binding goes away, and every exemption is
        // counted and reported rather than silently dropped.
        if (e.type === "contains" && forBoundVars.has(e.target)) {
          loopCoincidence++
          if (loopCoincidenceSample.length < 10) loopCoincidenceSample.push(`${e.source} -> ${e.target}  ${rel}`)
          continue
        }
        relSpurious++
        if (relExtra.length < 25) relExtra.push(`${e.type} ${e.source} -> ${JSON.stringify(e.target).slice(0, 90)}  ${rel}`)
      }
      // Exports are a SEPARATE array on the direct result, not an entry in
      // `relationships`. Without this the relationship leg demanded an
      // `exports global -> x` key that the direct relationship list can never
      // contain, and reported every export as missed — 317 of them on kong, which
      // is exactly the export truth count. The leg was measuring its own blind
      // spot and calling it a recall gap.
      for (const ex of direct.exports ?? []) {
        directKeys.add(`exports\u001fglobal\u001f${ex.name}`)
      }
      for (const e of deriveLuaTruth(tree.rootNode, rel)) {
        relTruth++
        if (directKeys.has(`${e.label}\u001f${e.from}\u001f${e.target}`)) relHit++
        else if (relMissed.length < 25) relMissed.push(`${e.label} ${e.from} -> ${e.target} (${e.rule}, L${e.line})  ${rel}`)
      }
      relFilesProbed++
    }  }

  // ── the two directions ─────────────────────────────────────────────────────
  const missing: any[] = []
  const unexplained: any[] = []
  // Split the missing set THREE ways, not two. An edge the pipeline STRUCTURALLY
  // CANNOT deliver is not the same fact as an edge the analyzer forgot, and
  // conflating them sends the next reader hunting an analyzer bug that is not
  // there. The previous classifier knew only about the noise denylist
  // (LUA-16), so EVERY export edge — 1,579 of them on kong — was filed as
  // "analyzer-attributable" when the analyzer publishes all 1,579 and the worker
  // drops the field. Measured, not assumed: `parseFile` on a file with two
  // exports returns no `exports` KEY AT ALL, while the direct path returns both.
  //
  // "Structurally absent" is derived from the run, never hardcoded: a label the
  // pipeline emitted zero times across the whole corpus cannot be judged on
  // recall, because there is no observed side to compare. That also means the
  // split heals itself when LUA-14 is fixed and the label starts appearing.
  const labelsSeenInPipeline = new Set<string>()
  // The observed edge is the analyzer's relationship object, so the field is
  // `type`. The truth edge calls the same thing `label`. Reading `o.label` here
  // yields undefined for EVERY observed edge, the set stays empty, and the whole
  // corpus is misfiled as "pipeline discarded" — which is what the first run of
  // this leg did: analyzer=0, PASS, on 1,867 edges it never actually examined.
  // A gate that reports zero defects because it classified everything as
  // unjudgeable is worse than no gate, and it looked exactly like a clean lane.
  for (const o of observed.values()) if (o.type) labelsSeenInPipeline.add(o.type)
  const missingByNoiseFilter: any[] = []
  const missingByPipelineDiscard: any[] = []
  const missingFromAnalyzer: any[] = []
  const lineWrong: any[] = []
  for (const [k, t] of truth) {
    const o = observed.get(k)
    if (!o) {
      missing.push(t)
      if (NOISE_TARGETS.has(leafOf(t.target))) missingByNoiseFilter.push(t)
      // LUA-31: excused ONLY on evidence that the pipeline drops the label, never
      // on its absence. `labelsSeenInPipeline` survives as a cross-check and is no
      // longer load-bearing.
      else if (dualProvesDiscard.has(t.label)) missingByPipelineDiscard.push(t)
      else missingFromAnalyzer.push(t)
      continue
    }
    if (t.line !== null) {
      lineChecked++
      const got = o.line_number ?? o.line
      if (got === t.line) lineExact++
      else lineWrong.push({ ...t, observedLine: got ?? null, rel: o.rel })
    }
  }
  for (const [k, o] of observed) {
    if (!truth.has(k)) unexplained.push({ label: o.type, from: o.source, target: o.target, rel: o.rel })
  }

  // ── shape attribution: a recall NUMBER is not actionable, a recall broken
  // into SHAPES is. Each missing/unexplained edge is reduced to a small
  // signature so the residue can be read as a list of causes.
  const shapeOf = (e: any): string => {
    const t = String(e.target ?? "")
    if (e.label === "calls") {
      if (NOISE_TARGETS.has(leafOf(t))) return `noise-filter target "${leafOf(t)}"`
      if (/^[A-Z]/.test(t)) return "capitalised target (a constructor-looking name)"
      if (t.length <= 2) return "very short target"
      return "ordinary call target"
    }
    if (e.label === "contains") {
      if (/^__/.test(t)) return "dunder/metamethod name"
      if (NOISE_TARGETS.has(leafOf(t))) return `noise-filter target "${leafOf(t)}"`
      if (/^[A-Z]/.test(t)) return "capitalised name (a type-like table)"
      return "ordinary name"
    }
    if (e.label === "exports") return "return <identifier> at file scope"
    return `${e.label} other`
  }
  const shapes = (rows: any[]): any[] => {
    const m = new Map<string, number>()
    for (const r of rows) { const k = shapeOf(r); m.set(k, (m.get(k) ?? 0) + 1) }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([shape, n]) => ({ shape, n }))
  }

  const report_missing_shapes = shapes(missingFromAnalyzer)
  const report_unexplained_shapes = shapes(unexplained)
  const byLabel: any = {}
  for (const L of LABELS) {
    const t = [...truth.values()].filter((e) => e.label === L)
    const tCount = t.length
    const mCount = missing.filter((e) => e.label === L).length
    const uCount = unexplained.filter((e) => e.label === L).length
    byLabel[L] = {
      truth: tCount,
      observed: perLabelObs.get(L) ?? 0,
      missing: mCount,
      unexplained: uCount,
      precision: tCount + uCount === 0 ? null : Number((tCount / (tCount + uCount)).toFixed(4)),
      recall: tCount === 0 ? null : Number(((tCount - mCount) / tCount).toFixed(4)),
    }
  }

  // ── selftest: the comparison must be able to FAIL ──────────────────────────
  let selftestResult: any = { ran: false }
  if (selftest) {
    const victim = [...truth.keys()][0]
    const t = truth.get(victim)!
    const held = observed.get(victim)
    // (1) drop one observed edge -> must appear as MISSING
    observed.delete(victim)
    const nowMissing = [...truth.keys()].some((k) => !observed.has(k) && truth.get(k) === t)
    if (held) observed.set(victim, held)
    // (2) drop one truth edge -> must appear as UNEXPLAINED
    const t2 = [...truth.values()][1]
    truth.delete(`${t2.rel}|${key(t2)}`)
    const nowUnexplained = [...observed.keys()].some((k) => !truth.has(k))
    truth.set(`${t2.rel}|${key(t2)}`, t2)
    // (3) corrupt one line -> must be reported as a LINE mismatch
    let lineCaught = false
    if (held) {
      const good = held.line_number
      observed.set(victim, { ...held, line_number: (good ?? 1) + 7 })
      lineCaught = [...truth.keys()].some((k) => {
        const tt = truth.get(k)!
        const oo: any = observed.get(k)
        return oo && tt.line !== null && (oo.line_number ?? oo.line) !== tt.line
      })
      observed.set(victim, held)
    }
    selftestResult = { ran: true, dropObservedShowsMissing: nowMissing, dropTruthShowsUnexplained: nowUnexplained, corruptLineIsCaught: lineCaught }
  }

  // The noise-filter set is a PIPELINE contract, not an analyzer defect, so it is
  // reported and excluded from the analyzer verdict. Counting it as an analyzer
  // failure would be a false accusation; ignoring it would hide a real user-facing
  // hole. It gets its own number and its own finding.
  // The direct-path export comparison is part of the verdict, not decoration: it is
  // the ONLY place an export defect can show up at all while LUA-14 stands.
  const exportsDirectBad = exportTruth > 0 && (exportHit !== exportTruth || exportSpurious > 0)
  // LUA-34: a direct-path relationship that the tree never derived is a fabricated
  // target, and a fabricated target is the defect class this lane has spent its
  // life on. It is part of the verdict, not a diagnostic.
  const relDirectBad = relSpurious > 0
  // LUA-36: a framework claimed that the tree does not support is a fabrication of
  // the kind LUA-04 was, and it is part of the verdict rather than a report.
  const metaBad = metaSpurious > 0
  const hardFail = missingFromAnalyzer.length > 0 || unexplained.length > 0 || lineWrong.length > 0 || exportsDirectBad | relDirectBad || metaBad || metaMissed.some((x) => x.startsWith("coroutineUsage"))
  const report = {
    schemaVersion: 1,
    kind: "lua_truth_oracle_differential",
    repo,
    sample: sampleArg ? Number(sampleArg) : null,
    filesDrawn: files.length,
    parseErrorFiles: parseErrors,
    method: "truth derived from the wasm parse tree by script/m60/lua-truth-oracle.ts; the analyzer's own output is never an input to the truth side",
    mirroredPolicy: MIRRORED_POLICY,
    totals: {
      truthEdges: truth.size,
      observedEdges: observed.size,
      missing: missing.length,
      missingFromAnalyzer,
      // LUA-14, measured per run: labels the pipeline never emitted at all. Their
      // edges are the pipeline's, not the analyzer's, and calling them the
      // analyzer's is what produced a "1,797 vs 1,579" phantom disagreement.
      exportsDirectPath: {
        note: "exports compared through parseWithAnalyzer, because the pipeline discards the field (LUA-14). Measured on the same tree-derived truth as every other label.",
        filesProbed: exportFilesProbed,
        truth: exportTruth,
        hit: exportHit,
        missed: exportTruth - exportHit,
        spurious: exportSpurious,
        recall: exportTruth ? Number((exportHit / exportTruth).toFixed(6)) : 1,
        precision: exportHit + exportSpurious ? Number((exportHit / (exportHit + exportSpurious)).toFixed(6)) : 1,
        missedSample: exportMissed,
        spuriousSample: exportExtra,
      },
      metadataDirectPath: {
        note: "M60 LUA-36. LUA-02, LUA-04, LUA-10 and LUA-11 are metadata defects and had a dedicated gate but NO corpus test, because this instrument compared only relationships and exports. The truth side is re-derived from the tree: coroutine CALLS counted by node type, and the framework rule re-implemented from the contract rather than copied from the analyzer, because a copy agrees by construction and proves nothing.",
        coroutines: { files: metaCoroutines, checks: metaHit },
        frameworkClaimWithoutMemberAccess: { files: metaFrameworks, violations: metaSpurious },
        spurious: metaSpurious,
        missedSample: metaMissed,
        spuriousSample: metaExtra,
        architecturalScore: {
          files: metaScoreFiles,
          distinctValues: metaScoreSet.size,
          values: [...metaScoreSet].sort((a, b) => a - b),
          mean: metaScoreFiles ? Number((metaScoreSum / metaScoreFiles).toFixed(3)) : null,
          note: "LUA-10/LUA-11 are about whether this number MOVES. One distinct value across a whole corpus is a constant wearing a number, and that is the check; the mean is reported so a reader can see the spread rather than be told it is fine.",
        },
      },
      surfaceDisclosures: {
        note: "M60 LUA-35. A module surface that carries no NAME is disclosed rather than published, so 'no exports' stops meaning two indistinguishable things. Counted on the direct path.",
        filesWithDisclosures: disclosureFiles,
        totalDisclosures: disclosureCount,
      },
      relationshipsDirectPath: {
        note: "analyzer output vs the same tree-derived truth, read through parseWithAnalyzer. Exists because pool-worker DROPS any relationship target containing a newline, so a multi-line payload target is invisible through the pipeline — the blind spot that hid LUA-32 for an entire lane. `spurious` is the leg that catches a target the tree never derived.",
        filesProbed: relFilesProbed,
        truth: relTruth,
        hit: relHit,
        missed: relTruth - relHit,
        spurious: relSpurious,
        loopCoincidenceExempted: loopCoincidence,
        loopCoincidenceSample,
        recall: relTruth ? Number((relHit / relTruth).toFixed(6)) : 1,
        precision: relHit + relSpurious ? Number((relHit / (relHit + relSpurious)).toFixed(6)) : 1,
        missedSample: relMissed,
        spuriousSample: relExtra,
      },
      pipelineDiscardEvidence: {
        note: "a label is called discarded ONLY where the direct path supplied it and the pipeline did not, on the same file. Absence on both sides proves nothing.",
        filesProbed: dualMeasured,
        cap: DUAL_SAMPLE_CAP,
        provenDiscarded: [...dualProvesDiscard].sort(),
        observedOnBothSides: [...dualAgrees].sort(),
      },
      missingByPipelineDiscard: {
        total: missingByPipelineDiscard.length,
        byLabel: shapes(missingByPipelineDiscard),
        labelsAbsentFromPipeline: [...new Set(missingByPipelineDiscard.map((e) => e.label))].sort(),
      },
      missingByPipelineNoiseFilter: missingByNoiseFilter.length,
      noiseTargetsHit: [...new Set(missingByNoiseFilter.map((e) => e.target))].sort(),
      unexplained: unexplained.length,
      lineChecked,
      lineExact,
      lineWrong: lineWrong.length,
      lineAccuracy: lineChecked === 0 ? null : Number((lineExact / lineChecked).toFixed(6)),
    },
    byLabel,
    missingByShape: shapes(missingFromAnalyzer),
    unexplainedByShape: shapes(unexplained),
    // The 22-edge residue is the question this artifact exists to answer, and it
    // was unreachable: `missingSample` is drawn from the FULL missing set, which
    // is dominated by the pipeline noise filter (type/text/parent) and by exports,
    // so the analyzer-attributable edges never appeared in a sample at all.
    analyzerAttributableSample: missingFromAnalyzer.slice(0, 40),
    analyzerAttributableUnexplainedSample: unexplained.slice(0, 40),
    missingSample: missing.slice(0, 25),
    unexplainedSample: unexplained.slice(0, 25),
    lineWrongSample: lineWrong.slice(0, 25),
    selftest: selftestResult,
    hardFailures: hardFail,
    status: hardFail ? "fail" : "pass",
  }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")

  console.log(`repo=${repo} files=${files.length} parseErrorFiles=${parseErrors}`)
  console.log(`truth=${truth.size} observed=${observed.size}`)
  console.log(`MISSING=${missing.length} (analyzer=${missingFromAnalyzer.length}, pipelineNoiseFilter=${missingByNoiseFilter.length}, pipelineDiscardedLabel=${missingByPipelineDiscard.length}) UNEXPLAINED=${unexplained.length}`)
  if (missingByPipelineDiscard.length) console.log(`  PROVEN pipeline-discarded: ${[...new Set(missingByPipelineDiscard.map((e) => e.label))].sort().join(", ")}  (direct path supplied these and the pipeline did not, on ${dualMeasured} probed files)`)
  if (dualProvesDiscard.size === 0) console.log(`  WARNING: no label could be PROVEN discarded from ${dualMeasured} probed files — every missing edge is charged to the analyzer`)
  if (missingByNoiseFilter.length) console.log(`  noise-filter targets hit: ${[...new Set(missingByNoiseFilter.map((e) => e.target))].sort().join(", ")}`)
  console.log(`lines: checked=${lineChecked} exact=${lineExact} wrong=${lineWrong.length} accuracy=${report.totals.lineAccuracy}`)
  console.log(`exports (DIRECT path, ${exportFilesProbed} files): truth=${exportTruth} hit=${exportHit} missed=${exportTruth - exportHit} spurious=${exportSpurious} recall=${report.totals.exportsDirectPath.recall} precision=${report.totals.exportsDirectPath.precision}`)
  // Numeric and parseable, always. An earlier version printed "yes" for a
  // mismatch and "0" for none, which a mutation harness cannot compare — a signal
  // that changes TYPE rather than VALUE is a signal nobody can gate on.
  const coroMismatches = metaMissed.filter((m) => m.startsWith("coroutineUsage")).length
  console.log(`metadata (DIRECT path, ${metaFrameworks} files): coroutineMismatches=${coroMismatches} frameworkClaimsWithoutMemberAccess=${metaSpurious} scoreDistinctValues=${metaScoreSet.size} scoreValues=${JSON.stringify([...metaScoreSet].sort((a, b) => a - b))}`)
  console.log(`disclosures (nameless surfaces): files=${disclosureFiles} total=${disclosureCount}`)
  console.log(`relationships (DIRECT path, ${relFilesProbed} files): truth=${relTruth} hit=${relHit} missed=${relTruth - relHit} SPURIOUS=${relSpurious} recall=${report.totals.relationshipsDirectPath.recall} precision=${report.totals.relationshipsDirectPath.precision}`)
  console.log("\nper label:")
  for (const L of LABELS) {
    const b = byLabel[L]
    if (!b || b.truth + b.observed === 0) continue
    console.log(`  ${L.padEnd(13)} truth=${String(b.truth).padEnd(6)} obs=${String(b.observed).padEnd(6)} missing=${String(b.missing).padEnd(5)} unexplained=${String(b.unexplained).padEnd(5)} recall=${b.recall} precision=${b.precision}`)
  }
  console.log("\nmissing by shape (analyzer-attributable only):")
  for (const s of report_missing_shapes) console.log(`  ${String(s.n).padEnd(5)} ${s.shape}`)
  console.log("\nunexplained by shape:")
  for (const s of report_unexplained_shapes) console.log(`  ${String(s.n).padEnd(5)} ${s.shape}`)
  if (missing.length) { console.log("\nMISSING samples:"); for (const m of missing.slice(0, 12)) console.log(`  ${m.label} ${m.from} -> ${m.target} (rule ${m.rule}, L${m.line})`) }
  if (unexplained.length) { console.log("\nUNEXPLAINED samples:"); for (const m of unexplained.slice(0, 12)) console.log(`  ${m.label} ${m.from} -> ${m.target}  [${m.rel}]`) }
  if (lineWrong.length) { console.log("\nLINE MISMATCH samples:"); for (const m of lineWrong.slice(0, 12)) console.log(`  ${m.label} ${m.from} -> ${m.target}: expected L${m.line}, got ${m.observedLine}  [${m.rel}]`) }
  if (selftest) console.log(`\nselftest: ${JSON.stringify(selftestResult)}`)
  console.log(`\n${report.status.toUpperCase()}  wrote ${outPath}`)
  if (hardFail) process.exitCode = 1
}
if (process.argv[1] && process.argv[1].endsWith("lua-truth-oracle.ts")) main()
