// go #914 — the EXECUTED NEGATIVE for F9-PROBE-GO-IMPL-SIGNATURE.
//
// Runs the probe's exact source through the PRE-FIX code (real, extracted from
// HEAD with `git show` — not a paraphrase) beside the fixed code, and prints
// which expected edges the pre-fix side could not derive and which forbidden
// edges it wrongly derived. A probe whose negative has never fired is a
// declaration, not evidence.
//
// The pre-fix modules are DERIVED AT RUN TIME into a temp dir (git show HEAD +
// only the import specifiers rewritten to absolute paths), so nothing derived is
// checked in and the negative always measures the code the commit actually holds.
//
// Run: bun script/m14/tmp/go-914-negative.ts
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"
import { deriveGoImplements } from "../differential"

const ROOT = path.resolve(import.meta.dir!, "..", "..", "..")
const PRE = fs.mkdtempSync(path.join(os.tmpdir(), "go914-prefix-"))

/** Materialize a HEAD blob in the temp dir, rewriting only import specifiers so
 *  a module that sat at a different depth still resolves the repo's own src. */
const materialize = (repoPath: string, outName: string, rewrites: [string, string][]): string => {
  let text = execSync(`git show HEAD:${repoPath}`, { cwd: ROOT, maxBuffer: 1 << 28 }).toString()
  for (const [from, to] of rewrites) text = text.split(from).join(to)
  const out = path.join(PRE, outName)
  fs.writeFileSync(out, text)
  return out
}

const preDifferential = materialize("script/m14/differential.ts", "pre914-differential.ts", [
  ['"../../src/ast/', `"${ROOT}/src/ast/`],
])
const preAnalyzer = materialize("src/ast/real-go-analyzer.ts", "pre914-go-analyzer.ts", [
  ['from "./engine"', `from "${ROOT}/src/ast/engine"`],
])
const preMod: any = await import(preDifferential)
const preAnalyzerMod: any = await import(preAnalyzer)
const preDeriveGoImplements: (root: any) => { label: string; from: string; target: string }[] = preMod.deriveGoImplements
const PreRealGoAnalyzer = preAnalyzerMod.RealGoAnalyzer

const EXPECT = [
  "myLogger->Logger",
  "clientDispatcher->Client",
  "AliasImpl->Alias",
  "AliasImpl->Embedder",
  "Diamond->D",
  "Diamond->B",
  "Diamond->C",
  "Diamond->A",
]
const FORBID = [
  "StrictValue->StrictType",
  "ArityVariadic->ArityIface",
  "SliceNotVariadic->SliceIface",
  "unimplementedDialer->Dialer",
  "VariadicOnly->BareIface",
]

// The source is the probe battery's — same text, so the negative measures the
// pinned artifact rather than a drifting copy. The distinctive lines below must
// appear verbatim in verify-probe-battery.ts or this script refuses to run.
const SRC = [
  `package probe`,
  ``,
  `type Logger interface {`,
  `\tLogf(format string, args ...any)`,
  `}`,
  ``,
  `type myLogger int`,
  ``,
  `func (myLogger) Logf(format string, args ...any) {}`,
  ``,
  `type Client interface {`,
  `\tCall(ctx context.Context, in *Params) error`,
  `}`,
  ``,
  `func (c *clientDispatcher) Call(ctx context.Context, in *Params) error { return nil }`,
  ``,
  `type Alias = interface {`,
  `\tM()`,
  `}`,
  ``,
  `type Embedder interface {`,
  `\tAlias`,
  `}`,
  ``,
  `type AliasImpl struct{}`,
  ``,
  `func (AliasImpl) M() {}`,
  ``,
  `type D interface { Deep() }`,
  `type B interface {`,
  `\tD`,
  `}`,
  `type C interface {`,
  `\tD`,
  `}`,
  `type A interface {`,
  `\tB`,
  `\tC`,
  `}`,
  ``,
  `type Diamond struct{}`,
  ``,
  `func (Diamond) Deep() {}`,
  ``,
  `type StrictType interface {`,
  `\tElem() StrictType`,
  `}`,
  ``,
  `type StrictValue struct{}`,
  ``,
  `func (StrictValue) Elem() StrictValue { return StrictValue{} }`,
  ``,
  `type ArityIface interface {`,
  `\tF(x int)`,
  `}`,
  ``,
  `type ArityVariadic struct{}`,
  ``,
  `func (ArityVariadic) F(x int, y ...string) {}`,
  ``,
  `type SliceIface interface {`,
  `\tG(xs ...string)`,
  `}`,
  ``,
  `type SliceNotVariadic struct{}`,
  ``,
  `func (SliceNotVariadic) G(xs []string) {}`,
  ``,
  `type Dialer interface {`,
  `\tDial(ctx context.Context, addr string, opts ...string) error`,
  `}`,
  ``,
  `type unimplementedDialer struct{}`,
  ``,
  `func (unimplementedDialer) Dial(ctx context.Context, addr string) error { return nil }`,
  ``,
  `type BareIface interface {`,
  `\tH(x string)`,
  `}`,
  ``,
  `type VariadicOnly struct{}`,
  ``,
  `func (VariadicOnly) H(x ...string) {}`,
  ``,
].join("\n")

