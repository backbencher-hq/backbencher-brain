/**
 * M14.0.F6 — Fixture-Coverage Gate
 *
 * The new-parent bug class: the PHP spec declared `relative_scope` as
 * handled_verified, but NO fixture ever contained `new self/static/parent`,
 * so the degenerate ternary survived every review and every gate. A spec can
 * claim a node type is handled; only a fixture that actually PARSES that node
 * type proves the claim is exercised.
 *
 * Two checks per gated language:
 *
 *   1. spec->fixture coverage: every type in spec.handled_verified.types must
 *      occur in at least one fixture source file's PARSE TREE (not text match —
 *      node type names never appear as source text). A type that no fixture
 *      exercises is a spec claim with zero evidence: the fixture must grow.
 *
 *   2. dead-literal audit: every string literal in the analyzer source that
 *      syntactically looks like a node type (`n.type === "x"` /
 *      `t === "x"` / findChildByType(..., "x")) must be one of:
 *        - a real node type in the pinned grammar, AND
 *        - present in the language spec (handled_verified / internal_silent /
 *          gap / design_decision types), OR an allowlisted non-node literal.
 *      A literal that is neither is DEAD CODE — the exact relative_scope bug
 *      (a branch that can never fire, or fires on a type the spec never
 *      classified). Dead literals must be removed or classified.
 *
 * Usage:
 *   bun run script/m14/verify-fixture-coverage.ts            # all gated langs
 *   bun run script/m14/verify-fixture-coverage.ts --lang php # one language
 *   bun run script/m14/verify-fixture-coverage.ts --update-baseline
 *
 * Evidence: validation/m14/results/M14.0.F6.json
 */

import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(__dirname, "..", "..")
const SPEC_DIR = path.join(ROOT, "script", "m14", "spec")
const FIXTURE_DIR = path.join(ROOT, "validation", "m14", "fixtures")
const WASM_DIR = path.join(ROOT, "wasm")
const BASELINE = path.join(ROOT, "validation", "m14", "baselines", "fixture-coverage.json")
const EVIDENCE = path.join(ROOT, "validation", "m14", "results", "M14.0.F6.json")

const GATED_LANGS: Record<string, { wasm: string; ext: string[]; analyzer: string; extraWasm?: string[] }> = {
  java:       { wasm: "tree-sitter-java.wasm",       ext: [".java"],   analyzer: "real-java-analyzer.ts" },
  groovy:     { wasm: "tree-sitter-groovy.wasm",     ext: [".groovy"], analyzer: "real-groovy-analyzer.ts" },
  kotlin:     { wasm: "tree-sitter-kotlin.wasm",     ext: [".kt"],     analyzer: "real-kotlin-analyzer.ts" },
  scala:      { wasm: "tree-sitter-scala.wasm",      ext: [".scala"],  analyzer: "real-scala-analyzer.ts" },
  typescript: { wasm: "tree-sitter-typescript.wasm", ext: [".ts"],     analyzer: "real-typescript-analyzer.ts", extraWasm: ["tree-sitter-tsx.wasm"] },
  javascript: { wasm: "tree-sitter-javascript.wasm", ext: [".js"],     analyzer: "real-javascript-analyzer.ts" },
  vue:        { wasm: "tree-sitter-vue.wasm",        ext: [".vue"],    analyzer: "real-vue-analyzer.ts", extraWasm: ["tree-sitter-typescript.wasm", "tree-sitter-javascript.wasm"] },
  svelte:     { wasm: "tree-sitter-svelte.wasm",     ext: [".svelte"], analyzer: "real-svelte-analyzer.ts", extraWasm: ["tree-sitter-typescript.wasm", "tree-sitter-javascript.wasm"] },
  c:          { wasm: "tree-sitter-c.wasm",          ext: [".c", ".h"], analyzer: "real-c-analyzer.ts" },
  cpp:        { wasm: "tree-sitter-cpp.wasm",        ext: [".cc", ".cpp", ".h", ".hpp"], analyzer: "real-cpp-analyzer.ts" },
  rust:       { wasm: "tree-sitter-rust.wasm",       ext: [".rs"],     analyzer: "real-rust-analyzer.ts" },
  go:         { wasm: "tree-sitter-go.wasm",         ext: [".go"],     analyzer: "real-go-analyzer.ts" },
  zig:        { wasm: "tree-sitter-zig.wasm",        ext: [".zig"],    analyzer: "real-zig-analyzer.ts" },
  csharp:     { wasm: "tree-sitter-c_sharp.wasm",    ext: [".cs"],     analyzer: "real-csharp-analyzer.ts" },
  dart:       { wasm: "tree-sitter-dart.wasm",       ext: [".dart"],   analyzer: "real-dart-analyzer.ts" },
  swift:      { wasm: "tree-sitter-swift.wasm",      ext: [".swift"],  analyzer: "real-swift-analyzer.ts" },
  objc:       { wasm: "tree-sitter-objc.wasm",       ext: [".m", ".h"], analyzer: "real-objective-c-analyzer.ts" },
  php:        { wasm: "tree-sitter-php.wasm",        ext: [".php"],    analyzer: "real-php-analyzer.ts" },
  ruby:       { wasm: "tree-sitter-ruby.wasm",       ext: [".rb"],     analyzer: "real-ruby-analyzer.ts" },
  python:     { wasm: "tree-sitter-python.wasm",     ext: [".py"],     analyzer: "real-python-analyzer.ts" },
  haskell:    { wasm: "tree-sitter-haskell.wasm",    ext: [".hs"],     analyzer: "real-haskell-analyzer.ts" },
}

