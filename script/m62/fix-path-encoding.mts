#!/usr/bin/env tsx
// script/m62/fix-path-encoding.mts — the SWEEP behind script/m62/verify-path-encoding.ts.
//
// The gate finds every site that turns a module URL into a filesystem path without
// decoding it. This rewrites them. It is a tool rather than a one-off edit for two
// reasons: the rewrite has to be uniform across ~100 files to be reviewable, and it
// has to be re-runnable so the sweep can be finished and re-checked rather than
// remembered.
//
// WHAT IT CHANGES, AND WHY IT IS SAFE TO DO MECHANICALLY.
//
//   before  const here = path.dirname(new URL(import.meta.url).pathname)
//   after   const here = path.dirname(fileURLToPath(import.meta.url))
//
//   before  const self = readFileSync(new URL(import.meta.url).pathname, "utf8")
//   after   const self = readFileSync(fileURLToPath(import.meta.url), "utf8")
//
//   before  const p = new URL("./x.json", import.meta.url).pathname
//   after   const p = fileURLToPath(new URL("./x.json", import.meta.url))
//
// The third form keeps the URL — it was resolving a RELATIVE path against the module
// — and only adds the decode that was missing. Collapsing it to fileURLToPath would
// drop the base and silently change which file it reads, so the base is preserved.
//
// WHY THIS CANNOT TOUCH A COMMENT. It uses the same code-only scanner as the gate,
// so a mention of the idiom inside a comment is left exactly as written. Several
// files in this repository carry a comment explaining this defect; rewriting those
// comments would delete the explanation of why the code looks the way it does.
//
// IMPORTS ARE ADDED, NOT ASSUMED. fileURLToPath is added to the existing
// "node:url" import where there is one, and a fresh import is inserted after the
// last top-level import otherwise. A rewrite that referenced an unimported binding
// would compile-fail loudly rather than silently, but leaving it to chance is not a
// plan.
//
// USAGE.   npx tsx script/m62/fix-path-encoding.mts           # report only
//          npx tsx script/m62/fix-path-encoding.mts --apply   # write
//
// Idempotent: a second run finds nothing, because the fixed form does not match.

import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { findCodeHits, walkSourceFiles } from "./path_encoding_scan.ts"

const APPLY = process.argv.includes("--apply")
const ROOT = process.cwd()

// The two-argument form MUST be rewritten before the one-argument form, or the
// second pattern would match the tail of the first and leave `fileURLToPath(new URL(`
// glued in front of a base it should have kept.
const TWO_ARG = /new URL\(\s*([^()]*?)\s*,\s*import\.meta\.url\s*\)\.pathname/g
const ONE_ARG = /new URL\(\s*import\.meta\.url\s*\)\.pathname/g

function rewriteLine(line: string): string {
  return line.replace(TWO_ARG, "fileURLToPath(new URL($1, import.meta.url))").replace(ONE_ARG, "fileURLToPath(import.meta.url)")
}

/** The line number just past the last top-level `import ... ;` statement. */
function endOfLastImport(lines: string[]): number {
  let last = -1
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*import\b/.test(lines[i]!)) continue
    // Walk forward to the end of this statement.
    let j = i
    while (j < lines.length && !/from\s+["'][^"']+["']\s*;?\s*$/.test(lines[j]!) && !/^\s*import\s+["'][^"']+["']\s*;?\s*$/.test(lines[j]!)) {
      j++
    }
    if (j < lines.length) last = j
  }
  return last
}

function ensureImport(src: string): string {
  if (/import\s*\{[^}]*\bfileURLToPath\b[^}]*\}\s*from\s*["']node:url["']/.test(src)) return src

  const lines = src.split("\n")

  // Case 1: a named import from node:url already exists — add to its braces.
  const namedIdx = lines.findIndex((l) => /import\s*\{[^}]*\}\s*from\s*["']node:url["']/.test(l))
  if (namedIdx !== -1) {
    const line = lines[namedIdx]!
    const replaced = line
      .replace(/^(\s*import\s*\{)([^}]*)(\}\s*from\s*["']node:url["'])/, (_all, head, body, tail) => {
        const existing = body
          .split(",")
          .map((p: string) => p.trim())
          .filter(Boolean)
        existing.push("fileURLToPath")
        return `${head} ${existing.join(", ")} ${tail}`
      })
    lines[namedIdx] = replaced
    return lines.join("\n")
  }

  // Case 2: a default or namespace import from node:url — widen it to named.
  const otherIdx = lines.findIndex((l) => /^\s*import\s+[^;]*\s*from\s*["']node:url["']/.test(l))
  const statement = 'import { fileURLToPath } from "node:url"'
  if (otherIdx !== -1) {
    lines[otherIdx] = lines[otherIdx]!.replace(
      /^\s*import\s+([^;]*?)\s*from\s*(["']node:url["'])/,
      (_all, bindings, mod) => {
        const trimmed = bindings.trim()
        if (trimmed.startsWith("*")) return statement
        return `import ${trimmed}, { fileURLToPath } from ${mod}`
      },
    )
    return lines.join("\n")
  }

  // Case 3: no node:url import at all — insert one after the last top-level import.
  const at = endOfLastImport(lines)
  if (at === -1) {
    lines.splice(0, 0, statement)
    return lines.join("\n")
  }
  lines.splice(at + 1, 0, statement)
  return lines.join("\n")
}

interface Change {
  file: string
  sites: number
}
const changes: Change[] = []
let totalSites = 0

for (const f of walkSourceFiles(ROOT)) {
  const rel = path.relative(ROOT, f)
  const src = readFileSync(f, "utf8")
  const hits = findCodeHits(src)
  if (hits.length === 0) continue

  const lines = src.split("\n")
  // Work on the hit lines only, so a comment elsewhere in the file is untouched.
  const hitLines = new Set(hits.map((h) => h.line))
  let sites = 0
  for (const lineNo of [...hitLines].sort((a, b) => a - b)) {
    const idx = lineNo - 1
    const before = lines[idx]!
    const after = rewriteLine(before)
    if (after !== before) {
      sites++
      lines[idx] = after
    }
  }
  if (sites === 0) continue

  let out = lines.join("\n")
  out = ensureImport(out)
  changes.push({ file: rel, sites })
  totalSites += sites
  if (APPLY) writeFileSync(f, out, "utf8")
}

const byDir = new Map<string, number>()
for (const c of changes) {
  const d = c.file.split("/").slice(0, 2).join("/")
  byDir.set(d, (byDir.get(d) ?? 0) + c.sites)
}

console.log(`\n${APPLY ? "APPLIED" : "WOULD CHANGE"} — ${totalSites} site(s) across ${changes.length} file(s)`)
for (const [d, n] of [...byDir].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${d}/`)
if (!APPLY) {
  console.log("\n  sample of the exact lines that would change:")
  for (const c of changes.slice(0, 6)) {
    const text = readFileSync(path.join(ROOT, c.file), "utf8").split("\n")
    const h = findCodeHits(text.join("\n"))[0]
    console.log(`    ${c.file}:${h?.line}`)
    console.log(`      - ${(text[h!.line - 1] ?? "").trim().slice(0, 96)}`)
    console.log(`      + ${rewriteLine(text[h!.line - 1] ?? "").trim().slice(0, 96)}`)
  }
  console.log("\n  re-run with --apply to write these.")
}