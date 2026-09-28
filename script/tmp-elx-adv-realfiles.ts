// tmp-elx-adv-realfiles.ts — measured outputs on REAL corpus files for the
// adversarial findings (quote-attribute leaks, Kernel-qualified, __MODULE__,
// unquote calls, defdelegate, docs). Usage: bun run script/tmp-elx-adv-realfiles.ts
import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm")))
const parser = new ParserClass()
parser.setLanguage(g)
const mod: any = await import("../src/ast/real-elixir-analyzer")
const analyzer = new mod.RealElixirAnalyzer()

const E = "$HOME/fixtures/repositories/elixir"
const P = "$HOME/fixtures/repositories/phoenix"

const kids = (n: any): any[] => { const r: any[] = []; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) r.push(c) } return r }
const find = (n: any, pred: (c: any) => boolean): any => { for (const c of kids(n)) if (pred(c)) return c; return undefined }
const callTarget = (n: any): string => find(n, (c: any) => c.type === "identifier" || c.type === "dot")?.text ?? ""

const SPECIAL = new Set(["if", "unless", "case", "cond", "receive", "for", "with", "try", "rescue", "catch", "after", "else", "quote", "unquote", "super", "raise", "throw", "exit", "fn", "do", "match"])
const KERNEL = new Set(["length", "hd", "tl", "elem", "put_elem", "map_size", "tuple_size", "byte_size", "bit_size", "div", "rem", "abs", "round", "trunc", "ceil", "floor", "min", "max", "is_atom", "is_binary", "is_bitstring", "is_boolean", "is_float", "is_function", "is_integer", "is_list", "is_map", "is_map_key", "is_number", "is_pid", "is_port", "is_reference", "is_tuple", "is_nil", "is_struct", "is_exception", "map_get", "to_string", "inspect", "apply", "self", "send", "send_after", "spawn", "spawn_link", "spawn_monitor", "make_ref", "node", "put_in", "get_in", "update_in", "get_and_update_in", "pop_in", "struct", "struct!", "binary_part", "binding", "tap", "then", "dbg", "tuple_to_list", "list_to_tuple", "atom_to_binary", "binary_to_atom", "term_to_binary", "binary_to_term", "process_flag", "sleep", "yield", "match?", "function_exported?", "macro_exported?", "reraise"])

interface InQuote { line: number; kind: string; detail: string }
// Ancestry-based: everything under a quote-headed call (excluding the quote call itself).
function collectInQuote(root: any): InQuote[] {
  const out: InQuote[] = []
  const walk = (n: any, depth: number) => {
    if (n.type === "call" && callTarget(n) === "quote") {
      // scan children at depth+1
      for (const c of kids(n)) walk(c, depth + 1)
      return
    }
    if (depth > 0) {
      if (n.type === "call") {
        const t = callTarget(n)
        if (t && !SPECIAL.has(t) && !KERNEL.has(t)) out.push({ line: n.startPosition.row + 1, kind: "call", detail: t })
      }
      if (n.type === "unary_operator" && n.childCount > 0 && n.child(0)?.text === "@") {
        const attrCall = n.child(1)
        const an = attrCall?.type === "call" ? callTarget(attrCall) : ""
        if (an) out.push({ line: n.startPosition.row + 1, kind: `attr:${an}`, detail: (attrCall.text ?? "").slice(0, 60) })
      }
    }
    for (const c of kids(n)) walk(c, depth)
  }
  walk(root, 0)
  return out
}