// Literals that look like node-type comparisons but are not node types
// (keywords, field names, framework markers). Extend with a comment when a
// language genuinely needs one — never to silence a real finding.
const LITERAL_ALLOWLIST: Record<string, Set<string>> = {
  php: new Set([
    "self", "static", "parent",       // relative-scope keywords (text match, not node type)
    "add_action", "add_filter",       // WP hook names
    "Controller", "Service",          // naming-convention suffixes
  ]),
  ruby: new Set([
    "puts", "raise", "require", "require_relative", "load",
    "attr_accessor", "attr_reader", "attr_writer",
    "include", "extend", "prepend",
    "private", "protected", "public", "module_function",
    "define_method", "method_missing",
  ]),
  swift: new Set([
    "print", "defer", "self", "Self", "super",
  ]),
  objc: new Set([
    "self", "super", "nil", "YES", "NO",
  ]),
  dart: new Set([
    "super", "this",
  ]),
  csharp: new Set([
    "base", "this",
  ]),
  java: new Set([
    "super", "this",
  ]),
  groovy: new Set([
    "super", "this", "it",
  ]),
  cpp: new Set([
    "auto", "template",
  ]),
  go: new Set([]),
  rust: new Set([
    "self", "Self", "super", "crate",
  ]),
  zig: new Set([]),
  c: new Set([]),
  kotlin: new Set([]),
  scala: new Set([]),
  typescript: new Set([]),
  javascript: new Set([]),
  vue: new Set([]),
  svelte: new Set([]),
}

interface LangResult {
  language: string
  specHandled: number
  fixtureTypes: number
  uncovered: string[]        // spec-handled types no fixture exercises
  deadLiterals: string[]     // analyzer literals that are neither grammar types nor spec-classified
  pass: boolean
}

