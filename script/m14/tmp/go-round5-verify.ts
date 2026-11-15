// go lane — ROUND 5 verification probe. Independent second read.
//
// What this is: the lane's five recorded review rounds all measured the SAME
// F5-comparable surface (extends / implements / instantiates / calls) and all
// read 0/0 — on go-tools, terraform, kubernetes, and now prometheus / grpc-go /
// etcd. That surface is therefore the lane's most-measured and least-productive
// place to look. The labels the harness DROPS for go (`uses`, `references`,
// `imports`) carried 51,209 edges on grpc-go alone and had NO oracle at all, so
// a wrong read edge there could not be MISSING and could not be fabrication.
//
// This probe is built to falsify, not to confirm. Each case below is a claim
// from a line-by-line read; the probe either reproduces the defect against the
// REAL analyzer + the REAL F5 oracle, or it does not. A case that cannot fail
// is marked as such.
//
// Run: bun script/m14/tmp/go-round5-verify.ts
// Output: a per-case verdict line + a machine-readable JSON block on stdout.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"
import { deriveGoEdges, deriveGoImplements, deriveTreeEdges } from "../differential"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "go-r5-"))
const analyzer = new RealGoAnalyzer()

const parse = async (src: string) => {
  const parser = await ASTEngine.getParser("go" as any)
  const tree = parser.parse(src)
  if (!tree.rootNode) throw new Error("no root node")
  return tree.rootNode
}

const run = async (src: string): Promise<any> => {
  const root = await parse(src)
  const res: any = await analyzer.analyze(root, src, "probe.go")
  const gated = ["extends", "implements", "instantiates", "overrides", "calls"]
  const edges = (res.relationships ?? []).map((r: any) => ({
    label: String(r.type ?? r.relationshipType ?? ""),
    rt: String(r.metadata?.relationshipType ?? ""),
    source: String(r.source ?? r.from ?? ""),
    target: String(r.target ?? r.to ?? r.toSymbol ?? ""),
    line: (r as any).line_number,
    conf: r.confidence,
    meta: r.metadata ?? {},
  }))
  const truth = [
    ...deriveTreeEdges(root, "go"),
    ...deriveGoEdges(root),
    ...deriveGoImplements(root),
  ].map((t: any) => ({ label: String(t.label), target: String(t.target), from: String(t.from) }))
  const norm = (s: string) => s.split("::").pop()!.split(".").pop()!.trim()
  const unexplained = edges
    .filter((e) => gated.includes(e.label))
    .filter((e) => (e.conf ?? 1) >= 0.7)
    .filter((e) => !truth.some((t) => t.label === e.label && norm(t.target) === norm(e.target)))
    .map((e) => `${e.source}->${e.target} [${e.label}]`)
  return { res, edges, truth, unexplained, symbols: res.symbols ?? [] }
}

// ---------------------------------------------------------------- the recorder
// A probe that reports "defect" is a probe that can only say one thing. Every
// case below therefore declares what it is — a DEFECT claim or a CONTROL — and
// the recorder compares the OBSERVATION against that declaration, so a control
// that stops behaving is a failure and a defect that stops reproducing is a
// failure. Both directions are reported; neither is allowed to be silent.
type Expectation = "defect" | "control"

const results: any[] = []
const record = (id: string, expectation: Expectation, claim: string, observed: boolean, detail: string) => {
  // For a defect, `observed === true` means "the defect is present". For a
  // control, `observed === true` means "the control held".
  const ok = expectation === "defect" ? !observed : observed
  results.push({ id, expectation, claim, observed, verdict: ok ? "PASS" : "FAIL", detail })
  const tag = expectation === "defect" ? (observed ? "DEFECT" : "fixed ") : (observed ? "control" : "BROKEN ")
  console.log(`${ok ? "ok  " : "FAIL"}  ${id.padEnd(4)}  [${tag}]  ${claim}`)
  if (detail) console.log(`          ${detail}`)
  return ok
}

// The analyzer's own text, COMMENTS STRIPPED, for the code-shape cases. A
// grep over the raw file would find its own fix notes — the first draft of
// this probe "found" the dead disjunct it had just removed, inside the comment
// explaining that it had been removed. Code-shape claims must be read from
// code.
const analyzerPath = path.join(import.meta.dir, "../../../src/ast/real-go-analyzer.ts")
const stripComments = (ts: string): string =>
  ts
    // block comments
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // line comments, but not the `//` inside a string literal such as a URL
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, (m) => " ".repeat(m.length))
    .replace(/\/\/[^\n]*/g, "")
