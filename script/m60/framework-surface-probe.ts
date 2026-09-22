// script/m60/framework-surface-probe.ts — the RUNTIME half of the framework-surface rule.
//
// The static census (script/m60/framework-surface-census.ts) proves what a source site
// LOOKS like. It cannot prove what the analyzer PUBLISHES: a `.push` of nine distinct
// names in straight line is not a duplicate, and the same `.push` inside a walker is one
// duplicate per node. Multiplicity is a property of the run, so it is measured here.
//
// Five assertions, on the metadata of every analyzed file:
//
//   A1 array       `detectedFrameworks` is present and an Array (the family contract)
//   A2 dedupe      no entry appears twice
//   A3 primary     a primary pick exists EXACTLY when something was detected — the
//                  contract's `framework` key must not be absent-when-detected, and must
//                  not name a framework when nothing was detected
//   A4 aligned     every `frameworkPatterns[i].framework` is one of `detectedFrameworks`
//   A5 one name    no emitted framework name is a strict substring of another emitted
//                  name (ruby publishes "Rails" and "Ruby on Rails" for one framework)
//
// Run over two corpora, because they answer different questions:
//   * --fixtures: one inline trigger per OO language. This is the only place the
//     "the capability claim predicts detection" question can be asked: a language whose
//     analyzer claims `hasFrameworkIntelligence: true` must detect its own framework
//     from a minimal file that uses it.
//   * --repos: real files from the pinned corpora. This is where duplication, alignment
//     and single-naming are measured on code nobody wrote for the probe.
//
// Run: bun script/m60/framework-surface-probe.ts [--repos] [--emit] [--all]
//   default: fixtures only | --repos: fixtures + corpus draw | --all: no per-repo cap
import * as fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS = "$HOME/fixtures/repositories"
const OUT = path.join(ROOT, "validation/m60/results/framework-surface-runtime.json")

interface Lane {
  lang: string
  wasm: string
  ext: string[]
  /** dynamic import + export name, so the probe loads analyzers the same way the pipeline does */
  module: string
  exportName: string
  repos: string[]
  /**
   * Cases this lane must get right. The first is the plain positive trigger; any case
   * with a non-null `expectDetected` that detects nothing is recorded as A6-claim (the
   * analyzer claims the capability, so it must detect the framework from a minimal file
   * that uses it). `expectDetected: null` is a NEGATIVE CONTROL — a file that uses no
   * framework must detect none, so a marker table that fires on anything is caught here.
   */
  cases: { name: string; src: string; expectDetected: string | null; expectAbsent?: string[]; note?: string }[]
}