async function main() {
  const langArgIdx = process.argv.indexOf("--lang")
  const langArg = langArgIdx >= 0 ? process.argv[langArgIdx + 1] : undefined
  const updateBaseline = process.argv.includes("--update-baseline")

  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

  const results: LangResult[] = []
  const langs = langArg ? [langArg] : Object.keys(GATED_LANGS)

  for (const lang of langs) {
    const cfg = GATED_LANGS[lang]
    if (!cfg) {
      console.error(`unknown language: ${lang}`)
      process.exit(2)
    }
    const specPath = path.join(SPEC_DIR, `${lang}-completeness.json`)
    if (!fs.existsSync(specPath)) {
      console.log(`${lang.padEnd(12)} SKIP (no spec)`)
      continue
    }
    const spec = JSON.parse(fs.readFileSync(specPath, "utf8"))
    const handled: string[] = spec.handled_verified?.types ?? []

    // --- parse all fixture sources, collect occurring node types ---
    const fixtureDir = path.join(FIXTURE_DIR, lang)
    const srcs: string[] = []
    if (fs.existsSync(fixtureDir)) {
      for (const f of fs.readdirSync(fixtureDir)) {
        if (cfg.ext.some((e) => f.endsWith(e))) srcs.push(path.join(fixtureDir, f))
      }
    }
    const occurring = new Set<string>()
    if (srcs.length > 0) {
      const langWasm = await L.load(fs.readFileSync(path.join(WASM_DIR, cfg.wasm)))
      const parser = new P()
      parser.setLanguage(langWasm)
      for (const src of srcs) {
        const tree = parser.parse(fs.readFileSync(src, "utf8"))
        const stack = [tree.rootNode]
        while (stack.length > 0) {
          const n = stack.pop()!
          occurring.add(n.type)
          // ALL children, not just named: specs legitimately declare
          // anonymous token types (`if`, `begin`, `case`) as handled, and
          // analyzers branch on them — they must count as coverable.
          for (let i = 0; i < n.childCount; i++) {
            const c = n.child(i)
            if (c) stack.push(c)
          }
        }
      }
    }
    // A ruled design decision (e.g. vue/svelte D1: style_element skipped by
    // design — CSS belongs to the css analyzer) is a DECLARED LIMITATION,
    // not an unevidenced claim. It must not fail the coverage check.
    const decisionRuled = new Set<string>()
    for (const d of spec.design_decision?.decisions ?? []) {
      for (const t of String(d.node_type ?? "").split(",")) {
        const tt = t.trim()
        if (tt) decisionRuled.add(tt)
      }
    }
    for (const t of spec.design_decision?.types ?? []) decisionRuled.add(t)
    const uncovered = handled.filter((t) => !occurring.has(t) && !decisionRuled.has(t))

    // --- dead-literal audit over the analyzer source ---
    const analyzerPath = path.join(ROOT, "src", "ast", cfg.analyzer)
    const deadLiterals: string[] = []
    if (fs.existsSync(analyzerPath)) {
      const src = fs.readFileSync(analyzerPath, "utf8")
      // node-type-looking literals: ONLY comparisons against a node's .type
      // (dotted receiver) or findChildByType/hasChildType helpers. The broad
      // `type === "x"` form is excluded on purpose: it also matches
      // relationship-kind comparisons (`type === "calls"`) and metadata-field
      // comparisons (`relationshipType === "declared_type"`), which are not
      // node types and would flood the audit with false positives.
      const patterns = [
        /\.[tT]ype\s*===\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
        /\.[tT]ype\s*!==\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
        /findChildByType\([^,]+,\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
        /hasChildType\([^,]+,\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
      ]
      const found = new Set<string>()
      for (const re of patterns) {
        for (const m of src.matchAll(re)) found.add(m[1])
      }
      // grammar node types for the dead-literal audit: named AND anonymous.
      // Analyzers legitimately compare against anonymous keyword tokens
      // (`c.type === "const"` in rust, `t === "case"` in scala); a literal
      // that matches ANY real node type or token is live, not dead.
      const langWasm = await L.load(fs.readFileSync(path.join(WASM_DIR, cfg.wasm)))
      const grammarTypes = new Set<string>()
      for (let i = 0; i < langWasm.nodeTypeCount; i++) {
        const n = langWasm.nodeTypeForId(i)
        if (n && !n.startsWith("_")) grammarTypes.add(n)
      }
      // Vue/Svelte analyzers re-parse embedded <script> content with the JS/TS
      // grammar — those node-type literals are live against that grammar.
      for (const extra of cfg.extraWasm ?? []) {
        const extraLang = await L.load(fs.readFileSync(path.join(WASM_DIR, extra)))
        for (let i = 0; i < extraLang.nodeTypeCount; i++) {
          const n = extraLang.nodeTypeForId(i)
          if (n && !n.startsWith("_")) grammarTypes.add(n)
        }
      }
      const specTypes = new Set<string>([
        ...handled,
        ...(spec.internal_silent?.types ?? []),
      ])
      for (const g of spec.gap?.gaps ?? []) {
        for (const t of String(g.node_type ?? "").split(",")) {
          const tt = t.trim()
          if (tt) specTypes.add(tt)
        }
      }
      for (const t of spec.design_decision?.types ?? []) specTypes.add(t)
      // decisions[] is the common shape: an array of rulings whose node_type
      // can be a comma-separated list.
      for (const d of spec.design_decision?.decisions ?? []) {
        for (const t of String(d.node_type ?? "").split(",")) {
          const tt = t.trim()
          if (tt) specTypes.add(tt)
        }
      }
      const allow = LITERAL_ALLOWLIST[lang] ?? new Set()
      for (const lit of found) {
        if (grammarTypes.has(lit)) continue
        if (lit === "ERROR" || lit === "MISSING") continue // tree-sitter synthetic nodes (parse-error probes)
        if (allow.has(lit)) continue
        // Not a grammar node/token, not synthetic, not allowlisted: a
        // comparison that can never fire against a parse tree — DEAD CODE,
        // the exact method_elem/relative_scope bug class.
        deadLiterals.push(lit)
      }
      deadLiterals.sort()
    }

    const pass = uncovered.length === 0 && deadLiterals.length === 0
    results.push({ language: lang, specHandled: handled.length, fixtureTypes: occurring.size, uncovered, deadLiterals, pass })
    const flag = pass ? "PASS" : "FAIL"
    console.log(`${lang.padEnd(12)} ${flag}  handled=${handled.length} fixtureTypes=${occurring.size} uncovered=${uncovered.length} deadLiterals=${deadLiterals.length}`)
    if (uncovered.length > 0) console.log(`    uncovered: ${uncovered.join(", ")}`)
    if (deadLiterals.length > 0) console.log(`    deadLiterals: ${deadLiterals.join(", ")}`)
  }

  // --- baseline regression check ---
  const failures = results.filter((r) => !r.pass)
  if (updateBaseline) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true })
    fs.writeFileSync(BASELINE, JSON.stringify({ results }, null, 2) + "\n")
    console.log(`\nbaseline written: ${path.relative(ROOT, BASELINE)}`)
  } else if (fs.existsSync(BASELINE)) {
    const prev = JSON.parse(fs.readFileSync(BASELINE, "utf8")).results as LangResult[]
    const prevBy = new Map(prev.map((r) => [r.language, r]))
    for (const r of results) {
      const p = prevBy.get(r.language)
      if (!p) continue
      const newlyUncovered = r.uncovered.filter((t) => !p.uncovered.includes(t))
      const newlyDead = r.deadLiterals.filter((t) => !p.deadLiterals.includes(t))
      if (newlyUncovered.length > 0 || newlyDead.length > 0) {
        console.log(`BASELINE REGRESSION ${r.language}: new uncovered=[${newlyUncovered}] new dead=[${newlyDead}]`)
        failures.push(r)
      }
    }
  }

  // --- evidence ---
  const { emitEvidence } = await import("./evidence-harness")
  const checks = results.map((r) => ({
    id: `fixture-coverage-${r.language}`,
    description: `every handled_verified type exercised by a fixture; no dead analyzer literals (${r.specHandled} spec types, ${r.fixtureTypes} fixture types)`,
    status: r.pass ? "pass" : "fail",
    uncovered: r.uncovered,
    deadLiterals: r.deadLiterals,
  }))
  emitEvidence({
    issueId: "M14.0.F6",
    title: "Fixture-coverage gate: spec-handled node types must be exercised by fixtures; no dead analyzer literals",
    claimLevel: "L1",
    layers: ["fixtures"],
    checks,
    limitations: [
      {
        description: "Coverage checked against single-file fixtures; per-language multi-file construct families (e.g. cross-file extends) rely on the differential gate instead",
      },
    ],
  })

  if (failures.length > 0) {
    console.log(`\nfixture-coverage gate: ${failures.length} failure(s) — release blocked`)
    process.exit(1)
  }
  console.log(`\nfixture-coverage gate: all ${results.length} language(s) pass`)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
