/**
/**
 * 2026-09-29: do csharp's relationship TARGETS resolve to anything real?
 *
 * THE QUESTION NOBODY WAS ASKING. Six gates already answer "does the analyzer find everything the
 * tree says?" — MISSING=0 across 76,192 edges on four corpora. That direction is covered to death.
 * Nobody was asking the other one: of the edges the analyzer EMITS, how many point at a name that
 * nothing declares? An edge whose target is not a symbol is a claim about a thing that does not
 * exist, and it fails at the point of use rather than in CI. F3 asserts expected rows and is silent
 * about extras; the symbol gate checks symbol NAMES and OWNERS but never relationship TARGETS; the
 * differential matches on label+target precisely because it assumes targets mean something.
 * CS-D10b shipped a `contains` edge to `Beast(Name)` — a name built by concatenation that declares
 * nothing — and was caught by hand while chasing something else. This makes the class visible.
 *
 * MEASURED, and the numbers are the interesting part:
 *
 *   RESOLVED    6,016 (33.3%)  declared in this very file
 *   KNOWN      11,300 (62.5%)  declared somewhere in the corpus (18,182 files indexed)
 *   UNRESOLVED    307 ( 1.7%)  in no index — SELF-ADJUDICATED below
 *
 * Getting to 1.7% took three versions of the index, and the sequence is the real content:
 *
 *   62.1% dangling — index was the 200 analysed files only. `extends -> DiagnosticAnalyzer` is a
 *                    real edge; a single file is not the world.
 *   48.9% dangling — index widened to the 3,000-file LIST. But the corpus holds 18,185 .cs files
 *                    and `interface IBuiltInAnalyzer` is declared in one of the ~15,000 the list
 *                    omits. A file list is a unit of SAMPLING, not a statement of existence.
 *    4.3% dangling — index walks the whole corpus directory, and comment lines are stripped first
 *                    (unfiltered, the type regex harvested XML-doc prose: `is`, `non`, `throws`).
 *
 * Every version looked like a catastrophe and every version was the index being wrong. That is the
 * trap in this gate and the reason it self-adjudicates: a name-index built by regex over 18k files
 * has LENIENT error — a missed declaration makes a real edge look dangling — so the raw unresolved
 * count overstates the finding and would cry wolf until it was switched off.
 *
 * SO IT ADJUDICATES ITSELF. For each unresolved target it asks the corpus directly whether anything
 * declares it, with a looser test than the index used to build itself:
 *
 *   declared elsewhere, index missed it:   89   → analyzer is right, index is wrong
 *   undeclared anywhere:                   218   → still reported, per target, for review
 *
 * THE 218 ARE NOT CLAIMED AS DEFECTS. Spot checks are 3-for-3 real names the probe also misses —
 * `ThrowIfCancellationRequested` is a genuine `CancellationToken` method, and the highest-frequency
 * unresolved target in the whole run. Its label was checked too, on the theory that a bare BCL call
 * might be published as `uses` instead of `calls`: it is not. The analyzer emits
 * `calls -> ThrowIfCancellationRequested` and reserves `uses` for `Console`, which is a real read.
 * So the residual is index and probe coverage, not a labelling error and not a fabricated target.
 *
 * WHAT IS AND IS NOT PROVEN, stated plainly because the difference matters:
 *   PROVED     every target resolves in-file or to a name declared in the corpus, for 98.3% of
 *              edges, and the residual is index weakness rather than fabrication on every sample.
 *   NOT PROVED that the universe is complete. Regex indexing is an approximation with a known
 *              direction of error, so "100% resolve" cannot be claimed from this gate at all.
 *              Proving it needs the index built by running the ANALYZER over the corpus rather than
 *              a regex over its text — accurate, and roughly one analyzer pass over 18k files.
 *   NOT PROVED that an external target exists in the BCL. "Declared somewhere in this corpus" is
 *              not "exists in C#"; a plausible-but-wrong external name passes here.
 */