const LANES: Lane[] = [
  {
    lang: "ruby", wasm: "tree-sitter-ruby.wasm", ext: [".rb"],
    module: "../../src/ast/real-ruby-analyzer", exportName: "RealRubyAnalyzer", repos: ["rake", "rack"],
    cases: [
      { name: "rails-model", src: `class User < ApplicationRecord\n  has_many :posts\nend\n`, expectDetected: "Ruby on Rails" },
      { name: "rails-controller-render", src: `class UsersController < ApplicationController\n  def show\n    render :json => {}\n  end\nend\n`, expectDetected: "Ruby on Rails" },
      { name: "plain-ruby", src: `class Plain\n  def go\n    1\n  end\nend\n`, expectDetected: null, expectAbsent: ["Ruby on Rails"] },
    ],
  },
  {
    lang: "python", wasm: "tree-sitter-python.wasm", ext: [".py"],
    module: "../../src/ast/real-python-analyzer", exportName: "RealPythonAnalyzer", repos: ["requests", "cython"],
    cases: [
      { name: "django-model", src: `from django.db import models\n\n\nclass User(models.Model):\n    name = models.CharField(max_length=10)\n`, expectDetected: "Django" },
      { name: "flask-app", src: `from flask import Flask\n\napp = Flask(__name__)\n`, expectDetected: "Flask" },
      { name: "plain-python", src: `x = 1\n`, expectDetected: null },
    ],
  },
  {
    lang: "php", wasm: "tree-sitter-php.wasm", ext: [".php"],
    module: "../../src/ast/real-php-analyzer", exportName: "RealPhpAnalyzer", repos: ["phpunit", "slim", "phpmyadmin"],
    cases: [
      { name: "laravel-illuminate", src: `<?php\nnamespace App\\Http\\Controllers;\n\nuse Illuminate\\Http\\Request;\n\nclass UserController extends Controller\n{\n}\n`, expectDetected: "Laravel" },
      { name: "laravel-app-root-only", src: `<?php\nnamespace App\\Http\\Controllers;\n\nclass UserController extends Controller\n{\n}\n`, expectDetected: "Laravel", note: "measured GAP: the `App\\` root marker is compared against a trailing backslash no namespace text carries" },
      { name: "phpunit-use-statement", src: `<?php\nnamespace Tests;\n\nuse PHPUnit\\Framework\\TestCase;\n\nclass MyTest extends TestCase\n{\n}\n`, expectDetected: "PHPUnit" },
      { name: "phpunit-global-base", src: `<?php\n\nclass MyTest extends TestCase\n{\n}\n`, expectDetected: "PHPUnit", note: "measured GAP: the bare `TestCase` marker is compared against the NAMESPACE text, which is empty here" },
      { name: "plain-php", src: `<?php\n\nfunction helper() { return 1; }\n`, expectDetected: null, expectAbsent: ["Laravel", "PHPUnit"] },
    ],
  },
  {
    lang: "csharp", wasm: "tree-sitter-c_sharp.wasm", ext: [".cs"],
    module: "../../src/ast/real-csharp-analyzer", exportName: "RealCSharpAnalyzer", repos: ["powershell", "fsharp"],
    cases: [
      { name: "aspnet-core-controller", src: `using Microsoft.AspNetCore.Mvc;\n\npublic class HomeController : Controller\n{\n}\n`, expectDetected: "ASP.NET Core" },
      { name: "xunit-test", src: `using Xunit;\n\npublic class MyTests\n{\n    [Fact]\n    public void Works() {}\n}\n`, expectDetected: "xUnit" },
      { name: "plain-csharp", src: `public class Plain {}\n`, expectDetected: null },
    ],
  },
  {
    lang: "objective-c", wasm: "tree-sitter-objc.wasm", ext: [".m"],
    module: "../../src/ast/real-objective-c-analyzer", exportName: "RealObjectiveCAnalyzer", repos: ["afnetworking", "sdwebimage"],
    cases: [
      { name: "uikit-view", src: `#import <UIKit/UIKit.h>\n\n@interface MyView : UIView\n@end\n`, expectDetected: "UIKit" },
      { name: "plain-objc", src: `int main(void) { return 0; }\n`, expectDetected: null },
    ],
  },
  {
    lang: "swift", wasm: "tree-sitter-swift.wasm", ext: [".swift"],
    module: "../../src/ast/real-swift-analyzer", exportName: "RealSwiftAnalyzer", repos: ["alamofire", "swift-nio"],
    cases: [
      { name: "swiftui-view", src: `import SwiftUI\n\nstruct ContentView: View {\n  var body: some View { Text("hi") }\n}\n`, expectDetected: "SwiftUI" },
      { name: "uikit-view", src: `import UIKit\n\nclass V: UIView {}\n`, expectDetected: "UIKit" },
      { name: "plain-swift", src: `let x = 1\n`, expectDetected: null },
    ],
  },
  {
    lang: "dart", wasm: "tree-sitter-dart.wasm", ext: [".dart"],
    module: "../../src/ast/real-dart-analyzer", exportName: "RealDartAnalyzer", repos: ["dart-http"],
    cases: [
      { name: "flutter-widget", src: `import 'package:flutter/material.dart';\n\nclass MyApp extends StatelessWidget {\n  Widget build(BuildContext context) => Container();\n}\n`, expectDetected: "Flutter" },
      // Dart measures differently: the analyzer reports the SDK name "Dart" for any Dart file
      // (measured), so the negative control here is "the SDK and nothing else" — Flutter must
      // be ABSENT. A marker table that fired on anything would break the absence half too.
      { name: "plain-dart", src: `int add(int a, int b) => a + b;\n`, expectDetected: "Dart", expectAbsent: ["Flutter"] },
    ],
  },
]

