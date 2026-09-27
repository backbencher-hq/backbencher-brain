// script/m60/framework-surface-probe.ts — the RUNTIME half of the framework-surface rule.
//
// The static census (script/m60/framework-surface-census.ts) proves what a source site
// LOOKS like. It cannot prove what the analyzer PUBLISHES: a `.push` of nine distinct
// names in straight line is not a duplicate, and the same `.push` inside a walker is one
// duplicate per node. Multiplicity is a property of the run, so it is measured here.
//
// Six assertions, on the metadata of every analyzed file:
//
//   A1 array       `detectedFrameworks` is present and an Array (the family contract)
//   A2 dedupe      no entry appears twice
//   A3 primary     a primary pick exists EXACTLY when something was detected — the
//                  contract's `framework` key must not be absent-when-detected, and must
//                  not name a framework when nothing was detected
//   A4 aligned     every `frameworkPatterns[i].framework` is one of `detectedFrameworks`
//   A5 one name    no emitted framework name is a strict substring of another emitted
//                  name (ruby publishes "Rails" and "Ruby on Rails" for one framework)
//   A7 presence    the three keys are ONE claim, but only where each carries a fact: a
//                  payload that DETECTED something must publish `detectedFrameworks`,
//                  `framework` and `frameworkPatterns`. Added after objective-c's missing
//                  `frameworkPatterns` measured clean here (153 files, 0 findings) while the
//                  census convicted it — A4/A5 read an absent pattern array as an empty one,
//                  so a missing key was invisible. Deliberately not per-file: see the note
//                  on `checkPresence` for the 189-file ruby measurement that ruled that out.
//
// Run over two corpora, because they answer different questions:
//   * --fixtures: one inline trigger per OO language. This is the only place the
//     "the capability claim predicts detection" question can be asked: a language whose
//     analyzer claims `hasFrameworkIntelligence: true` must detect its own framework
//     from a minimal file that uses it.
//   * --repos: real files from the pinned corpora. This is where duplication, alignment
//     and single-naming are measured on code nobody wrote for the probe.
//
// AND a second, separately-reported sweep over the PUBLISHED payload (--published).
// The analyzer sweep above measures what each analyzer EMITS. The product publishes a
// different object: `ASTEngine.parseFile` post-processes every result through
// `enhanceWithFrameworkIntelligence`, which merges a second detector's detections,
// re-promotes `framework`, and appends its own pattern objects to `frameworkPatterns`.
// The same assertions over the published metadata answer the question R8 actually
// asks — "does this code publish a framework capability it does not have" — because
// that is the object a consumer sees. The two sweeps are reported and counted
// separately: a finding in one is not a finding in the other, and collapsing them would
// make the analyzer half's clean rows hide a pipeline finding.
//
// Run: bun script/m60/framework-surface-probe.ts [--repos] [--emit] [--all] [--published]
//   default: fixtures only | --repos: fixtures + corpus draw | --all: no per-repo cap
//   --published: additionally sweep the engine-published payload over the same files
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
  cases: {
    name: string
    src: string
    expectDetected: string | null
    expectAbsent?: string[]
    /** a pattern the framework contract must carry for this trigger (pins reachability) */
    expectPattern?: { framework: string; pattern: string }
    /**
     * Route THIS case through `ASTEngine.parseFile` instead of the analyzer class
     * directly (#932).
     *
     * The case half calls the analyzer, so it measures the analyzer's metadata — right
     * for A6 (does the claimed capability fire on a minimal trigger?) and wrong for
     * anything the engine adds or rewrites afterwards. `enhanceWithFrameworkIntelligence`
     * unions the analyzer's list with a detector whose vocabulary is its own slug table
     * and then canonicalises BOTH through FRAMEWORK_ALIASES, which is why a lane could
     * publish one framework under two names in the object a consumer actually reads
     * while every case here stayed green. A case that pins the PUBLISHED list sets this.
     */
    viaPublished?: boolean
    note?: string
  }[]
}