const ANALYZER_CODE = stripComments(fs.readFileSync(analyzerPath, "utf8"))

// ---------------------------------------------------------------- A: C1
// Claim: a name that is ONLY an interface method (a `method_spec`, published as
// kind=Method) enters the analyzer's `declared` set and its bare-call resolver,
// but the F5 oracle's `declaredFns` is built from function_declaration +
// method_declaration only. So the analyzer FABRICATES a `calls` edge the oracle
// cannot derive -> UNEXPLAINED, the class the family calls C5 asymmetry.
{
  const r = await run(`package p

type I interface{ Handle(x int) error }

var _ = Handle(1)
`)
  record(
    "A1",
    "defect",
    "an interface-METHOD name resolves as a bare package-scope callee (C5 asymmetry -> UNEXPLAINED calls)",
    r.unexplained.some((u) => u.includes("Handle")),
    `unexplained=[${r.unexplained.join(", ")}]`,
  )
  const bodyVariant = await run(`package p

type I interface{ Handle(x int) error }

func g() { Handle(1) }
`)
  record(
    "A2",
    "defect",
    "...and the same name resolves as a bare callee inside a function body",
    bodyVariant.unexplained.some((u) => u.includes("Handle")),
    `body-variant unexplained=[${bodyVariant.unexplained.join(", ")}]`,
  )
}

// control: a real declared function must be derivable by BOTH sides
{
  const r = await run(`package p

func Handle(x int) error { return nil }

var _ = Handle(1)
`)
  record("A0", "control", "a real top-level function resolves on both sides (the fix must not silence it)", !r.unexplained.some((u) => u.includes("Handle")), `unexplained=[${r.unexplained.join(", ")}]`)
}

// ---------------------------------------------------------------- B: C17
// Claim: the oracle skips `structName === iface` for implements; the analyzer
// has no such guard, so duplicate declaration names (parseable, invalid Go)
// fabricate a self-implements edge.
{
  const r = await run(`package p

type I interface{ M() }

type I struct{}

func (i *I) M() {}
`)
  record("B1", "defect", "analyzer emits implements I->I that the oracle's self-pair guard refuses", r.unexplained.some((u) => u.includes("I->I")), `unexplained=[${r.unexplained.join(", ")}]`)
}

// ---------------------------------------------------------------- C: C2
// Claim: the declared-type graph dedupes on (source,target,relType) file-globally,
// so only the FIRST site of a repeated type survives, with the first site's line.
{
  const r = await run(`package p

type TypeGraph struct {
	prop  *TypeGraph
	other *TypeGraph
	third *TypeGraph
}
`)
  const dt = r.edges.filter((e) => e.label === "references" && e.rt === "declared_type" && e.source === "TypeGraph")
  record(
    "C1",
    "control",
    "the declared-type graph collapses N sites of one type to ONE edge (the per-set convention, ruled in the spec)",
    dt.length < 3,
    `declared_type edges for TypeGraph = ${dt.length} at line(s) ${dt.map((e) => e.line).join(",")} (3 sites written)`,
  )
  record("C2", "control", "distinct types are NOT collapsed", r.edges.filter((e) => e.rt === "declared_type").length >= 1 && r.edges.filter((e) => e.rt === "declared_type").every((e: any) => e.target === "TypeGraph"), `${r.edges.filter((e) => e.rt === "declared_type").length} edge(s), all target TypeGraph`)
}

