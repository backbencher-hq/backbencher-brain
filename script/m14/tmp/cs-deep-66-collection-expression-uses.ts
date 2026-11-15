/**
 * 2026-09-29: CS-D12 — reads inside a COLLECTION EXPRESSION's target-typed `new(...)`.
 *
 * FOUND BY LOOKING AT THE ONE CORPUS I HAD IGNORED. fsharp sat at unexplained=8 in three
 * consecutive draws (0.1%), which is stable enough to be real, while roslyn, aspnetcore and
 * powershell were at 1, 1 and 4. All eight edges were in ONE file:
 *
 *   uses ExtensionChoice -> OLD / LSP / BOTH / UNSET
 *   uses GetDiagnosticsFrom -> FSharpCategory / ExtensionChoice
 *   uses AllStringSettings -> GetDiagnosticsFrom / GetSemanticHighlightingFrom
 *
 * Which is FSharpExtensionSettings.cs, and reading it gives a shape nothing in this round had seen:
 *
 *   public static EnumSettingEntry[] ExtensionChoice { get; } =
 *   [
 *       new(OLD, "%FSharpSettings.Old%"),
 *       new(LSP, "%FSharpSettings.LSP%"),
 *   ];
 *
 * A COLLECTION EXPRESSION containing TARGET-TYPED `new(...)` — an `implicit_object_creation_expression`
 * with no type of its own. It is not indexing and not an attribute, which were the two shapes I
 * assumed before reading the line.
 *
 * Every target is a REAL declaration in the same file (`public const string OLD = "old"`,
 * `public static SettingCategory FSharpCategory { get; } = new(...)`), so the analyzer is publishing
 * genuine reads and the TRUTH is incomplete — CS-D12, the fifth oracle-side defect this round and the
 * second with the same root shape as CS-D11: a read the truth's walk does not reach.
 *
 * The cases below separate the axes: collection expression vs plain array initializer, target-typed
 * `new` vs explicit `new T`, and argument position vs the `new` itself. And the probe asks for the
 * blocking predicate directly, because four wrong mechanisms in this round all came from inferring
 * the shape instead of measuring it — `blocked_by=[...]` costs one run and settles it.
 */
import * as fs from "fs"
import * as path from "path"
import { Language } from "web-tree-sitter"

const ROOT = process.cwd()
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c_sharp.wasm")))
const parser = new P()
parser.setLanguage(g)

const mod: any = await import(path.join(ROOT, "src/ast/real-csharp-analyzer.ts"))
const diff: any = await import(path.join(ROOT, "script/m14/differential.ts"))

const CASES: Array<[string, string]> = [
  ["collection expr + target-typed new", `class A {
  public const string OLD = "old";
  public const string LSP = "lsp";
  public static int[] Choice { get; } = [ new(OLD, LSP) ];
}`],
  ["explicit new in collection expr", `class B {
  public const string OLD = "old";
  public static int[] Choice { get; } = [ new int[OLD] ];
}`],
  ["array initializer + target-typed new", `class C {
  public const string OLD = "old";
  public static int[] Choice = { new(OLD) };
}`],
  ["target-typed new in a METHOD body", `class D {
  public const string OLD = "old";
  static int[] Make() { return [ new(OLD) ]; }
}`],
  ["explicit new args in method body", `class E {
  public const string OLD = "old";
  static object Make() { return new System.Text.StringBuilder(OLD); }
}`],
]

let bad = 0
for (const [label, src] of CASES) {
  const f = `/tmp/opencode/d12-${label.replace(/[^a-z]/g, "")}.cs`
  fs.writeFileSync(f, src)
  const root = parser.parse(src)!.rootNode
  const res: any = await new mod.RealCSharpAnalyzer().analyze(root, f, src)
  const truth: any[] = diff.deriveCSharpBareUses(root, res.symbols ?? [])
  const aT = (res.relationships ?? []).filter((x: any) => x.type === "uses").map((x: any) => x.target).sort()
  const oT = truth.filter((e) => e.label === "uses").map((e: any) => e.target).sort()
  const only = aT.filter((t: string) => !oT.includes(t))
  console.log(`  ${label.padEnd(34)} analyzer=${JSON.stringify(aT)} oracle=${JSON.stringify(oT)} ${only.length ? "UNEXPLAINED " + JSON.stringify(only) : "ok"}`)
  if (only.length > 0) bad++
}
console.log(`\n  ${bad} of ${CASES.length} reproduce.`)