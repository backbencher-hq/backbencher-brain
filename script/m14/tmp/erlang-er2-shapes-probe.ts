// ER2 Phase-0 probe: measure the tree shapes of EVERY construct the wave
// will emit edges for. Nothing in ER2 is implemented off assumption — each
// branch below pins the exact node shape first.
//   1. record READ  (State#state.count)  — record_field_expr?
//   2. record UPDATE (State#state{count = X, label = ?T}) — record_update_expr + fields
//   3. record INDEX (#state.label as a value) — record_index_expr
//   4. macro USE (?TIMEOUT, ?MODULE) — macro_call_expr / macro_expr shape
//   5. callback (-callback handle_call(...) -> ...) — name extraction
//   6. type expr (-type maybe(T) :: T | undefined.) — where type names live
//   7. case arms / if arms — cr_clause / if_clause parents and counts
//   8. remote fields — does `remote` expose named fields (module/function)?
//   9. record field DEFAULTS (-record(s, {t = erlang:make_ref()})) — value shape
//  10. fun refs (fun run/1, fun lists:map/2) — internal_fun / external_fun
//  11. opaque (-opaque token() :: binary().)
import { Parser, Language } from "web-tree-sitter"

const src = `-module(probe2).
-behaviour(gen_server).
-define(TIMEOUT, 5000).
-callback handle_call(term(), {pid(), reference()}, state()) -> {reply, term(), state()}.
-type maybe(T) :: T | undefined.
-opaque token() :: binary().
-record(state, {timer = erlang:make_ref(), count = 0, label}).
-export([run/1]).

run(State) ->
    case State of
        one -> a;
        two -> b;
        _ -> c
    end,
    if
        State == one -> d;
        true -> e
    end,
    State#state{count = State#state.count + 1, label = ?TIMEOUT},
    X = State#state.count,
    Y = #state.label,
    F = fun run/1,
    G = fun lists:map/2,
    ?MODULE:run(State),
    ref(X, Y, F, G).

ref(_, _, _, _) -> ?TIMEOUT.
`

async function main() {
  await Parser.init()
  const parser = new Parser()
  parser.setLanguage(await Language.load(new URL("../../../wasm/tree-sitter-erlang.wasm", import.meta.url).pathname))
  const tree = parser.parse(src)!
  console.log("hasError:", tree.rootNode.hasError)
  const dump = (n: any, depth: number, maxDepth: number, prefix = "") => {
    const t = n.type
    const text = n.text.length > 50 ? n.text.slice(0, 50) + "…" : n.text
    console.log(`${prefix}${t}  [${n.startPosition.row + 1}:${n.startPosition.column + 1}] ${text}`)
    if (depth >= maxDepth) return
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) dump(c, depth + 1, maxDepth, prefix + "  ")
    }
  }
  const stack: any[] = [tree.rootNode]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const n = stack.pop()!
    const t = n.type
    const wanted = [
      "record_update_expr", "record_field_expr", "record_index_expr", "record_field_name",
      "macro_call_expr", "macro_expr", "callback", "type_alias", "opaque", "cr_clause",
      "if_clause", "internal_fun", "external_fun", "record_decl", "remote",
    ]
    if (wanted.includes(t) && !seen.has(t)) {
      seen.add(t)
      console.log(`\n===== ${t} =====`)
      dump(n, 0, t === "record_decl" ? 3 : (t === "type_alias" ? 3 : 4))
    }
    for (let i = n.childCount - 1; i >= 0; i--) { const c = n.child(i); if (c) stack.push(c) }
  }
  // named fields of remote?
  const remotes: any[] = []
  const walk2 = (n: any) => { if (n.type === "remote") remotes.push(n); for (let i = 0; i < n.childCount; i++) walk2(n.child(i)) }
  walk2(tree.rootNode)
  for (const r of remotes.slice(0, 2)) {
    console.log(`\n===== remote named fields? =====`)
    const g = parser.getLanguage()
    try {
      // @ts-ignore experimental field API
      const fieldCount = (g as any).fieldCount ?? 0
      console.log("grammar fieldCount:", fieldCount)
      for (let i = 0; i < r.childCount; i++) {
        const c = r.child(i)
        const fn = (g as any).fieldNameForChild ? (g as any).fieldNameForChild(i) : undefined
        console.log(`  remote child[${i}] type=${c?.type} field=${fn ?? "(none)"}`)
      }
    } catch (e: any) { console.log("field API error:", e.message) }
  }
  tree.delete()
  parser.delete()
}

main().catch(e => { console.error(e); process.exitCode = 1 })

// ER2 probe-2: receive arms, try clauses, maybe arms — complexity counting
// needs the exact arm node types. Plus: a record read in a clause HEAD
// (pattern position) vs a guard (evaluation position) — the emission guard.
async function probe2() {
  await Parser.init()
  const parser = new Parser()
  parser.setLanguage(await Language.load(new URL("../../../wasm/tree-sitter-erlang.wasm", import.meta.url).pathname))
  const src2 = `-module(probe3).
-export([run/1, head/1, guardy/1]).

run(Msg) ->
    receive
        {ok, V} -> V;
        stop -> done
    after 1000 -> timeout
    end,
    try run(Msg) of
        R -> R
    catch
        error:badarg -> 0;
        _:_ -> 1
    after
        ok
    end.

head(#state{count = C}) -> C.
guardy(S) when S#state.count > 0 -> positive.
`
  const tree = parser.parse(src2)!
  console.log("\nhasError2:", tree.rootNode.hasError)
  const arms: Record<string, number> = {}
  const stack: any[] = [tree.rootNode]
  const dump = (n: any, depth: number, maxDepth: number, prefix = "") => {
    const text = n.text.length > 40 ? n.text.slice(0, 40) + "…" : n.text
    console.log(`${prefix}${n.type}  [${n.startPosition.row + 1}] ${text}`)
    if (depth >= maxDepth) return
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) dump(c, depth + 1, maxDepth, prefix + "  ") }
  }
  const seen = new Set<string>()
  while (stack.length > 0) {
    const n = stack.pop()!
    arms[n.type] = (arms[n.type] ?? 0) + 1
    if (["receive_expr", "try_expr", "catch_clause", "record_field_expr"].includes(n.type) && !seen.has(n.type + ":" + n.startPosition.row)) {
      seen.add(n.type + ":" + n.startPosition.row)
      console.log(`\n===== ${n.type} @${n.startPosition.row + 1} =====`)
      dump(n, 0, 3)
    }
    for (let i = n.childCount - 1; i >= 0; i--) { const c = n.child(i); if (c) stack.push(c) }
  }
  console.log("\narm counts:", JSON.stringify(arms))
  tree.delete()
  parser.delete()
}
probe2().catch(e => { console.error(e); process.exitCode = 1 })