const LANES: Lane[] = [
  // M14 (#288): html joins the runtime half of the framework-surface rule. The
  // static half already enumerated it — `validation/m60/results/
  // framework-surfaces.json` carries an html row with one site at
  // real-html-analyzer.ts:379, verdict `reported` — but the RUNTIME probe's
  // LANES held seven OO lanes and had never executed against an html file, which
  // is why the pre-fix analyzer published `Targeted/ID-Styling` into
  // detectedFrameworks for 88.5% of corpus files with NOTHING able to see it. The
  // class is a CSS technique, not a framework: it appears once in the whole
  // repository and `framework-intelligence.ts`'s own policy set does not admit it.
  // Two of the three cases below are the ones that must NOT detect anything — a
  // document with ids, classes and a web component is the shape that used to
  // fabricate a framework name, so a detector that still does is convicted here.
  {
    lang: "html", wasm: "tree-sitter-html.wasm", ext: [".html", ".htm"],
    module: "../../src/ast/real-html-analyzer", exportName: "RealHtmlAnalyzer", repos: ["otp", "sqlite"],
    cases: [
      { name: "web-components", src: `<!doctype html>\n<html><body>\n<my-element is="my-element" id="w"></my-element>\n</body></html>\n`, expectDetected: "Web Components" },
      // `HTML5` is this lane's DOCUMENTED primary — framework-intelligence.ts:924
      // names it as a deliberate non-PURE_LANGUAGE_PRIMARY ("e.g. HTML 'HTML5' …
      // are treated as real primaries and never overwritten"), the same promotion
      // policy as python's `"Dart"`. So `expectDetected: null` is the WRONG
      // expectation here and a plain document is not a defect: the document IS
      // HTML5. What must not appear is a SECOND name, and `expectDetected` is a
      // containment check, so the fabricated name would ride along inside a green
      // case. `expectAbsent` is therefore the load-bearing assertion on all three
      // cases — it is the only channel that can convict a name the analyzer
      // invented, which is the entire class this lane was added to measure.
      { name: "ids-and-classes-are-not-frameworks", src: `<!doctype html>\n<html><head><link rel="stylesheet" href="/a.css"></head>\n<body><div id="app" class="container shell"><span class="row">x</span></div></body></html>\n`, expectDetected: "HTML5", expectAbsent: ["Targeted/ID-Styling"], note: "the measured pre-fix shape: ANY element with an id published a framework name, on 88.5% of corpus files" },
      { name: "plain-document", src: `<!doctype html>\n<html><body><h1>Title</h1><p>Text.</p></body></html>\n`, expectDetected: "HTML5", expectAbsent: ["Targeted/ID-Styling"] },
      { name: "web-components-absent", src: `<!doctype html>\n<html><body><div id="x" class="y">plain</div></body></html>\n`, expectDetected: "HTML5", expectAbsent: ["Targeted/ID-Styling", "Web Components"] },
    ],
  },
  {
    lang: "ruby", wasm: "tree-sitter-ruby.wasm", ext: [".rb"],
    module: "../../src/ast/real-ruby-analyzer", exportName: "RealRubyAnalyzer", repos: ["rake", "rack"],
    cases: [
      { name: "rails-model", src: `class User < ApplicationRecord\n  has_many :posts\nend\n`, expectDetected: "Ruby on Rails" },
      { name: "rails-controller-render", src: `class UsersController < ApplicationController\n  def show\n    render :json => {}\n  end\nend\n`, expectDetected: "Ruby on Rails" },
      // #749: `before_action` is in RAILS_MACRO_METHODS, whose branch RETURNS, so the
      // trigger that would record the callback pattern sat after the return and could
      // never fire. This case is the regression pin: it asserts the PATTERN, not just the
      // detection, because the detection was reachable the whole time.
      { name: "rails-before-action", src: `class UsersController < ApplicationController\n  before_action :authenticate\nend\n`, expectDetected: "Ruby on Rails", expectPattern: { framework: "Ruby on Rails", pattern: "Callbacks" } },
      { name: "plain-ruby", src: `class Plain\n  def go\n    1\n  end\nend\n`, expectDetected: null, expectAbsent: ["Ruby on Rails"] },
      // #932 — one framework, ONE name, measured at the PUBLISHED seam. The analyzer
      // publishes `"Ruby on Rails"` (RAILS_FRAMEWORK) while framework-intelligence's
      // `detectRubyFrameworks` adds the slug `"rails"` and `canonicalizeDetections`
      // dedupes by ALIASED lowercase — two different keys, so both landed in one payload
      // and a consumer keying on the framework string saw two frameworks. Only this case
      // can see it: the analyzer half is correct on its own, and the merge happens after
      // it. `expectAbsent` is the load-bearing half — the OLD slug must be GONE.
      { name: "rails-require-and-leaf", src: `require 'rails'\n\nclass User < ActiveRecord::Base\nend\n`, expectDetected: "Ruby on Rails", expectAbsent: ["rails"], viaPublished: true, note: "was the #932 duplicate: the published list read [\"Ruby on Rails\",\"rails\"]" },
      // #749/#932-class, PUBLISHED-seam only. `detectRubyFrameworks` carried a bare
      // `describe ` trigger beside `require 'rspec'`, and rack's test/ directory is
      // minitest/spec: measured 36 of 190 pinned-corpus files publishing ["rspec"]
      // with ZERO requiring rspec — the analyzer never reads `describe`, its own
      // comments call these files minitest specs, and require-level evidence was
      // 0 true / 36 false. The trigger could not tell rspec from minitest/spec, so
      // it is GONE; require 'rspec' remains, and the positive control below proves
      // the require path still fires (a negative control that lost its trigger
      // silently would read the same as one that never had it).
      { name: "plain-describe-minitest", src: `require_relative "helper"\n\ndescribe Rack::Static do\n  it "serves files" do\n  end\nend\n`, expectDetected: null, expectAbsent: ["rspec", "minitest"], viaPublished: true, note: "was a live false positive: rack's 36 minitest/spec files published [\"rspec\"]" },
      { name: "rspec-require-positive", src: `require 'rspec'\n`, expectDetected: "rspec", viaPublished: true, note: "positive control: the require-level rspec trigger still fires after the bare-describe removal" },
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
      // FIXED 2026-09-24 (#931, commit 57df923f). The note here read "measured GAP" from
      // 2026-09-22 until the marker was repaired: `text === "App\\"` was an exact match on a
      // namespace string ENDING in a separator, which no node's text carries, so the case
      // MISSED while claiming Laravel — for a week, with R8 reading MET, because a marker
      // that cannot fire is a detector every corpus calls clean. The literal's intent is now
      // the prefix it was reaching for, and `namespace App;` alone still does NOT fire.
      { name: "laravel-app-root-only", src: `<?php\nnamespace App\\Http\\Controllers;\n\nclass UserController extends Controller\n{\n}\n`, expectDetected: "Laravel", note: "was a measured GAP until #931 (57df923f): the `App\\` root marker compared against a trailing backslash no namespace text carries" },
      { name: "phpunit-use-statement", src: `<?php\nnamespace Tests;\n\nuse PHPUnit\\Framework\\TestCase;\n\nclass MyTest extends TestCase\n{\n}\n`, expectDetected: "PHPUnit" },
      // FIXED 2026-09-24 (#931, commit 57df923f). Same week, same shape, different wrong input:
      // the bare `TestCase` marker was compared against the NAMESPACE — empty for a class in
      // the global namespace — while the base CLAUSE, the node that names the relationship,
      // was never passed to detectFramework at all. The base clause's two spellings are tested
      // where the class is visited now; the table's substring markers are deliberately NOT fed
      // base names, or `WordPress`/`wp_` would fire on a class merely named after a framework.
      { name: "phpunit-global-base", src: `<?php\n\nclass MyTest extends TestCase\n{\n}\n`, expectDetected: "PHPUnit", note: "was a measured GAP until #931 (57df923f): the bare `TestCase` marker compared against the NAMESPACE text, which is empty here" },
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

export type AssertionId =
  | "A1-array"
  | "A2-dedupe"
  | "A3-primary"
  | "A3-default-primary"
  | "A4-aligned"
  | "A5-one-name"
  | "A6-claim"
  | "A7-presence"

/**
 * Options that let ONE assertion set read two different objects honestly.
 *
 * The analyzer half reads what an analyzer emits, where a primary pick beside an empty
 * detection is a defect. The published half reads what `ASTEngine.parseFile` publishes,
 * where the same field deliberately keeps a value when nothing was found — `"unknown"`, or
 * a pure-language name like `"Dart"` (both documented in `framework-intelligence.ts` as
 * promotion policy). Measured before scoping: 1,000+ real corpus files carried that
 * documented default and the published half convicted every one of them, which is noise
 * that hides the finding it exists for — a REAL framework name published with no detection
 * behind it. `defaults` is the policy list itself, imported rather than re-listed.
 */
export interface CheckOptions {
  published?: boolean
  defaults?: ReadonlySet<string>
}

export interface RuntimeFinding {
  lang: string
  file: string
  assertion: AssertionId
  detail: string
}

/** The contract assertions. Pure, so the probe's self-tests can drive them. */
export function checkMetadata(meta: any, opts: CheckOptions = {}): { id: AssertionId; detail: string }[] {
  const out: { id: AssertionId; detail: string }[] = []
  if (!meta || typeof meta !== "object") return out
  const raw = meta.detectedFrameworks
  // A1: the key, when the analyzer publishes the collection contract, must be an array.
  const claims = meta.hasFrameworkIntelligence === true
  /**
   * A7 — the key-set half of the contract, scoped to the EXERCISED contract: a payload that
   * detected something must publish all three keys, because that is the case where each key
   * carries a fact. It is a closure over `meta` so the two early exits below still reach it;
   * a lane publishing `framework` and `frameworkPatterns` but not `detectedFrameworks` used
   * to return before any assertion could see it.
   *
   * WHY NOT EVERY FILE, and this was measured rather than assumed: ruby publishes
   * `framework` and `frameworkPatterns` only from `recordFramework`, so a file with no Rails
   * trigger omits both keys. A strict per-file rule convicted 189 of 190 real rake/rack files
   * for it — and the finding has no consumer-visible effect, because the published payload
   * normalizes the key set: `enhanceWithFrameworkIntelligence` writes `framework`,
   * `detectedFrameworks` and `frameworkPatterns` unconditionally (framework-intelligence.ts),
   * so an omitted key and an `undefined` value are the same object downstream. The census
   * owns unconditional key presence, statically, once per analyzer; this half owns the key
   * set of a contract that was actually used, and counts real files. Convicting the honest
   * empty case would inflate the register with a shape that cannot affect a consumer.
   *
   * Key presence is read with `in`, not by value: `framework: undefined` is the key published
   * with an honest empty value, a different fact from never having it.
   */
  const checkPresence = (detectedCount: number): void => {
    if (detectedCount === 0) return
    const missing: string[] = []
    if (!("detectedFrameworks" in meta)) missing.push("detectedFrameworks")
    if (!("framework" in meta)) missing.push("framework")
    if (!("frameworkPatterns" in meta)) missing.push("frameworkPatterns")
    if (missing.length) {
      out.push({ id: "A7-presence", detail: `detected ${detectedCount} framework(s) but omits the key(s) ${missing.join(", ")}` })
    }
  }
  if (raw !== undefined && !Array.isArray(raw)) {
    // A structural breach dominates: reporting the key set of a payload whose collection is
    // not a collection would be noise on top of the real finding.
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
    const isDocumentedDefault = opts.published === true && opts.defaults?.has(String(meta.framework)) === true
    if (isDocumentedDefault) {
      // Not a finding, and not silence either: the pipeline's promotion policy keeps a
      // primary when nothing was detected, so the honest report is the CLASSIFICATION.
      out.push({
        id: "A3-default-primary",
        detail: `published primary ${JSON.stringify(meta.framework)} with no detection — a documented no-framework default, not a framework claim`,
      })
    } else {
      out.push({ id: "A3-primary", detail: `published primary ${JSON.stringify(meta.framework)} while detecting nothing` })
    }
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
  // A7: the three keys of the contract are ONE claim, so a lane that publishes any of
  // them must publish all of them. Without this assertion a missing key is invisible to
  // the runtime half: A3 fires when a primary pick is ABSENT beside a detection, but a
  // lane that stops one key earlier still satisfies A4/A5 over an empty pattern array —
  // which is exactly how objective-c's missing `frameworkPatterns` measured as clean
  // (153 files, 0 findings) while the static census convicted it. Same rule the census
  // applies statically (`missing-contract-key`), so the two halves now agree.
  // Deliberately NOT applied to a lane with no framework surface at all: publishing
  // none of the three is an absent capability, not a broken one, and convicting it
  // would make this assertion fire on every language without framework intelligence.
  checkPresence(det.length)
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
    const analyze = async (src: string, file: string, viaPublished?: boolean) => {
      // The published seam (#932): what a consumer reads, after the engine's
      // framework-intelligence merge and its alias canonicalisation.
      if (viaPublished) {
        const { ASTEngine } = await import("../../src/ast/engine")
        return await ASTEngine.parseFile(file, src)
      }
      const root = parser.parse(src).rootNode
      return await new Cls().analyze(root, src, file)
    }
    // --- cases: does the capability claim predict detection from a minimal trigger? ---
    const caseResults: CaseResult[] = []
    for (const c of lane.cases) {
      const cr: any = await analyze(c.src, `probe${lane.ext[0]}`, c.viaPublished)
      const meta = cr?.metadata ?? {}
      const detected: string[] = Array.isArray(meta.detectedFrameworks) ? meta.detectedFrameworks : []
      const findings = checkMetadata(meta).map((f) => ({ lang: lane.lang, file: `case:${c.name}`, assertion: f.id, detail: f.detail }))
      const absentHit = (c.expectAbsent ?? []).filter((a) => detected.includes(a))
      const patsOut: any[] = Array.isArray(meta.frameworkPatterns) ? meta.frameworkPatterns : []
      const patternMissed =
        c.expectPattern !== undefined &&
        !patsOut.some((p) => p?.framework === c.expectPattern!.framework && (p?.patterns ?? []).includes(c.expectPattern!.pattern))
      const ok =
        (c.expectDetected === null ? detected.length === 0 : detected.includes(c.expectDetected)) &&
        absentHit.length === 0 &&
        !patternMissed
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
            : patternMissed
              ? `${c.expectPattern!.framework} was detected but its ${c.expectPattern!.pattern} pattern is missing — the trigger is unreachable or the pattern name diverged (patterns: ${JSON.stringify(patsOut)})`
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

  // ---- the published half: the same files, the object consumers actually receive ----
  let published: any[] = []
  if (process.argv.includes("--published")) {
    const { ASTEngine } = await import("../../src/ast/engine")
    // The promotion policy, imported from the module that OWNS it. A second copy here
    // would be a second policy, and the first run of this half convicted 1,000+ real
    // files for following the real one.
    const { FrameworkIntelligence } = await import("../../src/ast/framework-intelligence")
    const DEFAULTS: ReadonlySet<string> = new Set([
      ...FrameworkIntelligence.PURE_LANGUAGE_PRIMARIES,
      ...FrameworkIntelligence.TOOLING_DEFAULTS,
    ])
    for (const r of results) {
      const lane = LANES.find((l) => l.lang === r.lang)!
      if (!doRepos) break
      const files = filesIn(lane.repos, lane.ext, cap)
      const findings: RuntimeFinding[] = []
      let withDetection = 0
      let checked = 0
      let defaultPrimary = 0
      for (const f of files) {
        let src: string
        try { src = fs.readFileSync(f, "utf8") } catch { continue }
        if (src.length > 400_000) continue
        let pub: any
        try { pub = await (ASTEngine as any).parseFile(f, src, { language: lane.lang }) } catch { continue }
        const m = pub?.metadata
        if (!m) continue
        checked++
        if (Array.isArray(m.detectedFrameworks) && m.detectedFrameworks.length) withDetection++
        for (const fd of checkMetadata(m, { published: true, defaults: DEFAULTS })) {
          // A documented default primary is COUNTED, not convicted: the count is what
          // makes the policy visible in the artifact instead of silently filtered away.
          if (fd.id === "A3-default-primary") { defaultPrimary++; continue }
          findings.push({ lang: lane.lang, file: path.relative(CORPUS, f), assertion: `P-${fd.id}`, detail: fd.detail })
        }
      }
      const byAssertion: Record<string, number> = {}
      for (const f of findings) byAssertion[f.assertion] = (byAssertion[f.assertion] ?? 0) + 1
      published.push({ lang: r.lang, corpus: { files: checked, withDetection, defaultPrimary, findings, byAssertion } })
      console.log(`\n=== ${r.lang} (PUBLISHED payload)`)
      console.log(`  corpus: ${checked} file(s), ${withDetection} with detection, ${defaultPrimary} documented-default primary(s), ${findings.length} finding(s) ${JSON.stringify(byAssertion)}`)
      for (const f of findings.slice(0, 4)) console.log(`    ${f.assertion} ${f.file}: ${f.detail}`)
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
      published: published.length
        ? {
            method:
              "the same five assertions over the metadata `ASTEngine.parseFile` PUBLISHES (the analyzer sweep above calls each analyzer directly). Assertion ids are prefixed `P-` so a published finding can never be read as an analyzer finding. This half is where a post-processing layer's effect is visible at all: `enhanceWithFrameworkIntelligence` merges a second detector, re-promotes `framework`, and appends its own pattern objects to `frameworkPatterns`.",
            lanes: published,
            totals: published.reduce(
              (a, l) => ({ files: a.files + l.corpus.files, withDetection: a.withDetection + l.corpus.withDetection, findings: a.findings + l.corpus.findings.length }),
              { files: 0, withDetection: 0, findings: 0 },
            ),
          }
        : undefined,
    }, null, 2) + "\n")
    console.log(`  -> ${path.relative(ROOT, OUT)}`)
  }
}

// ============================================================================
// Self-tests: the assertions must catch each contract breach, and must not fire on a
// compliant metadata object. Without these the probe's silence would be unreadable.
// ============================================================================
const SELF_TESTS: { name: string; meta: any; expect: AssertionId[]; opts?: CheckOptions }[] = [
  // Each meta below is COMPLETE except for the breach it is named for, so a test cannot
  // pass because A7-presence happened to fire in its place.
  { name: "a compliant metadata object is clean", meta: { framework: "Django", detectedFrameworks: ["Django"], frameworkPatterns: [{ framework: "Django", patterns: [] }], hasFrameworkIntelligence: true }, expect: [] },
  { name: "duplicates are convicted", meta: { framework: "Rails", detectedFrameworks: ["Rails", "Rails"], frameworkPatterns: [{ framework: "Rails" }] }, expect: ["A2-dedupe"] },
  // A7 fires with A3 here because the breach is the same missing key read two ways: A3 by
  // value (nothing to pick), A7 by key set (the key was never emitted).
  { name: "detection with no primary pick is convicted", meta: { detectedFrameworks: ["Rails"], frameworkPatterns: [{ framework: "Rails" }] }, expect: ["A3-primary", "A7-presence"] },
  { name: "a primary pick with no detection is convicted", meta: { framework: "Rails", detectedFrameworks: [], frameworkPatterns: [] }, expect: ["A3-primary"] },
  // The published half's scoping, all three directions pinned: a documented default is
  // classified (not convicted), a REAL framework name with nothing behind it is still a
  // fabrication, and the analyzer half keeps the strict reading either way.
  { name: "published default primary is classified, not convicted", meta: { framework: "unknown", detectedFrameworks: [], frameworkPatterns: [] }, opts: { published: true, defaults: new Set(["unknown", "Dart"]) }, expect: ["A3-default-primary"] },
  { name: "published language-default primary is classified too", meta: { framework: "Dart", detectedFrameworks: [], frameworkPatterns: [] }, opts: { published: true, defaults: new Set(["unknown", "Dart"]) }, expect: ["A3-default-primary"] },
  { name: "published real framework with no detection behind it is still convicted", meta: { framework: "Rails", detectedFrameworks: [], frameworkPatterns: [] }, opts: { published: true, defaults: new Set(["unknown", "Dart"]) }, expect: ["A3-primary"] },
  { name: "the analyzer half does not accept the published default", meta: { framework: "unknown", detectedFrameworks: [], frameworkPatterns: [] }, expect: ["A3-primary"] },
  { name: "a pattern naming an undetected framework is convicted", meta: { framework: "Django", detectedFrameworks: ["Django"], frameworkPatterns: [{ framework: "Flask" }] }, expect: ["A4-aligned"] },
  { name: "one framework under two names is convicted", meta: { framework: "Ruby on Rails", detectedFrameworks: ["Ruby on Rails"], frameworkPatterns: [{ framework: "Rails" }] }, expect: ["A4-aligned", "A5-one-name"] },
  { name: "a non-array detection is convicted", meta: { detectedFrameworks: "Rails" }, expect: ["A1-array"] },
  { name: "a capability claim with no collection is convicted", meta: { hasFrameworkIntelligence: true }, expect: ["A1-array"] },
  { name: "an analyzer with no framework metadata is not convicted", meta: { complexity: 3 }, expect: [] },
  // A7 — the objective-c shape: detection and a primary pick, no frameworkPatterns. Before
  // this assertion the probe measured 153 real objective-c files as contract-clean while
  // the census convicted the same analyzer, which is what a missing half looks like.
  { name: "a detection missing frameworkPatterns is convicted", meta: { framework: "UIKit", detectedFrameworks: ["UIKit"] }, expect: ["A7-presence"] },
  { name: "a detection missing the primary key is convicted", meta: { detectedFrameworks: ["UIKit"], frameworkPatterns: [{ framework: "UIKit" }] }, expect: ["A3-primary", "A7-presence"] },
  // The negative that keeps A7 from firing on every language without framework
  // intelligence: no key of the contract at all is an absent capability, not a breach.
  { name: "an analyzer publishing no contract key at all is not convicted", meta: { detected: [], complexity: 7, imports: 2 }, expect: [] },
  // The negative that keeps A7 from firing on ruby's honest empty case (189 of 190 real
  // files): nothing detected, so no key carries a fact, and the published payload writes all
  // three keys anyway. Pinned here so a later reader does not "tighten" A7 back to a
  // per-file rule and re-convict a shape with no consumer-visible effect.
  { name: "nothing detected with a partial key set is not convicted", meta: { detectedFrameworks: [], frameworkPatterns: [] }, expect: [] },
  // A4's real-world spellings, both measured on corpus files: the detector's slug beside the
  // analyzer's display name (swift, 2 files), and a framework the published detection list
  // has filtered out (dart, 68 files).
  { name: "a slug/display spelling pair is convicted", meta: { framework: "SwiftUI", detectedFrameworks: ["SwiftUI"], frameworkPatterns: [{ framework: "swiftui" }] }, expect: ["A4-aligned"] },
  { name: "a pattern naming a filtered-out detection is convicted", meta: { framework: "Flutter", detectedFrameworks: ["Flutter"], frameworkPatterns: [{ framework: "Dart" }] }, expect: ["A4-aligned"] },
]

/**
 * `alignFrameworkPatterns` — the PIPELINE half of A4, driven directly.
 *
 * It is a pure function in `framework-intelligence.ts` precisely so it can be tested here
 * rather than only through `parseFile` on a real corpus file: the two spellings and the
 * filtered-out detection it repairs were each measured on corpus files (swift 2, dart 68),
 * and the entries it must NOT touch are the ones every other lane publishes.
 */
const ALIGN_TESTS: { name: string; pats: any[]; det: string[]; expect: any[] }[] = [
  { name: "a detector slug is rewritten onto the published spelling", pats: [{ framework: "swiftui", patterns: ["declarative"] }], det: ["SwiftUI"], expect: [{ framework: "SwiftUI", patterns: ["declarative"] }] },
  { name: "an already-aligned entry is kept", pats: [{ framework: "Django", patterns: [] }], det: ["Django"], expect: [{ framework: "Django", patterns: [] }] },
  { name: "an aliased slug is canonicalised and then matched", pats: [{ framework: "gorilla_mux" }], det: ["gorilla"], expect: [{ framework: "gorilla" }] },
  { name: "an entry naming a filtered-out detection is dropped", pats: [{ framework: "Dart", patterns: ["async"] }], det: ["Flutter"], expect: [] },
  { name: "an entry naming an undetected framework is dropped, never relabelled", pats: [{ framework: "Rails" }], det: ["Django"], expect: [] },
  { name: "an entry with no framework name is dropped", pats: [{ patterns: ["x"] }], det: ["Django"], expect: [] },
  { name: "a mixed list keeps exactly the aligned entries, in order", pats: [{ framework: "Flutter" }, { framework: "Dart" }, { framework: "swiftui" }], det: ["Flutter", "SwiftUI"], expect: [{ framework: "Flutter" }, { framework: "SwiftUI" }] },
]

if (process.argv.includes("--self-test")) {
  let bad = 0
  for (const t of SELF_TESTS) {
    const got = checkMetadata(t.meta, t.opts).map((f) => f.id).sort()
    const want = [...t.expect].sort()
    if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(`FAIL ${t.name}: expected [${want}], got [${got}]`); bad++ }
  }
  const { FrameworkIntelligence } = await import("../../src/ast/framework-intelligence")
  for (const t of ALIGN_TESTS) {
    const got = JSON.stringify(FrameworkIntelligence.alignFrameworkPatterns(t.pats, t.det))
    const want = JSON.stringify(t.expect)
    if (got !== want) { console.log(`FAIL ${t.name}: expected ${want}, got ${got}`); bad++ }
  }
  const total = SELF_TESTS.length + ALIGN_TESTS.length
  console.log(`runtime-probe self-tests: ${total - bad}/${total} passed (${SELF_TESTS.length} assertions, ${ALIGN_TESTS.length} alignment)`)
  process.exit(bad ? 2 : 0)
}

// Only sweep when this file IS the entry point. `checkMetadata` and the lane table
// are imported by other instruments (the published-payload probe imports the
// assertion set so the two halves cannot drift), and an unguarded `main()` made the
// module un-importable — it parsed the corpora as a side effect of the import and
// crashed on a parser borrowed for the wrong language.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main()
}
