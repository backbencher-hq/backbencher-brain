// tmp-elx-adv-lens.ts — adversarial review probe (Elixir): runs the RAW
// analyzer + the differential oracle on minimal /tmp inputs, prints analyzer
// relationships (with line + callArity) and oracle edges, and applies the
// lane's exact per-file comparison semantics (label + normTarget last-segment,
// analyzer-side dedupe by label|target) so agreement/disagreement is measured,
// not assumed. Usage: bun run script/tmp-elx-adv-lens.ts [caseFilter]
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
const { deriveElixirEdges } = await import("./m14/differential")

function lastSegment(name: string): string {
  const parts = name.split(/::|\./).filter(Boolean)
  return parts[parts.length - 1] ?? name
}
function normTarget(t: string): string {
  return lastSegment(t.replace(/<.*$/, "").replace(/\[.*$/, "").trim())
}

const DIR = "/tmp/bb-elx-adv"
fs.mkdirSync(DIR, { recursive: true })
const filter = process.argv[2] ?? ""

function run(name: string, src: string) {
  if (filter && !name.includes(filter)) return
  const fp = path.join(DIR, name + ".ex")
  fs.writeFileSync(fp, src)
  const tree = parser.parse(src)
  const res: any = analyzer.analyze(tree.rootNode, src, fp)
  const truth = deriveElixirEdges(tree.rootNode)
  console.log(`\n══════════ ${name}  (${fp}) ══════════`)
  console.log("── analyzer relationships ──")
  for (const r of res.relationships) {
    const ar = r.metadata?.callArity !== undefined ? ` arity=${r.metadata.callArity}` : ""
    const x = [r.metadata?.isPipe ? " pipe" : "", r.metadata?.isCapture ? " capture" : "", r.metadata?.isStruct ? " struct" : ""].join("")
    console.log(`  [${r.type}] ${r.source} -> ${r.target} @L${r.line_number ?? "NULL"}${ar}${x} conf=${r.confidence}`)
  }
  console.log("── symbols ──")
  for (const s of res.symbols) {
    const extra = [s.metadata?.arity !== undefined ? `arity=${s.metadata.arity}` : "", s.metadata?.heads ? `heads=${s.metadata.heads}` : "", s.comments ? `doc=${JSON.stringify(String(s.comments[0]).slice(0, 40))}` : ""].filter(Boolean).join(" ")
    console.log(`  [${s.kind}] ${s.name}${s.ownerName ? ` owner=${s.ownerName}` : ""} ${extra}`)
  }
  if (res.metadata?.cyclomaticComplexity !== undefined) console.log(`  complexity=${res.metadata.cyclomaticComplexity}`)
  console.log("── oracle edges (label|from|target) ──")
  for (const e of truth) console.log(`  ${e.label} ${e.from} -> ${e.target}`)
  // lane-exact comparison (per-file)
  const LABELS = new Set(["extends", "implements", "instantiates", "overrides", "calls", "references"])
  const rels = (res.relationships as any[])
    .map((r: any) => ({ label: String(r.type ?? ""), target: String(r.target ?? ""), from: String(r.source ?? ""), line: r.line_number ?? 0, confidence: r.confidence }))
    .filter((r: any) => LABELS.has(r.label))
    .filter((r: any, i: number, arr: any[]) => { const k = r.label + "|" + r.target; return i === arr.findIndex((x: any) => (x.label + "|" + x.target) === k) })
  const missing: string[] = [], unexplained: string[] = []
  for (const te of truth) {
    if (!rels.some((r: any) => r.label === te.label && normTarget(r.target) === normTarget(te.target))) missing.push(`${te.label} ${te.from} -> ${te.target}`)
  }
  for (const r of rels) {
    if (!truth.some(te => te.label === r.label && (normTarget(te.target) === normTarget(r.target) || te.target.includes(normTarget(r.target))))) {
      unexplained.push(`${r.label} ${r.from} -> ${r.target} (L${r.line}, conf=${r.confidence})`)
    }
  }
  if (missing.length) console.log(`  !! MISSING (oracle-not-covered): ${missing.join(" | ")}`)
  if (unexplained.length) console.log(`  !! UNEXPLAINED (analyzer-not-explained): ${unexplained.join(" | ")}`)
  if (!missing.length && !unexplained.length) console.log("  gate: agree")
}

// ─── L2: pipe/thread arity — x |> f(1) invokes f/2 ────────────────────────
run("pipe-arity", `defmodule P do
  def run(x) do
    x |> f(1)
  end
  def run2(x) do
    x |> g
  end
  def run3(x) do
    x
    |> h(2)
    |> h(3)
  end
  def f(a, b), do: {a, b}
  def g(a), do: a
  def h(a, b), do: {a, b}
end
`)

// ─── L8: same-line call-site collapse — different arities, one line ───────
run("same-line-arity", `defmodule S do
  def run do
    {f(1), f(2, 3)}
  end
  defp f(a), do: a
  defp f(a, b), do: {a, b}
end
`)

// ─── L1: complexityNodes prototype pollution (toString etc.) ───────────────
run("proto-complexity", `defmodule PC do
  def toString(x), do: x
  def valueOf(x), do: x
  def constructor(x), do: x
  def run do
    toString(1) + valueOf(2) + constructor(3)
  end
end
`)
run("proto-complexity-control", `defmodule PCC do
  def to_string2(x), do: x
  def run do
    to_string2(1)
  end
end
`)

// ─── L3: quote + unquote (unquote executes) ────────────────────────────────
run("quote-unquote", `defmodule Q do
  defmacro m do
    quote do
      unquote(compute())
      unquote_splicing(list())
    end
  end
  def compute, do: 1
  def list, do: []
end
`)

// ─── L3: attributes inside quote (EX-D1 says nothing under quote) ─────────
run("quote-attrs", `defmodule QA do
  defmacro m do
    quote do
      @behaviour SomeB
      @derive SomeD
      @type t :: integer()
    end
  end
end
`)

// ─── L3/L7: @doc staged inside quote leaks to next def ─────────────────────
run("quote-doc-leak", `defmodule QD do
  defmacro m do
    quote do
      @doc "from quote"
    end
  end
  def after_macro, do: :ok
end
`)

// ─── L3: sigils — ~S interpolation is data, ~s is code ─────────────────────
run("sigils", `defmodule SG do
  def run do
    a = ~s"#{f()}"
    b = ~S"#{g()}"
    c = 'x#{h()}'
    d = """\n    #{i()}\n    """
    {a, b, c, d}
  end
  def f, do: 1
  def g, do: 2
  def h, do: 3
  def i, do: 4
end
`)

// ─── L4: __MODULE__ call target ────────────────────────────────────────────
run("module-self-call", `defmodule MS do
  def run do
    __MODULE__.helper()
  end
  def helper, do: :ok
end
`)

// ─── L4: Kernel-qualified builtins ─────────────────────────────────────────
run("kernel-qualified", `defmodule KQ do
  def run(x) do
    Kernel.is_atom(x)
    Kernel.length([1])
    is_atom(x)
  end
end
`)

// ─── L4: import :only inside a def body (function-scoped) ─────────────────
run("import-only-fn", `defmodule IF do
  def run(xs) do
    import Enum, only: [map: 2]
    map(xs, fn x -> x end)
  end
end
`)

// ─── L4/L9: alias as: + struct / use / defimpl targets ────────────────────
run("as-alias-struct", `defmodule AA do
  alias MyApp.Inner.Thing, as: T
  def run do
    %T{v: 1}
  end
end
`)
run("as-alias-use", `defmodule AB do
  alias MyApp.Inner.Audit, as: A
  use A
end
`)
run("as-alias-impl", `defmodule AC do
  alias MyApp.Inner.Proto, as: P
  alias MyApp.Inner.Impl, as: I
  defimpl P, for: I do
    def enc(_), do: :ok
  end
end
`)

// ─── L5: defdelegate — is the delegated target linked? ────────────────────
run("defdelegate", `defmodule DD do
  defdelegate fetch(id), to: Repo
end
`)

// ─── L5: defimpl for: atom target ─────────────────────────────────────────
run("defimpl-atom", `defmodule DA do
  defimpl String.Chars, for: :atom do
    def to_string(_), do: "atom"
  end
end
`)

// ─── L5: multi-clause heads + default arg ─────────────────────────────────
run("multiclause", `defmodule MC do
  def f(1), do: :one
  def f(x), do: x
  def g(a \\\\ defarg()), do: a
  def defarg, do: 9
end
`)

// ─── L3/L4: alias inside def body; alias multi-form ───────────────────────
run("alias-forms", `defmodule AF do
  def run do
    alias MyApp.Inner.Deep, as: D
    D.go()
  end
  alias MyApp.{One, Two}
  def after_aliases do
    One.go() + Two.go()
  end
end
`)

// ─── L3: keyword do:/else: bodies walked? ─────────────────────────────────
run("keyword-do", `defmodule KD do
  def run(x) do
    if x, do: yes(), else: no()
    case x do
      :a -> yes()
      _ -> no()
    end
  end
  def yes, do: 1
  def no, do: 0
end
`)

// ─── L6: lines — one-liner def + defimpl multiline + multiline alias list ──
run("lines", `defmodule LN do
  def one, do: g()
  def pipe(x) do
    x
    |> m(1)
  end
  def g, do: 1
  def m(a, b), do: {a, b}
end

defimpl Inspect, for: LN do
  def inspect(_, _), do: "LN"
end

defmodule LM do
  alias MyApp.{
    Alpha,
    Beta
  }
  def run do
    Alpha.go() + Beta.go()
  end
end
`)

// ─── L5/L4: nested defmodule + reopened module ────────────────────────────
run("nested-modules", `defmodule Outer do
  defmodule Inner do
    def go, do: helper()
    def helper, do: :inner
  end
  def call do
    Inner.go()
  end
end
`)
run("reopen", `defmodule RP do
  def a, do: :a
end

defmodule RP do
  def b, do: :b
end
`)

// ─── L3: receive/for/with/try bodies ──────────────────────────────────────
run("control-bodies", `defmodule CB do
  def run(x) do
    receive do
      {:msg, v} -> handle(v)
    after
      100 -> timeout()
    end
    for y <- gen(), z <- gen2(y), do: use2(z)
    with {:ok, v} <- fetch(x), do: use2(v)
    try do
      risky()
    rescue
      e -> handle(e)
    end
  end
  def gen, do: []
  def gen2(y), do: [y]
  def use2(z), do: z
  def fetch(x), do: {:ok, x}
  def risky, do: :ok
  def handle(v), do: v
  def timeout, do: :t
end
`)

// ─── L7: doc channel — heredoc, false, trailing comment ───────────────────
run("docs", `defmodule DC do
  @moduledoc """
  Module doc.
  """

  @doc "First."
  def a, do: :a

  # a comment, not a doc
  def b, do: :b

  @doc false
  def c, do: :c

  @doc """
  Multi
  """
  def d, do: :d
end
`)

// ─── L9: @derive LIST form — analyzer vs oracle (corpus claims 8 sites) ────
run("derive-list", `defmodule DL do\n  @derive [A, B]\n  defstruct [:x]\nend\n\ndefmodule DL2 do\n  @derive [{C, :ok}]\n  defstruct [:x]\nend\n`)

// ─── L1: A/B — complexityNodes prototype pollution (identical, one name) ──
run("proto-ab-a", `defmodule A do\n  def run, do: toString(1)\n  defp toString(x), do: x\nend\n`)
run("proto-ab-b", `defmodule B do\n  def run, do: tostr(1)\n  defp tostr(x), do: x\nend\n`)

console.log("\ndone")
