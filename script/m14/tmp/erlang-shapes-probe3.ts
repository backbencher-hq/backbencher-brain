// ER3 wave — probe #3: the node types the 450-file census MISSED
// (cond_match_expr / maybe_expr / nominal / record-in-generator), plus the
// `-record #a` ERROR shape, so no grammar surface is left unexplained.
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..", "..")
const REPO_ROOT = "/home/sano/ishaq/bb_tests/repositories"
const WANT = new Set((process.env.WANT ?? "cond_match_expr,maybe_expr,nominal,attr_name,ERROR,record_name,module,fa").split(","))

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new ParserClass()
  parser.setLanguage(await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm"))))

  const dump = (n: any, depth: number, maxDepth: number, prefix = "") => {
    const text = n.text.length > 60 ? n.text.slice(0, 60).replace(/\n/g, "\\n") + "…" : n.text.replace(/\n/g, "\\n")
    console.log(`${prefix}${n.type}${n.isNamed ? "" : " (anon)"} [${n.startPosition.row + 1}:${n.startPosition.column + 1}] ${text}`)
    if (depth >= maxDepth) return
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) dump(c, depth + 1, maxDepth, prefix + "  ") }
  }

  // 1. synthetic probes for the rare shapes
  const synth: Record<string, string> = {
    cond_match_expr: "-module(m).\nf(X) -> case X of _ when is_integer(X) -> 1 end.\n",
    maybe_expr: "-module(m).\nf(X) -> maybe X of Y -> Y end.\n",
    nominal: "-module(m).\n-type t() :: nominal(A).\nf() -> 1.\n",
    record_in_generator: "-module(m).\n-record(r, {a}).\nf(L) -> [K || #r{a = K} <- L].\n",
    record_in_comprehension: "-module(m).\n-record(r, {a}).\nf(L) -> [#r{} || _ <- L].\n",
    guard_ann_type: "-module(m).\nf(X) when X :: integer() -> 1.\n",
    external_fun_macro: "-module(m).\nf() -> [fun ?MODULE:g/0, fun m:h/1, ?MODULE:k(A)].\n",
    nif: "-module(m).\n-nifs([a/1, b/2]).\n-on_load([boot/0]).\na(X) -> X.\nb(X,Y) -> {X,Y}.\nboot() -> ok.\n",
    macro_record: "-module(m).\n-define(REC, r).\n-record(?REC, {a}).\nf() -> #?REC{}.\n",
    macro_fun_head: "-module(m).\n-define(NAME(X), X).\n?NAME(A) -> A.\n",
    macro_export: "-module(m).\n-define(FOO, foo).\n-export([?FOO/0]).\nfoo() -> 1.\n",
    nested_record_field_expr: "-module(m).\n-record(a, {f}).\n-record(b, {g}).\nf(S, T) -> S#a.f#b.g.\n",
    map_update: "-module(m).\nf(M, V) -> M#{a => V, b := 2, c => f(V)}.\n",
    bitstring_call: "-module(m).\nf(B) -> <<X:8/integer-unsigned>> = B, <<(f(X)):8>>.\n",
    list_tail: "-module(m).\nf(L) -> [a, b | L].\nf2(L) -> [a | L].\n",
    spec_when: "-module(m).\n-spec f(integer()) -> ok when integer() :: term().\nf(X) -> ok.\n",
    dotdotdot_define: "-module(m).\n-define(F(X, ...), ok).\nf(A) -> ?F(A).\n",
    string_concat: '-module(m).\nf(A) -> "a" ++ atom_to_list(A) ++ "b".\n',
    char_list: "-module(m).\nf() -> $\\n.\n",
  }
  for (const [name, src] of Object.entries(synth)) {
    const t = parser.parse(src)
    console.log(`\n=========== ${name} (hasError=${t!.rootNode.hasError}) ===========`)
    dump(t!.rootNode, 0, Number(process.env.DEPTH ?? 6))
  }

  // 2. find real corpus sites for the rare node types
  console.log("\n################ CORPUS SITES ################")
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
  const shown = new Map<string, number>()
  for (const f of files) {
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    const t = parser.parse(content)
    const stack: any[] = [t!.rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (WANT.has(n.type)) {
        const k = `${n.type}@${n.parent?.type ?? "root"}`
        const c = shown.get(k) ?? 0
        if (c < 2) {
          shown.set(k, c + 1)
          console.log(`\n--- ${k} :: ${path.basename(f)}:${n.startPosition.row + 1}`)
          const lines = content.split("\n")
          console.log(`    text: ${lines.slice(Math.max(0, n.startPosition.row - 1), n.endPosition.row + 1).join(" \\n ").slice(0, 220)}`)
          dump(n, 0, 3, "    ")
        } else shown.set(k, c + 1)
      }
      for (let i = n.childCount - 1; i >= 0; i--) { const c = n.child(i); if (c) stack.push(c) }
    }
  }
  console.log("\nsite counts:")
  for (const [k, v] of [...shown.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`)
}

main().catch(e => { console.error(e); process.exit(1) })
