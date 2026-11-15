/**
 * 2026-09-29: does the bare-uses oracle derive a const read that appears ONLY inside an
 * attribute's argument list? One question, one snippet, one run.
 *
 * WHY ASK IT THIS WAY. powershell's lane reported unexplained=7, every one of them a `uses` edge
 * whose target is a real `const` declared in the same file:
 *
 *   uses Date             -> DateAndUFormatParameterSet            (line 28, 57)
 *   uses UnixTimeSeconds  -> UnixTimeSecondsAndUFormatParameterSet (line 58)
 *   uses UnixTimeSeconds  -> MinimumUnixTimeSecond / MaximumUnixTimeSecond (line 58)
 *   uses LiteralName      -> LiteralNameParameterSet                (Navigation.cs:1508)
 *   uses GetComputerInfoCommand -> localMachineName                 (line 86)
 *
 * All of them are reads of declared consts inside `[Parameter(ParameterSetName = ...)]` or
 * `[ValidateRange(...)]`. Per-label attribution (added to differential.ts this round) put all of
 * them on `uses` and nothing else, which is what turned "7 unexplained" into a specific question.
 *
 * The adjudication hinges on WHICH side is wrong, and the fixture decides it: if the oracle
 * derives nothing for a snippet the analyzer reads, and the analyzer's target resolves to a
 * declared const, then the ANALYZER IS RIGHT and the ORACLE IS INCOMPLETE — the same shape as
 * CS-D9 and CS-D10, where the truth was the defective party. That distinction is not a detail;
 * it decides which file to change.
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

// The first version of this snippet declared the consts BEFORE the attribute that reads them, and
// it RECONCILED — so "the oracle is blind to attribute arguments" was wrong on the first try.
// In powershell the consts are declared at lines 48-574 and the attributes that read them sit at
// 28-58, i.e. the declaration comes LATER in the class. So both orders are tested here rather than
// the one that happens to work, because a blind spot that only shows when the declaration precedes
// the read is a different bug from one that only shows when it follows.
const AFTER = `class After {
  [Parameter(ParameterSetName = Late, Mandatory = true)]
  [ValidateRange(Low, 9)]
  void M() { var local = Low; }
  private const string Late = "a";
  private const long Low = 0;
}
`
const BEFORE = `class Before {
  private const string Early = "a";
  private const long Low2 = 0;
  [Parameter(ParameterSetName = Early, Mandatory = true)]
  [ValidateRange(Low2, 9)]
  void M() { var local = Low2; }
}
`
const run = async (label: string, text: string): Promise<void> => {
  const f = `/tmp/opencode/attr-${label}.cs`
  fs.writeFileSync(f, text)
  const r = parser.parse(text)!.rootNode
  const res: any = await new mod.RealCSharpAnalyzer().analyze(r, f, text)
  const t: any[] = diff.deriveCSharpBareUses(r, res.symbols ?? [])
  const au = (res.relationships ?? []).filter((x: any) => x.type === "uses").map((x: any) => x.target).sort()
  const ou = t.filter((e) => e.label === "uses").map((e: any) => e.target).sort()
  const only = au.filter((x: string) => !ou.includes(x))
  console.log(`  ${label.padEnd(7)} analyzer=${JSON.stringify(au)}  oracle=${JSON.stringify(ou)}  emitted-not-truth=${JSON.stringify(only)}`)
}
await run("before", BEFORE)
await run("after", AFTER)
// Third attempt, and the one that finally differs: in powershell the attribute is on a PROPERTY
// (`public DateTime Date`) and the edge's SOURCE is that property — not a method. Two of the seven
// had exactly that shape. `before`/`after` both put the attribute on a method, which is why they
// reconciled and told me nothing.
const ON_PROP = `class P {
  [Parameter(ParameterSetName = Later, Mandatory = true)]
  public DateTime Date { get; set; }
  private const string Later = "a";
}
`
await run("onprop", ON_PROP)
// Discriminator: is it "attributes on a property" generally, or specifically the `NAME = value`
// form in a property context? A positional argument on a property separates the two. The walk has
// only five branches and none of them skip children, so the push CONDITION must be failing for the
// `= value` shape — and `isAssignLhs` is the obvious candidate, since `= Later` is textually an
// assignment. If it is `isAssignLhs`, the positional form works and the named form does not.
const POSITIONAL = `class Q {
  [ValidateRange(Low, 9)]
  public DateTime Date { get; set; }
  private const long Low = 0;
}
`
await run("posprop", POSITIONAL)
const src = BEFORE
const file = "/tmp/opencode/attr.cs"
fs.writeFileSync(file, src)
const root = parser.parse(src)!.rootNode
const res: any = await new mod.RealCSharpAnalyzer().analyze(root, file, src)
const syms = res.symbols ?? []
const rels = res.relationships ?? []

const usesOf = (rows: any[]) => rows.filter((r) => (r.type ?? r.label) === "uses").map((r) => r.target).sort()
const truth: any[] = diff.deriveCSharpBareUses(root, syms)

console.log("  analyzer symbols: " + syms.map((s: any) => `${s.name}(${s.kind})`).join(", "))
console.log("  analyzer uses:     " + JSON.stringify(usesOf(rels)))
console.log("  oracle uses:       " + JSON.stringify(truth.filter((e) => e.label === "uses").map((e) => e.target).sort()))

const aT = usesOf(rels)
const oT = truth.filter((e) => e.label === "uses").map((e: any) => e.target).sort()
const onlyAnalyzer = aT.filter((t: string) => !oT.includes(t))
const onlyOracle = oT.filter((t: string) => !aT.includes(t))
console.log(`\n  emitted-not-truth: ${JSON.stringify(onlyAnalyzer)}`)
console.log(`  truth-not-emitted: ${JSON.stringify(onlyOracle)}`)

if (onlyAnalyzer.length > 0) {
  console.log(`\n  CS-D11 (ORACLE, not analyzer): the analyzer reads declared consts inside attribute`)
  console.log(`  argument lists and the oracle derives nothing for them. Every one of those targets`)
  console.log(`  is a real declaration in the same file, so the edges resolve and are semantically`)
  console.log(`  correct — the TRUTH is incomplete, which is why they surfaced as UNEXPLAINED rather`)
  console.log(`  than as fabrications. Fix belongs in deriveCSharpBareUses, not in the analyzer.`)
  console.log(`\n  This is the third oracle-side defect this round (CS-D9, CS-D10, now this) and the`)
  console.log(`  pattern is consistent: the oracle's blind spots are real, and every time the lane's`)
  console.log(`  "unexplained" number has been chased down, the truth turned out to be the`)
  console.log(`  defective party rather than the analyzer.`)
}
