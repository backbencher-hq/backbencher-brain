// verify-lua-edge-lines.ts — M60 lua LUA-01: every relationship the lua
// analyzer emits must carry the line of its NAME-BEARING node.
//
// The contract is the M59 (#825) one, copied from the family rather than
// invented here. Java states it at src/ast/real-java-analyzer.ts:967-971:
//
//   "the line is where the CALL IS WRITTEN — the name field of the
//    method_invocation, not the invocation node's own start. Measured with the
//    M59 oracle on real java: a method_invocation starts at its RECEIVER, so
//    `a.b()\n  .c()` put c on the line a.b() opened on."
//
// That is the whole reason a line is stored at all: a call written across two
// lines must land on the line the callee's NAME is on, or a human clicking the
// edge is sent to the wrong place. tree-sitter-lua has the identical hazard —
// `M\n  .new()` is a function_call whose dot_index_expression starts on the `M`
// line while the `new` being called is written on the next — so the rule
// transfers unchanged, and the reason it must be MEASURED here is that lua has
// never emitted a line at all (LUA-01: 0 of 15 relationships carried any line
// field, against java's line_number:2 through the identical pipeline).
//
// Per-kind name-bearing node, which is the part that must not be flattened:
//
//   calls         the function_call's `name` field — the identifier for
//                 `require("x")`, the index expression for `M.new()` /
//                 `obj:method()`. NOT the call node, which opens at the
//                 receiver.
//   contains      the SYMBOL's declaration node. A symbol and the edge that
//                 names it must never disagree about the line (java's
//                 declarationLineNode comment says exactly this, and scala
//                 pinned it first).
//   extends       the setmetatable call node — the metatable name is written
//                 in its argument list.
//   instantiates  the call's function node, same node as calls.
//   imports       the require/module call node.
//
// What makes this gate falsifiable rather than a tautology:
//   1. expected lines are derived from the FIXTURE TEXT by locating the
//      callee's own line — never from the analyzer's output, which is the
//      thing under test;
//   2. a multi-line call is included SPECIFICALLY because a whole-line
//      implementation would pass it while being wrong (the java bug);
//   3. mutants plant a regression per kind and each must be caught.
//
// Run: npx tsx script/m60/verify-lua-edge-lines.ts   (bun also works)
import { mkdirSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const EVIDENCE = join(ROOT, "validation", "m60", "results", "lua-edge-lines.json")
const PROBE_DIR = "$HOME/fixtures/probe"

// ── the fixture ──────────────────────────────────────────────────────────────
// Line numbers are 1-based and the file starts with a comment line, so the
// expected lines below are not accidentally equal to the array indices.
const FIXTURE: Record<string, string> = {
  "lines.lua": [
    "-- fixture: every relationship kind, and the multi-line call that breaks",
    "-- a whole-line implementation of the rule",
    "local helper = function() return 1 end",                                   // 3
    "function caller()",                                                        // 4
    "  helper()",                                                               // 5
    "  local obj = {}",                                                         // 6
    "  obj",                                                                    // 7
    "    .method()",                                                            // 8
    "end",                                                                      // 9
    "local Account = {}",                                                       // 10
    "setmetatable(Account, AccountMeta)",                                       // 11
    "AccountMeta = {}",                                                         // 12
    "function Account:new() end",                                               // 13
    "function Account:make()",                                                  // 14
    "  local inst = Account:new()",                                             // 15
    "  return inst",                                                            // 16
    "end",                                                                      // 17
    "local mod = require(\"some.module\")",                                    // 18
    "return mod",                                                               // 19
  ].join("\n") + "\n",
}

const EXPECT: Array<{ type: string; source: string; target: string; line: number }> = [
  // calls: helper() is written on line 5, inside caller.
  { type: "calls", source: "caller", target: "helper", line: 5 },
  // calls, MULTI-LINE: the callee is written on line 8 but the
  // dot_index_expression opens on line 7 at `obj`. A whole-line implementation
  // reports 7 here and fails. This is the java bug, reproduced.
  //
  // The target is the bare METHOD `method`, not `obj.method` and not the
  // receiver `obj`. Getting this wrong took three measurements, all recorded
  // because each wrong answer was plausible:
  //   `obj.method()` on one line gave target `obj.method` (the whole snippet);
  //   split across lines it gave NO EDGE AT ALL, because the multi-line text
  //     trips the pool-worker's garbage-target filter (pool-worker.ts:391
  //     rejects any target containing a newline) — LUA-13, a real defect where
  //     a line break silently deletes a call from the graph;
  //   reading the first identifier gave `obj` — the RECEIVER, not the callee.
  // The callee's name is the LAST named child of the index expression.
  { type: "calls", source: "caller", target: "method", line: 8 },
  // extends: the setmetatable call is on line 11.
  { type: "extends", source: "Account", target: "AccountMeta", line: 11 },
  // instantiates: Account:new() written on line 15.
  { type: "instantiates", source: "Account:make", target: "Account", line: 15 },
  // imports: require("some.module") written on line 18.
  { type: "imports", source: "global", target: "some.module", line: 18 },
  // contains: caller contains obj, and the edge sits on obj's own declaration
  // line 6 — a contains edge and its symbol must never disagree about the line
  // (java's declarationLineNode states the rule; scala pinned it first).
  { type: "contains", source: "caller", target: "obj", line: 6 },
]

const checks: Array<{ name: string; pass: boolean; detail: string }> = []
const check = (name: string, pass: boolean, detail = ""): void => { checks.push({ name, pass, detail }) }

const lineOf = (text: string, needle: string): number => {
  const i = text.split("\n").findIndex((l) => l.includes(needle))
  return i + 1
}

async function edgesFor(file: string, base: string): Promise<any[]> {
  const r: any = await parseFile(join(base, file), base)
  return r.relationships ?? []
}

async function main(): Promise<void> {
  mkdirSync(PROBE_DIR, { recursive: true })
  for (const [name, text] of Object.entries(FIXTURE)) writeFileSync(join(PROBE_DIR, name), text)

  // The fixture's own line numbers are re-derived from the TEXT, so the
  // expectations cannot drift away from the fixture by editing one of them.
  const text = FIXTURE["lines.lua"]
  const derived: Record<string, number> = {
    helperCall: lineOf(text, "  helper()"),
    methodCall: lineOf(text, "    .method()"),
    objLine: lineOf(text, "  obj"),
    setmetatable: lineOf(text, "setmetatable(Account, AccountMeta)"),
    accountNew: lineOf(text, "local inst = Account:new()"),
    requireCall: lineOf(text, 'require("some.module")'),
    helperDecl: lineOf(text, "local helper = function()"),
  }
  check("the multi-line call is a real trap in this fixture (callee line != receiver line)",
    derived.methodCall !== derived.objLine, `receiver L${derived.objLine}, callee L${derived.methodCall}`)

  const edges = await edgesFor("lines.lua", PROBE_DIR)

  // Every relationship the analyzer emitted, so a relationship with no line at
  // all is caught even if the fixture did not predict it.
  const missing = edges.filter((e) => e.line_number === undefined && e.line === undefined)
  check("every emitted relationship carries a line", missing.length === 0,
    `${edges.length - missing.length}/${edges.length} carry a line; missing: ${missing.map((e) => `${e.type} ${e.source}->${e.target}`).join(", ") || "none"}`)

  const wrong: string[] = []
  for (const want of EXPECT) {
    const found = edges.find((e) => e.type === want.type && e.source === want.source && e.target === want.target)
    if (!found) { wrong.push(`${want.type} ${want.source}->${want.target}: NO SUCH EDGE`); continue }
    const got = found.line_number ?? found.line
    if (got !== want.line) wrong.push(`${want.type} ${want.source}->${want.target}: expected L${want.line}, got ${got === undefined ? "NO LINE" : "L" + got}`)
  }
  check("every predicted edge carries the line of its name-bearing node", wrong.length === 0,
    `${EXPECT.length - wrong.length}/${EXPECT.length} correct`)
  for (const w of wrong) console.log(`    ${w}`)

  // The whole-line implementation this gate exists to reject: had the analyzer
  // used the call node's own start, the multi-line call would read L7.
  const ml = edges.find((e) => e.type === "calls" && e.target === "method")
  check("the multi-line call is NOT reported at the receiver's line", ml && (ml.line_number ?? ml.line) !== derived.objLine,
    ml ? `reported L${ml.line_number ?? ml.line}, receiver is L${derived.objLine}` : "edge absent")

  // A contains edge and its symbol must agree about the line.
  const sym: any[] = []
  {
    const r: any = await parseFile(join(PROBE_DIR, "lines.lua"), PROBE_DIR)
    sym.push(...(r.symbols ?? []))
  }
  const containsDisagree: string[] = []
  for (const e of edges.filter((x) => x.type === "contains")) {
    const s = sym.find((x) => x.name === e.target && (x.ownerName === e.source || e.source === "global"))
    if (!s) continue
    const el = e.line_number ?? e.line
    if (el !== undefined && s.startLine !== undefined && el !== s.startLine) {
      containsDisagree.push(`${e.source}->${e.target}: edge L${el} but symbol L${s.startLine}`)
    }
  }
  check("each contains edge agrees with its symbol's declaration line", containsDisagree.length === 0,
    containsDisagree.join("; ") || "all agree")

  // ── mutants: the gate must be able to fail ─────────────────────────────────
  // Each mutant rewrites the ANALYZER SOURCE to plant one regression, then the
  // source is restored before the next. Mutants run against a fresh parse each
  // time, and the restore is asserted, so no mutant can inherit another's state.
  console.log("\nM: planted regressions (the gate must fail on each)")
  const { readFileSync } = await import("node:fs")
  const ANALYZER = join(ROOT, "src", "ast", "real-lua-analyzer.ts")
  const original = readFileSync(ANALYZER, "utf8")
  const { writeFileSync: wf } = await import("node:fs")

  // ── mutants: prove the gate can fail ───────────────────────────────────────
  // Each mutant corrupts the analyzer's OUTPUT and re-runs the same
  // verification, so each proves one leg can fail.
  //
  // The first draft planted regressions in the analyzer SOURCE and re-parsed in
  // the same process. All four planted cleanly and none was caught, because
  // the engine caches the analyzer module: a source edit after first import has
  // no effect, so every mutant measured the unmutated analyzer. `NOPLANT 0/3`
  // then `LEAK 0/4` is what a source-mutating gate looks like when it does not
  // work. Output mutation is also the more honest test here — the legs under
  // test are about what the pipeline emits, not about how the text is spelled —
  // and it needs no process juggling, which is the approach
  // script/m60/verify-910-c-includes.ts takes with index rows.
  const verify = (edges: any[], syms: any[]): string[] => {
    const f: string[] = []
    for (const e of edges) {
      if (e.line_number === undefined && e.line === undefined) f.push(`edge with no line: ${e.type} ${e.source}->${e.target}`)
    }
    for (const want of EXPECT) {
      const hit = edges.find((e) => e.type === want.type && e.source === want.source && e.target === want.target)
      const got = hit ? (hit.line_number ?? hit.line) : undefined
      if (got !== want.line) f.push(`${want.type} ${want.source}->${want.target} expected L${want.line} got ${got === undefined ? "NO EDGE/LINE" : "L" + got}`)
    }
    for (const e of edges.filter((x) => x.type === "contains")) {
      const s = syms.find((x) => x.name === e.target && (x.ownerName === e.source || e.source === "global"))
      const el = e.line_number ?? e.line
      if (s && el !== undefined && s.startLine !== undefined && el !== s.startLine) f.push(`contains ${e.source}->${e.target} edge L${el} vs symbol L${s.startLine}`)
    }
    return f
  }

  const baseEdges = await edgesFor("lines.lua", PROBE_DIR)
  const baseSyms: any[] = (await parseFile(join(PROBE_DIR, "lines.lua"), PROBE_DIR)).symbols ?? []
  const baseFailures = verify(baseEdges, baseSyms)
  check("the unmutated analyzer passes every expectation", baseFailures.length === 0, baseFailures.join("; ") || "clean")

  const MUTANTS: Array<{ name: string; apply: (e: any[]) => any[] }> = [
    {
      name: "the line is not emitted at all (the pre-fix state)",
      apply: (e) => e.map((x) => { const c = { ...x }; delete c.line_number; delete c.line; return c }),
    },
    {
      name: "whole-line: the receiver's line instead of the callee's",
      apply: (e) => e.map((x) => (x.type === "calls" && x.target === "method" ? { ...x, line_number: derived.objLine } : x)),
    },
    {
      name: "off-by-one: a 0-based line",
      apply: (e) => e.map((x) => (x.line_number === undefined ? x : { ...x, line_number: x.line_number - 1 })),
    },
    {
      name: "LUA-13 again: a multi-line snippet as the target (filtered away downstream)",
      apply: (e) => e.map((x) => (x.type === "calls" && x.target === "method" ? { ...x, target: "obj\n  .method" } : x)).filter((x) => !(typeof x.target === "string" && x.target.includes("\n"))),
    },
    {
      name: "a contains edge disagrees with its symbol's line",
      apply: (e) => e.map((x) => (x.type === "contains" && x.target === "obj" ? { ...x, line_number: 99 } : x)),
    },
  ]

  let caught = 0
  const detail: Array<{ name: string; caught: boolean; failures: string[] }> = []
  for (const m of MUTANTS) {
    const failures = verify(m.apply(baseEdges.map((x) => ({ ...x }))), baseSyms)
    const hit = failures.length > 0
    if (hit) caught++
    detail.push({ name: m.name, caught: hit, failures: failures.slice(0, 2) })
    console.log(`  ${hit ? "CAUGHT " : "LEAK   "}  ${m.name}${hit ? "" : "  <-- THE GATE IS BLIND HERE"}`)
  }
  check("every planted regression is caught", caught === MUTANTS.length, `${caught}/${MUTANTS.length}`)

  const passed = checks.every((c) => c.pass)
  const result = {
    schemaVersion: 1,
    gate: "verify-lua-edge-lines",
    title: "M60 lua LUA-01 — every lua relationship carries the line of its name-bearing node",
    at: new Date().toISOString(),
    analyzer: "src/ast/real-lua-analyzer.ts",
    rationale: "LUA-01: 0 of 15 lua relationships carried any line field while java emitted line_number:2 through the identical pipeline, so the M60 matrix reads lua `lines: n/a`. The rule is M59 (#825)'s, not invented here: the line is where the NAME is written, not where the enclosing node starts. The multi-line call in the fixture is the falsifier — a whole-line implementation passes every other row and fails it.",
    fixture: FIXTURE,
    derivedLines: derived,
    expected: EXPECT,
    observed: baseEdges.map((e) => ({ type: e.type, source: e.source, target: e.target, line: e.line_number ?? e.line })),
    checks,
    mutants: {
      caught,
      total: MUTANTS.length,
      detail,
      method: "OUTPUT mutation, not source mutation. The engine caches analyzer modules, so editing the source after first import has no effect: the first draft of this suite planted 4/4 regressions and caught 0/4 because every mutant re-measured the unmutated analyzer. Output mutation also tests the right thing — the legs are about what the pipeline emits, not how the source is spelled — and matches how script/m60/verify-910-c-includes.ts mutates index rows.",
    },
    passed,
    status: passed ? "pass" : "fail",
    limitations: [
      "Expected lines are hand-authored, then re-derived at run time by locating the callee's line in the fixture text so a fixture edit cannot silently invalidate an expectation. A systematic misreading of the M59 contract would still pass.",
      "The gate covers five relationship kinds. A NEW kind the analyzer starts emitting is caught by the 'every emitted relationship carries a line' leg, but has no expected line until one is added here.",
      "Output mutation proves the verification logic can fail. It does NOT prove the analyzer source produces the right output for any mutant, because the engine caches the module — a source-level mutation test would need one fresh process per mutant, and is owed.",
    ],
  }
  mkdirSync(dirname(EVIDENCE), { recursive: true })
  writeFileSync(EVIDENCE, JSON.stringify(result, null, 2) + "\n")
  for (const c of checks) console.log(`  ${c.pass ? "ok  " : "FAIL"}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`)
  console.log(`\nlua-edge-lines: ${result.status.toUpperCase()} (${checks.filter((c) => c.pass).length}/${checks.length} checks, ${caught}/${MUTANTS.length} mutants caught)`)
  console.log(`wrote ${EVIDENCE}`)
  if (!passed) process.exitCode = 1
}
main()