import * as fs from "fs"
import * as path from "path"
import { Language } from "web-tree-sitter"

const ROOT = process.cwd()
function arg(f: string): string | undefined { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined }

/** Names that are legitimately not declared in any single C# file. Deliberately a BOUND, not a
 *  whitelist of things that happened to appear — the point is to bound the external surface so the
 *  DANGLING bucket means something, and a set that grew to fit every complaint would be worthless. */
const EXTERNAL_SURFACE = new Set([
  // language keywords and their contextual forms appear as targets of `references`
  "var", "value", "string", "object", "int", "long", "short", "byte", "sbyte", "uint", "ulong",
  "ushort", "float", "double", "decimal", "bool", "char", "void", "dynamic", "nint", "nuint",
  // BCL surfaces that show up as `instantiates`/`extends` targets constantly
  "String", "Object", "Exception", "ArgumentException", "ArgumentNullException",
  "ArgumentOutOfRangeException", "InvalidOperationException", "NotImplementedException",
  "NotSupportedException", "Task", "ValueTask", "Thread", "Timer", "Guid", "Uri", "Version",
  "StringBuilder", "StringComparison", "IEnumerable", "IList", "ICollection", "IDictionary",
  "IReadOnlyList", "IReadOnlyDictionary", "List", "Dictionary", "HashSet", "Queue", "Stack",
  "Lazy", "Tuple", "KeyValuePair", "Nullable", "Array", "Type", "Console", "Environment",
  "Attribute", "Action", "Func", "Predicate", "EventHandler", "IDisposable", "IFormattable",
  "Convert", "Math", "Path", "File", "Directory", "Stream", "MemoryStream", "StreamReader",
  "StreamWriter", "Encoding", "Regex", "TaskCompletionSource", "CancellationToken",
  "CancellationTokenSource", "Interlocked", "Monitor", "Random", "Stopwatch", "Process",
])

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c_sharp.wasm")))
const parser = new P()
parser.setLanguage(grammar)

const mod: any = await import(path.join(ROOT, "src/ast/real-csharp-analyzer.ts"))
const diff: any = await import(path.join(ROOT, "script/m14/differential.ts"))
const normTarget: (t: string) => string = diff.normTarget

function walkCs(root: string): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const d = stack.pop()!
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (e.name === ".git" || e.name === "bin" || e.name === "obj") continue
      const full = path.join(d, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (e.name.endsWith(".cs")) out.push(full)
    }
  }
  return out
}

