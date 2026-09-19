/**
 * M14.0.F7 — Analyzer Hygiene Gate
 *
 * The php wave found `target = child.text === "parent" ? owner : owner` — a
 * no-op ternary whose both arms are identical — green through every gate,
 * and the csharp wave found `(this as any)._patterns ? null : null` (a
 * literal no-op statement) plus an `mvcPattern` flag written and never read.
 * These classes are mechanically detectable. This gate detects them over
 * every gated analyzer source, so they can never again survive review.
 *
 * Checks per analyzer source file:
 *   1. no-op ternary statements: `cond ? X : X` (identical arms) or the
 *      degenerate `? null : null` shape
 *   2. identical if/else bodies: `if (c) { X } else { X }` (normalized)
 *   3. write-only `this.<flag> = <value>` — assigned but never read
 *
 * Usage:
 *   bun run script/m14/verify-analyzer-hygiene.ts            # all gated langs
 *   bun run script/m14/verify-analyzer-hygiene.ts --lang php
 *
 * Evidence: validation/m14/results/M14.0.F7.json
 */

import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(__dirname, "..", "..")
const ANALYZER_DIR = path.join(ROOT, "src", "ast")

const GATED_ANALYZERS: Record<string, string> = {
  java: "real-java-analyzer.ts",
  groovy: "real-groovy-analyzer.ts",
  kotlin: "real-kotlin-analyzer.ts",
  scala: "real-scala-analyzer.ts",
  typescript: "real-typescript-analyzer.ts",
  javascript: "real-javascript-analyzer.ts",
  vue: "real-vue-analyzer.ts",
  svelte: "real-svelte-analyzer.ts",
  c: "real-c-analyzer.ts",
  cpp: "real-cpp-analyzer.ts",
  rust: "real-rust-analyzer.ts",
  go: "real-go-analyzer.ts",
  zig: "real-zig-analyzer.ts",
  csharp: "real-csharp-analyzer.ts",
  dart: "real-dart-analyzer.ts",
  swift: "real-swift-analyzer.ts",
  objc: "real-objective-c-analyzer.ts",
  php: "real-php-analyzer.ts",
  ruby: "real-ruby-analyzer.ts",
  python: "real-python-analyzer.ts",
  haskell: "real-haskell-analyzer.ts",
  erlang: "real-erlang-analyzer.ts",
  clojure: "real-clojure-analyzer.ts",
  elixir: "real-elixir-analyzer.ts",
}

// A ternary's `?` is never the tail of a nullish-coalescing operator. Without
// this guard both rules below read `x ?? null` as a ternary question mark and
// then run `\s*` (which matches newlines) across to the ternary's own
// `: arm`, inventing a no-op that is not in the source. Measured: the ruby
// analyzer's `cond ? (n.parent as any)?.childForFieldName?.("name") ?? null : null` — a
// meaningful expression — was reported as `? null : null` and release-blocked
// M14.0.F7 (M49 W13). The guard is on the operator, not on the whitespace,
// because whitespace between a ternary's `?` and its arms may legitimately
// wrap; the shape that must not match is specifically the `??`/`??=` pair.
const TERNARY_Q = /(?<!\?)\?(?!\?)/.source

interface Finding {
  lang: string
  kind: string
  line: number
  snippet: string
  note: string
}


