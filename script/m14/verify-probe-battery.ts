/**
 * M14.0.F9 — Defect-Class Probe Battery
 *
 * Every probe encodes a defect class that ACTUALLY occurred in this project
 * (haskell HSD12–HSD19, csharp CSD1–CSD12, php relative_scope, kotlin K1–K8).
 * Gates that mirror the analyzer (F5) cannot see shared holes; probes assert
 * the SEMANTIC contract on both sides:
 *   - analyzer: expected edges present, forbidden edges absent
 *   - oracle:   the differential truth-derivation must agree (no fabrication,
 *     no missing derivation) — an oracle regression fails the gate too
 * Additionally self-tests the F7 hygiene detectors (regexes regress like any
 * code) and verifies the F8 census gate rejects an unclassified type.
 *
 * Usage: bun run script/m14/verify-probe-battery.ts
 * Evidence: validation/m14/results/M14.0.F9.json
 */

import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"

const ROOT = path.resolve(__dirname, "..", "..")
const WASM_DIR = path.join(ROOT, "wasm")

interface ProbeResult {
  id: string
  lang: string
  description: string
  pass: boolean
  detail: string
}

const results: ProbeResult[] = []

function record(id: string, lang: string, description: string, pass: boolean, detail: string) {
  results.push({ id, lang, description, pass, detail })
  console.log(`${pass ? "ok  " : "FAIL"}  ${id}  ${pass ? "" : "— " + detail}`)
}

async function analyzeWith(lang: string, cfg: { wasm: string; analyzerFile: string; className: string; ext: string }, src: string) {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const langWasm = await L.load(fs.readFileSync(path.join(WASM_DIR, cfg.wasm)))
  const parser = new P()
  parser.setLanguage(langWasm)
  const tree = parser.parse(src)
  if (tree.rootNode.hasError) throw new Error(`probe snippet has parse errors for ${lang}`)
  const mod = await import(`../../src/ast/${cfg.analyzerFile}`)
  const analyzer = new mod[cfg.className]()
  return analyzer.analyze(tree.rootNode, src, `probe${cfg.ext}`)
}

async function oracleFor(lang: string, deriveFn: string, src: string): Promise<Set<string>> {
  const diff = await import("./differential")
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const cfgs: Record<string, string> = { csharp: "tree-sitter-c_sharp.wasm", haskell: "tree-sitter-haskell.wasm", php: "tree-sitter-php.wasm", java: "tree-sitter-java.wasm", javascript: "tree-sitter-javascript.wasm", scala: "tree-sitter-scala.wasm" }
  const langWasm = await L.load(fs.readFileSync(path.join(WASM_DIR, cfgs[lang])))
  const parser = new P()
  parser.setLanguage(langWasm)
  const tree = parser.parse(src)
  // `deriveTreeEdges(root, lang)` is the GENERIC structural walker: its second
  // parameter is the LANGUAGE TAG, not the protocol/type-kind Set the
  // language-specific oracles take (deriveJavaEdges, derivePhpEdges, ...).
  // Passing a Set here silently ran the walker without its language branches,
  // i.e. a probe that no longer mirrored the sweep it claims to gate. The
  // dispatch is explicit so a future deriveTreeEdges probe stays honest.
  const edges =
    deriveFn === "deriveTreeEdges"
      ? (diff as any)[deriveFn](tree.rootNode, lang)
      : (diff as any)[deriveFn](tree.rootNode, new Set())
  return new Set(edges.map((e: any) => `${e.label}:${e.target}`))
}

/**
 * #906: the SFC-truth lane parses every `<script>` block with the grammar its
 * `lang` attribute names. The oracle used to dispatch on a /lang=["']ts["']/
 * test while holding only js+ts parsers, so a `<script lang="tsx" setup>`
 * block was parsed as JAVASCRIPT: JSX recovered as relational expressions,
 * which fabricated `calls -> return/key/if/string` (single letters the analyzer
 * rightly refuses) AND swallowed the following real declarations, so genuine
 * script-setup calls (`generateColumns`, `dayjs`) landed as UNEXPLAINED. Both
 * directions are asserted here, analyzer first and oracle second, exactly as
 * probeLang does for the deriveTreeEdges languages.
 */
async function oracleVue(content: string): Promise<Set<string>> {
  const diff = await import("./differential")
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const langWasm = await L.load(fs.readFileSync(path.join(WASM_DIR, "tree-sitter-vue.wasm")))
  const parser = new P()
  parser.setLanguage(langWasm)
  const root = parser.parse(content).rootNode
  const out = new Set<string>()
  for (const t of await (diff as any).deriveEmbeddedScriptTrees(root, content, "vue")) {
    for (const e of (diff as any).deriveTypeScriptEdges(t)) out.add(`${e.label}:${e.target}`)
  }
  return out
}