export type AssertionId = "A1-array" | "A2-dedupe" | "A3-primary" | "A4-aligned" | "A5-one-name" | "A6-claim"

export interface RuntimeFinding {
  lang: string
  file: string
  assertion: AssertionId
  detail: string
}

/** The contract assertions. Pure, so the probe's self-tests can drive them. */
export function checkMetadata(meta: any): { id: AssertionId; detail: string }[] {
  const out: { id: AssertionId; detail: string }[] = []
  if (!meta || typeof meta !== "object") return out
  const raw = meta.detectedFrameworks
  // A1: the key, when the analyzer publishes the collection contract, must be an array.
  const claims = meta.hasFrameworkIntelligence === true
  if (raw !== undefined && !Array.isArray(raw)) {
    out.push({ id: "A1-array", detail: `detectedFrameworks is ${typeof raw}, not an array` })
    return out
  }
  if (raw === undefined) {
    if (claims) out.push({ id: "A1-array", detail: "claims hasFrameworkIntelligence but publishes no detectedFrameworks" })
    return out
  }
  const det: string[] = raw.map((x: unknown) => String(x))
  // A2: no entry twice.
  const seen = new Set<string>()
  const dupes: string[] = []
  for (const d of det) { if (seen.has(d)) dupes.push(d); seen.add(d) }
  if (dupes.length) out.push({ id: "A2-dedupe", detail: `${dupes.length} duplicate entr(ies): ${[...new Set(dupes)].join(", ")}` })
  // A3: a primary pick exists exactly when something was detected.
  if (det.length > 0 && meta.framework === undefined) {
    out.push({ id: "A3-primary", detail: `detected [${det.join(", ")}] but no primary pick published` })
  }
  if (det.length === 0 && meta.framework !== undefined) {
    out.push({ id: "A3-primary", detail: `published primary ${JSON.stringify(meta.framework)} while detecting nothing` })
  }
  // A4 + A5: the patterns agree with the detection, and one framework has one name.
  const pats: any[] = Array.isArray(meta.frameworkPatterns) ? meta.frameworkPatterns : []
  const patNames = pats.map((p) => String(p?.framework)).filter((n) => n && n !== "undefined")
  const stray = patNames.filter((n) => !seen.has(n))
  if (stray.length) out.push({ id: "A4-aligned", detail: `patterns name ${[...new Set(stray)].join(", ")} which detection does not list` })
  const all = [...new Set([...det, ...patNames])]
  const divergent = all.filter((a) => all.some((b) => b !== a && a.length < b.length && b.includes(a)))
  if (divergent.length) {
    out.push({ id: "A5-one-name", detail: `one framework under two names: ${divergent.map((d) => `${d} ⊂ ${all.find((b) => d.length < b.length && b.includes(d))}`).join(", ")}` })
  }
  return out
}

async function mkParser(wasm: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const language = await L.load(fs.readFileSync(path.join(ROOT, "wasm", wasm)))
  const p = new P()
  p.setLanguage(language)
  return p
}

/**
 * A DETERMINISTIC draw: every matching file is collected, the list is SORTED, and only
 * then is the cap applied. The first version capped by readdir order, so the same command
 * produced a different population on each run (ruby returned 184 files against a cap of
 * 150, because a directory's worth of matches was pushed between cap checks) and a clean
 * run could not be compared with the next one. A measurement that cannot be re-run is not
 * evidence.
 */
function filesIn(repos: string[], ext: string[], cap: number): string[] {
  const out: string[] = []
  for (const repo of repos) {
    const base = path.join(CORPUS, repo)
    if (!fs.existsSync(base)) continue
    const found: string[] = []
    const stack = [base]
    while (stack.length) {
      const dir = stack.pop()!
      let entries: fs.Dirent[]
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
      for (const e of entries) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name === ".git" || e.name === "node_modules" || e.name === "vendor") continue
          stack.push(p)
        } else if (ext.some((x) => e.name.endsWith(x))) found.push(p)
      }
    }
    found.sort()
    out.push(...found.slice(0, cap))
  }
  return out
}