export function findNoopTernaries(src: string, lang: string, findings: Finding[]) {
  // `cond ? X : X` where both arms are token-identical. The regex anchors on
  // a ternary whose arms share the exact same token sequence (letters, dots,
  // parens, underscores, digits). The second lookahead rejects matches where
  // the second arm continues into a NESTED ternary (`? start : start ? ...`
  // is legitimate nesting, not a duplicate — false-positive guard added after
  // the first run flagged exactly that shape in the scala analyzer) or into a
  // nullish-coalescing continuation (`? a : a ?? b`).
  const re = new RegExp(
    `${TERNARY_Q}\\s*([A-Za-z_][A-Za-z0-9_.()]*)\\s*:\\s*\\1(?![A-Za-z0-9_.?])(?!\\s*\\?(?:\\?)?)`,
    "g",
  )
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    if (m[1] === "null") continue // reported once by the dedicated null-null pass below
    const line = src.slice(0, m.index).split("\n").length
    // Skip string-literal contexts: count quotes up to the match — an odd
    // number means the match sits inside a string template.
    const before = src.slice(0, m.index)
    const quotes = (before.match(/(?<!\\)"/g) || []).length + (before.match(/(?<!\\)`/g) || []).length
    if (quotes % 2 === 1) continue
    findings.push({
      lang,
      kind: "noop-ternary",
      line,
      snippet: m[0],
      note: "both arms identical — the condition has no effect (php relative_scope class)",
    })
  }
  // Degenerate `? null : null`
  const reNull = new RegExp(`${TERNARY_Q}\\s*null\\s*:\\s*null`, "g")
  while ((m = reNull.exec(src))) {
    const line = src.slice(0, m.index).split("\n").length
    findings.push({
      lang,
      kind: "noop-ternary",
      line,
      snippet: m[0],
      note: "both arms null — a literal no-op (csharp system.linq class)",
    })
  }
}

function normalizeBlock(t: string): string {
  return t.replace(/\s+/g, " ").replace(/[{}]/g, "").trim()
}

export function findDuplicateIfElse(src: string, lang: string, findings: Finding[]) {
  // `if (...) X else X` where the branches are token-identical statements
  // (single-statement or block form). Normalizes whitespace before compare.
  const re = /if\s*\(([^)]+)\)\s*(\{[^{}]*\}|[^;{}]+?)\s*else\s*(\{[^{}]*\}|[^;{}]+?)(?=[;)]|\n\s*\}|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const a = normalizeBlock(m[2])
    const b = normalizeBlock(m[3])
    if (a && a === b && a.length > 0) {
      const line = src.slice(0, m.index).split("\n").length
      findings.push({
        lang,
        kind: "duplicate-if-else",
        line,
        snippet: m[0].slice(0, 120),
        note: `if and else bodies identical: "${a.slice(0, 60)}" — one branch is dead or the condition is wrong`,
      })
    }
  }
}

export function findWriteOnlyFlags(src: string, lang: string, findings: Finding[]) {
  // `this.<name> = ...` where `<name>` is never READ on `this.` anywhere.
  const writeRe = /\bthis\.([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/g
  const names = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = writeRe.exec(src))) names.add(m[1])
  for (const name of names) {
    const readRe = new RegExp(`\\bthis\\.${name}\\b(?!=\\s*)(?![\\s]*=[^=])`, "g")
    // Count occurrences that are NOT part of an assignment LHS.
    const all = new RegExp(`\\bthis\\.${name}\\b`, "g")
    const write = new RegExp(`\\bthis\\.${name}\\s*=(?!=)`, "g")
    const total = (src.match(all) || []).length
    const writes = (src.match(write) || []).length
    if (total > writes) continue // at least one read exists
    // Exception: instance flag written in constructor AND read as a bare
    // `<name>` inside methods (some analyzers alias this.x). Bare-name read
    // check: if the bare identifier appears elsewhere with non-assignment
    // use, treat as read. Keep this conservative: flag only when the name
    // NEVER appears outside its own write sites.
    const bareAll = new RegExp(`\\b${name}\\b`, "g")
    const bareTotal = (src.match(bareAll) || []).length
    const bareWrites = (src.match(new RegExp(`\\bthis\\.${name}\\s*=(?!=)`, "g")) || []).length
    if (bareTotal > bareWrites) continue
    const idx = src.search(new RegExp(`\\bthis\\.${name}\\s*=(?!=)`))
    const line = src.slice(0, idx).split("\n").length
    findings.push({
      lang,
      kind: "write-only-flag",
      line,
      snippet: `this.${name} = ...`,
      note: "assigned on this but never read anywhere — csharp mvcPattern class",
    })
  }
}