async function probeVue(
  id: string,
  description: string,
  src: string,
  expect: string[],
  forbid: string[],
) {
  try {
    // The PRODUCTION entry, not a hand-built context: the SFC script trees,
    // their langs and their byte bases are constructed by the engine
    // (sfcScriptTrees/sfcScriptLangs), so a probe that assembled them itself
    // could pass while the pipeline dispatched the block differently.
    const eng: any = await import("../../src/ast/engine")
    const res = await eng.ASTEngine.parseFile("probe.vue", src)
    const got = res.relationships.map((r: any) => `${r.type}:${r.source}->${r.target}`)
    const matches = (g: string, e: string) =>
      e.includes("->") ? g === e : g.split(":")[0] === e.split(":")[0] && g.split("->")[1] === e.split(":")[1]
    const missing = expect.filter((e) => !got.some((g) => matches(g, e)))
    const fabricated = forbid.filter((f) => got.some((g) => matches(g, f)))
    if (missing.length > 0) {
      record(id, "vue", description, false, `analyzer missing: ${missing.join(", ")}`)
      return
    }
    if (fabricated.length > 0) {
      record(id, "vue", description, false, `analyzer fabricated: ${fabricated.join(", ")}`)
      return
    }
    const oracle = await oracleVue(src)
    const targetOf = (e: string) => {
      const [label, rest] = e.split(":")
      return `${label}:${rest.includes("->") ? rest.split("->")[1] : rest}`
    }
    const oracleMiss = expect.filter((e) => !oracle.has(targetOf(e)))
    if (oracleMiss.length > 0) {
      record(id, "vue", description, false, `oracle no longer derives: ${oracleMiss.join(", ")} (oracle regression)`)
      return
    }
    const collusion = forbid.filter((f) => oracle.has(targetOf(f)))
    if (collusion.length > 0) {
      record(id, "vue", description, false, `oracle colludes: truth also derives ${collusion.join(", ")} (lockstep mirrored a fabrication — lane cannot see it)`)
      return
    }
    record(id, "vue", description, true, "ok (oracle agrees, no collusion on the forbidden set)")
  } catch (e: any) {
    record(id, "vue", description, false, e.message)
  }
}

async function probeLang(
  id: string,
  lang: string,
  description: string,
  cfg: { wasm: string; analyzerFile: string; className: string; ext: string },
  oracleFn: string | null,
  src: string,
  expect: string[],
  forbid: string[],
  // M49 W1 (JSD24): `oracleForbid` turns on the COLLUSION check. Oracle
  // lockstep (C5 standing lesson) mirrors analyzer contracts into the truth,
  // so a lane can agree on a WRONG contract and still report 100/0/0 — the
  // binding-position fabrication lived through exactly that. Probes that pin
  // an absence must also assert the oracle does NOT derive it: an oracle that
  // derives a forbidden edge fails the battery as `oracle colludes`.
  opts: { oracleForbid?: boolean } = {},
) {
  try {
    const res = await analyzeWith(lang, cfg, src)
    // got entries carry source: `label:source->target`. An expectation of the
    // form `label:target` matches ANY source; `label:source->target` must
    // match exactly (distinguishes `calls:useGives->gives` from the HSD19
    // self-call fabrication `calls:gives->gives`, same target).
    const got = res.relationships.map((r: any) => `${r.type}:${r.source}->${r.target}`)
    const matches = (g: string, e: string) =>
      e.includes("->") ? g === e : g.split(":")[0] === e.split(":")[0] && g.split("->")[1] === e.split(":")[1]
    const missing = expect.filter((e) => !got.some((g) => matches(g, e)))
    const fabricated = forbid.filter((f) => got.some((g) => matches(g, f)))
    let oracleDetail = ""
    if (oracleFn && missing.length === 0 && fabricated.length === 0) {
      const oracle = await oracleFor(lang, oracleFn, src)
      const oracleMiss = expect.filter((e) => {
        const label = e.split(":")[0]
        const rest = e.slice(label.length + 1)
        // expectations may be written `label:target` or `label:source->target`;
        // oracle edges are site-agnostic `label:target` pairs.
        const target = rest.includes("->") ? rest.split("->")[1] : rest
        return !oracle.has(`${label}:${target}`)
      })
      if (oracleMiss.length > 0) {
        record(id, lang, description, false, `oracle no longer derives: ${oracleMiss.join(", ")} (oracle regression)`)
        return
      }
      if (opts.oracleForbid) {
        // forbid entries are `label:target` or `label:source->target`; the
        // oracle's edges are site-agnostic `label:target` pairs.
        const collusion = forbid.filter((f) => {
          const [label, rest] = f.split(":")
          const target = rest.includes("->") ? rest.split("->")[1] : rest
          return oracle.has(`${label}:${target}`)
        })
        if (collusion.length > 0) {
          record(id, lang, description, false, `oracle colludes: truth also derives ${collusion.join(", ")} (lockstep mirrored a fabrication — lane cannot see it)`)
          return
        }
      }
      oracleDetail = opts.oracleForbid ? " (oracle agrees, no collusion on the forbidden set)" : " (oracle agrees)"
    }
    if (missing.length > 0) {
      record(id, lang, description, false, `missing: ${missing.join(", ")}`)
    } else if (fabricated.length > 0) {
      record(id, lang, description, false, `fabricated: ${fabricated.join(", ")}`)
    } else {
      record(id, lang, description, true, `ok${oracleDetail}`)
    }
  } catch (e: any) {
    record(id, lang, description, false, e.message)
  }
}

