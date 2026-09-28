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
  clojure:    { wasm: "tree-sitter-clojure.wasm",    ext: [".clj", ".cljc", ".cljs"], analyzer: "real-clojure-analyzer.ts" },
  elixir:     { wasm: "tree-sitter-elixir.wasm",     ext: [".ex", ".exs"], analyzer: "real-elixir-analyzer.ts" },
  // M60 functional family: the clean lane was absent from this gate, so its
  // spec claim (a definition module's declared interface, the operator
  // callable, the export surface) had no fixture-coverage check at all. Its two
  // extensions are both real sources: a `.dcl` is declarations only and a
  // `.icl` is the implementation — the F6 check must see both or the ruling's
  // first half is unexercised by construction.
  clean:      { wasm: "tree-sitter-clean.wasm",     ext: [".icl", ".dcl"], analyzer: "real-clean-analyzer.ts" },
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
    // `dynamic` compares the PARAMETER TYPE PAYLOAD, not a node type — the
    // honest no-type value DARTD13 leaves for unresolvable params (see spec
    // DARTD13). The coverage audit flags it because it is not a grammar
    // type; it never claimed to be one.
    "dynamic",
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

/**
 * Mask `//` line comments and `/* … *​/` block comments, preserving string
 * literals (the findings ARE string literals) and byte offsets.
 *
 * Why this is not cosmetic: the literal scan reads a whole analyzer file as
 * text, so an ANALYZER COMMENT that quotes a node-type comparison — e.g. an
 * audit note explaining that `cur.type === "qualified_type"` was removed
 * because the grammar has no such node — was itself matched and reported as
 * dead code. A gate that punishes documenting a removal is worse than blind:
 * it forces the reasoning out of the code. String-aware, so a `//` inside a
 * string is not treated as a comment.
 */
function maskComments(src: string): string {
  const out = src.split("")
  const n = src.length
  let i = 0
  let state: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code"
  while (i < n) {
    const c = src[i]
    const c2 = src[i + 1]
    if (state === "code") {
      if (c === "/" && c2 === "/") {
        out[i] = " "; out[i + 1] = " "; state = "line"; i += 2; continue
      }
      if (c === "/" && c2 === "*") {
        out[i] = " "; out[i + 1] = " "; state = "block"; i += 2; continue
      }
      if (c === "'") state = "sq"
      else if (c === '"') state = "dq"
      else if (c === "`") state = "tpl"
      i++
      continue
    }
    if (state === "line") {
      if (c === "\n") { state = "code"; i++; continue }
      out[i] = " "; i++; continue
    }
    if (state === "block") {
      if (c === "*" && c2 === "/") {
        out[i] = " "; out[i + 1] = " "; state = "code"; i += 2; continue
      }
      if (c !== "\n") out[i] = " "
      i++
      continue
    }
    // Inside a string: preserve content (findings live there), honor escapes.
    if (c === "\\") { i += 2; continue }
    const closer = state === "sq" ? "'" : state === "dq" ? '"' : "`"
    if (c === closer) state = "code"
    i++
  }
  return out.join("")
}

interface LangResult {
  language: string
  specHandled: number
  fixtureTypes: number
  uncovered: string[]        // spec-handled types no fixture exercises
  deadLiterals: string[]     // analyzer literals that are neither grammar types nor spec-classified
  deadLiteralSites?: Array<{ literal: string; line: number }>  // first-occurrence line per dead literal
  pass: boolean
}

