// tmp-ex2-verify.ts — EX2 verification probe (user-found issues U1–U7 +
// sibling-language expansion spot-checks + performance baseline).
// Runs the RAW analyzer (below the pool-worker mapping) so `comments`,
// `exports` and metadata are visible — the FileResult hides them.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

const parserCache = new Map<string, any>()
async function getParser(wasm: string): Promise<any> {
  if (parserCache.has(wasm)) return parserCache.get(wasm)
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", wasm)))
  const p = new ParserClass()
  p.setLanguage(grammar)
  parserCache.set(wasm, p)
  return p
}
async function getAnalyzer(file: string, cls: string): Promise<any> {
  const m: any = await import(`../src/ast/${file}`)
  return new m[cls]()
}

const DIR = "/tmp/bb-ex2"
fs.mkdirSync(DIR, { recursive: true })

function runElixir(name: string, src: string, p: any, a: any): any {
  const fp = path.join(DIR, name)
  fs.writeFileSync(fp, src)
  const tree = p.parse(src)
  return a.analyze(tree.rootNode, src, fp)
}
function report(label: string, res: any) {
  console.log(`\n### ${label}`)
  console.log("SYMBOLS:")
  for (const s of res.symbols) {
    const doc = s.comments ? ` doc=${JSON.stringify(String(s.comments[0]).trim())}` : ""
    console.log(`  [${s.kind}] ${s.name} owner=${s.ownerName ?? "-"} cplx=${s.complexity ?? "-"}${doc}`)
  }
  console.log("RELATIONSHIPS:")
  for (const r of res.relationships) {
    console.log(`  ${r.source} -[${r.type}]-> ${r.target}  line=${r.line_number ?? "NULL"}`)
  }
  console.log(`PATTERNS: ${JSON.stringify(res.metadata?.patterns ?? [])}`)
  console.log(`FRAMEWORKS: ${JSON.stringify(res.metadata?.detectedFrameworks ?? [])}`)
  console.log(`IMPORTS: ${(res.imports ?? []).map((i: any) => i.module).join(", ")}`)
}

const ep = await getParser("tree-sitter-elixir.wasm")
const ea = await getAnalyzer("real-elixir-analyzer", "RealElixirAnalyzer")

// ── U1: alias resolution — every type-name site except recordCall ────────────
const U1 = `defmodule MyApp.OrderBook do
  defstruct [:id]
end

defmodule MyApp.Audit do
  def check(_), do: :ok
end

defmodule MyApp.Encodable do
  def enc(_), do: :ok
end

defmodule MyApp.Thing do
  defstruct [:v]
end

defmodule AliasCases do
  alias MyApp.OrderBook
  alias MyApp.Audit

  @behaviour Audit

  def build do
    %OrderBook{id: 1}
    struct(OrderBook, id: 2)
    OrderBook.build()
  end
end

defmodule AliasDerive do
  alias MyApp.Encodable
  @derive Encodable
  defstruct [:a]
end

defmodule AliasImpl do
  alias MyApp.Encodable
  alias MyApp.Thing
  defimpl Encodable, for: Thing do
    def enc(_), do: :ok
  end
end

defmodule AliasUse do
  alias MyApp.Audit
  use Audit
end
`
report("U1 aliases (expect MyApp.* targets; actual raw short names?)", runElixir("u1.ex", U1, ep, ea))

// ── U2: bare function scope names collide across modules ─────────────────────
const U2 = `defmodule CollA do
  def run, do: common()
  defp common, do: :a
end

defmodule CollB do
  def run, do: common()
  defp common, do: :b
end
`
report("U2 scope collision (expect 2 edges run->common; actual 1 deduped?)", runElixir("u2.ex", U2, ep, ea))

// ── U3: GenServer/Supervisor substring vs ELXD9 root-segment ────────────────
report("U3a fake Supervisor (expect NO patterns)", runElixir("u3a.ex", `defmodule FakeSup do\n  use MyApp.SupervisorTree\nend\n`, ep, ea))
report("U3b fake GenServer (expect NO patterns)", runElixir("u3b.ex", `defmodule FakeGs do\n  use MyApp.GenServerPool\nend\n`, ep, ea))
report("U3c real OTP (expect both patterns)", runElixir("u3c.ex", `defmodule RealOtp do\n  use Supervisor\n  use GenServer\nend\n`, ep, ea))

// ── U4: parameterized @type declarations ────────────────────────────────────
const U4 = `defmodule Types do
  @type plain :: integer()
  @type t(a) :: {:ok, a}
  @typep pt(b) :: b
  @opaque o(c) :: c
end
`
report("U4 parameterized types (expect 4 Type symbols; actual plain only?)", runElixir("u4.ex", U4, ep, ea))