// ---------------------------------------------------------------- D: C3
// Claim: an UNNAMED parameter (`func f(*Server)`) and an unnamed RESULT
// (`func f() (int, error)`) are both one-named-child `parameter_declaration`
// nodes, so the heuristic at :402 labels the parameter `return_type`.
{
  const r = await run(`package p

type Server struct{ N int }

func f(*Server, Server) {}
`)
  const mislabelled = r.edges.filter((e) => e.label === "references" && e.rt === "return_type" && e.source === "f")
  record("D1", "defect", "an unnamed PARAMETER is published with relationshipType=return_type", mislabelled.length > 0, `edges: ${mislabelled.map((e) => `${e.source}->${e.target} ${e.rt}`).join(", ") || "(none)"}`)
  const r2 = await run(`package p

type Server struct{ N int }

func g() (Server, error) { return Server{}, nil }
`)
  const ok = r2.edges.filter((e) => e.rt === "return_type" && e.source === "g")
  record("D2", "control", "an unnamed RESULT is still return_type (the exact-arity fix must keep it)", ok.length > 0, `edges: ${ok.map((e) => `${e.source}->${e.target} ${e.rt}`).join(", ") || "(none)"}`)
  const r3 = await run(`package p

type Server struct{ N int }

func h(s *Server) {}
`)
  const named = r3.edges.filter((e) => e.label === "references" && e.source === "h")
  record("D3", "control", "a NAMED parameter is still declared_type", named.length > 0 && named.every((e) => e.rt === "declared_type"), `edges: ${named.map((e) => `${e.source}->${e.target} ${e.rt}`).join(", ") || "(none)"}`)
}

// ---------------------------------------------------------------- E: C5
// Claim: `comparable` is the third Go predeclared identifier and is absent from
// the analyzer's BUILTINS set, so a generic CONSTRAINT leaks a dangling target.
{
  const r = await run(`package p

type Pair[K comparable, V any] struct{ K K; V V }
`)
  const edges = r.edges.filter((e) => e.target === "comparable")
  record("E1", "defect", "the predeclared constraint `comparable` becomes a declared_type target", edges.length > 0, `edges: ${edges.map((e) => `${e.source}->${e.target} ${e.rt}`).join(", ") || "(none)"}`)
  const r2 = await run(`package p

type Named interface{ comparable }
`)
  const syms = r2.symbols.filter((s: any) => String(s.name).includes("comparable"))
  record(
    "E2",
    "control",
    "`interface{ comparable }` embeds a predeclared interface — RULED CORRECT (same rule as io.Closer), so it must still emit",
    syms.length > 0 && r2.edges.some((e) => e.label === "extends" && e.target === "comparable"),
    `symbols=[${syms.map((s: any) => `${s.kind}:${s.name}`).join(", ")}] extends=${r2.edges.filter((e) => e.target === "comparable").length}`,
  )
  const r3 = await run(`package p

type Ok[K any, V comparable] struct{ K K }
`)
  record(
    "E3",
    "control",
    "`any` (also predeclared) is in the builtin set, so it leaks nothing",
    !r3.edges.some((e) => e.target === "any"),
    `any-target edges: ${r3.edges.filter((e) => e.target === "any").length}`,
  )
}

// ---------------------------------------------------------------- F: C6
// Claim: Go's spec defines exported by unicode.IsUpper, not an ASCII range, so a
// legal non-ASCII exported identifier is published `private` and DROPPED from the
// product's public-API export list.
{
  const r = await run(`package p

type Ünï struct{ Ä int }

func Ö() {}

var Ñ = 1
`)
  const bad = r.symbols.filter((s: any) => s.visibility === "private" && /[^\x00-\x7F]/.test(String(s.name)))
  const exportedNames = (r.res.exports ?? []).map((e: any) => e.name)
  record("F1", "defect", "non-ASCII exported identifiers are published private", bad.length > 0, `private symbols with non-ASCII names: ${bad.map((s: any) => s.name).join(", ") || "(none)"}`)
  record(
    "F2",
    "defect",
    "...and are therefore ABSENT from the export list the product serves",
    !exportedNames.some((n) => /[^\x00-\x7F]/.test(String(n))),
    `exports = [${exportedNames.join(", ")}]`,
  )
  const r2 = await run(`package p

func Ascii() {}
`)
  record("F3", "control", "an ASCII exported identifier is still exported", (r2.res.exports ?? []).some((e: any) => e.name === "Ascii"), `exports = [${(r2.res.exports ?? []).map((e: any) => e.name).join(", ")}]`)
}

// ---------------------------------------------------------------- G: C4
// Claim: the Module symbol's range is hardcoded to line 1 / byte 0, so a file
// with a //go:build header reports its package clause at the wrong place.
{
  const r = await run(`//go:build linux
// +build linux

package p
`)
  const mod = r.symbols.find((s: any) => s.kind === "module" || s.metadata?.isGoPackage)
  record(
    "G1",
    "defect",
    "the package Module symbol reports startLine 1 when the package clause is on line 4",
    !!mod && mod.range.startLine === 1,
    `range = ${mod ? `${mod.range.startLine}:${mod.range.startColumn}-${mod.range.endLine}:${mod.range.endColumn} idx ${mod.range.startIndex}..${mod.range.endIndex}` : "(no module symbol)"}`,
  )
}