export function findNodeIdentityComparisons(src: string, lang: string, findings: Finding[]) {
  // M37 #596 (TSD2/TSD6 class): web-tree-sitter returns FRESH wrapper objects
  // per node access, so `x.childForFieldName("f") === n` NEVER matches even
  // for the same underlying node. The stable identity handles are node.id /
  // startIndex-endIndex spans (both analyzers now document this). Flag any
  // comparison where at least one operand ends in a fresh-node accessor
  // (childForFieldName / namedChild / child / parent / siblings / namedChildren)
  // and neither operand reduces to a stable primitive (.id, .type, .text,
  // .startIndex, ...). `=== null`/`undefined` absence checks are excluded
  // (comparing a fresh wrapper to null is legitimate). The TSD6 defect
  // (`n.parent.childForFieldName("function") === n` in the TS analyzer) fired
  // exactly this shape; the TSD2 defect (`nameField === n`) is a variable-to-
  // variable comparison NOT mechanically visible without dataflow — documented
  // in limitations, caught by review + probes instead.
  const operand = String.raw`[\w$?.\[\]]+(?:\([^()]*\))?[\w$?.\[\]]*`
  const re = new RegExp(String.raw`(${operand})\s*(===|!==)\s*(${operand})`, "g")
  const FRESH = /\.(childForFieldName|namedChild|child)\s*\(|\.(parent|previousSibling|nextSibling|namedChildren)\b/
  const PRIMITIVE_TAIL = /\.(id|type|text|name|startIndex|endIndex|startPosition|endPosition|length|row|column|isNamed|isMissing|hasError)\s*$/
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const [full, left, , right] = m
    // Absence checks are fine: a fresh wrapper compared to null/undefined.
    if (/^(null|undefined)\b/.test(right) || /^(null|undefined)\b/.test(left)) continue
    // String literals / numeric literals on one side: value comparison, clean.
    if (/^(["'`])/.test(right) || /^(["'`])/.test(left)) continue
    if (/^\d/.test(right) || /^\d/.test(left)) continue
    // Either side ending in a stable primitive property (id/span/text) is a
    // legitimate identity/value comparison — node.id is stable within a tree.
    if (PRIMITIVE_TAIL.test(left) || PRIMITIVE_TAIL.test(right)) continue
    // At least one side must be an unmistakable fresh-node expression.
    if (!FRESH.test(left) && !FRESH.test(right)) continue
    const line = src.slice(0, m.index).split("\n").length
    // Skip string-literal contexts (quote parity guard, same as ternaries).
    const before = src.slice(0, m.index)
    const quotes = (before.match(/(?<!\\)"/g) || []).length + (before.match(/(?<!\\)`/g) || []).length
    if (quotes % 2 === 1) continue
    findings.push({
      lang,
      kind: "node-identity-comparison",
      line,
      snippet: full.slice(0, 120),
      note: "web-tree-sitter nodes are fresh wrappers per access — object identity never matches; compare .id or startIndex/endIndex spans (TSD2/TSD6 class)",
    })
  }
}

// M37 #597 (KAD2 class, follow-up): variable-to-variable node identity
// comparisons are invisible to the accessor rule above when BOTH sides are
// bare identifiers (`sibling === node`, the TSD2 `nameField === n` shape).
// Mini dataflow: resolve each side backward to its initializer or a
// `: Node` type annotation. web-tree-sitter has NO legitimate object-
// identity use, so ANY bare node-vs-node comparison is suspect.
export function findBareNodeIdentityComparisons(src: string, lang: string, findings: Finding[]) {
  const FRESH = /\.(childForFieldName|namedChild|child)\s*\(|\.(parent|previousSibling|nextSibling|namedChildren|parent)\b/
  const PRIMITIVE = /\.(id|text|type|startIndex|endIndex|startPosition|endPosition|length|row|column|isNamed|isMissing|hasError|name|kind|visibility|module)\b/
  // A bare identifier is node-ish when (a) its nearest initializer uses a
  // fresh accessor, or (b) it is declared/parameterized as a Node.
  const declaredNode = new Map<string, boolean>()
  const initializerHasFresh = (ident: string, uptoIdx: number): boolean => {
    const re = new RegExp(`\\b(?:const|let|var)\\s+${ident}\\s*=\\s*([^;\\n]+)`, "g")
    let m: RegExpExecArray | null
    let found = false
    while ((m = re.exec(src)) && m.index < uptoIdx) {
      if (FRESH.test(m[1])) found = true
    }
    return found
  }
  const isNodeIsh = (ident: string, lineIdx: number): boolean => {
    if (!(ident in declaredNode)) {
      declaredNode.set(ident, new RegExp(`\\b${ident}\\s*\\??\\s*:\\s*Node\\b`).test(src))
    }
    if (declaredNode.get(ident)) return true
    return initializerHasFresh(ident, lineIdx)
  }
  const lines = src.split("\n")
  let offset = 0
  for (const line of lines) {
    const cmp = line.match(/([A-Za-z_][\w?]*)\s*(===|!==)\s*([A-Za-z_][\w?]*)/)
    if (cmp && !PRIMITIVE.test(line) && !/["'`]/.test(line) && !/\bnull\b|\bundefined\b|\d/.test(line)) {
      const [, left, , right] = cmp
      if (isNodeIsh(left, offset) && isNodeIsh(right, offset)) {
        findings.push({
          lang,
          kind: "bare-node-identity-comparison",
          line: src.slice(0, offset).split("\n").length,
          snippet: line.trim().slice(0, 120),
          note: "both sides resolve to web-tree-sitter Nodes — object identity never matches (fresh wrappers); compare .id or spans (KAD2/TSD2 class)",
        })
      }
    }
    offset += line.length + 1
  }
}

export function main() {
  const only = process.argv.includes("--lang") ? process.argv[process.argv.indexOf("--lang") + 1] : undefined
  const langs = only ? [only] : Object.keys(GATED_ANALYZERS)
  const allFindings: Finding[] = []

  for (const lang of langs) {
    const file = GATED_ANALYZERS[lang]
    if (!file) {
      console.error(`unknown language: ${lang}`)
      process.exit(2)
    }
    const p = path.join(ANALYZER_DIR, file)
    if (!fs.existsSync(p)) {
      console.error(`missing analyzer source: ${p}`)
      process.exit(2)
    }
    const src = fs.readFileSync(p, "utf8")
    findNoopTernaries(src, lang, allFindings)
    findDuplicateIfElse(src, lang, allFindings)
    findWriteOnlyFlags(src, lang, allFindings)
    findNodeIdentityComparisons(src, lang, allFindings)
    findBareNodeIdentityComparisons(src, lang, allFindings)
  }

  for (const f of allFindings) {
    console.error(`HYGIENE FAIL [${f.lang}] ${f.kind} @ line ${f.line}: ${f.note}\n  ${f.snippet}`)
  }

  const { emitEvidence } = require("./evidence-harness")
  const perLang = new Map<string, number>()
  for (const f of allFindings) perLang.set(f.lang, (perLang.get(f.lang) || 0) + 1)
  const checks = langs.map((lang) => ({
    id: `analyzer-hygiene-${lang}`,
    description: "no no-op ternaries, duplicate if/else bodies, write-only this-flags, or fresh-node identity comparisons in the analyzer source",
    status: (perLang.get(lang) || 0) === 0 ? "pass" : "fail",
    findings: perLang.get(lang) || 0,
  }))
  // Scoped-run guard (M14 W16 / #886 class): a --lang run is for inspecting
  // one analyzer — it prints here and writes NO evidence. This gate HAD no
  // guard: the canonical artifact was last written by an erlang-scoped run
  // and every other language's row vanished from it (found 2026-09-19 when
  // the F6/F7 ceremony wired clojure/elixir in). The canonical artifact is
  // only ever produced by a full run.
  if (only) {
    console.log(`\nSCOPED run (1 of ${Object.keys(GATED_ANALYZERS).length} analyzers): result printed above, NO evidence written — run without --lang for the canonical artifact`)
  } else {
    emitEvidence({
      issueId: "M14.0.F7",
      title: "Analyzer-hygiene gate: dead code classes mechanically detected (no-op ternaries, duplicate branches, write-only flags)",
      claimLevel: "L1",
      layers: ["hygiene"],
      checks,
      limitations: [
        {
          description: "Regex-based detection over TypeScript source: multi-line identical-branch ternaries, alias-heavy this-patterns, cross-method write-only object props, and variable-to-variable node comparisons (dataflow needed — the TSD2 `nameField === n` shape) are out of scope (covered by review + F9 probes instead)",
        },
      ],
    })
  }

  if (allFindings.length > 0) {
    console.log(`\nanalyzer-hygiene gate: ${allFindings.length} finding(s) — release blocked`)
    process.exit(1)
  }
  console.log(`\nanalyzer-hygiene gate: all ${langs.length} analyzer(s) clean`)
}

// Self-test: these detectors are regexes over source text, so the property
// that matters is not "do they run" but "do they still discriminate". Every
// case below is a shape this gate has actually mis-read, or a true positive
// it must not stop catching. Run with --selftest; it belongs to the gate
// battery (a detector that silently stops matching is indistinguishable from
// a clean codebase otherwise).
//
// Returns 0 on success, 1 if any expectation is unmet.
export function selftest(): number {
  const cases: { name: string; src: string; expect: number }[] = [
    {
      name: "identical arms (the original php relative_scope class)",
      src: "const x = cond ? foo : foo;\n",
      expect: 1,
    },
    {
      name: "null arms on one line (csharp system.linq class)",
      src: "const y = cond ? null : null;\n",
      expect: 1,
    },
    {
      name: "null arms wrapped across lines — still a real no-op",
      src: "const z = cond\n  ? null\n  : null;\n",
      expect: 1,
    },
    {
      name: "nullish coalescing in the then-arm, ternary else-arm null (ruby FP)",
      src:
        "const nameField = (parentType === \"method\" || parentType === \"singleton_method\")\n" +
        "  ? (n.parent as any)?.childForFieldName?.(\"name\") ?? null\n" +
        "  : null\n",
      expect: 0,
    },
    {
      name: "optional chaining before a ternary question mark",
      src: "const a = obj?.foo ? 1 : 2;\n",
      expect: 0,
    },
    {
      name: "plain nullish coalescing, no ternary at all",
      src: "const b = x ?? y;\n",
      expect: 0,
    },
    {
      name: "else arm continues into nullish coalescing — not a no-op",
      src: "const c = cond ? a : a ?? b;\n",
      expect: 0,
    },
    {
      name: "nested ternary (the scala false positive class)",
      src: "const d = cond ? start : start ? 1 : 2;\n",
      expect: 0,
    },
  ]

  let bad = 0
  for (const c of cases) {
    const found: Finding[] = []
    findNoopTernaries(c.src, "selftest", found)
    const noops = found.filter((f) => f.kind === "noop-ternary")
    const ok = noops.length === c.expect
    if (!ok) bad++
    console.log(
      `${ok ? "ok  " : "FAIL"} ${c.name}: expected ${c.expect}, got ${noops.length}` +
        (ok ? "" : ` (${noops.map((f) => f.snippet.replace(/\s+/g, " ")).join(" | ")})`),
    )
  }
  // The negative cases are only meaningful if the detector works at all, so a
  // run that reports nothing anywhere is a failure, not a pass.
  const positive = cases.filter((c) => c.expect > 0).length
  if (positive === 0) {
    bad++
    console.log("FAIL self-test is vacuous: no positive case to discriminate against")
  }
  console.log(
    bad === 0
      ? `\nanalyzer-hygiene selftest: ${cases.length} case(s) meet expectation`
      : `\nanalyzer-hygiene selftest: ${bad} case(s) failed`,
  )
  return bad === 0 ? 0 : 1
}

if (process.argv[1]?.endsWith("verify-analyzer-hygiene.ts")) {
  if (process.argv.includes("--selftest")) process.exit(selftest())
  main()
}