// ── U5: function-scoped import resolution ───────────────────────────────────
const U5fun = `defmodule ImpFun do
  def run do
    import Enum, only: [map: 2]
    map([1], &(&1 + 1))
  end
end
`
const U5mod = `defmodule ImpMod do
  import Enum, only: [map: 2]
  def run, do: map([1], &(&1 + 1))
end
`
report("U5a import inside def (expect target Enum.map; actual dropped?)", runElixir("u5a.ex", U5fun, ep, ea))
report("U5b import at module level CONTROL (expect Enum.map)", runElixir("u5b.ex", U5mod, ep, ea))

// ── U6: default-argument calls swallowed by isDefHead ───────────────────────
const U6 = `defmodule DefaultsRemote do
  def fetch(url, opts \\\\ Builder.build_opts()) do
    request(url, opts)
  end
  defp request(_u, _o), do: :ok
end

defmodule DefaultsLocal do
  def fetch(url, opts \\\\ build_opts()) do
    request(url, opts)
  end
  defp build_opts, do: []
  defp request(_u, _o), do: :ok
end
`
report("U6 default-arg calls (expect Builder.build_opts + build_opts; actual none?)", runElixir("u6.ex", U6, ep, ea))

// ── U7: sigil-based docs ────────────────────────────────────────────────────
const U7 = `defmodule DocSig do
  @moduledoc ~S"""
  Module sigil docs.
  """

  @doc ~s(Inline sigil doc)
  def f, do: :ok
end

defmodule DocCtl do
  @moduledoc """
  Module string docs.
  """

  @doc "Plain doc"
  def g, do: :ok
end
`
report("U7 sigil docs (expect all 4 docs; actual sigils lost?)", runElixir("u7.ex", U7, ep, ea))

// ── Expansion spot-checks: sibling languages ────────────────────────────────
async function sib(lang: string, wasm: string, file: string, cls: string, code: string) {
  const p = await getParser(wasm)
  const a = await getAnalyzer(file, cls)
  const fp = path.join(DIR, `${lang}-probe${path.extname(file) === ".ts" ? "" : ""}`)
  const ext = { python: ".py", kotlin: ".kt", ruby: ".rb", scala: ".scala", csharp: ".cs", php: ".php" }[lang] || ".txt"
  const real = path.join(DIR, `sib-${lang}${ext}`)
  fs.writeFileSync(real, code)
  const res: any = a.analyze(p.parse(code).rootNode, code, real)
  console.log(`\n### SIBLING: ${lang}`)
  console.log("RELATIONSHIPS:")
  for (const r of res.relationships) console.log(`  ${r.source} -[${r.type}]-> ${r.target} line=${r.line_number ?? "NULL"}`)
  console.log(`IMPORTS: ${(res.imports ?? []).map((i: any) => i.module ?? i.path).join(", ")}`)
  void fp
}

await sib("python", "tree-sitter-python.wasm", "real-python-analyzer", "RealPythonAnalyzer", `def fetch(x=compute()):
    import math
    return math.sqrt(x)

def compute():
    return 1
`)
await sib("kotlin", "tree-sitter-kotlin.wasm", "real-kotlin-analyzer", "RealKotlinAnalyzer", `fun fetch(x: Int = compute()): Int {
    return x
}
fun compute(): Int = 1
`)
await sib("ruby", "tree-sitter-ruby.wasm", "real-ruby-analyzer", "RealRubyAnalyzer", `def fetch(x = compute)
  helper(x)
end

def compute
  1
end
`)
await sib("scala", "tree-sitter-scala.wasm", "real-scala-analyzer", "RealScalaAnalyzer", `object A {
  def run: Int = {
    import scala.math.max
    max(1, 2)
  }
}
`)
await sib("csharp", "tree-sitter-c_sharp.wasm", "real-csharp-analyzer", "RealCSharpAnalyzer", `using Alias = My.Namespace.Type;
class C { void M() { var x = new Alias(); } }
`)
await sib("php", "tree-sitter-php.wasm", "real-php-analyzer", "RealPhpAnalyzer", `<?php
use My\\Space\\Thing as Alias;
$t = new Alias();
`)

// ── Performance baseline: 60 real phoenix files ─────────────────────────────
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === "_build" || e.name === "deps" || e.name === ".git") continue
      walk(p, acc)
    } else if (e.name.endsWith(".ex") || e.name.endsWith(".exs")) acc.push(p)
  }
  return acc
}
const files = walk("$HOME/fixtures/repositories/phoenix").slice(0, 60)
let syms = 0, rels = 0, lines = 0
const t0 = performance.now()
for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  const res: any = ea.analyze(ep.parse(src).rootNode, src, f)
  syms += res.symbols.length
  rels += res.relationships.length
  lines += src.split("\n").length
}
const t1 = performance.now()
console.log(`\n### PERF baseline: ${files.length} phoenix files (${lines} lines) in ${(t1 - t0).toFixed(0)}ms = ${((t1 - t0) / files.length).toFixed(1)} ms/file; ${syms} symbols, ${rels} relationships`)

process.exit(0)