function probe(label: string, fp: string, opts: { lines?: number[]; grepTargets?: string[]; showSymbols?: string[] } = {}) {
  const src = fs.readFileSync(fp, "utf8")
  const tree = parser.parse(src)
  const res: any = analyzer.analyze(tree.rootNode, src, fp)
  const iq = collectInQuote(tree.rootNode)
  // What the analyzer emitted whose LINE+target matches an in-quote construct
  const iqCalls = iq.filter((x) => x.kind === "call")
  const iqAttrs = iq.filter((x) => x.kind.startsWith("attr:"))
  const emittedInQuote = res.relationships.filter((r: any) => {
    const L = r.line_number ?? 0
    if (iqAttrs.some((x) => x.line === L && (x.kind === "attr:behaviour" || x.kind === "attr:behavior" || x.kind === "attr:derive" || x.kind === "attr:type" || x.kind === "attr:moduledoc" || x.kind === "attr:doc"))) return true
    if (r.type === "calls" && iqCalls.some((x) => x.line === L && (x.detail === r.target || r.target.endsWith("?")))) return true
    return false
  })
  console.log(`\n══════════ ${label} (${fp.replace(/^.*repositories\//, "")}) ══════════`)
  console.log(`in-quote emitting constructs: ${iq.length}`)
  for (const x of iq.slice(0, 40)) console.log(`   qi L${x.line} ${x.kind} :: ${x.detail}`)
  console.log(`── analyzer edges emitted from in-quote constructs ──`)
  for (const r of emittedInQuote) {
    const L = r.line_number ?? 0
    const srcLine = L > 0 ? (src.split("\n")[L - 1] ?? "").trim().slice(0, 95) : ""
    console.log(`  [${r.type}] ${r.source} -> ${r.target} @L${L}${r.metadata?.callArity !== undefined ? ` arity=${r.metadata.callArity}` : ""}`)
    console.log(`        | ${srcLine}`)
  }
  console.log("── symbols of interest ──")
  for (const s of res.symbols) {
    if (s.kind === "function" || s.kind === "module") continue
    const doc = s.comments ? ` doc=${JSON.stringify(String(s.comments[0]).slice(0, 50))}` : ""
    console.log(`  [${s.kind}] ${s.name} owner=${s.ownerName ?? "-"} L${s.range?.startLine}${doc}`)
  }
  if (opts.showSymbols) {
    console.log("── named symbols (docs / lines) ──")
    for (const s of res.symbols) {
      if (!opts.showSymbols.includes(s.name)) continue
      const doc = s.comments ? ` doc=${JSON.stringify(String(s.comments[0]).slice(0, 60))}` : ""
      console.log(`  [${s.kind}] ${s.name} L${s.range?.startLine}${doc}`)
    }
  }
}

// 1. @behaviour inside quote — application.ex (elixir), presence.ex (phoenix)
probe("@behaviour-in-quote (elixir application.ex)", `${E}/lib/elixir/lib/application.ex`)
probe("@behaviour-in-quote (phoenix presence.ex)", `${P}/lib/phoenix/presence.ex`)
// 2. @doc inside quote — gen_event.ex (6 sites)
probe("@doc-in-quote (gen_event.ex)", `${E}/lib/elixir/lib/gen_event.ex`, { showSymbols: ["init", "start_link", "add_handler", "call", "cast"] })
// 3. @type inside quote — protocol.ex
probe("@type-in-quote (protocol.ex)", `${E}/lib/elixir/lib/protocol.ex`, { showSymbols: ["t", "protocol", "impl_for"] })
// 4. Kernel-qualified builtins
probe("Kernel.length (string.ex)", `${E}/lib/elixir/lib/string.ex`)
// 5. __MODULE__ call
probe("__MODULE__ call (mix.ex)", `${E}/lib/mix/lib/mix.ex`)
probe("__MODULE__ call (logger.ex)", `${P}/lib/phoenix/logger.ex`)
// 6. unquote with calls
probe("unquote calls (generator.ex)", `${E}/lib/mix/lib/mix/generator.ex`)
probe("unquote calls (router/helpers.ex)", `${P}/lib/phoenix/router/helpers.ex`)
// 7. defdelegate
probe("defdelegate (project.ex)", `${E}/lib/mix/lib/mix/project.ex`)

// 8. determinism: same file twice → identical relationship sets AND order
{
  const fp = `${E}/lib/elixir/lib/gen_server.ex`
  const src = fs.readFileSync(fp, "utf8")
  const a = analyzer.analyze(parser.parse(src).rootNode, src, fp)
  const b = analyzer.analyze(parser.parse(src).rootNode, src, fp)
  const sa = JSON.stringify(a.relationships)
  const sb = JSON.stringify(b.relationships)
  console.log(`\n determinism check (gen_server.ex): edges=${a.relationships.length} identical-and-same-order=${sa === sb}`)
  const symStr = JSON.stringify(a.symbols) === JSON.stringify(b.symbols)
  console.log(` determinism symbols identical=${symStr}`)
}
console.log("\ndone")
