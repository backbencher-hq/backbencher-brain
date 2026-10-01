import assert from "node:assert/strict"
import { Parser, Language } from "web-tree-sitter"
import { RealErlangAnalyzer } from "../../src/ast/real-erlang-analyzer"

const source = `-module(arity_identity).
-export([pick/0, pick/1]).
pick() -> zero.
pick(0) -> zero;
pick(X) -> X.
shape({A, B}, [C, D], #{key := E}) -> {A, B, C, D, E}.
commented(A,
    % not an argument
    B) -> {A, B}.
`

// #880 obligation 4 (ER-D2): call-site arity is part of call-edge identity.
// pick/1 and pick/2 are distinct callees, so calls to them are distinct edges;
// remote targets keep their module qualification (ER-D1) and carry arity too.
const callSource = `-module(call_identity).
-export([go/0, pick/1, pick/2, ping/0]).
go() ->
    pick(1),
    pick(1, 2),
    ping(),
    io:format("one~n"),
    io:format("~p~n", [ok]).
pick(X) -> X.
pick(X, Y) -> {X, Y}.
ping() -> pong.
`

function checkIdentity(result: ReturnType<RealErlangAnalyzer["analyze"]>) {
  const functions = result.symbols.filter(s => s.kind === "function")
  assert.equal(functions.length, 4)
  assert.deepEqual(functions.map(s => ({ name: s.name, owner: s.ownerName, arity: s.metadata?.arity, clauses: s.metadata?.clauseCount, start: s.range.startLine, end: s.range.endLine })), [
    { name: "pick", owner: "arity_identity", arity: 0, clauses: 1, start: 3, end: 3 },
    { name: "pick", owner: "arity_identity", arity: 1, clauses: 2, start: 4, end: 5 },
    { name: "shape", owner: "arity_identity", arity: 3, clauses: 1, start: 6, end: 6 },
    { name: "commented", owner: "arity_identity", arity: 2, clauses: 1, start: 7, end: 9 },
  ])
  assert.deepEqual(result.exports.map(e => ({ name: e.name, arity: e.arity })), [{ name: "pick", arity: 0 }, { name: "pick", arity: 1 }])
  assert.equal(source.slice(functions[1].range.startIndex, functions[1].range.endIndex), "pick(0) -> zero;\npick(X) -> X.")
}

function checkCallIdentity(result: ReturnType<RealErlangAnalyzer["analyze"]>) {
  const byTargetArity = (a: { target: string; arity: number }, b: { target: string; arity: number }) =>
    `${a.target}/${a.arity}`.localeCompare(`${b.target}/${b.arity}`)
  // M59 (#825): every call edge carries the NAME-BEARING node's line — the
  // callee atom (local) or the function atom (remote, the chain's leaf) —
  // never the enclosing construct's line, never 0.
  const calls = result.relationships
    .filter(r => r.type === "calls")
    .map(r => ({ source: r.source, target: r.target, arity: (r.metadata as any)?.callArity, context: (r.metadata as any)?.context, line: (r as any).line_number }))
    .sort(byTargetArity)
  assert.deepEqual(calls, ([
    { source: "go", target: "pick", arity: 1, context: "local function call", line: 4 },
    { source: "go", target: "pick", arity: 2, context: "local function call", line: 5 },
    { source: "go", target: "ping", arity: 0, context: "local function call", line: 6 },
    { source: "go", target: "io:format", arity: 1, context: "remote function call", line: 7 },
    { source: "go", target: "io:format", arity: 2, context: "remote function call", line: 8 },
  ] as const).map(x => ({ ...x })).sort(byTargetArity))
  // The line contract covers EVERY relationship kind, not just calls:
  // contains carries the member's declaration line; implements the
  // behaviour atom's; references the include/import name's.
  for (const r of result.relationships) {
    if (r.type !== "calls") continue
    assert.equal(typeof (r as any).line_number, "number", "every call edge carries a line_number")
    assert.ok((r as any).line_number > 0, "line_number is 1-based, never 0")
  }
}