interface CaseResult {
  name: string
  detected: string[]
  primary: unknown
  expected: string | null
  ok: boolean
  note?: string
  findings: RuntimeFinding[]
}

interface LaneResult {
  lang: string
  cases: CaseResult[]
  corpus: { files: number; withDetection: number; findings: RuntimeFinding[]; byAssertion: Record<string, number> }
}

async function main() {
  const doRepos = process.argv.includes("--repos")
  const cap = process.argv.includes("--all") ? 100000 : 150
  const results: LaneResult[] = []
  for (const lane of LANES) {
    const parser = await mkParser(lane.wasm)
    const mod: any = await import(lane.module)
    const Cls = mod[lane.exportName]
    if (!Cls) { console.error(`MISSING analyzer export ${lane.exportName} in ${lane.module}`); continue }
    const analyze = async (src: string, file: string) => {
      const root = parser.parse(src).rootNode
      return await new Cls().analyze(root, src, file)
    }
    // --- cases: does the capability claim predict detection from a minimal trigger? ---
    const caseResults: CaseResult[] = []
    for (const c of lane.cases) {
      const cr: any = await analyze(c.src, `probe${lane.ext[0]}`)
      const meta = cr?.metadata ?? {}
      const detected: string[] = Array.isArray(meta.detectedFrameworks) ? meta.detectedFrameworks : []
      const findings = checkMetadata(meta).map((f) => ({ lang: lane.lang, file: `case:${c.name}`, assertion: f.id, detail: f.detail }))
      const absentHit = (c.expectAbsent ?? []).filter((a) => detected.includes(a))
      const ok = (c.expectDetected === null ? detected.length === 0 : detected.includes(c.expectDetected)) && absentHit.length === 0
      // A6: the analyzer CLAIMS the capability (so it must detect from a file that uses
      // the framework). A negative control that detects something is the same defect
      // inverted, and is recorded under the same id.
      if (!ok) {
        findings.push({
          lang: lane.lang,
          file: `case:${c.name}`,
          assertion: "A6-claim",
          detail: absentHit.length
            ? `a file that uses no such framework still reported ${JSON.stringify(absentHit)} (detection returned ${JSON.stringify(detected)})`
            : c.expectDetected === null
              ? `no framework is used, yet detection returned ${JSON.stringify(detected)}`
              : `a file using ${c.expectDetected} detected ${JSON.stringify(detected)}`,
        })
      }
      caseResults.push({ name: c.name, detected, primary: meta.framework, expected: c.expectDetected, ok, note: c.note, findings })
    }
    // --- corpus ---
    const files = doRepos ? filesIn(lane.repos, lane.ext, cap) : []
    const findings: RuntimeFinding[] = []
    let withDetection = 0
    for (const f of files) {
      let src: string
      try { src = fs.readFileSync(f, "utf8") } catch { continue }
      if (src.length > 400_000) continue
      let r: any
      try { r = await analyze(src, path.relative(CORPUS, f)) } catch { continue }
      const m = r?.metadata
      if (!m) continue
      if (Array.isArray(m.detectedFrameworks) && m.detectedFrameworks.length) withDetection++
      for (const fd of checkMetadata(m)) findings.push({ lang: lane.lang, file: path.relative(CORPUS, f), assertion: fd.id, detail: fd.detail })
    }
    const byAssertion: Record<string, number> = {}
    for (const f of findings) byAssertion[f.assertion] = (byAssertion[f.assertion] ?? 0) + 1
    results.push({ lang: lane.lang, cases: caseResults, corpus: { files: files.length, withDetection, findings, byAssertion } })
    console.log(`\n=== ${lane.lang}`)
    for (const c of caseResults) {
      console.log(`  case ${c.name}: detected=${JSON.stringify(c.detected)} primary=${JSON.stringify(c.primary)} expected=${JSON.stringify(c.expected)} -> ${c.ok ? "OK" : "MISS"}`)
      if (c.note) console.log(`      note: ${c.note}`)
      for (const f of c.findings) console.log(`      ${f.assertion}: ${f.detail}`)
    }
    if (doRepos) {
      console.log(`  corpus: ${files.length} file(s), ${withDetection} with detection, ${findings.length} finding(s) ${JSON.stringify(byAssertion)}`)
      for (const f of findings.slice(0, 6)) console.log(`    ${f.assertion} ${f.file}: ${f.detail}`)
    }
  }

  const totals = { files: 0, withDetection: 0, findings: 0, casesOk: 0, casesTotal: 0, claimMisses: 0 }
  for (const r of results) {
    totals.files += r.corpus.files
    totals.withDetection += r.corpus.withDetection
    totals.findings += r.corpus.findings.length
    for (const c of r.cases) {
      totals.casesTotal++
      if (c.ok) totals.casesOk++
      if (c.findings.some((f) => f.assertion === "A6-claim")) totals.claimMisses++
    }
  }
  console.log(`\n--- runtime contract: cases ${totals.casesOk}/${totals.casesTotal} behave (${totals.claimMisses} claim miss) | corpus ${totals.files} file(s) (${totals.withDetection} with detection), ${totals.findings} contract finding(s)`)

  if (process.argv.includes("--emit")) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true })
    fs.writeFileSync(OUT, JSON.stringify({
      gate: "M60.R8",
      half: "runtime",
      at: new Date().toISOString(),
      method:
        "the emitted metadata of each OO analyzer is checked against five contract assertions (A1 array, A2 dedupe, A3 primary-presence, A4 patterns-subset, A5 single-name) over two corpora: an inline minimal framework trigger per language, and a real-file draw from the pinned corpora in $HOME/fixtures/repositories. Multiplicity cannot be decided statically, which is why this half exists.",
      assertions: ["A1-array", "A2-dedupe", "A3-primary", "A4-aligned", "A5-one-name", "A6-claim"],
      corpusRoot: CORPUS,
      perRepoCap: cap,
      totals,
      lanes: results,
    }, null, 2) + "\n")
    console.log(`  -> ${path.relative(ROOT, OUT)}`)
  }
}