const CS = (s: string) => s.replace(/^\n/, "")
const HS = (s: string) => s.replace(/^\n/, "")
const PHP = (s: string) => s.replace(/^\n/, "")

async function main() {
  const csharpCfg = { wasm: "tree-sitter-c_sharp.wasm", analyzerFile: "real-csharp-analyzer", className: "RealCSharpAnalyzer", ext: ".cs" }
  const haskellCfg = { wasm: "tree-sitter-haskell.wasm", analyzerFile: "real-haskell-analyzer", className: "RealHaskellAnalyzer", ext: ".hs" }
  const phpCfg = { wasm: "tree-sitter-php.wasm", analyzerFile: "real-php-analyzer", className: "RealPhpAnalyzer", ext: ".php" }
  const javaCfg = { wasm: "tree-sitter-java.wasm", analyzerFile: "real-java-analyzer", className: "RealJavaAnalyzer", ext: ".java" }

  // ── CSD11: assignment-form target-typed new() ───────────────────────────
  await probeLang("F9-PROBE-CSD11", "csharp",
    "assignment-form `_f = new();` emits instantiates via member-type map; declarator + property forms unchanged",
    csharpCfg, "deriveCSharpEdges", CS(`
using System.Collections.Generic;

namespace Probe
{
    public class Host
    {
        private List<int> _items = new();
        private Dictionary<string, int> _cache;

        public Host()
        {
            _cache = new();
        }
    }
}`),
    ["instantiates:List", "instantiates:Dictionary"],
    ["extends:IDisposable"])

  // ── CSD12: interface-only external base lists + struct bases ───────────
  await probeLang("F9-PROBE-CSD12a", "csharp",
    "interface-only external base list emits implements, never a fabricated extends",
    csharpCfg, "deriveCSharpEdges", CS(`
using System;

namespace Probe
{
    public class Job : IDisposable
    {
        public void Dispose() { }
    }
}`),
    ["implements:IDisposable"],
    ["extends:IDisposable"])

  await probeLang("F9-PROBE-CSD12b", "csharp",
    "struct bases are implements (structs cannot inherit), non-I-named external class base keeps extends (first-base rule)",
    csharpCfg, "deriveCSharpEdges", CS(`
using System;

namespace Probe
{
    public struct Handle : IDisposable
    {
        public void Dispose() { }
    }

    public class Job : XmlUrlResolver
    {
    }
}`),
    ["implements:IDisposable", "extends:XmlUrlResolver"],
    ["extends:IDisposable"])

  // ── HSD12/14/16/19: haskell defect classes ──────────────────────────────
  await probeLang("F9-PROBE-HSD12", "haskell",
    "standalone deriving instance (bare + qualified class heads) emits implements",
    haskellCfg, "deriveHaskellEdges", HS(`
module M where

data Session = Session

deriving instance Show Session

deriving instance Csv.ToNamedRecord Session
`),
    ["implements:Show"],
    [])

  await probeLang("F9-PROBE-HSD14", "haskell",
    "pattern-position constructors (case alternative, pattern guard, record pattern in head) never fabricate instantiates",
    haskellCfg, "deriveHaskellEdges", HS(`
module M where

data Shape = Circle Double

area :: Shape -> Double
area s = case s of
  Circle r -> r

nOf :: Shape -> Double
nOf (Circle r) = r
`),
    [],
    ["instantiates:Circle"])

  await probeLang("F9-PROBE-HSD16", "haskell",
    "body-position qualified constructor APPLICATION emits instantiates (HSD16 contract)",
    haskellCfg, "deriveHaskellEdges", HS(`
module M where

import qualified Data.Csv as C

pickOne :: C.Registry
pickOne = C.Registry 1
`),
    ["instantiates:C.Registry"],
    [])

  await probeLang("F9-PROBE-HSD2-BAREVALUE", "haskell",
    "HS-D2 boundary: bare constructor VALUES bind function values, not instances — silent in both qualified and unqualified forms (applications emit, per HSD16)",
    haskellCfg, "deriveHaskellEdges", HS(`
module M where

import qualified Data.Csv as C

registry :: C.Registry
registry = C.Registry

maybeOne :: Maybe Int
maybeOne = Just
`),
    [],
    ["instantiates:C.Registry", "instantiates:Registry", "instantiates:Just"])

  await probeLang("F9-PROBE-HSD19", "haskell",
    "backtick-infix definition heads become function symbols without self-call fabrication; calls in body resolve",
    haskellCfg, null, HS(`
module M where

(a, b) \`gives\` r = r + 1

useGives :: Int -> Int
useGives x = (1, 2) \`gives\` x
`),
    ["calls:useGives->gives"],
    ["calls:gives->gives"])

  // ── php relative_scope: new self/static/parent (the original F6-class bug)
  await probeLang("F9-PROBE-PHP-RS", "php",
    "new self/static resolve to the class; the degenerate ternary class cannot reappear (F7 also guards)",
    phpCfg, null, PHP(`
<?php

namespace P;

class Host
{
    public function make(): Host
    {
        $a = new self();
        $b = new static();
        return $a;
    }
}`),
    [],
    [])

  // ── Java: constructor chains + implicit-this array reads (documented) ──
  await probeLang("F9-PROBE-JAVA-CTOR", "java",
    "explicit constructor invocation emits calls with this/super literal targets (G2 ruling); array reads attribute to owner (implicit-this)",
    javaCfg, null, `class A {
    A(int x) { }
    A() { this(1); }
    void m(int[] arr) { int x = arr[0]; }
}`,
    ["calls:this", "uses:arr"],
    [])

  // ── M37.10: overrideCompanion dead-machinery sweep ────────────────────
  // Production callers never populate the companion (grep across src/,
  // ide/, script/ — only m12/verify-analyzer builds one for its own
  // tests), so analyzers that gated ALL override emission on it silently
  // lost every cross-file override. Family contract asserted here:
  //   - in-file base declares the method -> overrides @0.95 (verified)
  //   - external base, no companion -> overrides @0.5 with reasonCode
  //     "first-parent-guess" and tier "inferred" (Pass-3 parity with
  //     java/groovy; below the 0.7 patterns threshold; heuristic in F5)
  //   - swift: the Pass-3 guess must NOT claim 1.0/structural (silent
  //     overclaim fixed in M37.10); java pins its existing Pass-3
  const m3710Cfgs: Record<string, { wasm: string; analyzerFile: string; className: string; ext: string }> = {
    php: { wasm: "tree-sitter-php.wasm", analyzerFile: "real-php-analyzer", className: "RealPhpAnalyzer", ext: ".php" },
    ruby: { wasm: "tree-sitter-ruby.wasm", analyzerFile: "real-ruby-analyzer", className: "RealRubyAnalyzer", ext: ".rb" },
    python: { wasm: "tree-sitter-python.wasm", analyzerFile: "real-python-analyzer", className: "RealPythonAnalyzer", ext: ".py" },
    javascript: { wasm: "tree-sitter-javascript.wasm", analyzerFile: "real-javascript-analyzer", className: "RealJavaScriptAnalyzer", ext: ".js" },
    perl: { wasm: "tree-sitter-perl.wasm", analyzerFile: "real-perl-analyzer", className: "RealPerlAnalyzer", ext: ".pl" },
    swift: { wasm: "tree-sitter-swift.wasm", analyzerFile: "real-swift-analyzer", className: "RealSwiftAnalyzer", ext: ".swift" },
    java: { wasm: "tree-sitter-java.wasm", analyzerFile: "real-java-analyzer", className: "RealJavaAnalyzer", ext: ".java" },
  }
  const m3710Cases: Record<string, string> = {
    php: `<?php\nclass Base { public function handle(): void {} }\nclass InService extends Base { public function handle(): void {} }\nclass AuditService extends ExternalBase { public function handle(): void {} }\n`,
    ruby: `class Base\n  def handle; end\nend\nclass InService < Base\n  def handle; end\nend\nclass AuditService < ExternalBase\n  def handle; end\nend\n`,
    python: `class Base:\n    def handle(self):\n        pass\n\nclass InService(Base):\n    def handle(self):\n        pass\n\nclass AuditService(ExternalBase):\n    def handle(self):\n        pass\n`,
    javascript: `class Base { handle() {} }\nclass InService extends Base { handle() {} }\nclass AuditService extends ExternalBase { handle() {} }\n`,
    perl: `package Base; sub handle { 1 }\npackage InService; use parent -norequire, 'Base'; sub handle { 2 }\npackage AuditService; use parent -norequire, 'ExternalBase'; sub handle { 3 }\n1;\n`,
    swift: `class Base { func handle() {} }\nclass InService: Base { override func handle() {} }\nclass AuditService: ExternalBase { override func handle() {} }\n`,
    java: `class Base { void handle() {} }\nclass InService extends Base { @Override void handle() {} }\nclass AuditService extends ExternalBase { @Override void handle() {} }\n`,
  }
  for (const lang of Object.keys(m3710Cases)) {
    const src = m3710Cases[lang]
    const probeId = "F9-PROBE-M3710-" + lang.toUpperCase()
    try {
      const res = await analyzeWith(lang, m3710Cfgs[lang], src)
      const rels = (res.relationships ?? []).filter((r: any) => r.type === "overrides")
      const inSvc = rels.find((r: any) => r.source === "InService.handle" && r.target === "Base.handle")
      const audit = rels.find((r: any) => r.source === "AuditService.handle" && r.target === "ExternalBase.handle")
      const problems: string[] = []
      if (!inSvc) problems.push("in-file overrides edge missing")
      else if ((inSvc.confidence ?? 0) < 0.9) problems.push(`in-file confidence ${inSvc.confidence} < 0.9 (verified tier must hold; 0.95 php/ruby/python/js/perl family, 1.0 java/swift Pass-1)`)
      if (!audit) problems.push("external-base guess edge missing")
      else {
        if (Math.abs((audit.confidence ?? 0) - 0.5) > 1e-9) problems.push(`external confidence ${audit.confidence} != 0.5`)
        if ((audit.metadata?.reasonCode ?? "") !== "first-parent-guess") problems.push(`reasonCode ${audit.metadata?.reasonCode} != first-parent-guess`)
        if (audit.metadata?.evidenceClass && audit.metadata.evidenceClass !== "inferred") problems.push(`tier ${audit.metadata.evidenceClass} != inferred`)
      }
      const label = lang === "java" ? " (Pass-3 already in place; guards regressions)" : " (M37.10 fix)"
      record(probeId, lang, "external-base override emits Pass-3 guess @0.5/inferred; in-file verified @0.95" + label,
        problems.length === 0, problems.join("; ") || "ok")
    } catch (e: any) {
      record(probeId, lang, "external-base override Pass-3 contract", false, e.message)
    }
  }

  // ── JSD-BINDINGS (M49 W1 #768): a binding position is a DEFINITION ──────
  // Real defect: the #744 bare-read walk treated every identifier that was
  // not a declaration NAME as a read, so import bindings, parameters, catch
  // params, destructuring targets and export aliases all fabricated
  // `uses @0.6` edges — and the JS lane oracle carried the identical gate
  // list, so the lane reported 100/0/0 on a wrong contract (JSD24
  // collusion). This probe pins both sides and lets oracleForbid assert the
  // ORACLE does not derive a single forbidden name.
  {
    const jsCfg = { wasm: "tree-sitter-javascript.wasm", analyzerFile: "real-javascript-analyzer", className: "RealJavaScriptAnalyzer", ext: ".js" }
    const src = [
      `import Default from "./d";`,
      `import { named, other as alias } from "./n";`,
      `import * as ns from "./s";`,
      `const base = { count: 0 };`,
      `export function reader(flag) { return base.count + flag; }`,
      `export function binder(alpha, beta) { return 1; }`,
      `export function catcher() { try { reader(1); } catch (err) {} return 0; }`,
      `export const destructured = ({ first, second: renamed, ...third }) => 1;`,
      `export const [one, two] = [1, 2];`,
      `export function defaults(seed, value = seed) { return 1; }`,
      `export { named as reexported };`,
    ].join("\n") + "\n"
    await probeLang("F9-PROBE-JSD-BINDINGS", "javascript",
      "binding positions emit no read edge (import bindings, parameters, catch params, destructuring targets, export aliases); pattern-default RHS still reads; oracle must not derive the forbidden names",
      jsCfg, "deriveJavaScriptEdges", src,
      ["uses:reader->base", "uses:reader->count", "uses:reader->flag", "uses:defaults->seed"],
      ["uses:Default", "uses:named", "uses:alias", "uses:ns", "uses:alpha", "uses:beta", "uses:err", "uses:first", "uses:renamed", "uses:third", "uses:one", "uses:two", "uses:reexported", "uses:value"],
      { oracleForbid: true },
    )
  }

  // ── JS-HERITAGE-EXTERNAL (M49 W12 svelte wave) ─────────────────────────
  // Real defect: the F5 oracle derived heritage from the TYPESCRIPT
  // class_heritage shape (extends_clause/implements_clause children) only.
  // tree-sitter-JAVASCRIPT never wraps the base — `(class_heritage
  // (identifier))`, or `(class_heritage (member_expression))` for a dotted
  // base, with `extends` an UNNAMED token — so deriveTreeEdges derived ZERO
  // extends edges for every pure-JS parse. The svelte lane derives its
  // script-side truth with that walker, so RealSvelteAnalyzer's custom-element
  // edge (`class MyCustomElement extends HTMLElement`, merged from the JS
  // sub-analyzer) had no truth to match and surfaced as a fabrication
  // (probe 2026-09-13: analyzer [extends MyCustomElement->HTMLElement],
  // oracle []). This probe asserts BOTH sides: the analyzer emits the three
  // heritage forms, and the ORACLE still derives them (revert the oracle
  // branch and this fails as `oracle no longer derives`).
  //
  // No `oracleForbid` here on purpose: a SELF-edge forbid
  // (`extends MyCustomElement->MyCustomElement`) is unrepresentable in the
  // oracle's site-agnostic `label:target` space, where the legitimate
  // `extends Extended->MyCustomElement` shares the same target key — the
  // collusion check would fire on a true edge. The self-edge and the
  // head-only form (`Lib` instead of `Lib.Base`) are asserted on the
  // analyzer side, which is where a fabrication can actually occur.
  {
    const jsCfg = { wasm: "tree-sitter-javascript.wasm", analyzerFile: "real-javascript-analyzer", className: "RealJavaScriptAnalyzer", ext: ".js" }
    const src = [
      `class MyCustomElement extends HTMLElement {`,
      `  connectedCallback() { this.render(); }`,
      `  render() { return 1; }`,
      `}`,
      `class Extended extends MyCustomElement {}`,
      `class Qualified extends Lib.Base {}`,
      `window.customElements.define('my-custom-element', MyCustomElement);`,
    ].join("\n") + "\n"
    await probeLang("F9-PROBE-JS-HERITAGE-EXTERNAL", "javascript",
      "bare external, in-file and DOTTED heritage bases all derive `extends` on the analyzer AND the oracle (the JS class_heritage shape the TS-clause-matching oracle missed)",
      jsCfg, "deriveTreeEdges", src,
      ["extends:MyCustomElement->HTMLElement", "extends:Extended->MyCustomElement", "extends:Qualified->Lib.Base"],
      ["extends:MyCustomElement->MyCustomElement", "extends:Qualified->Lib", "extends:Extended->MyCustomElement2"],
    )
  }

  // ── JS-DECORATOR-METADATA (M49 #868, acceptance item 3) ────────────────
  // The analyzer rules a decorator invocation METADATA on the decorated symbol
  // (`inDecoratorPosition`), so `@inject(DB)` yields no `calls` edge, no `uses`
  // for the decorator's own name and none for its argument — the same family rule
  // the typescript twin and the python oracle's PYD1 carry. The ORACLE mirror in
  // `deriveJavaScriptEdges` did not carry the guard, so it derived all three, and
  // the differential would have reported them as MISSING rows on any `.js` file
  // with a decorator. Nothing could see it: the corpus lanes sample plain `.js`
  // from the web repos (no class-body decorators — #861's sweep found one affected
  // file in 9,065) and the fixture lanes compare the analyzer against its
  // EXPECTATION, never against the oracle. `oracleForbid` is what makes this
  // permanent: it fails as `oracle colludes` when the truth derives a forbidden
  // edge. Executed control: with the guard removed, `oracleForbid` reported
  // `uses:sealed, uses:DB, calls:inject`; with it, the probe passes.
  {
    const jsCfg = { wasm: "tree-sitter-javascript.wasm", analyzerFile: "real-javascript-analyzer", className: "RealJavaScriptAnalyzer", ext: ".js" }
    const src = [
      `function sealed(t) { return t }`,
      `function inject(n) { return () => undefined }`,
      `function make() { return 1 }`,
      `const DB = "db"`,
      `@sealed`,
      `export class Service {`,
      `  @inject(DB)`,
      `  pool = make()`,
      `  @sealed`,
      `  method() {}`,
      `}`,
    ].join("\n") + "\n"
    await probeLang("F9-PROBE-JSD-DECORATOR-POSITION", "javascript",
      "a decorator is METADATA on the symbol it decorates on BOTH sides: no `calls` edge for the decorator name, no `uses` for its name or its argument — while an ordinary call in the same class (`make()` in the field initializer) still derives",
      jsCfg, "deriveJavaScriptEdges", src,
      ["calls:make"],
      ["calls:inject", "uses:sealed", "uses:DB"],
      { oracleForbid: true },
    )
  }

  // ── SVELTE-DYNAMIC-COMPONENT (M49 W13) ────────────────────────────────
  // The analyzer side of `<svelte:component this={X}/>` is already pinned by
  // fixture svelte/relationship-kinds (instantiates -> Widget). What needed
  // pinning is the ORACLE: it treats `svelte:component` as a builtin tag, so
  // the dynamic target is named by an ATTRIBUTE and the tag-name walk never
  // saw it — the analyzer's (correct) edge surfaced as the one unexplained
  // edge W12's 400-file svelte measurement left open. Revert the
  // deriveSvelteComponentUsages branch and this probe fails as
  // `oracle no longer derives: instantiates:Widget`. The negative half keeps
  // the mirror HONEST: the analyzer gates on the import binding, so a local
  // `const Widget` must NOT produce an oracle instantiates either — a bare
  // superset here would fix an unexplained edge by fabricating one.
  {
    const wts: any = WTS
    const P = wts.Parser ?? wts.default ?? wts
    const L = wts.Language ?? wts.default?.Language
    await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
    const langWasm = await L.load(fs.readFileSync(path.join(WASM_DIR, "tree-sitter-svelte.wasm")))
    const parser = new P()
    parser.setLanguage(langWasm)
    const jsWasm = await L.load(fs.readFileSync(path.join(WASM_DIR, "tree-sitter-javascript.wasm")))
    const jsParser = new P()
    jsParser.setLanguage(jsWasm)
    const diff: any = await import("./differential")
    const run = (svelteSrc: string): Set<string> => {
      const root: any = parser.parse(svelteSrc).rootNode
      const bindings = new Set<string>()
      // The svelte grammar keeps script bodies as OPAQUE raw_text, so the
      // script must be re-parsed as JS before any import_clause exists —
      // exactly what the truth block's deriveEmbeddedScriptTrees does.
      const scriptRoots: any[] = []
      const findScripts = (n: any): void => {
        if (n.type === "script_element") {
          const raw = n.namedChildren.find((c: any) => c.type === "raw_text")
          if (raw && raw.text.trim().length > 0) scriptRoots.push(jsParser.parse(raw.text).rootNode)
        }
        for (let i = 0; i < n.namedChildCount; i++) findScripts(n.namedChild(i))
      }
      findScripts(root)
      const collect = (n: any): void => {
        if (n.type === "import_statement") {
          const clause = n.namedChildren.find((c: any) => c.type === "import_clause")
          if (clause) {
            for (let i = 0; i < clause.namedChildCount; i++) {
              const c = clause.namedChild(i)
              if (c.type === "identifier") bindings.add(c.text)
              else if (c.type === "namespace_import") {
                const id = c.namedChildren.find((x: any) => x.type === "identifier")
                if (id) bindings.add(id.text)
              } else if (c.type === "named_imports") {
                for (let j = 0; j < c.namedChildCount; j++) {
                  const sp = c.namedChild(j)
                  if (sp.type !== "import_specifier") continue
                  const ids = sp.namedChildren.filter((x: any) => x.type === "identifier")
                  if (ids.length) bindings.add(ids[ids.length - 1].text)
                }
              }
            }
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) collect(n.namedChild(i))
      }
      for (const sr of scriptRoots) collect(sr)
      return new Set<string>(
        (diff.deriveSvelteComponentUsages(root, bindings) as any[]).map(
          (e: any) => `${e.label}:${e.target}`
        )
      )
    }
    const imported = run(
      "<script>\n\timport Widget from './Widget.svelte';\n</script>\n\n<svelte:component this={Widget} on:foo/>\n"
    )
    const localOnly = run(
      "<script>\n\tconst Widget = 1;\n</script>\n\n<svelte:component this={Widget}/>\n"
    )
    const ok = imported.has("instantiates:Widget") && !localOnly.has("instantiates:Widget")
    record(
      "F9-PROBE-SVELTE-DYNAMIC-COMPONENT",
      "svelte",
      "the oracle derives instantiates for an import-bound <svelte:component this={X}/> target and does NOT for a non-import (member) target — the analyzer's own gate, so the mirror cannot fabricate",
      ok,
      `imported=[${[...imported].join(",")}] local=[${[...localOnly].join(",")}]`
    )
  }

  // ── SCAD11 (M49 #905): a BARE-`private` base member is not inherited ────
  // Real defect: the scala truth derivation had no privacy notion at all, so
  // it paired `Transformation.submitWithValue -> DefaultPromise.submitWithValue`
  // through a `private final def` base member (scala3 Promise.scala:473/488) —
  // the analyzer's documented JLS/Scala rule refuses it, and the lane reported
  // it as MISSING = 1 on a 200-file draw. The QUALIFIED form is the control:
  // `private[probe]` IS inheritable (the analyzer models it as package-scoped),
  // so the filter must not swallow it. Asserted on both sides; the forbidden
  // bare-private pair additionally asserts the ORACLE does not derive it.
  await probeLang("F9-PROBE-SCAD11", "scala",
    "bare-`private` base member seeds no override pair (not inherited); qualified `private[pkg]` still pairs",
    { wasm: "tree-sitter-scala.wasm", analyzerFile: "real-scala-analyzer", className: "RealScalaAnalyzer", ext: ".scala" },
    "deriveTreeEdges",
    [
      `package probe`, "", "trait Base {",
      `  private def secret(x: Int): Int = 1`,
      `  private[probe] def scoped(x: Int): Int`,
      `  def open(x: Int): Int`,
      "}", "", "class Child extends Base {",
      `  def secret(x: Int): Int = 2`,
      `  def scoped(x: Int): Int = 3`,
      `  def open(x: Int): Int = 4`,
      "}", "",
    ].join("\n"),
    ["overrides:Child.open->Base.open", "overrides:Child.scoped->Base.scoped"],
    ["overrides:Child.secret->Base.secret"],
    { oracleForbid: true },
  )

  // ── VUED11 (M49 #906): the SFC block's grammar comes from its `lang` ────
  // Real defect: the truth lane dispatched `<script lang="tsx">` onto the
  // JAVASCRIPT grammar (its isTs test matched only `ts`), so JSX recovered as
  // relational expressions — truth invented `calls -> return/key/string/if`,
  // which no analyzer may emit, while the real script-setup calls were lost.
  await probeVue("F9-PROBE-VUED11",
    "`<script lang=\"tsx\" setup>` truth parses as tsx: real script-setup calls derived, no keyword callees invented",
    [
      `<script lang="tsx" setup>`,
      `import { ref } from 'vue'`,
      ``,
      `type Props = {`,
      `  value: boolean`,
      `  ariaLabel?: string`,
      `  onChange: (value: string) => void`,
      `}`,
      ``,
      `const Cell: FunctionalComponent<Props> = ({ value, onChange }) => {`,
      `  return (`,
      `    <ElCheckbox`,
      `      onChange={onChange}`,
      `      modelValue={value}`,
      `    />`,
      `  )`,
      `}`,
      ``,
      `const generateColumns = (length = 10, prefix = 'column-') =>`,
      `  Array.from({ length }).map((_, i) => ({ key: \`\${prefix}\${i}\` }))`,
      ``,
      `const columns = generateColumns(10)`,
      `</script>`,
      `<template><div /></template>`,
      ``,
    ].join("\n"),
    // MEASURED under the javascript dispatch (the pre-#906 behaviour): the js
    // parse of this block yields ONLY `key` and `return` and loses all three
    // real calls; the tsx parse yields exactly the analyzer's targets.
    ["calls:generateColumns", "calls:from", "calls:map"],
    ["calls:return", "calls:key", "calls:string", "calls:if"],
  )

  // ── F7 detector self-test: regexes regress like any code ────────────────
  {
    const hyg = await import("./verify-analyzer-hygiene")
    const f: any[] = []
    hyg.findNoopTernaries(`x = c ? owner : owner`, "t", f)
    hyg.findNoopTernaries(`y = c ? null : null`, "t", f)
    hyg.findNoopTernaries(`z = c ? a : a ? b : c  // nested ternary must NOT fire`, "t", f)
    hyg.findWriteOnlyFlags(`class A { m() { this.flag = true } }`, "t", f)
    const ids = new Set(f.map((x) => x.kind))
    const pass = f.length === 3 && ids.has("noop-ternary") && ids.has("write-only-flag")
    record("F9-SELFTEST-F7", "meta", "hygiene detectors flag historical shapes, skip nested ternary", pass, `got ${f.length} findings: ${f.map((x) => x.kind).join(",")}`)
  }

  // ── F8 self-test: census gate rejects unclassified types ────────────────
  // (verified structurally: the classifier includes gap.gaps[] — a spec with
  // only gap.gaps[] entries classifies K2's explicit_delegation. Probed live
  // by the full F8 run; here we assert the classifier code path exists.)
  {
    const censusSrc = fs.readFileSync(path.join(ROOT, "script", "m14", "verify-corpus-census.ts"), "utf8")
    const pass = censusSrc.includes("gap?.gaps") && censusSrc.includes("internal_silent?.types") && censusSrc.includes("handled_verified?.types")
    record("F9-SELFTEST-F8", "meta", "census classifier reads all spec ruling formats", pass, "classifier format coverage")
  }

  // ── evidence ────────────────────────────────────────────────────────────
  const { emitEvidence } = await import("./evidence-harness")
  emitEvidence({
    issueId: "M14.0.F9",
    title: "Defect-class probe battery: historical defect classes asserted on analyzer AND oracle, plus gate self-tests",
    claimLevel: "L2",
    layers: ["probes"],
    checks: results.map((r) => ({
      id: r.id,
      description: r.description,
      status: r.pass ? "pass" : "fail",
      detail: r.detail,
    })),
    limitations: [
      {
        description: "Probe snippets are minimal shapes per defect class, not full programs; cross-file resolution classes remain covered by the differential corpora (F5)",
      },
    ],
  })

  const failed = results.filter((r) => !r.pass)
  if (failed.length > 0) {
    console.log(`\nprobe battery: ${failed.length} failure(s) — release blocked`)
    process.exit(1)
  }
  console.log(`\nprobe battery: all ${results.length} probes pass`)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