const battery = fs.readFileSync(path.join(import.meta.dir!, "..", "verify-probe-battery.ts"), "utf8")
for (const line of ["\\tLogf(format string, args ...any)", "\\tDial(ctx context.Context, addr string, opts ...string) error", "H(x ...string)", "F9-PROBE-GO-IMPL-SIGNATURE"]) {
  if (!battery.includes(line)) {
    console.error(`REFUSING: the battery no longer contains ${JSON.stringify(line)} — this negative would measure a different source than the pinned probe.`)
    process.exit(2)
  }
}

const parser = await ASTEngine.getParser("go" as any)
const tree = parser.parse(SRC)
const root = tree.rootNode

const fixed = deriveGoImplements(root).map((e) => `${e.from}->${e.target}`)
const pre = preDeriveGoImplements(root).map((e) => `${e.from}->${e.target}`)

const fixedAnalyzer = await new RealGoAnalyzer().analyze(root, SRC, "probe.go")
const preAnalyzerRes = await new (PreRealGoAnalyzer as any)().analyze(root, SRC, "probe.go")
const aEdges = (r: any) => (r.relationships ?? []).filter((x: any) => String(x.type) === "implements").map((x: any) => `${x.source}->${x.target}`)
const fixedA = aEdges(fixedAnalyzer)
const preA = aEdges(preAnalyzerRes)

let bad = 0
const show = (label: string, expect: string[], forbid: string[], oracleGot: string[], analyzerGot: string[]) => {
  const missing = expect.filter((e) => !oracleGot.includes(e) || !analyzerGot.includes(e))
  const fabricated = forbid.filter((f) => oracleGot.includes(f) || analyzerGot.includes(f))
  console.log(`\n=== ${label}`)
  console.log(`  oracle edges:   ${oracleGot.length}  analyzer edges: ${analyzerGot.length}`)
  console.log(`    oracle:   ${[...oracleGot].sort().join(" ")}`)
  console.log(`    analyzer: ${[...analyzerGot].sort().join(" ")}`)
  console.log(`  expects missing: ${missing.length ? missing.join(", ") : "(none)"}`)
  console.log(`  forbids derived: ${fabricated.length ? fabricated.join(", ") : "(none)"}`)
  if (missing.length || fabricated.length) bad++
  return { missing, fabricated }
}

const preRes = show("PRE-FIX  (HEAD)", EXPECT, FORBID, pre, preA)
const fixRes = show("POST-FIX (working tree)", EXPECT, FORBID, fixed, fixedA)

const ok = bad === 1 && preRes.missing.length > 0 && fixRes.missing.length === 0 && fixRes.fabricated.length === 0
console.log(`\nNEGATIVE FIRES: ${preRes.missing.length > 0 ? "yes" : "NO"} (pre-fix missed ${preRes.missing.length}, pre-fix fabricated ${preRes.fabricated.length})`)
console.log(`POST-FIX CLEAN: ${fixRes.missing.length === 0 && fixRes.fabricated.length === 0 ? "yes" : "NO"}`)
console.log(`EXECUTED NEGATIVE ${ok ? "PROVEN" : "NOT PROVEN"}`)
process.exit(ok ? 0 : 1)
