/**
 * PERL-MR12 — the M59.A7 line contract, verified against the SOURCE.
 *
 * PRESENCE IS NOT CORRECTNESS. The lane emits 108,013 of 108,013 relationships
 * with a line, and a fabricated 0, or a container's line copied onto every one
 * of its members, scores identically. So this is a Tier A oracle in M59's sense:
 * for an edge claiming line L, the source line L must actually contain the name
 * the edge names. An edge whose claimed line does not contain its own name is a
 * definite defect; an edge that passes is reported CONSISTENT, never "correct" —
 * a multi-line construct can put a name on a neighbouring line, so a pass is a
 * necessary condition, and the tiers are kept apart rather than conflated.
 *
 * INDEPENDENCE BOUNDARY (M59's, restated so the claim is exact):
 *   * this file imports NO analyzer, engine, or store code;
 *   * the analyzer is called only to READ what it emitted — the thing under test;
 *   * every expected value is derived from the file's own text and its own tree;
 *   * the only thing shared with the analyzer is the tree-sitter PARSER.
 *
 * TIER A (all labels, necessary): source line L contains the target's leaf name
 *   as a whole token. Failure = INCONSISTENT.
 * TIER B (contains/overrides, exact): L is a line on which the name is WRITTEN as
 *   a declaration — a `name` field, a `varname` (sigil-stripped), a string
 *   literal, a `qw` word, or a bareword under a declaration parent. This is the
 *   #921 / c / cpp / objc trap: a `contains` edge stamped from the DECLARATION's
 *   start line instead of the name's.
 * TIER C (bounds): 1-based and inside the file. A 0 is the value M59.A7 outlawed.
 *
 * LABEL-AWARE, because one label's target is not spelled the way the edge names
 * it. A symbol this lane names `constructor` is written `new`, in four
 * spellings — `sub new`, `$obj->new`, `Foo::new`, and indirect-object
 * `new Foo(...)` (perl5's own cpan/Compress-Raw-Bzip2/t/01bzip2.t:73). Testing
 * for the literal word `constructor` fabricated thousands of failures; each gap
 * in that list was closed by pointing this oracle at the file that produced it,
 * which is the only reason the gaps surfaced.
 *
 * MUTATION SELF-TEST: the predicate is re-run against a deliberately wrong line
 * (verified + 7) and the run reports whether the mutation was caught. An oracle
 * that cannot fail is decoration, not evidence — and this one failed its own
 * first three drafts (a leaf that split on `::` only, so every dot-qualified
 * target was "inconsistent"; a Tier B that read the analyzer's `meta.nameLine`
 * instead of the source; and a walk that visited the Tree rather than
 * `.rootNode` and so reported a clean 0%).
 *
 * usage: bun script/m14/tmp/perl-lineoracle.mts [corpusDir|all] [limit]
 *   exit 0 iff INCONSISTENT == 0 and the self-test caught its mutation.
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(import.meta.dir, "..", "..", "..")
const CR = process.env.BB_PERL_CORPUS ?? "<corpus-root>/bb_tests/repositories"
const OUT = process.env.BB_PERL_OUT ?? "/tmp"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const p = new P()
p.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-perl.wasm"))))
const { RealPerlAnalyzer } = await import(path.join(ROOT, "src/ast/real-perl-analyzer.ts"))

const CORPORA: Record<string, string> = {
  mojo: `${CR}/mojo`,
  plack: `${CR}/plack`,
  // PERL-ONTO: these four paths were `cpan/<Dist-Name>` and NONE of them exists
  // on this box. The instrument reported them ABSENT rather than counting them as
  // clean -- which is the right behaviour and also why 4 of its 7 corpora had
  // been silently not running: the `implements` label gets its Tier A read-back
  // ONLY on Moose and Moo, so a green "0 INCONSISTENT" was covering 3 corpora
  // and 725 files rather than 7 and 5,774. The Moose and Moo checkouts are at
  // `moose/` and `moo/` (pinned `fadfec9` / `f0c9e7b`); Catalyst-Runtime and DBI
  // are not on the box at all and stay ABSENT, which the instrument already says
  // rather than hides.
  Moose: `${CR}/moose`,
  Moo: `${CR}/moo`,
  Catalyst: `${CR}/cpan/Catalyst-Runtime-5.90132`,
  DBI: `${CR}/cpan/DBI-1.654`,
  perl5: `${CR}/perl5`,
}

function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 12) return out
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "build" || e.name === "node_modules") continue
    const q = path.join(dir, e.name)
    if (e.isDirectory()) walk(q, out, depth + 1)
    else if (/\.(pm|pl|t)$/.test(e.name)) out.push(q)
  }
  return out
}

/**
 * The target's LEAF: `IOLoop.start` -> `start`, `Mojo::Util.encode_json` ->
 * `encode_json`. Splits on the DOT as well as the `::`, and the dot is not
 * optional: splitting on `::` only made a dot-qualified target come back whole
 * (`IOLoop.start`), after which Tier A asked the source line for those literal
 * characters — which no perl line contains. It reported 256 inconsistent edges
 * and 0 caught by its own self-test, every sample of which was visibly correct.
 */
