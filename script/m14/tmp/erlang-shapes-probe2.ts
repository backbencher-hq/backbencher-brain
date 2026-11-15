// ER3 wave — targeted shape probe #2.
//
// The census (erlang-grammar-census.ts) says WHICH node types exist; this
// probe answers the questions a census cannot: the exact child shapes of the
// constructs the rewrite will branch on, and — from the REAL corpus — the
// complete parent set of the nodes that carry edges, so no evaluation context
// is left unhandled and no pattern context leaks an edge.
//
// Usage: bun run script/m14/tmp/erlang-shapes-probe2.ts
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..", "..")
const REPO_ROOT = "/home/sano/ishaq/bb_tests/repositories"

const SYNTHETIC = `-module(shape_probe).
-behaviour(gen_server).
-compile([{inline, [{f, 1}]}]).
-compile(export_all).
-file("shape_probe.erl", 1).
-include("a.hrl").
-include_lib("kernel/include/file.hrl").
-import(lists, [seq/2, sort/1]).
-nifs([nif_a/1]).
-on_load([boot/0]).
-optional_callbacks([handle_call/3, handle_info/2]).
-export([f/0, f/1, g/2]).
-export_type([my_t/0, other/1]).
-callback handle_call(Request :: term(), From :: {pid(), term()}, State :: state()) -> {reply, term(), state()}.
-callback init(term()) -> {ok, state()} | {error, term()}.
-spec f() -> ok.
-spec g(integer(), atom()) -> {ok, integer()} | error when integer() :: term().
-type my_t() :: #{atom() => integer(), atom() => atom()}.
-type other(A) :: {ok, A} | {error, term()} | [A, ...] | fun((A) -> A) | 1..7 | #rec{}.
-opaque hidden() :: #rec{}.
-record(rec, {a = 1 :: integer(), b, c = ?DEFAULT}).
-define(OBJ, 42).
-define(DEFAULT, 100).
-define(FUN(X, Y), {X, Y}).
-define(GUARDED(X, ...) when is_list(X), (catch foo(X))).
-define(EMPTY,).

f() -> ?DEFAULT.
g(A, B) -> ?FUN(A, B), ?OBJ, f(), g(1, b), lists:sort([1,2]), maps:get(a, #{}),
          M#{a := 1}, M#{a => 2}, << <<X:8>> || X <- [1,2] >>,
          [Y || Y <- [1,2], Y > 1], #{K => V || K <- [a], V <- [1]},
          begin ok end, catch throw(x), try ok catch throw:E:S -> E after 0 -> ok end,
          spawn(?MODULE), self(), erlang:make_ref(), apply(m, f, [A]),
          A ! B, S#rec.a, S#rec{a = 1}, #rec.a, fun g/2, fun lists:map/2,
          fun(X) -> X end, fun ?MODULE:f/0, ?MODULE:g(A, B), "str", $c, 1.0, [a|_],
          case A of #rec{} -> 1; _ -> 2 end, if A > 0 -> 1; true -> 2 end,
          receive after 100 -> ok end,
          lists:foreach(fun(X) when is_integer(X) -> X end, [1]),
          begin io:format("~p~n", [A]) end.

handle_call(R, From, S) -> {reply, R, S}.
handle_info(M, S) -> {noreply, M, S}.
init([]) -> {ok, []}.
boot() -> ok.
nif_a(X) -> erlang:make_ref().
`

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new ParserClass()
  parser.setLanguage(await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm"))))

  const dump = (n: any, depth: number, maxDepth: number, prefix = "") => {
    const text = n.text.length > 46 ? n.text.slice(0, 46).replace(/\n/g, "\\n") + "…" : n.text.replace(/\n/g, "\\n")
    console.log(`${prefix}${n.type}${n.isNamed ? "" : " (anon)"}  [${n.startPosition.row + 1}:${n.startPosition.column + 1}] ${text}`)
    if (depth >= maxDepth) return
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) dump(c, depth + 1, maxDepth, prefix + "  ")
    }
  }

  console.log("################ SYNTHETIC TOP-LEVEL FORMS ################")
  const tree = parser.parse(SYNTHETIC)!
  console.log("hasError:", tree.rootNode.hasError)
  for (let i = 0; i < tree.rootNode.childCount; i++) {
    const c = tree.rootNode.child(i)
    if (c && c.isNamed) dump(c, 0, Number(process.env.DEPTH ?? 2))
  }

  console.log("\n################ CORPUS: PARENT SETS OF EDGE-CARRYING NODES ################")
  const WATCH = new Set([
    "call", "record_expr", "record_field_expr", "record_update_expr", "record_index_expr",
    "macro_call_expr", "internal_fun", "external_fun", "callback", "opaque", "type_alias",
    "fa", "record_decl", "spec", "pp_define", "wild_attribute", "attr_name", "remote",
  ])
  const parentSets = new Map<string, Map<string, number>>()
  const examples = new Map<string, string>()
  const wildNames = new Map<string, number>()
  const files: string[] = []
  for (const d of ["otp", "rebar3", "cowboy"]) {
    const base = path.join(REPO_ROOT, d)
    if (!fs.existsSync(base)) continue
    const stack = [base]
    while (stack.length > 0) {
      const cur = stack.pop()!
      let entries: fs.Dirent[]
      try { entries = fs.readdirSync(cur, { withFileTypes: true }) } catch { continue }
      for (const e of entries) {
        if (e.name === ".git") continue
        const p = path.join(cur, e.name)
        if (e.isDirectory()) stack.push(p)
        else if (e.name.endsWith(".erl")) files.push(p)
      }
    }
  }
  files.sort()
  const limit = Number(process.env.FILES ?? 400)
  const step = Math.max(1, Math.floor(files.length / limit))
  const sample = files.filter((_, i) => i % step === 0).slice(0, limit)
  console.log(`corpus sample: ${sample.length} of ${files.length}`)
  for (const f of sample) {
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    const t = parser.parse(content)
    const stack: any[] = [t!.rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (WATCH.has(n.type)) {
        const pt = n.parent?.type ?? "(root)"
        const m = parentSets.get(n.type) ?? new Map<string, number>()
        m.set(pt, (m.get(pt) ?? 0) + 1)
        parentSets.set(n.type, m)
        if (!examples.has(`${n.type}<-${pt}`)) examples.set(`${n.type}<-${pt}`, `${path.basename(f)}:${n.startPosition.row + 1} ${n.text.slice(0, 40).replace(/\n/g, "\\n")}`)
      }
      if (n.type === "attr_name") wildNames.set(n.text, (wildNames.get(n.text) ?? 0) + 1)
      for (let i = n.childCount - 1; i >= 0; i--) { const c = n.child(i); if (c) stack.push(c) }
    }
  }
  for (const t of [...WATCH].sort()) {
    const m = parentSets.get(t)
    if (!m) { console.log(`\n${t}: ABSENT in sample`); continue }
    console.log(`\n${t}: parents ${JSON.stringify(Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1])))}`)
  }
  console.log("\nwild_attribute attr_name values (the unknown-attribute surface):")
  for (const [k, v] of [...wildNames.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`)
  console.log("\nexamples for the shapes the rewrite branches on:")
  for (const [k, v] of [...examples.entries()].sort()) if (["record_expr<-field_expr", "record_expr<-match_expr", "record_field_expr<-guard", "record_update_expr<-clause_body", "macro_call_expr<-remote_module", "call<-pp_define", "fa<-optional_callbacks_attribute", "fa<-export_type_attribute", "callback<-source_file", "opaque<-source_file", "internal_fun<-match_expr", "external_fun<-expr_args", "record_decl<-source_file", "spec<-source_file", "call<-type_sig", "call<-fun_type", "call<-macro_call_args"].includes(k)) console.log(`  ${k} :: ${v}`)
}

main().catch(e => { console.error(e); process.exit(1) })
