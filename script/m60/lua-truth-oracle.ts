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
  /** every table name bound to a table_constructor anywhere in the file */
  declaredTables: Set<string>
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

function walk(node: any, scope: string, w: Walk, rel: string): void {
  if (node.isMissing) return

  if (node.type === "variable_declaration") {
    // `local a, b = ...` — the names live in a variable_list child reached by
    // TYPE, because this grammar has no `name_list` field (LUA-00).
    const asg = node.namedChild(0)
    if (asg?.type === "assignment_statement") {
      const vl = asg.namedChild(0)
      if (vl?.type === "variable_list") {
        for (let i = 0; i < vl.namedChildCount; i++) {
          const id = vl.namedChild(i)
          if (id?.type !== "identifier") continue
          if (scope !== "global") {
            if (!w.localsIn.has(scope)) w.localsIn.set(scope, new Set())
            w.localsIn.get(scope)!.add(id.text)
          }
          w.edges.push({ label: "contains", from: scope, target: id.text, line: id.startPosition.row + 1, rule: "local-decl", rel })
        }
      }
    }
  }

  if (node.type === "assignment_statement" && node.parent?.type !== "variable_declaration") {
    const vl = node.namedChild(0)
    if (vl?.type === "variable_list") {
      for (let i = 0; i < vl.namedChildCount; i++) {
        const id = vl.namedChild(i)
        if (id?.type !== "identifier") continue
        // A re-assignment of a local in scope is not a new declaration and the
        // analyzer does not emit a symbol for it. Mirrored because it is a
        // statement about scope, and getting it wrong in EITHER direction is a
        // finding worth having.
        if (scope !== "global" && w.localsIn.get(scope)?.has(id.text)) continue
        w.edges.push({ label: "contains", from: scope, target: id.text, line: id.startPosition.row + 1, rule: "assign-decl", rel })
      }
    }
  }

  if (node.type === "function_declaration") {
    const fn = functionNameOf(node)
    if (fn) {
      // A method belongs to its RECEIVER, not to the enclosing scope.
      w.edges.push({ label: "contains", from: fn.owner ?? scope, target: fn.name, line: fn.nameNode.startPosition.row + 1, rule: fn.owner ? "method-decl" : "fn-decl", rel })
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
        // The metatable may be ANY expression, not only a bare identifier.
        // `setmetatable(e, Emitter.meta)` — luvit/deps/hooks.lua:37 — is a real
        // inheritance edge, and the first version of this oracle required
        // `meta.type === "identifier"`, so it called 3 genuine edges on luvit
        // FABRICATIONS and recorded the analyzer's precision as 0.7. The defect
        // was the oracle's. Requiring an identifier was never justified: the
        // second argument of setmetatable is a table-valued expression by
        // definition, and a member expression names one perfectly well.
        if (target && meta && target.type !== "table_constructor" && meta.type !== "table_constructor") {
          w.edges.push({ label: "extends", from: target.text, target: meta.text, line: meta.startPosition.row + 1, rule: "setmetatable", rel })
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

  if (node.type === "return_statement" && scope === "global") {
    const list = node.namedChild(0)
    const first = list?.namedChild(0)
    // Only `return <identifier>`: the oracle asserts what the analyzer's own
    // contract says it exports. `return {}` and `return require(...)` are
    // recorded as NOT exported by both sides, and if that is wrong the fix is a
    // finding, not a mirror.
    if (first?.type === "identifier") {
      w.edges.push({ label: "exports", from: "global", target: first.text, line: first.startPosition.row + 1, rule: "return-id", rel })
    }
  }

  // The scope a body belongs to is the name field's FULL TEXT, so a method
  // `Editor:onKey` and a local `function onKey` are DIFFERENT scopes. Using the
  // field alone collapses them and then dedups calls from two unrelated
  // functions into one edge — which is how 6 real call sites became 2 edges
  // with one wrong line each.
  const childScope = node.type === "function_declaration" ? (functionNameOf(node)?.label ?? scope) : scope
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c) walk(c, childScope, w, rel)
  }
}

export function deriveLuaTruth(root: any, rel = ""): TruthEdge[] {
  const w: Walk = { edges: [], localsIn: new Map(), declaredTables: new Set() }
  collectTables(root, w.declaredTables)
  walk(root, "global", w, rel)
  // A set, because the analyzer's edge identity is (label, from, target): N call
  // sites of one callee are ONE stored edge. Collapsing here keeps the
  // comparison about PRESENCE. Per-site information is a separate finding
  // (LUA-01b) and is measured by count, not by this set.
  const seen = new Set<string>()
  return w.edges.filter((e) => {
    const k = `${e.label}${e.from}${e.target}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

const key = (e: { label: string; from: string; target: string }) => `${e.label}${e.from}${e.target}`

async function main(): Promise<void> {
  const repo = arg("--repo", "kong")
  const repoRoot = join(REPOS, repo)
  const sampleArg = arg("--sample")
  const selftest = process.argv.includes("--selftest")
  const outPath = arg("--out", join(ROOT, "validation", "m60", "results", `lua-truth-oracle-${repo}${sampleArg ? `-${sampleArg}` : ""}.json`))

  let files = execFileSync("git", ["-C", repoRoot, "ls-files", "*.lua", "*.luau"], { encoding: "utf8", maxBuffer: 1 << 28 })
    .trim().split("\n").filter(Boolean)
  if (sampleArg) files = files.slice(0, Number(sampleArg))

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
    for (const e of deriveLuaTruth(tree.rootNode, rel)) truth.set(`${rel}|${key(e)}`, e)

    const r: any = await parseFile(abs, repoRoot)
    if (r.errors?.length) parseErrors++
    for (const e of r.relationships ?? []) {
      const k = `${rel}|${e.type}${e.source}${e.target}`
      if (!observed.has(k)) observed.set(k, { ...e, rel })
      perLabelObs.set(e.type, (perLabelObs.get(e.type) ?? 0) + 1)
    }
    for (const e of deriveLuaTruth(tree.rootNode, rel)) perLabelTruth.set(e.label, (perLabelTruth.get(e.label) ?? 0) + 1)
  }

  // ── the two directions ─────────────────────────────────────────────────────
  const missing: any[] = []
  const unexplained: any[] = []
  // Split the missing set: an edge the pipeline STRUCTURALLY CANNOT deliver is
  // not the same fact as an edge the analyzer forgot. Conflating them would
  // send the next reader hunting an analyzer bug that is not there.
  const missingByNoiseFilter: any[] = []
  const missingFromAnalyzer: any[] = []
  const lineWrong: any[] = []
  for (const [k, t] of truth) {
    const o = observed.get(k)
    if (!o) {
      missing.push(t)
      if (NOISE_TARGETS.has(leafOf(t.target))) missingByNoiseFilter.push(t)
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
  const hardFail = missingFromAnalyzer.length > 0 || unexplained.length > 0 || lineWrong.length > 0
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
  console.log(`MISSING=${missing.length} (analyzer=${missingFromAnalyzer.length}, pipelineNoiseFilter=${missingByNoiseFilter.length}) UNEXPLAINED=${unexplained.length}`)
  if (missingByNoiseFilter.length) console.log(`  noise-filter targets hit: ${[...new Set(missingByNoiseFilter.map((e) => e.target))].sort().join(", ")}`)
  console.log(`lines: checked=${lineChecked} exact=${lineExact} wrong=${lineWrong.length} accuracy=${report.totals.lineAccuracy}`)
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