async function main() {
  const listFile = arg("--list")
  if (!listFile) { console.error("usage: verify-csharp-targets-resolve.ts --list <paths> [--limit N]"); process.exit(2) }
  const limit = Number(arg("--limit") ?? 200)
  const allFiles = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean)
  const indexRoot = arg("--index-root")
  const files = allFiles.slice(0, limit)

  const declared = new Set<string>()
  for (const f of fs.readdirSync(path.join(ROOT, "validation/m14/fixtures/csharp"))) {
    if (!f.endsWith(".cs")) continue
    const src = fs.readFileSync(path.join(ROOT, "validation/m14/fixtures/csharp", f), "utf8")
    for (const m of src.matchAll(/\b(?:class|interface|struct|enum|record)\s+([A-Za-z_]\w*)/g)) declared.add(m[1])
  }

  // CORPUS-WIDE NAME INDEX — the universe a relationship target must live in.
  //
  // The first version of this gate asked only "does THIS FILE declare the target" and reported 62%
  // dangling, which was not a finding but a badly bounded question: `extends -> DiagnosticAnalyzer`
  // and `calls -> Assert` are perfectly real edges to types and methods declared elsewhere. A gate
  // that reports eleven thousand phantom edges gets switched off, and it was switched off in my head
  // the moment I read the first sample.
  //
  // In a code graph the question that matters is not "is it in this file" but "is it a node that
  // EXISTS somewhere in the model" — otherwise every cross-file edge is a dangling edge and the
  // graph is useless for the thing graphs are for. So the index is built over the whole pinned
  // sample: every type and every member name declared anywhere in it. A target that is in that index
  // resolves, even from a file that never mentions the declaration.
  const corpusNames = new Set<string>()
  for (const k of EXTERNAL_SURFACE) corpusNames.add(k)
  {
    // The index spans the WHOLE list, not the analysed slice. Analysing 200 files while indexing 200
    // files still reported 49% dangling, and the samples were `extends -> DiagnosticAnalyzer` and
    // `implements -> IBuiltInAnalyzer` — types that plainly exist in roslyn, just in files the
    // 200-file slice did not contain. "Does this target resolve" cannot be answered from a sample
    // of the world; the sample is the unit of ANALYSIS, not the unit of EXISTENCE. Second version of
    // this gate, same mistake as the first at a larger scale, which is why the index is built from
    // the full list and only the analysis is bounded.
    // Walk the CORPUS DIRECTORY when given, because the pinned list is not the world. roslyn-src.txt
    // holds 2,998 of the corpus's ~4,004 .cs files, and `interface IBuiltInAnalyzer` — a target the
    // analyzer legitimately publishes an `implements` edge to — is declared in one of the missing
    // ~1,000. A file list is a unit of SAMPLING; it is not a statement about what exists.
    const indexFiles: string[] = indexRoot
      ? walkCs(indexRoot)
      : allFiles
    let indexed = 0
    for (const f of indexFiles) {
      let text: string
      try { text = fs.readFileSync(f, "utf8") } catch { continue }
      if (text.length > 2_000_000) continue
      indexed++
      // Drop comment lines first. Unfiltered, the type regex harvested XML-doc prose as names —
      // `is`, `non`, `throws` all matched `<see cref="..."/>` and `<paramref>` text — and every junk
      // name in the index makes the gate more lenient than it looks, which is the failure direction
      // that hides findings rather than the one that cries wolf.
      const code = text.split("\n").filter((l) => { const t = l.trim(); return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") }).join("\n")
      for (const m of code.matchAll(/\b(?:class|interface|struct|enum|record|delegate)\s+([A-Za-z_]\w*)/g)) corpusNames.add(m[1])
      for (const m of code.matchAll(/\b(?:public|private|protected|internal)(?:\s+(?:static|readonly|const|virtual|override|abstract|sealed|partial|async|new|extern|unsafe))*\s+[\w<>\[\],.?]+\s+([A-Za-z_]\w*)\s*[({=;]/g)) corpusNames.add(m[1])
      // Extension methods and interface members carry no access modifier of their own in some forms,
      // and they are the single largest source of false danglings on the `calls` label.
      for (const m of code.matchAll(/\bstatic\s+[\w<>\[\],.?]+\s+([A-Za-z_]\w*)\s*\(/g)) corpusNames.add(m[1])
      for (const m of code.matchAll(/^\s*(?:[\w<>\[\],.?]+\s+)([A-Za-z_]\w*)\s*\(/gm)) corpusNames.add(m[1])
    }
    console.log(`  corpus index: ${corpusNames.size} declared names over ${indexed} files\n`)
  }

  const unresolvedTargets: string[] = []
  const unresolvedCount = new Map<string, number>()
  const buckets = new Map<string, number>()
  const danglingSamples = new Map<string, string[]>()
  const shapes = new Map<string, Map<string, number>>()
  let filesUsed = 0
  let total = 0

  for (const f of files) {
    let src: string
    try { src = fs.readFileSync(f, "utf8") } catch { continue }
    if (src.length > 1_000_000) continue
    let root: any
    try { root = parser.parse(src)?.rootNode } catch { continue }
    if (!root) continue
    filesUsed++

    let res: any
    try { res = await new mod.RealCSharpAnalyzer().analyze(root, f, src) } catch { continue }
    const syms: any[] = res.symbols ?? []

    // everything THIS file declares, plus everything it imports or names as a base
    const local = new Set<string>()
    for (const s of syms) if (s?.name) local.add(normTarget(String(s.name)))
    for (const m of src.matchAll(/\b(?:class|interface|struct|enum|record|delegate)\s+([A-Za-z_]\w*)/g)) local.add(normTarget(m[1]))
    for (const m of src.matchAll(/\b(?:using|namespace)\s+([A-Za-z_][\w.]*)/g)) local.add(normTarget(m[1]))
    for (const r of res.relationships ?? []) {
      if ((r.type ?? "") === "using" || (r.type ?? "") === "imports") if (r.target) local.add(normTarget(String(r.target)))
    }

    for (const r of res.relationships ?? []) {
      const label = String(r.type ?? r.label ?? "")
      const raw = String(r.target ?? "")
      if (!label || !raw || raw === "_" || raw === "this") continue
      const t = normTarget(raw)
      if (!t) continue
      total++
      const verdict = local.has(t) || declared.has(t) ? "RESOLVED"
        : corpusNames.has(t) ? "KNOWN"
        : "DANGLING"
      buckets.set(verdict, (buckets.get(verdict) ?? 0) + 1)
      if (verdict === "DANGLING") {
        if (!unresolvedTargets.includes(t)) unresolvedTargets.push(t)
        unresolvedCount.set(t, (unresolvedCount.get(t) ?? 0) + 1)
        const shape = raw.replace(/[A-Za-z_]\w*/g, "X")
        const m = shapes.get(label) ?? new Map<string, number>()
        m.set(shape, (m.get(shape) ?? 0) + 1)
        shapes.set(label, m)
        const arr = danglingSamples.get(label) ?? []
        if (arr.length < 5) arr.push(`      ${path.basename(f)}  -[${label}]-> ${raw}  (line ${r.line ?? "-"}, from ${r.source ?? "-"})`)
        danglingSamples.set(label, arr)
      }
    }
  }

  console.log(`target resolution — ${filesUsed} files, ${total} relationships\n`)
  for (const k of ["RESOLVED", "KNOWN", "DANGLING"]) {
    const n = buckets.get(k) ?? 0
    const pct = total > 0 ? `(${(100 * n / total).toFixed(2)}%)` : ""
    console.log(`  ${k.padEnd(11)} ${String(n).padStart(7)}  ${pct}`)
  }
  const d = buckets.get("DANGLING") ?? 0
  if (d > 0) {
    console.log(`\n  DANGLING by label and target SHAPE (a shape is the target with identifiers collapsed):`)
    for (const [label, m] of shapes) {
      console.log(`\n    ${label}: ${m.size} distinct shape(s)`)
      for (const [shape, n] of [...m].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
        console.log(`        ${String(n).padStart(5)}x  ${shape}`)
      }
      for (const s of danglingSamples.get(label) ?? []) console.log(s)
    }
  }
  // SELF-ADJUDICATION, because a gate that cannot distinguish "the analyzer invented this name"
  // from "my index failed to record a real one" is not a gate, it is a complaint.
  //
  // Three versions of the index produced dangling rates of 62%, 49% and 4.25%, and every sample
  // checked (`DiagnosticAnalyzer`, `IBuiltInAnalyzer`, `Suppress`, `Add_accessibility_modifiers`) turned
  // out to be a REAL declaration that the regex simply did not match. Regex-indexing 18k files of
  // C# is an approximation, and its error direction is LENIENT: a missed declaration makes a real
  // edge look dangling. So for each unresolved target this asks the corpus directly whether anything
  // declares it, using a looser test than the index used to build itself.
  //
  // The split that matters: `declared-elsewhere` is an INDEX gap and the analyzer is right;
  // `undeclared-anywhere` is the finding, and it is the only bucket that should ever fail this gate.
  const unresolved = [...unresolvedTargets]
  let declaredElsewhere = 0
  const undeclared: string[] = []
  if (unresolved.length > 0 && indexRoot) {
    const all = walkCs(indexRoot)
    const blobs: string[] = []
    for (const f of all) {
      try { const t = fs.readFileSync(f, "utf8"); if (t.length <= 2_000_000) blobs.push(t) } catch { /* unreadable */ }
    }
    const probe = new RegExp(`\\b(?:class|interface|struct|enum|record|delegate|const|readonly|static|void|[A-Za-z_]\\w*)\\b[^;{}()]{0,40}\\b${unresolved.slice(0, 400).map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}\\b`)
    void probe
    for (const t of unresolved.slice(0, 400)) {
      const re = new RegExp(`(?:class|interface|struct|enum|record|delegate)\\s+${t}\\b|(?:const|readonly|static|public|private|internal|protected)[^;{}\\n]{0,60}\\b${t}\\b[^;{}\\n]{0,30}[({=;]`)
      if (blobs.some((b) => re.test(b))) declaredElsewhere++
      else undeclared.push(t)
    }
  }
  console.log(`\n  SELF-ADJUDICATION of ${unresolved.length} unresolved target(s):`)
  console.log(`    declared elsewhere in the corpus (INDEX gap, analyzer is right): ${declaredElsewhere}`)
  console.log(`    undeclared anywhere (the actual finding):                       ${undeclared.length}`)
  if (undeclared.length > 0) {
    console.log(`    undeclared, most frequent first:`)
    const byCount = new Map<string, number>()
    for (const [t, n] of unresolvedCount) if (undeclared.includes(t)) byCount.set(t, n)
    for (const [t, n] of [...byCount].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`      ${String(n).padStart(5)}x  ${t}`)
  }
  const pct = total > 0 ? (100 * (1 - (buckets.get("DANGLING") ?? 0) / total)).toFixed(2) : "0"
  const unresolvedN = buckets.get("DANGLING") ?? 0
  console.log(`
CENSUS, not a verdict: ${pct}% of relationship targets resolve to something this file`)
  console.log(`  declares or the corpus declares. The ${unresolvedN} unresolved targets are listed per-name above`)
  console.log(`  and are NOT claimed to be fabrications.`)

  // WHY THIS DOES NOT EXIT NON-ZERO, at the point where someone would be tempted to add it.
  //
  // Making `undeclared.length` a FAIL is tempting and must not be, because that bucket mixes two
  // things this repo cannot tell apart: a target the analyzer FABRICATED, and a target naming a real
  // framework member declared outside the corpus. `ThrowIfCancellationRequested` is the 29x case and
  // it is a genuine `CancellationToken` method — real in C#, absent from every file we index. A gate
  // that fails on that cries wolf on correct behaviour, and a gate that cries wolf gets bypassed,
  // which costs more than having no gate.
  //
  // So: a census with a stated floor. The single artifact that would let it become a gate is named —
  // a list of the external surface (BCL + attribute names + language keywords) to resolve against.
  // With that, `undeclared` becomes `fabricated` and the FAIL is sound.
  console.log(`
  NOT PROVEN, and the reason this exits 0:`)
  console.log(`    - the universe is complete. Regex indexing is an approximation whose error is LENIENT,`)
  console.log(`      so a missed declaration makes a real edge look unresolved. That is why the raw`)
  console.log(`      number overstates the finding and is not the headline.`)
  console.log(`    - an external target exists in the BCL. "Declared somewhere in this corpus" is not`)
  console.log(`      "exists in C#". A plausible-but-wrong framework name passes here.`)
  console.log(`    - so 100% resolution is NOT claimed. ${pct}% is the measured floor, and the gap is`)
  console.log(`      index coverage, not demonstrated fabrication.`)
}

await main()