const leafOf = (t: string): string => String(t ?? "").split(/[.:]+/).filter(Boolean).pop() ?? ""

const WHOLE = /[A-Za-z0-9_]/
function lineHasToken(lineText: string, name: string): boolean {
  if (!name) return false
  let from = 0
  for (;;) {
    const i = lineText.indexOf(name, from)
    if (i < 0) return false
    const before = i > 0 ? lineText[i - 1] : ""
    const after = lineText[i + name.length] ?? ""
    if (!WHOLE.test(before) && !WHOLE.test(after)) return true
    from = i + 1
  }
}

const IDENT = /^[@%&$*]*[A-Za-z_][A-Za-z0-9_]*(::[A-Za-z_][A-Za-z0-9_]*)*$/
const SIGIL = /^[@%&$*]+/
/** Node types whose children name a DECLARATION rather than use one. */
const DECLARATION_PARENT = /statement|expression|declaration|hash|fat_comma|element|block/

function record(out: Map<string, Set<number>>, key: string, line: number) {
  if (!key) return
  let set = out.get(key)
  if (!set) out.set(key, (set = new Set()))
  set.add(line)
}

/**
 * Tier B's source: every line on which a name is WRITTEN. Derived by this file's
 * own walk — never from the analyzer's `meta.nameLine`, because comparing an
 * output to itself is not an oracle.
 *
 * The first version recorded only `name` FIELDS, and 24% of `contains` rows came
 * back NOT-CHECKABLE while being perfectly checkable in substance:
 *
 *   Mojo::BaseUtil.pm:11  contains -> EXPORT_OK   written `our @EXPORT_OK`
 *   Mojo/Asset.pm:6       contains -> end_range   written `has 'end_range'`
 *   Mojo::Base.pm:141     contains -> constructor written `sub new`
 *   Mojo/URL.pm:9         contains -> fragment    written `has [qw(fragment ...)]`
 *   Proxy.pm:6            contains -> http        written `has [qw(http https not)]`
 *
 * A sigil, a quoted string, a `qw` list and the constructor spelling are all ways
 * perl writes a name with no `name` field. The walk records each. This makes MORE
 * rows checkable and checks each one more strictly — the exact token must still
 * appear on the exact line.
 */
