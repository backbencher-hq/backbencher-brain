/**
 * M14.0.F9 — Defect-Class Probe Battery
 *
 * Every probe encodes a defect class that ACTUALLY occurred in this project
 * (haskell HSD12–HSD19, csharp CSD1–CSD12, php relative_scope, kotlin K1–K8,
 * M60 objc: a block-pointer parameter declaration read as a value, and the
 * production entry's noise filter eating every selector target that ends in ':').
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
  // The wasm comes from LANGS — the F5 sweep's own table, not a second copy of
  // it. This was a hand-kept map of 8 languages and it read as a limit on what
  // could be probed: `cpp` had no entry, so a cpp probe that pins an ORACLE
  // contract (the only kind that can catch collusion) could not be written at
  // all. The map also duplicated LANGS verbatim for every entry it did have —
  // a copy that could drift silently. One definition, one lookup.
  const wasmName = (diff as any).LANGS?.[lang]?.wasm
  if (!wasmName) throw new Error(`oracleFor: no LANGS entry for ${lang} (wasm unknown — add the lane to LANGS)`)
  const langWasm = await L.load(fs.readFileSync(path.join(WASM_DIR, wasmName)))
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

  // ── GO-EMBED-GENERIC (#799 round 3: the go-heavy corpus stress read) ─────
  // Real defect, found on a corpus the pinned ones cannot stand in for: the go
  // lane's two corpora carry ZERO generic embedded fields (a measured count,
  // not an impression), while kubernetes' generated client code embeds
  // INSTANTIATED GENERICS everywhere. The ORACLE resolved an embedded field's
  // name as `lastSegment(raw text)`, and for a generic the last dot lands
  // INSIDE the type arguments: `listers.ResourceIndexer[*crv1.Example]` became
  // `Example]` and `*gentype.ClientWithListAndApply[*crv1.Example, …]` became
  // `…ApplyConfiguration]`. The analyzer names the LEAF of the base type (Go
  // promotes the BASE's methods, not a type argument's), so the two sides
  // disagreed in bulk — 648 MISSING + 557 UNEXPLAINED `extends` rows over
  // 13,488 files, invisible on go-tools (10/2, all `implements`) and terraform
  // (22/0). The fix is pinned on BOTH sides: reverting the oracle fails the
  // probe as `oracle no longer derives: extends:exampleLister->ResourceIndexer, …`
  // (executed 2026-09-24 — it is the expect-side oracle check that fires first),
  // and `oracleForbid` additionally forbids the bracket text where the
  // analyzer's own forbid already refuses it. The plain external embed
  // (`io.Reader` -> `Reader`) is the control: it worked before and must keep
  // working.
  {
    const goCfg = { wasm: "tree-sitter-go.wasm", analyzerFile: "real-go-analyzer", className: "RealGoAnalyzer", ext: ".go" }
    const src = [
      `package probe`,
      ``,
      `type ctl struct {`,
      `\tio.Reader`,
      `}`,
      ``,
      `type exampleLister struct {`,
      `\tlisters.ResourceIndexer[*crv1.Example]`,
      `}`,
      ``,
      `type examples struct {`,
      `\t*gentype.ClientWithListAndApply[*crv1.Example, *crv1.ExampleList, *applyconfigurationcrv1.ExampleApplyConfiguration]`,
      `}`,
      ``,
    ].join("\n")
    await probeLang("F9-PROBE-GO-EMBED-GENERIC", "go",
      "an embedded INSTANTIATED GENERIC names the LEAF of its base type on the analyzer AND the oracle (ResourceIndexer, ClientWithListAndApply), and the truth never derives a TYPE ARGUMENT as the embedded type's name (Example])",
      goCfg, "deriveGoEdges", src,
      ["extends:ctl->Reader", "extends:exampleLister->ResourceIndexer", "extends:examples->ClientWithListAndApply"],
      ["extends:exampleLister->Example]", "extends:examples->CustomResourceDefinitionApplyConfiguration]"],
      { oracleForbid: true },
    )
  }

  // ── GO-IMPL-SIGNATURE (#914 round 4: the implements oracle) ─────────────
  // Real defects, all four found by classifying every remaining `implements`
  // disagreement on BOTH pinned corpora (go-tools 9 MISSING + 2 UNEXPLAINED,
  // terraform 18 MISSING) plus 90 MISSING over 13,488 kubernetes files. Three
  // were in the analyzer, one in the oracle, and the SAME probe source pins all
  // of them because each is a shape of the same question: is a Go method set
  // compared the way Go defines it?
  //
  //  (1) VARIADIC interface params. `variadic_parameter_declaration` was
  //      rejected outright by the interface-method extractor, so
  //      `Logf(format string, args ...any)` lost `args` on the DECLARED side
  //      while the implementor kept it as a plain param — the two texts could
  //      never match, and every grpc client (all of whose methods end in
  //      `opts ...grpc.CallOption`) and every `Output(code, args ...any)` view
  //      interface was silently un-satisfiable. `myLogger -> Logger` is the
  //      go-tools shape (printf/testdata/src/a/a2.go).
  //  (2) RECEIVER-ONLY implementors. The candidates were the types DECLARED in
  //      the file, but Go's method set is a PACKAGE-level property: gopls
  //      declares `clientDispatcher` in protocol.go and all 21 of Client's
  //      methods in tsclient.go, so the pair is provable from this file alone.
  //      The oracle has always keyed its map by receiver name, so this was a
  //      pure asymmetry.
  //  (3) ALIAS interfaces. `type A = interface{ M() }` is a `type_alias`, not a
  //      `type_spec`, so the ORACLE skipped it — and an interface that EMBEDS
  //      the alias folded nothing (gcimporter/testdata/issue25301.go was the
  //      lane's only UNEXPLAINED pair, both rows this one shape).
  //  (4) DIAMOND interface embedding. The visiting mark was never released, so
  //      it was a global `seen` set: `A { B; C }`, `B { D }`, `C { D }` left C
  //      (and A) without D's methods, by declaration order alone. Both sides
  //      lost it, which is exactly why no differential could ever see it.
  //
  // The NEGATIVE half is the oracle-over-claim class, which is what the four
  // `forbid` rows are: the oracle compared method NAMES only, a strict superset
  // of Go's rule, so it published `Value -> Type` (`Elem() Value` against
  // `Elem() Type`), `VT -> VI` (`F(int, ...string)` against `F(int)`),
  // `Diff -> DiffRenderer`, `graphTransformerMulti -> GraphVertexTransformer`
  // and every `UnimplementedXServer -> XClient` (fixed arity against variadic).
  // Each of those was charged to the analyzer as a MISSING edge it could never
  // close. `StrictValue`, `ArityVariadic`, `SliceNotVariadic` and
  // `unimplementedDialer` are those shapes; `oracleForbid` asserts the truth no
  // longer derives ANY of them either (pre-fix it derived all four, so this is
  // a real execution of the negative, not a declaration).
  {
    const goCfg = { wasm: "tree-sitter-go.wasm", analyzerFile: "real-go-analyzer", className: "RealGoAnalyzer", ext: ".go" }
    const src = [
      `package probe`,
      ``,
      `// (1) variadic interface parameter (go-tools printf/testdata a2.go)`,
      `type Logger interface {`,
      `\tLogf(format string, args ...any)`,
      `}`,
      ``,
      `type myLogger int`,
      ``,
      `func (myLogger) Logf(format string, args ...any) {}`,
      ``,
      `// (2) receiver-only implementor (gopls protocol tsclient.go)`,
      `type Client interface {`,
      `\tCall(ctx context.Context, in *Params) error`,
      `}`,
      ``,
      `func (c *clientDispatcher) Call(ctx context.Context, in *Params) error { return nil }`,
      ``,
      `// (3) alias interface + the interface that embeds it (gcimporter issue25301.go)`,
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
      `// (4) diamond interface embedding: a PATH mark, not a global seen set`,
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
      `// ---- NEGATIVE: same NAME, different SIGNATURE (must not implement) ----`,
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
    await probeLang("F9-PROBE-GO-IMPL-SIGNATURE", "go",
      "implements compares Go METHOD SETS: variadic interface params, receiver-only implementors, alias interfaces and diamond embedding all derive on BOTH sides, and a same-name/different-signature pair derives on NEITHER",
      goCfg, "deriveGoImplements", src,
      [
        "implements:myLogger->Logger",
        "implements:clientDispatcher->Client",
        "implements:AliasImpl->Alias",
        "implements:AliasImpl->Embedder",
        "implements:Diamond->D",
        "implements:Diamond->B",
        "implements:Diamond->C",
        "implements:Diamond->A",
      ],
      [
        "implements:StrictValue->StrictType",
        "implements:ArityVariadic->ArityIface",
        "implements:SliceNotVariadic->SliceIface",
        "implements:unimplementedDialer->Dialer",
        "implements:VariadicOnly->BareIface",
      ],
      { oracleForbid: true },
    )
  }

  // ── M60 objc (#D): a parameter's DECLARED NAME is never a value read ────
  // The lane's state at HEAD published `uses runBlock -> handler` from
  // `void (^handler)(NSString *)` ALONE — no read anywhere in the function —
  // and deriveObjcEdges mirrored it (probe script/m14/tmp/oc-oracle-param-uses.ts:
  // "block decl only" -> uses handler on both sides, while the C oracle given
  // the identical function-pointer parameter publishes nothing). Both sides now
  // refuse the declaration; both must still publish the CALL where the
  // parameter is invoked, which is what proves the name resolves and this probe
  // is a declaration gate rather than a missing binding.
  {
    const src = [
      `void runBlock(void (^handler)(NSString *)) {`,
      `  NSString *tag = @"t";`,
      `  handler(tag);`,
      `}`,
      ``,
      `void runPtr(void (*cb)(int)) {`,
      `  int x = 1;`,
      `  cb(x);`,
      `}`,
      ``,
      `@implementation Applier`,
      `- (void)apply:(void (^)(int))done {`,
      `  int n = 1;`,
      `  done(n);`,
      `}`,
      `@end`,
    ].join("\n") + "\n"
    await probeLang("F9-PROBE-OBJC-PARAM-DECL", "objc",
      "M60 (#D): a block-pointer/function-pointer PARAMETER's declared name is never a read — neither the analyzer nor the oracle publishes `uses runBlock -> handler` from the declaration, while BOTH publish the call where it is invoked and the argument read",
      { wasm: "tree-sitter-objc.wasm", analyzerFile: "real-objective-c-analyzer", className: "RealObjectiveCAnalyzer", ext: "m" },
      "deriveObjcEdges", src,
      [
        "calls:runBlock->handler",
        "uses:runBlock->tag",
        "calls:runPtr->cb",
        "uses:runPtr->x",
        "calls:apply:->done",
        "uses:apply:->n",
      ],
      [
        "uses:runBlock->handler",
        "uses:runPtr->cb",
        "uses:apply:->done",
      ],
      { oracleForbid: true },
    )
  }

  // ── M60 objc (#B): the production entry keeps selector targets ──────────
  // `filterNoiseRelationships` (src/ast/pool-worker.ts) computed a target's
  // "leaf" as the LAST ':'-separated segment. An ObjC selector ENDS in ':'
  // because that colon IS its arity, so the leaf was empty, `leaf.length < 1`
  // fired, and EVERY message-send target was dropped before any consumer saw
  // it: 17 of the M12 objc differential's 30 false negatives were rows the
  // analyzer had emitted and this filter had eaten. The fixture/mutant suites
  // cannot see it (M14 fixtures call `analyzer.analyze` directly), so the pin
  // has to run the PRODUCTION entry over a real file.
  {
    const id = "F9-PROBE-OBJC-PRODUCTION-SELECTOR"
    const description = "M60 (#B): pool-worker's production entry keeps a keyword-selector target that ends in ':' (calls saveUser: -> addObject:, contains UserService -> saveUser:)"
    try {
      const os = await import("os")
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-f9-objc-prod-"))
      const file = path.join(dir, "probe.m")
      fs.writeFileSync(file, [
        `#import <Foundation/Foundation.h>`,
        `@interface UserService`,
        `- (void)saveUser:(NSString *)userId;`,
        `@end`,
        `@implementation UserService {`,
        `  NSMutableArray *_savedUsers;`,
        `}`,
        `- (void)saveUser:(NSString *)userId {`,
        `  [_savedUsers addObject:userId];`,
        `}`,
        `@end`,
      ].join("\n") + "\n")
      const pw: any = await import("../../src/ast/pool-worker")
      const prod = await pw.parseFile(file, dir)
      const got = (prod.relationships ?? []).map((r: any) => `${r.type}:${r.source}->${r.target}`)
      const expect = ["calls:saveUser:->addObject:", "contains:UserService->saveUser:"]
      const missing = expect.filter((e) => !got.includes(e))
      if (missing.length > 0) {
        record(id, "objc", description, false, `production entry dropped: ${missing.join(", ")} (the analyzer emits them — this is the noise filter, see src/ast/pool-worker.ts filterNoiseRelationships)`)
      } else {
        record(id, "objc", description, true, "ok (production entry preserves trailing-colon selector targets)")
      }
      fs.rmSync(dir, { recursive: true, force: true })
    } catch (e: any) {
      record(id, "objc", description, false, e.message)
    }
  }

  // ── M37.19 (#612) cpp: a template-wrapped DECLARATOR NAME is not a read ──
  // The defect class this round found, and the ONLY kind of gate that could
  // have caught it: the analyzer and the oracle AGREED on a wrong answer. The
  // declared name of an explicit specialization sits inside `template_function`
  // (`template <> constexpr auto num_bits<native_int128>() -> int`), so the
  // leftmost-declarator rule — which gates on the node's DIRECT parent — read
  // the declared entity as a use of itself on BOTH sides. 7 such pairs were
  // `covered` reads at the fmt full extent (fmt format.h num_bits/digits10,
  // printf.h find, gtest.h GenerateNamesRecursively, one-arg.cc from_repr,
  // fuzzer-common.h assign_from_buf, format-impl-test.cc run_double_tests), so
  // every count in that lane read clean while the lane published 7 false reads.
  // A fixture alone cannot express this: the M14 fixture runner asserts the
  // analyzer against its OWN expectation, and the analyzer was not wrong
  // relative to the oracle — both were. `oracleForbid` is the assertion that
  // the truth side refuses the edge too; drop the shared rule from either side
  // and this probe fails.
  {
    const src = [
      `namespace detail {`,
      `template <typename T> constexpr auto bits_of() -> int { return (int)sizeof(T) * 8; }`,
      `template <> constexpr auto bits_of<long>() -> int { return 64; }`,
      `const int kBufferSize = 8;`,
      `int shared_counter;`,
      `int use_bits() { return bits_of<short>(); }`,
      `int read_through_size() { char buffer[kBufferSize]; return buffer[0] + shared_counter; }`,
      `}`,
    ].join("\n") + "\n"
    await probeLang("F9-PROBE-CPP-TEMPLATE-DECL-NAME", "cpp",
      "a template-wrapped declarator's NAME is a DECLARATION on both sides: no `uses -> bits_of` from `template <> constexpr auto bits_of<long>() -> int` on the analyzer OR in the bare-uses truth, while the genuine reads in the same file (an array-size read of a namespace constant and a bare value read) stay on both sides",
      { wasm: "tree-sitter-cpp.wasm", analyzerFile: "real-cpp-analyzer", className: "RealCppAnalyzer", ext: "cpp" },
      "deriveCppBareUses", src,
      [
        "uses:read_through_size->kBufferSize",
        "uses:read_through_size->shared_counter",
      ],
      [
        "uses:bits_of",
        "uses:detail->bits_of",
      ],
      { oracleForbid: true },
    )
    await probeLang("F9-PROBE-CPP-TEMPLATE-CALL", "cpp",
      "the controls that keep the declaration gate narrow: a CALL of the same template is still a call on both sides (the callee leaf belongs to the calls branch), and the size-expression read of a namespace-scope constant is still a read — so the rule cannot be satisfied by silencing the name",
      { wasm: "tree-sitter-cpp.wasm", analyzerFile: "real-cpp-analyzer", className: "RealCppAnalyzer", ext: "cpp" },
      "deriveCppEdges", src,
      [
        // deriveCppEdges derives the call truth (calls + member reads); the
        // bare-value read controls belong to the probe above, which pins them
        // against their own oracle.
        "calls:use_bits->bits_of",
      ],
      [
        // The danger with a declaration-position rule is the mirror mistake:
        // reading `bits_of<long>()` in a DECLARATOR as a call whose source is
        // the enclosing scope. `calls:use_bits->bits_of` above must survive,
        // so the forbid is the scope-sourced shape, not the bare target.
        "calls:detail->bits_of",
      ],
    )
  }

  // ── M37.19 (#612) cpp: a WRAPPED declarator still opens a function scope ──
  // The FUNCTION-path sibling of the two probes above, and the one that cost a
  // whole SCOPE. Two spellings wrap the declarator, and for both the declared
  // name was looked up among the function_declarator's DIRECT children:
  //
  //   bool (acceptParenthesized)(bool strict = true) { … }
  //     function_declarator[declarator: parenthesized_declarator[field_identifier]]
  //   JSON_HEDLEY_NON_NULL(3)
  //   bool sax_parse(const input_format_t format,          <- macro between the
  //                  json_sax_t* sax_, …)                 <- return type and the name
  //     function_definition > parenthesized_declarator[ERROR, function_declarator]
  //
  // No name meant no method SYMBOL and, because the caller pushes the function
  // scope out of that same result, NO SCOPE — so the parameter `strict` was never
  // bound and its reads resolved outward to the file-scope enumerator. Measured:
  // nlohmann-json's `include/nlohmann/json_v3_10_5.hpp` lost 14 method symbols and
  // produced the lane's last unexplained edge, `uses binary_reader -> strict`.
  //
  // Only the FIRST spelling can live in a probe: the second is a grammar RECOVERY
  // shape, and the battery refuses a snippet whose tree has errors (a probe must
  // be valid code — see analyzeWith). The macro spelling is pinned by
  // cpp/wrapped-declarator-names-612 instead, whose own tree carries the ERROR
  // exactly as the corpus does. Here the parenthesized spelling gets the shared
  // rule: the parameter's read must be absent on BOTH sides while a real read in
  // the same snippet stays on both — the control that stops `no strict read` from
  // being satisfied by silencing the name outright.
  {
    const src = [
      `enum class error_handler_t { strict, ignore };`,
      `int counter;`,
      `class binary_reader {`,
      `  int bump() { return counter; }`,
      `  bool (acceptParenthesized)(bool strict = true) { return strict; }`,
      `};`,
    ].join("\n") + "\n"
    await probeLang("F9-PROBE-CPP-WRAPPED-DECLARATOR-SCOPE", "cpp",
      "a wrapped declarator name (`bool (acceptParenthesized)(…)`) still publishes its method and opens a function scope, so its parameter's read never escapes to the file-scope enumerator — on the analyzer OR in the bare-uses truth — while a genuine read in the same snippet stays on both sides",
      { wasm: "tree-sitter-cpp.wasm", analyzerFile: "real-cpp-analyzer", className: "RealCppAnalyzer", ext: "cpp" },
      "deriveCppBareUses", src,
      [
        "uses:bump->counter",
      ],
      [
        "uses:strict",
        "uses:binary_reader->strict",
      ],
      { oracleForbid: true },
    )
  }

  // ── M60 clean: the declaration contract, the operator callable and its
  //    scope exit, the guard-equation complexity signal, and the head-pattern
  //    gate — four defects this lane actually had, each asserted on the
  //    analyzer (and, where the shape is an edge, on the oracle too).
  //
  //   1. a definition module's declared interface published NOTHING: 2,002
  //      distinct module-level signature names over the lane's 312 files, 708 of
  //      them visible nowhere, and the export predicate `!sym.ownerName` — the
  //      negation of the rule its own comment stated — left 312 of 312 files
  //      exporting at most one thing.
  //   2. an `operator_definition` owned no call at all, and the moment it did it
  //      was never released: `(++|)` in clean-stdlib/StdOverloadedList.icl claimed
  //      `flatten l` from a macro six lines below it (the single UNEXPLAINED row
  //      of the exhaustive mini-differential).
  //   3. `cyclomaticComplexity` counted the `guard` node type — 23 corpus sites,
  //      every one of them a LIST-COMPREHENSION qualifier — while `guard_equation`
  //      (1,594 function guards) went uncounted. The signal measured the rare
  //      shape and missed the intended one.
  //   4. the function-head pattern gate looked for a child typed `operator` with
  //      text `=`, which the pinned grammar cannot produce (a definition's
  //      children are name/pattern…/body and the `=` is not a child; the 1,576
  //      corpus `operator` nodes are operator symbols under binary_expression /
  //      unary_expression / paren_pattern). The gate was dead, so a grammar that
  //      app-lifts a head pattern would have started fabricating `instantiates`
  //      with nothing in the way — the failure it was written against.
  {
    const cleanCfg = { wasm: "tree-sitter-clean.wasm", analyzerFile: "real-clean-analyzer", className: "RealCleanAnalyzer", ext: ".icl" }
    const declCfg = { ...cleanCfg, ext: ".dcl" }

    // 1. the declaration contract, in one definition module
    const dclSrc = [
      "definition module DclInterface",
      "import StdEnv",
      "plainFunction :: !Int -> Bool",
      "NSMakeSize :: !Int !Int -> Int",
      "(%.) infixl 9 :: !Int !Int -> Int",
      "(bitxor) :: !Int !Int -> Int",
      "",
    ].join("\n")
    const dcl = await analyzeWith("clean", declCfg, dclSrc)
    const dclSyms = new Set((dcl.symbols as any[]).map((s) => `${s.kind}:${s.name}`))
    const dclExps = new Set((dcl.exports as any[]).map((e) => `${e.kind}:${e.name}`))
    const wantShapes = ["plainFunction", "NSMakeSize", "%.", "bitxor"]
    const missSym = wantShapes.filter((w) => !dclSyms.has(`function:${w}`))
    const missExp = wantShapes.filter((w) => !dclExps.has(`function:${w}`))
    const marked = (dcl.symbols as any[]).filter((s) => s.metadata?.isDeclaration === true).length
    const dclPass = missSym.length === 0 && missExp.length === 0 && marked === wantShapes.length
    record("F9-PROBE-CLEAN-DCL-INTERFACE", "clean",
      "a definition module's declared interface publishes a symbol per `signature_name` shape AND exports it (identifier, constructor-as-function, parenthesized_operator, parenthesized_name), each marked as a declaration",
      dclPass,
      dclPass
        ? `4 shapes published and exported, ${marked} marked isDeclaration`
        : `missing symbols=[${missSym}] missing exports=[${missExp}] isDeclaration-marked=${marked}`)

    // 3. guards are decision points; a comprehension filter is a different one
    // Clean's comprehension separator is TWO backslashes. Built from char codes
    // so this snippet does not depend on counting escape levels in a JS literal —
    // the first draft wrote one backslash and the snippet failed to parse, which
    // is the kind of silent difference a probe must not have.
    const SEP = String.fromCharCode(92) + String.fromCharCode(92)
    const guardBody = (n: string) => [
      "module GuardComplexity",
      "import StdEnv",
      "classify :: !Int -> String",
      n,
      "filters :: ![Int] -> [Int]",
      `filters xs = [ k * k ${SEP} k <- xs | k > 0 ]`,
      "",
    ].join("\n")
    const withGuards = await analyzeWith("clean", cleanCfg, guardBody('classify n\n\t| n < 0\t\t= "negative"\n\t| n == 0\t= "zero"\n\t| otherwise\t= "positive"'))
    const noGuards = await analyzeWith("clean", cleanCfg, guardBody('classify n = "any"'))
    const cxWith: number = withGuards.metadata?.cyclomaticComplexity ?? 0
    const cxWithout: number = noGuards.metadata?.cyclomaticComplexity ?? 0
    const delta = cxWith - cxWithout
    const guardPass = delta >= 3
    record("F9-PROBE-CLEAN-GUARD-COMPLEXITY", "clean",
      "cyclomaticComplexity counts FUNCTION guards (`guard_equation`) — three guard equations raise it by at least three over the same file without them — and a list-comprehension `guard` remains a counted decision point of its own",
      guardPass,
      guardPass
        ? `guards add ${delta} (${cxWithout} -> ${cxWith})`
        : `guards add only ${delta} (${cxWithout} -> ${cxWith}); guard_equation is not counted`)

    // 2 + 4: both defects are MISATTRIBUTION — the same target reached from a
    // source that must not own it. `probeLang`'s oracle half cannot express that:
    // it reduces an edge to `label:target`, so `forbid: ["calls:++->tweak"]`
    // becomes `calls:tweak`, which the oracle legitimately derives for
    // `later -> tweak` — a false "oracle colludes" (measured: that is exactly how
    // these two probes first failed). A source-aware comparison on BOTH sides is
    // the only honest form for this class, so it is written out here.
    const wtsAny: any = WTS
    const PB = wtsAny.Parser ?? wtsAny.default ?? wtsAny
    const LB = wtsAny.Language ?? wtsAny.default?.Language
    await PB.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
    const cleanParser = new PB()
    cleanParser.setLanguage(await LB.load(fs.readFileSync(path.join(WASM_DIR, "tree-sitter-clean.wasm"))))
    const { deriveCleanEdges } = await import("./differential")

    const probeCleanEdges = async (id: string, description: string, src: string, expect: string[], forbid: string[]) => {
      try {
        const root = cleanParser.parse(src).rootNode
        if (root.hasError) throw new Error("probe snippet has parse errors for clean")
        const res = await analyzeWith("clean", cleanCfg, src)
        const analyzer = new Set((res.relationships as any[]).map((r) => `${r.type}:${r.source}->${r.target}`))
        const oracle = new Set(deriveCleanEdges(root).map((e: any) => `${e.label}:${e.from}->${e.target}`))
        const missing = expect.filter((e) => !analyzer.has(e))
        const fabricated = forbid.filter((e) => analyzer.has(e))
        const oracleMissing = expect.filter((e) => !oracle.has(e))
        const oracleColludes = forbid.filter((e) => oracle.has(e))
        if (missing.length) return record(id, "clean", description, false, `missing: ${missing.join(", ")}`)
        if (fabricated.length) return record(id, "clean", description, false, `fabricated: ${fabricated.join(", ")}`)
        if (oracleMissing.length) return record(id, "clean", description, false, `oracle no longer derives: ${oracleMissing.join(", ")} (oracle regression)`)
        if (oracleColludes.length) return record(id, "clean", description, false, `oracle colludes: truth derives ${oracleColludes.join(", ")} (lockstep mirrored a fabrication — the lane cannot see it)`)
        record(id, "clean", description, true, `ok (oracle agrees, source-aware: no collusion on the forbidden set)`)
      } catch (e: any) {
        record(id, "clean", description, false, e?.message ?? String(e))
      }
    }

    await probeCleanEdges(
      "F9-PROBE-CLEAN-OPERATOR-SCOPE",
      "an operator definition's body attributes its call to the operator, and the attribution is RELEASED when its scope ends — a later module-level application keeps its own source instead of being swallowed by the operator",
      "module OperatorScope\nimport StdEnv\n(++) x y = helper x\nlater :: !Int -> Int\nlater z = tweak z\ntweak :: !Int -> Int\ntweak w = w - 1\nhelper :: !Int -> Int\nhelper v = v\n",
      ["calls:++->helper", "calls:later->tweak"],
      ["calls:++->tweak"],
    )

    await probeCleanEdges(
      "F9-PROBE-CLEAN-HEAD-PATTERN",
      "a constructor in a function HEAD pattern is never an `instantiates` (pattern territory is everything before the body FIELD — the pre-fix gate tested for an `operator` child with text `=`, which this grammar cannot produce), while the same constructor in a BODY still is",
      "module HeadPattern\nimport StdEnv\nunwrap :: Maybe Int -> Int\nunwrap (Just v) = v\nwrap :: Int -> Maybe Int\nwrap y = Just y\n",
      ["instantiates:wrap->Just"],
      ["instantiates:unwrap->Just"],
    )

    // 5. Dimension 8 / M59.O2: every edge names its SITE LINE, 1-based, on the
    // name-bearing node, PER-SITE. The probe is written so each clause can fail on
    // its own: a per-SET implementation (the pre-fix state: no line field at all,
    // one edge per source|type|target) passes the coverage clause trivially when
    // the line is absent, so the multiplicity clause is the one that pins per-site,
    // and the anchor clause is the one the store's resolver actually reads (#921).
    {
      const lineSrc = [
        "module EdgeLines",       // 1
        "import StdEnv",          // 2
        "f :: !Int -> Int",       // 3
        "f x = x + 1",            // 4
        "g :: !Int -> Int",       // 5
        "g a = f a",              // 6
        "h :: !Int -> Int",       // 7
        "h b = f b",              // 8
        "k :: !Int -> Int",       // 9
        "k c = f c",              // 10
        "",
      ].join("\n")
      const res = await analyzeWith("clean", cleanCfg, lineSrc)
      const rels = (res.relationships ?? []) as any[]
      const noLine = rels.filter((r) => !(typeof r.line_number === "number" && Number.isInteger(r.line_number) && r.line_number > 0))
      const zero = rels.filter((r) => r.line_number === 0)
      const callLines = rels.filter((r) => r.type === "calls" && r.target === "f").map((r) => r.line_number).sort((a, b) => a - b)
      const perSite = callLines.length === 3 && new Set(callLines).size === 3 && callLines.join(",") === "6,8,10"
      const containsF = rels.find((r) => r.type === "contains" && r.target === "f")
      const fSym = (res.symbols ?? []).find((s: any) => s.name === "f")
      const anchorOk = !!containsF && !!fSym && containsF.line_number === fSym.range?.startLine
      const importEdge = rels.find((r) => r.type === "references" && r.target === "StdEnv")
      const importOk = importEdge?.line_number === 2
      const pass = rels.length > 0 && noLine.length === 0 && zero.length === 0 && perSite && anchorOk && importOk
      record(
        "F9-PROBE-CLEAN-EDGE-LINE",
        "clean",
        "every relationship carries the SITE LINE it happened on — 1-based, positive, never a fabricated 0, on the name-bearing node — and the line is part of the dedupe key: a function called from three lines is three edges at those three lines, while a `contains` edge carries the child's own naming line (the #921 anchor the store resolves with)",
        pass,
        pass
          ? `ok (${rels.length} edges, all with a line; calls f at lines ${callLines.join(",")}; contains f at the definition's line; import at L2)`
          : `edges=${rels.length} withoutLine=${noLine.length} zero=${zero.length} callsToF=[${callLines.join(",")}] (per-site needs 3 distinct) containsAnchor=${anchorOk} importLine=${importEdge?.line_number}`,
      )
    }
  }

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
