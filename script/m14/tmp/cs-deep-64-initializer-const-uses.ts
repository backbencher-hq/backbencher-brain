/**
 * 2026-09-29: CS-D11, fourth attempt — built from the CORPUS shapes rather than from a guess.
 *
 * WHY THIS FILE IS THE FOURTH VERSION. Three previous attempts inferred the failing shape from the
 * relationship label and the `source` name without reading the source line, and got it wrong twice:
 *
 *   attempt 1  assumed "the oracle is blind to attribute arguments"  -> false, it handles them
 *   attempt 2  assumed declaration order mattered                      -> false, both orders reconcile
 *   attempt 3  assumed the discriminator was method-vs-property        -> true, but far too narrow,
 *               and then generalised it to "attributes on declarations generally" from a `source` of
 *               `constructor` rather than from the line
 *
 * Reading the actual lines gives a completely different class. The corpus edges are:
 *
 *   BaseFormattingCommandParameters.cs:112   internal int maxDepth = maxDepthAllowable;
 *   AsyncByteStreamTransfer.cs:37            _buffer = new byte[DefaultBufferSize];
 *   RunspaceConnectionInfo.cs:247            uses CancelTimeout -> defaultCancelTimeout
 *
 * NONE of those is an attribute. They are FIELD INITIALISERS and CONSTRUCTOR ASSIGNMENTS — const
 * reads in an initializer position, one of them inside an array-size bracket. So the class is
 * "const read in an initializer", not "attribute argument", and the fix I reverted was aimed at the
 * wrong shape entirely. That is what reading the source instead of the label buys, and it is why
 * this file starts by reproducing those two lines verbatim rather than by generalising.
 *
 * THE EMPIRICAL BOUNDARY, measured rather than assumed. Ten cases, and the split is sharp:
 *
 *   FAILS    field initializer reads a class const   `internal int maxDepth = maxDepthAllowable;`
 *   FAILS    same, const declared after the use      declaration order is irrelevant
 *   FAILS    field initializer reads a field         `internal int v = _k;`
 *   FAILS    ctor body, array-size bracket           `_buffer = new byte[DefaultBufferSize];`
 *   passes  method body reads a class const         `return K;`
 *   passes  local declaration initializer            `int v = K;` inside a method body
 *   passes  constructor assignment                   `_v = K;`
 *   passes  attribute named argument, on a method    `[Parameter(ParameterSetName = Set1)]`
 *   passes  attribute named argument, other shape    both sides derive it
 *   passes  field initializer reads a METHOD call    neither side emits (not a bare identifier)
 *
 * So the discriminator is NOT "initializer" and NOT "attribute" and NOT declaration order. It is
 * specifically a read inside a FIELD DECLARATION's initializer. A constructor body and a method
 * body both work; a local declaration both works; only the class-level field initializer is
 * dropped. The two node shapes are otherwise identical — `variable_declaration > predefined_type
 * + variable_declarator(identifier, identifier)` in both the failing and passing trees — so the
 * difference is the enclosing `field_declaration`, and nothing about the initializer's own structure.
 *
 * RULED OUT as the blocker, by construction rather than by reading:
 *   isTypePosition  its first branch tests `variable_declarator` and returns whether the node lies
 *                   within the declared TYPE's range; an initializer does not, so it returns false
 *                   for both the failing and passing shapes
 *   isNamePosition  returns false as soon as an ancestor "includes declaration", true for both
 *   class frames     `class_declaration` pushes a frame with `cls` set, so `fr.cls` is correct
 *   members inventory the analyzer publishes the const/field as `property` with the right owner, and
 *                   the `members` map is keyed on exactly that
 *
 * NOT YET IDENTIFIED: which of the remaining predicates in the push condition drops it. The next
 * step is to instrument that condition and print which one fires, rather than reading sixteen
 * predicates and guessing — that approach already produced three wrong mechanisms in this file's * history.
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
  ["field-init, const first", `class A {
  internal const int maxDepthAllowable = 100;
  internal int maxDepth = maxDepthAllowable;
}`],
  ["field-init, const after", `class B {
  internal int maxDepth = maxDepthAllowable;
  internal const int maxDepthAllowable = 100;
}`],
  ["ctor body, array size", `class C {
  internal const int DefaultBufferSize = 4096;
  private byte[] _buffer;
  C() { _buffer = new byte[DefaultBufferSize]; }
}`],
  ["enum-ish attr arg", `class D {
  internal const string defaultCancelTimeout = "x";
  [Output(CancelTimeout = defaultCancelTimeout)]
  void M() { }
}`],
  ["method attr named arg", `class E {
  internal const string Set1 = "a";
  [Parameter(ParameterSetName = Set1)]
  void M() { }
}`],
  // Bisection. The initializer cases fail, so either `isTypePosition` blocks them or something
  // else does. These four separate the axes: WHERE the read is, WHETHER the target is a const,
  // WHETHER the target is a field at all, and WHETHER an initializer is involved.
  ["method BODY read of class const", `class F {
  internal const int K = 1;
  int M() { return K; }
}`],
  ["local var init reads const", `class G {
  internal const int K = 1;
  int M() { int v = K; return v; }
}`],
  ["field init reads a FIELD", `class H {
  internal int _k;
  internal int v = _k;
}`],
  ["ctor assigns from const", `class I2 {
  internal const int K = 1;
  int _v;
  I2() { _v = K; }
}`],
  ["field init reads a METHOD call", `class J2 {
  int Get() => 1;
  int v = Get();
}`],
]

let bad = 0
for (const [label, src] of CASES) {
  const f = `/tmp/opencode/d11-${label.replace(/[^a-z]/g, "")}.cs`
  fs.writeFileSync(f, src)
  const root = parser.parse(src)!.rootNode
  const res: any = await new mod.RealCSharpAnalyzer().analyze(root, f, src)
  const truth: any[] = diff.deriveCSharpBareUses(root, res.symbols ?? [])
  const aT = (res.relationships ?? []).filter((x: any) => x.type === "uses").map((x: any) => x.target).sort()
  const oT = truth.filter((e) => e.label === "uses").map((e: any) => e.target).sort()
  const only = aT.filter((t: string) => !oT.includes(t))
  const syms = (res.symbols ?? []).map((s: any) => `${s.name}:${s.kind}`).join(" ")
  console.log(`  ${label.padEnd(24)} analyzer=${JSON.stringify(aT)}  oracle=${JSON.stringify(oT)}  ${only.length ? "UNEXPLAINED " + JSON.stringify(only) : "ok"}`)
  console.log(`  ${" ".repeat(24)} symbols: ${syms}`)
  if (only.length > 0) bad++
}
console.log(`\n  ${bad} of ${CASES.length} shapes reproduce.`)
console.log(`  A shape that reconciles is as informative as one that fails: it says the guard is not`)
console.log(`  too broad, which is the check that matters before changing shared code.`)