function nameLines(root: any): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>()
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    for (let i = 0; i < (n.childCount ?? 0); i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
    const line = n.startPosition.row + 1
    const nm = n.childForFieldName?.("name")
    if (nm) {
      const t = String(nm.text ?? "").trim()
      if (t) {
        record(out, t, nm.startPosition.row + 1)
        if (SIGIL.test(t)) record(out, t.replace(SIGIL, ""), nm.startPosition.row + 1)
        if (t === "new" && /declaration/.test(String(n.type ?? ""))) record(out, "constructor", nm.startPosition.row + 1)
      }
    }
    if (n.type === "varname") {
      const t = String(n.text ?? "").trim()
      if (t) {
        record(out, t, line)
        if (SIGIL.test(t)) record(out, t.replace(SIGIL, ""), line)
      }
    }
    if (n.type === "string_literal" || n.type === "autoquoted_string_literal" || n.type === "string") {
      const t = String(n.text ?? "").trim().replace(/^['"]|['"]$/g, "")
      if (t && IDENT.test(t)) record(out, t, line)
    }
    if (n.type === "string_content" && /quoted_word_list|word_list/.test(String(n.parent?.type ?? ""))) {
      for (const word of String(n.text ?? "").trim().split(/\s+/)) if (word && IDENT.test(word)) record(out, word, line)
    }
    if (n.type === "bareword" || n.type === "package" || n.type === "autoquoted_bareword") {
      const t = String(n.text ?? "").trim()
      if (t && IDENT.test(t) && DECLARATION_PARENT.test(String(n.parent?.type ?? ""))) record(out, t, line)
    }
  }
  return out
}

const arg = process.argv[2]
const limit = Number(process.argv[3] ?? 100000)
const targets: Array<[string, string]> = !arg || arg === "all" ? Object.entries(CORPORA) : [[arg, CORPORA[arg] ?? arg]]

const tally: Record<string, number> = {
  edges: 0, withLine: 0, withoutLine: 0,
  tierA_consistent: 0, tierA_inconsistent: 0,
  tierB_checkable: 0, tierB_inconsistent: 0, tierB_notCheckable: 0,
  tierC_bad: 0,
}
const byLabel: Record<string, { edges: number; inconsistent: number; notCheckable: number }> = {}
const samples: any[] = []
const notCheckableSamples: any[] = []
let nameLineDiffers = 0
const nameLineDiffersSamples: any[] = []
const label = (t: string) => (byLabel[t] ??= { edges: 0, inconsistent: 0, notCheckable: 0 })

for (const [corpusName, dir] of targets) {
  if (!fs.existsSync(dir)) {
    console.log(`corpus ${corpusName}: ABSENT (${dir}) - skipped, NOT counted as clean`)
    continue
  }
  const files = walk(dir).sort().slice(0, limit)
  let cEdges = 0, cBad = 0
  for (const f of files) {
    let src: string
    try {
      src = fs.readFileSync(f, "utf8")
    } catch {
      continue
    }
    const lines = src.split(/\r?\n/)
    let root: any
    let res: any
    try {
      root = p.parse(src).rootNode
      res = new RealPerlAnalyzer().analyze(root, src, f)
    } catch {
      continue
    }
    const nfl = nameLines(root)
    // The fix's MEASURED SIZE, labelled as what it is: this reads the analyzer's
    // own `meta.nameLine` against its own `range.startLine`, so it MEASURES the
    // fix and does not verify the line. Verification is Tier A/B above, which
    // never read an analyzer field.
    for (const sym of res.symbols ?? []) {
      const nl = (sym.metadata ?? {}).nameLine
      const st = sym.range?.startLine
      if (typeof nl === "number" && typeof st === "number" && nl !== st) {
        nameLineDiffers++
        if (nameLineDiffersSamples.length < 12) nameLineDiffersSamples.push({ file: path.relative(dir, f), name: sym.name, kind: sym.kind, nameLine: nl, declarationStart: st, gap: nl - st })
      }
    }
    for (const rel of res.relationships ?? []) {
      const t = String(rel.type)
      const ln = (rel as any).line_number
      tally.edges++
      cEdges++
      const l = label(t)
      l.edges++
      const leaf = leafOf(String(rel.target ?? ""))
      const where = { file: path.relative(dir, f), label: t, target: rel.target, line: ln ?? null }
      if (typeof ln !== "number") {
        tally.withoutLine++
        l.notCheckable++
        if (samples.length < 40) samples.push({ ...where, verdict: "no-line" })
        continue
      }
      tally.withLine++
      if (!Number.isInteger(ln) || ln < 1 || ln > lines.length) {
        tally.tierC_bad++
        tally.tierA_inconsistent++
        l.inconsistent++
        cBad++
        if (samples.length < 40) samples.push({ ...where, verdict: "out-of-bounds", fileLines: lines.length })
        continue
      }
      const lineText = lines[ln - 1] ?? ""
      const ctorSpelling = leaf === "constructor" && /\bsub\s+new\b|->\s*new\b|::\s*new\b|\bnew\s+\(?[$\\]*[A-Za-z_]/.test(lineText)
      const ctorForInstantiates =
        t === "instantiates" && (ctorSpelling || /->\s*new\b|::\s*new\b/.test(lineText) || lineHasToken(lineText, String(rel.target ?? "").split(/[.:]+/)[0] ?? ""))
      const aOk = ctorSpelling || ctorForInstantiates || lineHasToken(lineText, leaf)
      if (!aOk) {
        tally.tierA_inconsistent++
        l.inconsistent++
        cBad++
        if (samples.length < 40) samples.push({ ...where, verdict: "tierA", claimed: lineText.trim().slice(0, 80) })
        continue
      }
      tally.tierA_consistent++
      if (t === "contains" || t === "overrides") {
        // Try the target AS WRITTEN before its leaf. `sub DBI::var::STORE` is
        // legal perl and declares a symbol whose NAME is the qualified string, so
        // the edge's target is qualified. Reading only the leaf looked up
        // `STORE`, found an unrelated `sub STORE` 1,000 lines down, and called a
        // correct line wrong: DBI.pm:321, claimed "sub DBI::var::STORE {...".
        // The analyzer was right; the oracle was asking about the wrong name.
        const set = nfl.get(String(rel.target ?? "")) ?? nfl.get(leaf)
        if (!set) {
          tally.tierB_notCheckable++
          l.notCheckable++
          if (notCheckableSamples.length < 15) notCheckableSamples.push({ ...where, verdict: "tierB-not-checkable" })
        } else {
          tally.tierB_checkable++
          if (!set.has(ln)) {
            tally.tierB_inconsistent++
            l.inconsistent++
            cBad++
            if (samples.length < 40) samples.push({ ...where, verdict: "tierB", claimed: lineText.trim().slice(0, 80), nameLinesHere: [...set].sort((x, y) => x - y) })
          }
        }
      }
    }
  }
  const pctEdges = cEdges ? (100 * cBad) / cEdges : 0
  console.log(`corpus ${corpusName.padEnd(9)} files=${String(files.length).padStart(5)}  edges=${String(cEdges).padStart(7)}  inconsistent=${cBad} (${pctEdges.toFixed(3)}%)`)
}

console.log("")
console.log(`edges                       ${tally.edges}`)
console.log(`  with a line               ${tally.withLine}`)
console.log(`  without a line            ${tally.withoutLine}`)
console.log(`TIER A consistent           ${tally.tierA_consistent}`)
console.log(`TIER A INCONSISTENT         ${tally.tierA_inconsistent}`)
console.log(`TIER B checkable (2 labels) ${tally.tierB_checkable}`)
console.log(`TIER B INCONSISTENT         ${tally.tierB_inconsistent}`)
console.log(`TIER B not checkable        ${tally.tierB_notCheckable}`)
console.log(`TIER C out-of-bounds lines  ${tally.tierC_bad}`)
console.log("")
console.log("label                       edges   inconsistent   not-checkable")
for (const t of Object.keys(byLabel).sort()) {
  const v = byLabel[t]
  console.log(`  ${t.padEnd(24)} ${String(v.edges).padStart(7)} ${String(v.inconsistent).padStart(12)} ${String(v.notCheckable).padStart(14)}`)
}
if (notCheckableSamples.length) {
  console.log("\nTIER B not-checkable (name not found as a written declaration here):")
  for (const s of notCheckableSamples) console.log(`  ${s.file}:${s.line}  ${s.label} -> ${s.target}`)
}
if (samples.length) {
  console.log("\nsamples (max 40):")
  for (const s of samples) console.log(`  ${s.verdict}  ${s.file}:${s.line ?? "-"}  ${s.label} -> ${s.target}` + (s.claimed ? `  claimed: ${JSON.stringify(s.claimed)}` : "") + (s.nameLinesHere ? `  written here: ${JSON.stringify(s.nameLinesHere)}` : ""))
}

console.log(`\nname-line census (analyzer-reported SIZE of the #921 fix, not a verification):`)
console.log(`  symbols where the NAME line differs from the DECLARATION start: ${nameLineDiffers}`)
if (nameLineDiffersSamples.length) for (const s of nameLineDiffersSamples) console.log(`    ${s.file}  ${s.kind} ${s.name}  name@${s.nameLine} decl@${s.declarationStart} gap=${s.gap}`)
else console.log(`    none in this draw - the corpora do not exercise the wrapped-declaration shape, so only a fixture stands between this rule and the c/cpp trap.`)

let selfTestCaught = false
{
  const src = "package M;\nsub run {\n  Mojo::IOLoop->start;\n}\n1;\n"
  const root: any = p.parse(src).rootNode
  const res: any = new RealPerlAnalyzer().analyze(root, src, "self-test.pm")
  const lines = src.split(/\r?\n/)
  const edges = (res.relationships ?? []).filter((r: any) => typeof r.line_number === "number" && String(r.target ?? "").endsWith("start"))
  for (const e of edges) {
    const good = e.line_number
    const verdictGood = lineHasToken(lines[good - 1] ?? "", leafOf(String(e.target)))
    const verdictBad = lineHasToken(lines[good + 7 - 1] ?? "", leafOf(String(e.target)))
    if (verdictGood && !verdictBad) selfTestCaught = true
  }
  if (!selfTestCaught) console.log(`\nSELF-TEST FAILED: no "start" edge was found to mutate (${edges.length} candidates). The oracle cannot be shown to fail.`)
}
console.log(`\nself-test: a +7 line shift is ${selfTestCaught ? "CAUGHT" : "NOT CAUGHT"}`)

const totalBad = tally.tierA_inconsistent + tally.tierB_inconsistent
fs.writeFileSync(path.join(OUT, "perl-lineoracle.json"), JSON.stringify({ corpora: targets.map(([n, d]) => ({ name: n, dir: d })), ...tally, byLabel, totalBad, selfTestCaught, samples, notCheckableSamples, nameLineDiffers }, null, 2) + "\n")
console.log(`\n${totalBad === 0 && selfTestCaught ? "PASS" : "FAIL"} - ${totalBad} inconsistent edges, self-test ${selfTestCaught ? "caught" : "NOT caught"}`)
process.exit(totalBad === 0 && selfTestCaught ? 0 : 1)
