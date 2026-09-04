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
}

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
  // the first run flagged exactly that shape in the scala analyzer).
  const re = /\?\s*([A-Za-z_][A-Za-z0-9_.()]*)\s*:\s*\1(?![A-Za-z0-9_.?])(?!\s*\?)/g
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
  const reNull = /\?\s*null\s*:\s*null/g
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
  }

  for (const f of allFindings) {
    console.error(`HYGIENE FAIL [${f.lang}] ${f.kind} @ line ${f.line}: ${f.note}\n  ${f.snippet}`)
  }

  const { emitEvidence } = require("./evidence-harness")
  const perLang = new Map<string, number>()
  for (const f of allFindings) perLang.set(f.lang, (perLang.get(f.lang) || 0) + 1)
  const checks = langs.map((lang) => ({
    id: `analyzer-hygiene-${lang}`,
    description: "no no-op ternaries, duplicate if/else bodies, or write-only this-flags in the analyzer source",
    status: (perLang.get(lang) || 0) === 0 ? "pass" : "fail",
    findings: perLang.get(lang) || 0,
  }))
  emitEvidence({
    issueId: "M14.0.F7",
    title: "Analyzer-hygiene gate: dead code classes mechanically detected (no-op ternaries, duplicate branches, write-only flags)",
    claimLevel: "L1",
    layers: ["hygiene"],
    checks,
    limitations: [
      {
        description: "Regex-based detection over TypeScript source: multi-line identical-branch ternaries, alias-heavy this-patterns, and cross-method write-only object props are out of scope (covered by review + F9 probes instead)",
      },
    ],
  })

  if (allFindings.length > 0) {
    console.log(`\nanalyzer-hygiene gate: ${allFindings.length} finding(s) — release blocked`)
    process.exit(1)
  }
  console.log(`\nanalyzer-hygiene gate: all ${langs.length} analyzer(s) clean`)
}

if (process.argv[1]?.endsWith("verify-analyzer-hygiene.ts")) main()