// ---------------------------------------------------------------- H: C15
// Claim: var/const symbols take the whole `var_spec` range, while struct fields
// deliberately take the NAME node's range (#919's rule). On a grouped or
// multi-line declaration every name reports the first name's position.
{
  const r = await run(`package p

var alpha,
	beta int
`)
  const vs = r.symbols.filter((s: any) => s.name === "alpha" || s.name === "beta")
  record(
    "H1",
    "defect",
    "grouped var names do not carry their own name-node range (the #919 field rule is not applied to var/const)",
    new Set(vs.map((s: any) => `${s.range.startLine}:${s.range.startColumn}`)).size === 1,
    `ranges: ${vs.map((s: any) => `${s.name}@${s.range.startLine}:${s.range.startColumn}`).join(", ")}`,
  )
  const r2 = await run(`package p

type S struct {
	A, B string
}
`)
  const fs2 = r2.symbols.filter((s: any) => s.metadata?.isStructField)
  record(
    "H2",
    "control",
    "grouped STRUCT FIELDS still carry their own name-node range",
    fs2.length === 2 && new Set(fs2.map((s: any) => `${s.range.startLine}:${s.range.startColumn}`)).size === fs2.length,
    `ranges: ${fs2.map((s: any) => `${s.name}@${s.range.startLine}:${s.range.startColumn}`).join(", ")}`,
  )
}

// ---------------------------------------------------------------- I: C16
// Claim: the contains pass skips any member whose name equals its owner, so a
// legal same-named field is published as a symbol with NO containment edge.
{
  const r = await run(`package p

type Foo struct {
	Foo string
	N   int
}
`)
  const member = r.symbols.find((s: any) => s.name === "Foo" && s.ownerName === "Foo")
  const contains = r.edges.filter((e) => e.label === "contains" && e.source === "Foo")
  record(
    "I1",
    "control",
    "a same-named member is published but its contains edge is suppressed (RULED: no self-loops, registered in the spec)",
    !!member && !contains.some((e) => e.target === "Foo") && contains.some((e) => e.target === "N"),
    `member symbol present=${!!member}; contains targets = [${contains.map((e) => e.target).join(", ")}]`,
  )
}

// ---------------------------------------------------------------- J: C19
// Claim: `type_alias` to a struct publishes the embedded member but no extends
// edge, because the embedding pass reads `type_spec` only. The oracle is
// type_spec-only too, so the differential cannot see it.
{
  const r = await run(`package p

type Inner struct{ Q int }

type A = struct{ *Inner }
`)
  const member = r.symbols.find((s: any) => s.ownerName === "A")
  const ext = r.edges.filter((e) => e.label === "extends" && e.source === "A")
  record(
    "J1",
    "defect",
    "an alias-to-struct with an embedded field publishes the member but no extends edge",
    !!member && ext.length === 0,
    `member=${member ? `${member.kind}:${member.name}` : "(none)"} extends=[${ext.map((e) => e.target).join(", ")}]`,
  )
  const r2 = await run(`package p

type Inner struct{ Q int }

type A struct{ *Inner }
`)
  record("J2", "control", "a plain struct declaration still emits extends", r2.edges.some((e) => e.label === "extends" && e.source === "A" && e.target === "Inner"), `extends=[${r2.edges.filter((e) => e.label === "extends" && e.source === "A").map((e) => e.target).join(", ")}]`)
}