async function main() {
  await Parser.init()
  const parser = new Parser()
  parser.setLanguage(await Language.load(new URL("../../wasm/tree-sitter-erlang.wasm", import.meta.url).pathname))
  const tree = parser.parse(source)!
  try {
    assert.equal(tree.rootNode.hasError, false)
    const analyzer = new RealErlangAnalyzer()
    const result = analyzer.analyze(tree.rootNode, source, "arity_identity.erl")
    checkIdentity(result)
    assert.deepEqual(analyzer.analyze(tree.rootNode, source, "arity_identity.erl"), result)
    const mutations = [
      { id: "collapse-arity", apply: (r: ReturnType<RealErlangAnalyzer["analyze"]>) => { r.symbols = r.symbols.filter(s => !(s.name === "pick" && s.metadata?.arity === 1)) } },
      { id: "split-clauses", apply: (r: ReturnType<RealErlangAnalyzer["analyze"]>) => { r.symbols.push(structuredClone(r.symbols.find(s => s.name === "pick" && s.metadata?.arity === 1)!)) } },
      { id: "lose-clause-count", apply: (r: ReturnType<RealErlangAnalyzer["analyze"]>) => { r.symbols.find(s => s.name === "pick" && s.metadata?.arity === 1)!.metadata!.clauseCount = 1 } },
      { id: "truncate-clause-range", apply: (r: ReturnType<RealErlangAnalyzer["analyze"]>) => { r.symbols.find(s => s.name === "pick" && s.metadata?.arity === 1)!.range.endLine = 4 } },
      { id: "count-comment", apply: (r: ReturnType<RealErlangAnalyzer["analyze"]>) => { r.symbols.find(s => s.name === "commented")!.metadata!.arity = 3 } },
      { id: "flatten-arguments", apply: (r: ReturnType<RealErlangAnalyzer["analyze"]>) => { r.symbols.find(s => s.name === "shape")!.metadata!.arity = 5 } },
    ]
    for (const mutation of mutations) {
      const mutated = structuredClone(result)
      mutation.apply(mutated)
      assert.notDeepEqual(mutated, result, `${mutation.id} must alter the output`)
      assert.throws(() => checkIdentity(mutated), assert.AssertionError, `${mutation.id} must be rejected`)
      console.log(`CAUGHT ${mutation.id}`)
    }

    // ---- call-site arity identity (ER-D2 + ER-D1) ----
    const callTree = parser.parse(callSource)!
    try {
      assert.equal(callTree.rootNode.hasError, false)
      const callResult = analyzer.analyze(callTree.rootNode, callSource, "call_identity.erl")
      checkCallIdentity(callResult)
      assert.deepEqual(analyzer.analyze(callTree.rootNode, callSource, "call_identity.erl"), callResult)
      const callMutations = [
        { id: "merge-call-arities", apply: (r: ReturnType<RealErlangAnalyzer["analyze"]>) => { const seen = new Set<string>(); r.relationships = r.relationships.filter(x => { if (x.type !== "calls") return true; const k = `${x.source}|${x.target}`; if (seen.has(k)) return false; seen.add(k); return true }) } },
        { id: "drop-call-arity-metadata", apply: (r: ReturnType<RealErlangAnalyzer["analyze"]>) => { for (const x of r.relationships) { if (x.type === "calls" && x.metadata) delete x.metadata.callArity } } },
        { id: "off-by-one-site-arity", apply: (r: ReturnType<RealErlangAnalyzer["analyze"]>) => { const e = r.relationships.find(x => x.type === "calls" && x.target === "pick" && x.metadata?.callArity === 1); if (e) e.metadata.callArity = 2 } },
        { id: "remote-arity-flip", apply: (r: ReturnType<RealErlangAnalyzer["analyze"]>) => { const e = r.relationships.find(x => x.type === "calls" && x.target === "io:format" && x.metadata?.callArity === 2); if (e) e.metadata.callArity = 3 } },
        { id: "lines-dropped", apply: (r: ReturnType<RealErlangAnalyzer["analyze"]>) => { for (const x of r.relationships as any[]) delete x.line_number } },
        { id: "line-zero-based", apply: (r: ReturnType<RealErlangAnalyzer["analyze"]>) => { for (const x of r.relationships as any[]) if (typeof x.line_number === "number") x.line_number -= 1 } },
        { id: "line-shifted-to-construct", apply: (r: ReturnType<RealErlangAnalyzer["analyze"]>) => { for (const x of r.relationships as any[]) if (typeof x.line_number === "number") x.line_number = 3 } },
      ]
      for (const mutation of callMutations) {
        const mutated = structuredClone(callResult)
        mutation.apply(mutated)
        assert.notDeepEqual(mutated, callResult, `${mutation.id} must alter the output`)
        assert.throws(() => checkCallIdentity(mutated), assert.AssertionError, `${mutation.id} must be rejected`)
        console.log(`CAUGHT ${mutation.id}`)
      }
    } finally {
      callTree.delete()
    }
    console.log("PASS Erlang identity: four functions, two export arities, call-site arity + site lines on local+remote call edges, thirteen output mutations")
  } finally {
    tree.delete()
    parser.delete()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
