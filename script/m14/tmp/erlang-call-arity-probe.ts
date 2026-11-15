// Probe: tree shape of Erlang call nodes for call-site arity extraction (#880
// obligation 4 — arity-aware local-call resolution). Confirms:
//   1. does `call` carry an expr_args child (like function_clause)?
//   2. do comments inside call expr_args count as named children?
//   3. remote node shape (two atoms under `remote`)?
//   4. zero-arg call shape (f() vs f(X))?
import { Parser, Language } from "web-tree-sitter"

const src = `-module(probe).
-export([go/0]).
go() ->
    f(1),
    f(1, 2),
    f(),
    lists:map(fun f/1, [1]),
    io:format("~p~n", [
        % comment inside args
        1
    ]),
    ok.
f(X) -> X.
f(X, Y) -> {X, Y}.
f() -> zero.
`

function dump(n: any, depth: number) {
  const pad = "  ".repeat(depth)
  const named = n.isNamed ? "" : " (unnamed)"
  console.log(`${pad}${n.type}${n.isNamed ? "" : named}  [${n.startPosition.row + 1}:${n.startPosition.column + 1}] ${n.text.length > 60 ? n.text.slice(0, 60) + "…" : n.text}`)
}

async function main() {
  await Parser.init()
  const parser = new Parser()
  parser.setLanguage(await Language.load(new URL("../../../wasm/tree-sitter-erlang.wasm", import.meta.url).pathname))
  const tree = parser.parse(src)!
  console.log("hasError:", tree.rootNode.hasError)
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()!
    dump(n, 0)
    // only descend into the first two function clauses' bodies to keep output small
    if (n.type === "call" || n.type === "remote" || n.type === "expr_args") {
      for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i))
    } else {
      for (let i = n.childCount - 1; i >= 0; i--) {
        const c = n.child(i)
        if (c && ["call", "remote", "expr_args", "fun_decl", "function_clause", "clause_body", "atom", "integer", "list", "comment", "var", "string", "fun", "map", "expr"].includes(c.type)) stack.push(c)
      }
    }
  }
  tree.delete()
  parser.delete()
}

main().catch(e => { console.error(e); process.exitCode = 1 })
