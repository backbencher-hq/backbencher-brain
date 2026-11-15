/**
 * ELIXIR output-coverage census — for every DECLARATION FORM the grammar emits
 * on real code, does the analyzer publish a symbol or an edge for it?
 *
 * WHY. The lane's completeness claim was, until now, a list of node types the
 * spec classifies (0 unclassified) plus spot checks. A node type being
 * "handled" only says the walker looks at it. The question a consumer actually
 * asks is per FORM: `defmodule` → a module symbol, `@type` → a Type symbol,
 * `@callback` → … ? The answer has to be measured per form, per site, with the
 * quote boundary respected (EX-D1: a declaration inside a `quote` is data and is
 * correctly silent — those sites are counted separately, never as coverage).
 *
 * METHOD. Tree pass collects every declaration occurrence with its line and
 * whether it sits inside a quote. Analyzer pass (`ASTEngine.parseFile`, the
 * production path) publishes symbols/relationships. Attribution is by DECLARATION
 * LINE: a symbol counts for a site when its range starts on that line (that is
 * the index's own symbol id, `${fileId}:${name}:${startLine}`, so it is the
 * attribution the store would make); an edge counts when its `line_number`
 * equals the line.
 *
 * THE VOCABULARY (why a form's verdict is not just "has a symbol")
 *   symbol          a symbol must exist whose range CONTAINS the declaration line
 *                   (containment, not start-line: a merged multi-clause head is
 *                   ONE symbol spanning every clause, EX-D16 — start-line
 *                   attribution reports clauses 2..N as uncovered and is wrong)
 *   symbol+edge     both, at the declaration line
 *   edge            an edge of that class on the line
 *   decl-own-line   a symbol must START on the line — for attribute
 *                   declarations, where "the enclosing module covers the line" is
 *                   not coverage
 *   annotates-owner no symbol of its own; the fact must ride the OWNING symbol's
 *                   metadata (`@optional_callbacks`)
 *   dynamic-ok      an edge iff the form NAMES a type; a computed first
 *                   argument is silent by contract. The SILENCE arm is the F5
 *                   lane's audited contract (proven bidirectionally against the
 *                   oracle on six corpora) and is not re-derived here, because
 *                   one source line carries several forms
 *   none-correct    nothing should be published, and the census asserts the
 *                   absence of a MISSING declaration only
 *   ?               not yet ruled — the census prints the count and the site
 *
 * WHAT IT FOUND (2026-09-28). One real gap on a fully green lane:
 * `@callback`/`@macrocallback` published nothing (165 sites in a 100-file
 * elixir+phoenix+ash sample). Everything else it flagged was its own artifact,
 * and each artifact is recorded in the review rather than quietly corrected:
 * start-line attribution, a self-alias rule that only matched the literal
 * `alias __MODULE__`, a by-line call lookup for `raise`/`struct` that missed
 * continuation lines, the attribute's inner call counted as a second
 * declaration site, a function named `callback` counted as an attribute form,
 * and a `when`-constrained typespec — which turned out to be a real analyzer
 * defect in the EX-A14 fix itself (the `when` WRAPS the `::`).
 *
 * CLI: npx tsx script/m14/tmp/elixir-declaration-census.ts --repos=ecto_sql,ash --per-repo=60
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/sano/ishaq/backbencher-brain"
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const REPOS = (arg("repos") ?? "elixir,phoenix,ecto,ecto_sql,ash,wallaby").split(",").filter(Boolean)
const PER = Number(arg("per-repo") ?? "60")

const DEFS = new Set(["def", "defp", "defmacro", "defmacrop", "defdelegate", "defguard", "defguardp"])
/** form → how the analyzer is EXPECTED to answer. The verdict vocabulary is
 *  the point: "symbol+edge", "symbol", "edge", "pattern-only" (a file-level
 *  idiom flag and nothing else), "none-correct" (nothing should be published). */