// ---------------------------------------------------------------- K: C7
// Claim: the package-scope call predicate's last disjunct
// `(isCtor && declared.has(leaf))` is dead — `declared.has(leaf)` subsumes it.
{
  const deadDisjunct = /isCtor\s*&&\s*declared\.has\(/.test(ANALYZER_CODE)
  record("K1", "defect", "the package-scope call predicate carries a dead disjunct (F7 duplicate branch)", deadDisjunct, deadDisjunct ? "pattern `(isCtor && declared.has(...))` present in the emit predicate" : "pattern absent from comment-stripped code")
  const emitLine = ANALYZER_CODE.split("\n").find((l) => l.includes("const emit =") && l.includes("declared.has(leaf)")) ?? ""
  record("K2", "control", "the emit predicate is a pure disjunction with no subsumed term", !emitLine.includes("isCtor"), `emit line: ${emitLine.trim()}`)
}

// ---------------------------------------------------------------- L: C8
// Claim: the `references` branch of the tier classifier tests isGoImportDep/isImport,
// but the only writer of those markers emits the `imports` kind, so the branch
// is unreachable for go.
{
  const writers = (ANALYZER_CODE.match(/isGoImportDep:\s*true/g) ?? []).length
  const tierReadsMarker = /if \(t === "references"\)[\s\S]{0,400}isGoImportDep/.test(ANALYZER_CODE)
  record("L1", "defect", "the `references` tier branch still tests a marker no `references` edge carries", tierReadsMarker, `isGoImportDep:true writers=${writers}; the references tier branch reads the marker: ${tierReadsMarker}`)
}

// ---------------------------------------------------------------- M: C9
// Claim: extractGoSymbols is always called with 3 args, so parentStruct is
// permanently undefined and every ownerName/ownerKind it sets is dead.
{
  const stillPlumbed = /parentStruct|parentStruct\?/.test(ANALYZER_CODE)
  record("M1", "defect", "the dead `parentStruct` plumbing is still present", stillPlumbed, `occurrences in comment-stripped code: ${(ANALYZER_CODE.match(/parentStruct/g) ?? []).length}`)
  const r = await run(`package p

func Free() {}

var V = 1

const C = 2
`)
  const f = r.symbols.find((s: any) => s.name === "Free")
  const v = r.symbols.find((s: any) => s.name === "V")
  record("M2", "control", "a package-scope function/variable still has no owner (Go has no nested declarations)", !!f && f.ownerName === undefined && !!v && v.ownerName === undefined, `Free.ownerName=${f?.ownerName} V.ownerName=${v?.ownerName}`)
}

// ---------------------------------------------------------------- O: C20
// Claim: calculateCyclomaticComplexity(rootNode) is called twice on the same node,
// each call a full recursive tree walk.
{
  const twice = (ANALYZER_CODE.match(/calculateCyclomaticComplexity\(rootNode\)/g) ?? []).length
  record("O1", "defect", "the analyzer walks the whole tree twice for one metadata literal", twice > 1, `occurrences of the identical call: ${twice}`)
}

// ---------------------------------------------------------------- P: C10
// Claim: method_spec always carries a name in the pinned grammar, so
// extractInterfaceMethods' no-name else-branch is unreachable.
{
  let nameless = 0
  let specs = 0
  for (const t of [
    "interface { M() }",
    "interface { io.Reader }",
    "interface { M(); N() }",
    "interface { ~int | ~string }",
    "interface { comparable }",
    "interface { error }",
    "interface { M(a, b int) (c, d error) }",
    "interface { M() error; N() (int, error) }",
  ]) {
    const root = await parse(`package p\n\ntype T ${t}\n`)
    const stack: any[] = [root]
    while (stack.length) {
      const n = stack.pop()!
      if (n.type === "method_spec") {
        specs++
        if (!n.childForFieldName("name")) nameless++
      }
      for (let i = 0; i < n.namedChildCount; i++) if (n.namedChild(i)) stack.push(n.namedChild(i))
    }
  }
  const deadElseBranch = /methodName\)\s*\{[\s\S]{0,400}?\}\s*else\s*\{/.test(ANALYZER_CODE)
  record("P1", "defect", "the nameless `method_spec` else-branch is still in the source", deadElseBranch, `else-branch present: ${deadElseBranch}; method_spec nodes probed: ${specs}, nameless: ${nameless}`)
}

fs.rmSync(tmp, { recursive: true, force: true })
const summary = {
  probe: "go-round5-verify",
  cases: results.length,
  defects: results.filter((r) => r.expectation === "defect").length,
  defectsStillReproducing: results.filter((r) => r.expectation === "defect" && r.observed).length,
  defectsClosed: results.filter((r) => r.expectation === "defect" && !r.observed).length,
  controls: results.filter((r) => r.expectation === "control").length,
  controlsHolding: results.filter((r) => r.expectation === "control" && r.observed).length,
  controlsBroken: results.filter((r) => r.expectation === "control" && !r.observed).length,
  fail: results.filter((r) => r.verdict === "FAIL").length,
  results,
}
console.log("\n=== JSON ===")
console.log(JSON.stringify(summary, null, 2))