// ============================================================================
// Self-tests: the assertions must catch each contract breach, and must not fire on a
// compliant metadata object. Without these the probe's silence would be unreadable.
// ============================================================================
const SELF_TESTS: { name: string; meta: any; expect: AssertionId[] }[] = [
  { name: "a compliant metadata object is clean", meta: { framework: "Django", detectedFrameworks: ["Django"], frameworkPatterns: [{ framework: "Django", patterns: [] }], hasFrameworkIntelligence: true }, expect: [] },
  { name: "duplicates are convicted", meta: { framework: "Rails", detectedFrameworks: ["Rails", "Rails"] }, expect: ["A2-dedupe"] },
  { name: "detection with no primary pick is convicted", meta: { detectedFrameworks: ["Rails"] }, expect: ["A3-primary"] },
  { name: "a primary pick with no detection is convicted", meta: { framework: "Rails", detectedFrameworks: [] }, expect: ["A3-primary"] },
  { name: "a pattern naming an undetected framework is convicted", meta: { framework: "Django", detectedFrameworks: ["Django"], frameworkPatterns: [{ framework: "Flask" }] }, expect: ["A4-aligned"] },
  { name: "one framework under two names is convicted", meta: { framework: "Ruby on Rails", detectedFrameworks: ["Ruby on Rails"], frameworkPatterns: [{ framework: "Rails" }] }, expect: ["A4-aligned", "A5-one-name"] },
  { name: "a non-array detection is convicted", meta: { detectedFrameworks: "Rails" }, expect: ["A1-array"] },
  { name: "a capability claim with no collection is convicted", meta: { hasFrameworkIntelligence: true }, expect: ["A1-array"] },
  { name: "an analyzer with no framework metadata is not convicted", meta: { complexity: 3 }, expect: [] },
]

if (process.argv.includes("--self-test")) {
  let bad = 0
  for (const t of SELF_TESTS) {
    const got = checkMetadata(t.meta).map((f) => f.id).sort()
    const want = [...t.expect].sort()
    if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(`FAIL ${t.name}: expected [${want}], got [${got}]`); bad++ }
  }
  console.log(`runtime-probe self-tests: ${SELF_TESTS.length - bad}/${SELF_TESTS.length} passed`)
  process.exit(bad ? 2 : 0)
}

main()