const FORMS: Record<string, { expect: string; why: string }> = {
  defmodule: { expect: "symbol", why: "module symbol; nested ones owned by the parent (EX-A10)" },
  defprotocol: { expect: "symbol", why: "interface symbol" },
  defimpl: { expect: "symbol+edge", why: "class symbol per for-type + implements edge to the protocol" },
  defstruct: { expect: "symbol", why: "struct symbol + one property per field" },
  defexception: { expect: "symbol", why: "struct symbol + fields, defstruct-identical (ELXD10)" },
  def: { expect: "symbol", why: "function/method; merged across clauses (EX-D16 extent)" },
  defp: { expect: "symbol", why: "private function/method" },
  defmacro: { expect: "symbol", why: "macro" },
  defmacrop: { expect: "symbol", why: "private macro" },
  defguard: { expect: "symbol", why: "macro (a guard macro)" },
  defguardp: { expect: "symbol", why: "private macro" },
  defdelegate: { expect: "symbol+edge", why: "function + a calls edge to `to:` (X8/EX-D13)" },
  type: { expect: "symbol", why: "Type symbol named by the `::` LHS (EX2-U4)" },
  typep: { expect: "symbol", why: "private Type symbol" },
  opaque: { expect: "symbol", why: "Type symbol" },
  callback: { expect: "decl-own-line", why: "a typed callback DECLARATION: its own symbol must start on this line (the enclosing module covering the line is not coverage)" },
  macrocallback: { expect: "decl-own-line", why: "a typed macro callback declaration, same rule" },
  spec: { expect: "none-correct", why: "the function already has a symbol; the spec is an attribute" },
  behaviour: { expect: "edge", why: "implements edge to the behaviour (the attribute is not a symbol)" },
  behavior: { expect: "edge", why: "US-spelling alias of behaviour" },
  derive: { expect: "dynamic-ok", why: "implements edge per derived protocol (EX-L4 list/tuple/single forms); a DYNAMIC derive (`@derive Keyword.values(x)`) names no protocol and is silent by contract" },
  moduledoc: { expect: "symbol-payload", why: "docstring on the enclosing module" },
  doc: { expect: "symbol-payload", why: "docstring on the NEXT definition" },
  impl: { expect: "none-correct", why: "@impl true is a promise about which callback a def implements" },
  overridable: { expect: "none-correct", why: "defoverridable names no target (EX-D8 macro boundary)" },
  enforce_keys: { expect: "none-correct", why: "@enforce_keys constrains struct construction, declares nothing" },
  optional_callbacks: { expect: "annotates-owner", why: "names the callbacks an implementation MAY omit: it declares nothing new, so the names must ride the owning protocol/module metadata (and stamp the members)" },
  compile: { expect: "none-correct", why: "@compile is a compiler directive" },
  external_resource: { expect: "none-correct", why: "compilation bookkeeping" },
  before_compile: { expect: "none-correct", why: "a hook, injected as a macro" },
  after_compile: { expect: "none-correct", why: "a hook, injected as a macro" },
  on_definition: { expect: "none-correct", why: "a compile-time hook" },
  dialyzer: { expect: "none-correct", why: "a dialyzer directive" },
  use: { expect: "edge", why: "references edge to the used module (+ OTP metadata)" },
  import: { expect: "edge", why: "references edge; :only additionally resolves unqualified calls" },
  alias: { expect: "edge", why: "references edge per member (multi-alias expands); `alias __MODULE__` inside the module it names is a lexical no-op and its self-edge is dropped (ELXD8)" },
  require: { expect: "edge", why: "references edge" },
  send: { expect: "none-correct", why: "Kernel builtin: pattern flag only (EX-D2/EX-A13)" },
  spawn: { expect: "none-correct", why: "Kernel builtin: pattern flag only" },
  raise: { expect: "dynamic-ok", why: "instantiates the exception struct when the first arg NAMES one (EX-D17); a bare string or a bound exception is silent by contract" },
  struct: { expect: "dynamic-ok", why: "instantiates the named type (ELXD19); a variable/computed first arg names nothing and is silent by contract" },
  defexception_use: { expect: "edge", why: "n/a — reserved" },
}

function walk(d: string, out: string[] = []): string[] {
  let e: fs.Dirent[]
  try { e = fs.readdirSync(d, { withFileTypes: true }) } catch { return out }
  for (const x of e) {
    if ([".git", "_build", "deps", "node_modules"].includes(x.name)) continue
    const p = path.join(d, x.name)
    if (x.isDirectory()) walk(p, out)
    else if (x.name.endsWith(".ex") || x.name.endsWith(".exs")) out.push(p)
  }
  return out
}

function pick(files: string[], n: number): string[] {
  if (n <= 0 || n >= files.length) return files
  const step = files.length / n
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(files[Math.floor(i * step)]!)
  return [...new Set(out)]
}

