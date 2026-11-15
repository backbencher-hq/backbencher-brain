// ER2 restoration Phase-0 probe (second half): the shapes the first probe left
// open — fun_decl/function_clause/expr_args (arity + clause merge), the
// `?MODULE:run(X)` module position (a macro under `remote`), `-nifs`, and the
// clause guard's position relative to expr_args (pattern-position suppression
// must NOT silence guards: ER2's record contract emits in guards and bodies,
// and only a clause HEAD is a match).
//
// Run: bun script/m14/tmp/erlang-er2-shapes2.ts
import { Parser, Language } from "web-tree-sitter"

const src = `-module(probe3).
-export([go/0, pick/1, pick/2, commented/1, guarded/1]).
-nifs([nif_one/0]).

go() ->
    ?MODULE:pick(1),
    ?TIMEOUT.

pick(X) -> X.
pick(X, Y) -> {X, Y}.

commented(A,
    % not an argument
    B) -> {A, B}.

guarded(S) when S#state.count > 0 andalso not ?FLAG -> S.

nif_one() -> ok.
`

async function main() {
  await Parser.init()
  const parser = new Parser()
  parser.setLanguage(await Language.load(new URL("../../../wasm/tree-sitter-erlang.wasm", import.meta.url).pathname))
  const tree = parser.parse(src)!
  console.log("hasError:", tree.rootNode.hasError)

  const show = (n: any, depth = 0) => {
    const pad = "  ".repeat(depth)
    const text = n.text.length > 54 ? n.text.slice(0, 54) + "…" : n.text
    console.log(`${pad}${n.type}${n.isNamed ? "" : " (unnamed)"} [${n.startPosition.row + 1}:${n.startPosition.column + 1}] "${text.replace(/\n/g, "\\n")}"`)
  }
  const walk = (n: any, depth: number, cap: number) => {
    show(n, depth)
    if (depth >= cap) return
    for (let i = 0; i < n.childCount; i++) walk(n.child(i), depth + 1, cap)
  }

  const find = (type: string, limit = 1): any[] => {
    const out: any[] = []
    const stack: any[] = [tree.rootNode]
    while (stack.length && out.length < limit) {
      const n = stack.pop()!
      if (n.type === type) out.push(n)
      for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i))
    }
    return out
  }

  for (const t of ["fun_decl", "wild_attribute", "function_clause", "expr_args"]) {
    for (const n of find(t, t === "function_clause" || t === "expr_args" ? 2 : 1)) {
      console.log(`\n===== ${t} =====`)
      walk(n, 0, 3)
    }
  }

  console.log("\n===== ?MODULE in remote-module position =====")
  const remotes: any[] = []
  const walk2 = (n: any) => { if (n.type === "remote") remotes.push(n); for (let i = 0; i < n.childCount; i++) walk2(n.child(i)) }
  walk2(tree.rootNode)
  for (const r of remotes) walk(r, 0, 2)

  console.log("\n===== guard's parent chain (guarded/1) =====")
  const guards = find("guard", 1)
  for (const g of guards) {
    walk(g, 0, 2)
    let cur = g.parent
    const chain: string[] = []
    while (cur) { chain.push(cur.type); cur = cur.parent }
    console.log("  ancestors:", chain.join(" < "))
  }
  let head = find("record_field_expr", 1)[0] ?? find("binary_op_expr", 1)[0]
  if (head) {
    let cur = head.parent
    const chain: string[] = []
    while (cur) { chain.push(cur.type); cur = cur.parent }
    console.log("  guard-expression ancestors:", chain.join(" < "))
  }

  tree.delete()
  parser.delete()
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