const LITERAL_PATTERNS = [
  /\.[tT]ype\s*===\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
  /\.[tT]ype\s*!==\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
  /findChildByType\([^,]+,\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
  /hasChildType\([^,]+,\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
]

function literalSet(source: string): Set<string> {
  const out = new Set<string>()
  for (const re of LITERAL_PATTERNS) for (const m of source.matchAll(re)) out.add(m[1])
  return out
}

/**
 * M49 W9 self-test. The comment-masker narrows what this gate can see, so
 * "masking narrowed too much" is the failure mode that would make the whole
 * audit vacuous. Two assertions, both computed:
 *
 *   1. For every gated analyzer: masked-literal-set ⊆ raw-literal-set, and
 *      EVERY removed literal's first raw occurrence is inside a comment. That
 *      is the proof that masking removes documentation, never a comparison.
 *   2. Masking is still able to fail: a synthetic dead literal in code is
 *      found; the identical text inside a line comment / block comment is not.
 */
function runSelfTest(): number {
  let failures = 0
  const fail = (msg: string) => { console.log(`SELFTEST FAIL ${msg}`); failures++ }

  const synthetic = [
    'function f(n: any) {',
    '  // audit note: the old cur.type === "ghost_from_line_comment" was removed',
    '  /* block note: n.type === "ghost_from_block" was removed */',
    '  if (n.type === "real_dead_literal") return 1',
    '  return 0',
    '}',
  ].join("\n")
  const sy = literalSet(maskComments(synthetic))
  if (!sy.has("real_dead_literal")) fail("a real comparison in code must be visible after masking")
  if (sy.has("ghost_from_line_comment")) fail("a comparison inside a // comment must NOT be visible")
  if (sy.has("ghost_from_block")) fail("a comparison inside a /* */ comment must NOT be visible")

  // proof: masking only ever REMOVES comment-derived occurrences
  for (const [lang, cfg] of Object.entries(GATED_LANGS)) {
    const p = path.join(ROOT, "src", "ast", cfg.analyzer)
    if (!fs.existsSync(p)) continue
    const src = fs.readFileSync(p, "utf8")
    const raw = literalSet(src)
    const masked = literalSet(maskComments(src))
    for (const lit of masked) {
      if (!raw.has(lit)) fail(`${lang}: masking INVENTED literal ${lit}`)
    }
    for (const lit of raw) {
      if (masked.has(lit)) continue
      // removed: prove every raw occurrence sits inside a comment
      const maskedSrc = maskComments(src)
      const inCode = LITERAL_PATTERNS.some((re) => re.test(maskedSrc))
      for (const re of LITERAL_PATTERNS) {
        re.lastIndex = 0
        for (const m of src.matchAll(re)) {
          if (m[1] !== lit || m.index === undefined) continue
          // index in raw vs masked: if the masked char at that offset is a
          // space where raw had non-space, the occurrence was inside a comment
          const rawChunk = src.slice(m.index, m.index + m[0].length)
          const maskedChunk = maskedSrc.slice(m.index, m.index + m[0].length)
          if (maskedChunk === rawChunk) fail(`${lang}: masking removed a LIVE occurrence of ${lit} (offset ${m.index})`)
        }
      }
      void inCode
    }
  }

  console.log(failures === 0 ? "F6 selftest: PASS (masking is comment-only; gate can still fail)" : `F6 selftest: ${failures} failure(s)`)
  return failures
}

async function main() {
  const langArgIdx = process.argv.indexOf("--lang")
  const langArg = langArgIdx >= 0 ? process.argv[langArgIdx + 1] : undefined
  const updateBaseline = process.argv.includes("--update-baseline")

  if (process.argv.includes("--selftest")) {
    process.exit(runSelfTest() === 0 ? 0 : 1)
  }

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
    const deadLiteralSitesLine = new Map<string, number>()
    if (fs.existsSync(analyzerPath)) {
      const src = fs.readFileSync(analyzerPath, "utf8")
      // M49 W9 FIX: scan the COMMENT-MASKED source. Reading the raw file made
      // the audit comment-blind — an analyzer's own audit note quoting a
      // comparison was counted as a live comparison, so the very comments that
      // document a removed literal kept it "dead" forever.
      const masked = maskComments(src)
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
      // line of first occurrence, so a finding is directly reviewable
      const foundLine = new Map<string, number>()
      for (const re of patterns) {
        for (const m of masked.matchAll(re)) {
          found.add(m[1])
          if (!foundLine.has(m[1]) && m.index !== undefined) {
            foundLine.set(m[1], masked.slice(0, m.index).split("\n").length)
          }
        }
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
      // M49 W8 FIX: `specTypes` was constructed above and then NEVER READ — the
      // documented contract is "a real grammar node/token, OR spec-classified
      // (handled_verified / internal_silent / gap / design_decision), OR an
      // allowlisted non-node literal", but the loop below only ever consulted
      // the grammar set and the allowlist. Every literal the SPEC classifies but
      // the grammar enumeration does not expose was therefore reported as DEAD
      // CODE. The gate had been dormant (not wired into the battery), so the
      // false positives had never been seen — they are why it reported 24 dead
      // literals across five languages on its first wired run.
      const allow = LITERAL_ALLOWLIST[lang] ?? new Set()
      for (const lit of found) {
        if (grammarTypes.has(lit)) continue
        if (specTypes.has(lit)) continue
        if (lit === "ERROR" || lit === "MISSING") continue // tree-sitter synthetic nodes (parse-error probes)
        if (allow.has(lit)) continue
        // Not a grammar node/token, not spec-classified, not synthetic, not
        // allowlisted: a comparison that can never fire against a parse tree —
        // DEAD CODE, the exact method_elem/relative_scope bug class.
        deadLiterals.push(lit)
        deadLiteralSitesLine.set(lit, foundLine.get(lit) ?? 0)
      }
      deadLiterals.sort()
    }

    const pass = uncovered.length === 0 && deadLiterals.length === 0
    const deadLiteralSites = deadLiterals.map((lit) => ({ literal: lit, line: deadLiteralSitesLine.get(lit) ?? 0 }))
    results.push({ language: lang, specHandled: handled.length, fixtureTypes: occurring.size, uncovered, deadLiterals, deadLiteralSites, pass })
    const flag = pass ? "PASS" : "FAIL"
    console.log(`${lang.padEnd(12)} ${flag}  handled=${handled.length} fixtureTypes=${occurring.size} uncovered=${uncovered.length} deadLiterals=${deadLiterals.length}`)
    if (uncovered.length > 0) console.log(`    uncovered: ${uncovered.join(", ")}`)
    if (deadLiterals.length > 0) {
      console.log(`    deadLiterals: ${deadLiterals.join(", ")}`)
      console.log(`    at: ${deadLiteralSites.map((s) => `${s.literal}:${s.line}`).join(", ")}`)
    }
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
  // Scoped-run guard (the M14 W16 / #886 class, found live on the F7 sibling:
  // a --lang run once replaced the canonical artifact with a one-language
  // file). A scoped run is for inspecting a lane — it prints here and writes
  // NO evidence and may not touch the baseline; the canonical artifact is
  // only ever produced by a full run.
  if (langArg) {
    if (updateBaseline) {
      console.error("refusing --update-baseline on a scoped run (would drop every language it did not touch)")
      process.exit(2)
    }
    console.log(`\nSCOPED run (${langs.length} of ${Object.keys(GATED_LANGS).length} lanes): results printed above, NO evidence written — run without --lang for the canonical artifact`)
  } else {
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
  }

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