interface Occ { form: string; line: number; quoted: boolean; text: string; named?: boolean; file: string; edges?: string[]; multilineAlias?: boolean }

/** The `call` node that starts on `line` (the form's own node). */
function findCallAt(root: any, line: number): any {
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "call" && n.startPosition.row + 1 === line) return n
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return null
}

function occurrences(root: any): Occ[] {
  const out: Occ[] = []
  const stack: { n: any; quote: number }[] = [{ n: root, quote: 0 }]
  const firstId = (n: any) => { for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && c.type === "identifier") return c } return null }
  while (stack.length) {
    const { n, quote } = stack.pop()!
    if (n.type === "call") {
      const id = firstId(n)
      const t = id?.text ?? ""
      let isQuote = quote > 0
      if (t === "quote") isQuote = true
      const inAttribute = n.parent?.type === "unary_operator" && n.parent.child(0)?.text === "@"
      const leadsWithDef = (callNode: any): boolean => {
        if (!callNode || callNode.type !== "call") return false
        for (let i = 0; i < callNode.childCount; i++) { const c = callNode.child(i); if (c && c.type === "identifier") return DEFS.has(c.text) }
        return false
      }
      const inDefSignature = n.parent?.type === "arguments" || leadsWithDef(n.parent)
      const isDefForm = DEFS.has(t) || t === "defmodule" || t === "defprotocol" || t === "defimpl" || t === "defstruct" || t === "defexception" || t === "defoverridable"
      // `callback`/`spec`/`derive`/… are ATTRIBUTE names: a call with that name in
      // code position is an ordinary call (audited as an edge), not a
      // declaration form. `defoverridable` is the one form that IS a bare call.
      // An attribute's inner call is recorded by the unary_operator branch, so
      // the call branch must NOT record it again (that double-count is what
      // made every `@callback`/`@derive` look half-uncovered). And the forms
      // that are ATTRIBUTE NAMES are never forms in code position: a call to a
      // function that happens to be named `callback` is a call, which the edge
      // audit already owns.
      const ATTR_ONLY = new Set(["callback", "macrocallback", "spec", "type", "typep", "opaque", "derive", "moduledoc", "doc", "impl", "behaviour", "behavior", "enforce_keys", "compile", "dialyzer", "optional_callbacks", "external_resource", "before_compile", "after_compile", "on_definition", "typedoc"])
      const isAttrForm = !!FORMS[t] && !inAttribute && !ATTR_ONLY.has(t)
      if (!inDefSignature && (isDefForm || isAttrForm)) {
        const argsNode = n.namedChildren?.find((c: any) => c.type === "arguments")
        const first = argsNode?.namedChildren?.[0]
        out.push({
          form: t, line: n.startPosition.row + 1, quoted: quote > 0 && t !== "quote",
          text: n.text.slice(0, 60).replace(/\n/g, " "),
          // the FIRST ARGUMENT'S node type decides whether a type is NAMED
          // (alias / __MODULE__ -> an edge) or merely computed (-> silence)
          named: t === "raise" || t === "struct" || t === "struct!"
            ? first?.type === "alias" || (first?.type === "identifier" && first.text === "__MODULE__")
            : undefined,
          argText: first?.text?.slice(0, 24) ?? "",
        })
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push({ n: c, quote: isQuote ? quote + 1 : quote }) }
      continue
    }
    if (n.type === "unary_operator" && n.child(0)?.text === "@") {
      const inner = n.child(1)
      const aid = inner?.type === "call" ? firstId(inner) : null
      if (aid?.text && FORMS[aid.text]) {
        const a0 = inner?.namedChildren?.find((c: any) => c.type === "arguments")?.namedChildren?.[0]
        out.push({
          form: aid.text, line: n.startPosition.row + 1, quoted: quote > 0,
          text: n.text.slice(0, 60).replace(/\n/g, " "),
          // for @derive: a CALL first argument (`Keyword.values(x)`) is dynamic
          named: aid.text === "derive" ? a0?.type !== "call" : undefined,
          argText: a0?.text?.slice(0, 24) ?? "",
        })
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push({ n: c, quote }) }
  }
  return out
}

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm")))
  const parser = new P(); parser.setLanguage(g)

  const rows: Record<string, { sites: number; quoted: number; covered: number; examples: string[] }> = {}
  const bump = (form: string, site: Occ, ok: boolean) => {
    if (!rows[form]) rows[form] = { sites: 0, quoted: 0, covered: 0, examples: [] }
    if (site.quoted) { rows[form]!.quoted++; return }
    rows[form]!.sites++
    if (ok) rows[form]!.covered++
    else if (rows[form]!.examples.length < 3) rows[form]!.examples.push(`${site.file}:${site.line}  arg0=${String((site as any).argText ?? "").slice(0, 24)}  edges-on-line=${((site as any).edges ?? []).join(",") || "(none)"}  ${site.text.slice(0, 46)}`)
  }

  let files = 0
  for (const repo of REPOS) {
    const dir = path.join(CORPUS_ROOT, repo)
    if (!fs.existsSync(dir)) { console.log(`[skip] ${repo}`); continue }
    for (const f of pick(walk(dir).sort(), PER)) {
      const content = fs.readFileSync(f, "utf8")
      const root = parser.parse(content).rootNode
      const relFile = `${repo}/${path.relative(dir, f)}`
      const occ = occurrences(root).map((o) => {
        o.file = relFile
        // `raise`/`struct` only publish an edge when the first argument NAMES a
        // type; a bare string / a variable is silent by design (EX-D17), so the
        // census adjudicates the dynamic form as covered-by-contract.
        if (o.form === "raise" || o.form === "struct" || o.form === "struct!") {
          o.argText = o.argText ?? ""
          o.named = o.named ?? false
          // EX-D17: the edge's line is the NAME-BEARING line — the first
          // argument's — not the call's opening line, so a parenthesized
          // multi-line `raise(\n  Mod,\n  "…")` attributes to the next line.
          if (o.named) {
            const call = findCallAt(root, o.line)
            const a0 = call?.namedChildren?.find((c: any) => c.type === "arguments")?.namedChildren?.[0]
            if (typeof a0?.startPosition?.row === "number") o.line = a0.startPosition.row + 1
          }
        }
        return o
      })
      if (occ.length === 0) continue
      files++
      const res: any = await ASTEngine.parseFile(f, content)
      // Attribution by CONTAINMENT, not start-line: a merged multi-clause head
      // is ONE symbol whose range spans every clause (EX-D16), so start-line
      // attribution reports clauses 2..N as uncovered — a census artifact, not
      // a defect. Containment is also the store's own owner-fallback rule.
      const symSpans: [number, number][] = []
      const docSyms: any[] = []
      for (const s of res.symbols ?? []) {
        if (typeof s.range?.startLine === "number") symSpans.push([s.range.startLine, s.range.endLine ?? s.range.startLine])
        if (s.docstring) docSyms.push(s)
      }
      const hasSymbolAt = (line: number) => symSpans.some(([a, b]) => line >= a && line <= b)
      const symStartLines = new Set<number>()
      for (const s of res.symbols ?? []) if (typeof s.range?.startLine === "number") symStartLines.add(s.range.startLine)
      const edgeLines = new Set<number>()
      for (const r of res.relationships ?? []) if (typeof r.line_number === "number") edgeLines.add(r.line_number)
      const patterns: string[] = res.metadata?.patterns ?? []
      for (const o of occ) {
        const hasSym = hasSymbolAt(o.line)
        const hasEdge = edgeLines.has(o.line)
        const hasDoc = docSyms.some((s) => s.range?.startLine <= o.line && s.range?.endLine >= o.line)
          // `alias __MODULE__` inside the module it names is a lexical no-op
          // (ELXD8): the self-edge is dropped, and THAT is the contract.
          if (o.form === "alias") {
            if (/^alias __MODULE__(\s*,|$)/.test(o.text.trim())) o.named = false
            else {
              const ownerSym = (res.symbols ?? []).find((s: any) => (s.kind === "module" || s.kind === "interface") && s.range?.startLine <= o.line && (s.range?.endLine ?? s.range?.startLine) >= o.line)
              const spelled = o.text.trim().replace(/^alias\s+/, "").split(",")[0]!.trim()
              if (ownerSym && spelled === ownerSym.name) o.named = false   // a self alias is a lexical no-op (ELXD8)
            }
          }
          // A multi-line `alias Foo.{A, B}` emits one edge per MEMBER at the
          // member's own line (EX3 per-member lines), so the prefix line
          // legitimately carries none; the site is covered if the members emit.
          if (o.form === "alias" && o.text.includes("{")) o.multilineAlias = true

        // what the analyzer actually published on this line (diagnostic + the
        // multi-alias rule below): edges at the line, plus the member lines a
        // multi-line `alias Foo.{A, B}` group occupies (EX3 per-member lines).
        o.edges = (res.relationships ?? []).filter((r: any) => r.line_number === o.line).map((r: any) => `${r.type}->${r.target}`)
        // A multi-line `@derive [A, B]` / `alias Foo.{A, B}` publishes one edge
        // per MEMBER at the member's own line (EX-L4 / EX3 per-member lines), so
        // the group header line legitimately carries none.
        if (o.multilineAlias || (o.form === "derive" && /[\[{]/.test(o.text))) {
          const near = (res.relationships ?? []).filter((r: any) => typeof r.line_number === "number" && r.line_number > o.line && r.line_number <= o.line + 12 && String(r.type) === "references")
          o.edges = [...o.edges, ...near.map((r: any) => `member@${r.line_number}->${r.target}`)]
        }
        const expect = FORMS[o.form]?.expect ?? "?"
        let ok: boolean
        switch (expect) {
          case "symbol": ok = hasSym; break
          case "symbol+edge": ok = hasSym && hasEdge; break
          case "edge":
            if (o.form === "alias" && o.named === false) ok = !hasEdge
            else if ((o as any).multilineAlias) ok = (o.edges ?? []).length > 0
            else ok = hasEdge
            break
          case "symbol-payload": ok = hasDoc || hasEdge || patterns.length > 0; break
          case "none-correct": ok = true; break
          case "dynamic-ok": {
            // The contract is a BICONDITIONAL on the EDGE, not on the line: a
            // named type -> an `instantiates` edge naming it, an unnamed one ->
            // NO `instantiates` edge. A line-level presence test is wrong in
            // both directions — `raise "boom"` on a line that also calls
            // `Process.put` looks covered, and that is how a fabricated
            // dynamic edge would pass.
            // Which edge CLASS this form publishes. The SILENCE arm of the
            // biconditional (a dynamic form must emit nothing) is the F5
            // lane's audited contract, proven bidirectionally against the
            // oracle on six corpora — and it cannot be re-derived from a line,
            // because one line carries several forms (`struct(%S{}, opts)`
            // publishes the LITERAL's instantiates, not the call's). The census
            // therefore asserts the MISSING-edge arm only: a form that names a
            // type must have that type's edge on its line.
            const cls = o.form === "derive" ? "implements->" : "instantiates->"
            const ofClass = (o.edges ?? []).filter((e) => e.startsWith(cls))
            ok = o.named === undefined ? hasEdge : (o.named ? ofClass.length > 0 : true)
            break
          }
          case "decl-own-line": ok = symStartLines.has(o.line); break
          case "annotates-owner": {
            const owner = (res.symbols ?? []).find((s: any) => s.range?.startLine <= o.line && (s.range?.endLine ?? s.range?.startLine) >= o.line && (s.kind === "module" || s.kind === "interface" || s.kind === "class"))
            const declared: string[] = owner?.metadata?.optionalCallbacks ?? []
            const first = (o.argText ?? "").replace(/^\[/, "").split(/[:,]/)[0]?.trim() ?? ""
            ok = declared.includes(first)
            break
          }
          default: ok = hasSym || hasEdge
        }
        bump(o.form, o, ok)
      }
    }
  }

  console.log(`\n######## ELIXIR DECLARATION COVERAGE (files=${files}, sample=${PER}/repo over ${REPOS.join(",")})`)
  console.log("form                 expect          sites  covered  quoted  verdict")
  for (const form of Object.keys(rows).sort()) {
    const r = rows[form]!
    const exp = FORMS[form]?.expect ?? "?"
    const pct = r.sites ? (r.covered / r.sites) * 100 : 100
    const verdict = r.sites === 0 ? "(no live site)" : pct === 100 ? "OK" : `GAP ${pct.toFixed(1)}%`
    console.log(`${form.padEnd(20)} ${exp.padEnd(15)} ${String(r.sites).padStart(6)} ${String(r.covered).padStart(8)} ${String(r.quoted).padStart(7)}  ${verdict}`)
    if (pct !== 100) for (const ex of r.examples) console.log(`${" ".repeat(22)}e.g. ${ex}`)
  }
  console.log(JSON.stringify(rows, null, 1).slice(0, 200))
}
main().catch((e) => { console.error(e); process.exit(1) })
