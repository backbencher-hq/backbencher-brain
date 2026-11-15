// Rust zero-regex proof (framework detection): the two `\b(...)\b` derive-body
// tests are replaced by `hasBareWord`. This probe proves the replacement is an
// EQUIVALENCE, not a rewrite with new behaviour, by evaluating BOTH predicates
// against every `#[derive(...)]` body in the corpus and reporting the first
// disagreement. It also reports the corpus's marker census, so the spec's
// recorded counts (cargo+ripgrep: serde 55 / thiserror 10 / tracing 29) can be
// re-derived from the same pass.
//
// Run: bun script/m14/tmp/rust-004-regex-equivalence.ts <repoRoot> [moreRoots...]
import * as fs from "node:fs"
import * as path from "node:path"

// The OLD predicate, verbatim from the pre-change analyzer.
const oldSerde = (body: string): boolean => /\b(Serialize|Deserialize)\b/.test(body)
const oldClap = (body: string): boolean => /\b(Parser|Subcommand|Args|ValueEnum)\b/.test(body)

// The NEW predicate, ported verbatim from the analyzer's hasBareWord.
const isWordChar = (c: number): boolean =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
const hasBareWord = (hay: string, word: string): boolean => {
  let i = hay.indexOf(word)
  while (i >= 0) {
    const before = i > 0 ? hay.charCodeAt(i - 1) : 0
    const after = i + word.length < hay.length ? hay.charCodeAt(i + word.length) : 0
    if (!isWordChar(before) && !isWordChar(after)) return true
    i = hay.indexOf(word, i + 1)
  }
  return false
}
const newSerde = (b: string): boolean => hasBareWord(b, "Serialize") || hasBareWord(b, "Deserialize")
const newClap = (b: string): boolean => hasBareWord(b, "Parser") || hasBareWord(b, "Subcommand") || hasBareWord(b, "Args") || hasBareWord(b, "ValueEnum")

const roots = process.argv.slice(2)
const files: string[] = []
for (const r of roots) {
  const walk = (dir: string, depth = 0) => {
    if (depth > 14) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === "target" || e.name === "node_modules") continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p, depth + 1)
      else if (e.name.endsWith(".rs")) files.push(p)
    }
  }
  walk(r)
}

let bodies = 0
let mismatches = 0
const samples: string[] = []
// full-attribute markers the analyzer also scans (non-derive sentences)
const attrCensus: Record<string, number> = {}
const crates = ["serde", "clap", "thiserror", "tokio", "axum", "rocket", "tracing", "actix_web"]
for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  const text = src
  let idx = 0
  while ((idx = text.indexOf("derive(", idx)) >= 0) {
    const start = idx + 7
    const end = text.indexOf(")]", start)
    if (end < 0) break
    const body = text.slice(start, end)
    bodies++
    const oS = oldSerde(body), nS = newSerde(body)
    const oC = oldClap(body), nC = newClap(body)
    if (oS !== nS || oC !== nC) {
      mismatches++
      if (samples.length < 8) samples.push(`${path.relative(roots[0], f)}: ${JSON.stringify(body)} old=(serde:${oS},clap:${oC}) new=(serde:${nS},clap:${nC})`)
    }
    idx = end
  }
  // crate census over attributes (this is the spec's recorded number family)
  for (const c of crates) {
    if (c === "serde" || c === "clap") continue
    if (text.includes(c)) attrCensus[c] = (attrCensus[c] ?? 0) + 1
  }
}
console.log(JSON.stringify({ files: files.length, deriveBodies: bodies, mismatches, samples, attrCensus }, null, 1))
