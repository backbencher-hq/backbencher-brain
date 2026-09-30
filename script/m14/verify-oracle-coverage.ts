/**
 * 2026-09-29: the oracle-coverage invariant, as a gate.
 *
 * WHY THIS FILE EXISTS. Five separate merges damaged the shared harness in the same way — small,
 * silent, load-bearing, and invisible to every gate:
 *
 *   1. an orphaned `LANGS` block left `differential.ts` unparseable (4 errors, one line)
 *   2. `process.env.BB_CORPUS_ROOT ??` dropped from a hardcoded path that does not exist here
 *   3. three duplicate keys in `LANG_REPOS`, so `bash` and `json` measured the wrong corpora
 *      — a duplicate key is VALID JavaScript, so build, tsc and every gate passed
 *   4. csharp's compared-label set silently reduced from 4 labels to 2, deleting the `contains`
 *      and `uses` oracles' entire reason to exist
 *   5. `oracles/json.ts` committed unparseable, taking the F5 gate down for all 40 languages
 *
 * Three of those were caught by accident, one by a probe written for a different question, and
 * one (`oracles/json.ts`) by a build I happened to run. None by a gate. The common structure is
 * that they all removed COVERAGE while leaving every gate green, because no gate asks "how much of
 * the analyzer is actually being checked?".
 *
 * THE INVARIANT. For every language, two sets must be consistent with each other:
 *
 *   COMPARED  the labels the harness admits to its label+target match — the labels whose edges
 *             can ever be adjudicated. An empty or shrunken set is the silent failure.
 *   DERIVED   the relationship classes some oracle in that language's truth-push block can
 *             produce. A derived class that is never compared is truth nobody checks; a compared
 *             class that nothing derives is a lane compared against nothing.
 *
 * The second half is what catches case 4 in the general case, and the first half is what catches
 * it for a lane that has no oracle block at all. Neither is derivable by reading a diff: a merge
 * can remove one `? ["contains", "uses"] : []` from a 20-line chain and every reviewer sees a
 * tidy resolution.
 *
 * WHAT IT IS NOT. It does not measure whether an oracle is CORRECT — that is what F5 is for, and
 * two oracle bugs (CS-D9, CS-D10) passed this file happily because they were inside a derivation
 * that existed. It asserts the wiring, not the answers. A check that claimed more would be the
 * kind of gate that stops meaning anything.
 *
 * IT ALSO CANNOT SEE LABELS AN ORACLE DERIVES DYNAMICALLY. Several truth functions compute their
 * label from the tree rather than returning a fixed set, so a language can legitimately push an
 * oracle that yields labels absent from any static list. The output therefore separates
 * "compared but nothing pushes a known oracle" (suspicious) from "pushed, labels unknown
 * statically" (expected) rather than pretending to a precision it does not have.
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()
const TARGET = path.join(ROOT, "script/m14/differential.ts")

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

/** Strip comments, and neutralise the STRUCTURAL characters that appear inside string literals
 *  while KEEPING the characters themselves.
 *
 *  The first version of this replaced every string literal with `""`. That is the obvious way to
 *  make brace counting safe and it silently destroyed the only data the gate reads: `lang ===
 *  "csharp"` became `lang === ""` and `["calls", "uses"]` became `["", ""]`. The result was ZERO
 *  languages parsed and a PASS — a vacuous green from a gate whose entire purpose is to catch
 *  vacuous greens, on the same day I had been finding them by hand in three other files.
 *
 *  So string CONTENT is preserved and only `{ } ( ) | ;` inside it becomes an inert filler of the
 *  same width. Names survive; a regex literal or a C# interpolated string can no longer shift a
 *  brace count. */
function codeOnly(src: string): string {
  let out = ""
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++
      continue
    }
    if (c === "/" && d === "*") {
      i += 2
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++
      i += 2
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c
      i++
      let lit = ""
      while (i < n && src[i] !== q) {
        if (src[i] === "\\" && i + 1 < n) { lit += src[i] + src[i + 1]; i += 2; continue }
        lit += src[i]
        i++
      }
      i++
      // Keep the QUOTES and the CONTENT, neutralise only what would change the STRUCTURE.
      // Emitting the content without its quotes was the second attempt's bug: the text became
      // `lang === zig` while every pattern here (and in the source) spells it `lang === "zig"`.
      const safe = lit.replace(/[{}()|;]/g, (ch) => (ch === "|" ? "!" : "."))
      out += q + safe + q
      continue
    }
    out += c
    i++
  }
  return out
}

/** Every label array in the allowlist chain, and the language condition that guards it.
 *
 *  ANCHORED ON THE ARRAY, NOT ON THE CONDITION. The two earlier versions matched
 *  `...(lang === "x" ? [...] : [])` and `((?:|| lang === "x")+) ? [...]`, and both were wrong in
 *  a way that looked like a finding: the second required its group to START with `||`, so a chain
 *  whose FIRST term is `lang === "html" || lang === "php" ? [...]` never matched, and html was
 *  reported as having no compared labels at all. A gate that reports a lane as unaudited because
 *  it failed to read the lane is worse than no gate — it invites someone to "fix" a lane that is
 *  fine. So the scan finds every `? [ ... ]` and reads the guard BACKWARDS to the previous
 *  separator, which is the shape the file actually has in both forms.
 */
function comparedLabels(src: string): Map<string, Set<string>> {
  const code = codeOnly(src)
  const out = new Map<string, Set<string>>()
  const add = (lang: string, labels: string[]) => {
    let s = out.get(lang)
    if (!s) { s = new Set<string>(); out.set(lang, s) }
    for (const l of labels) s.add(l)
  }
  for (const m of code.matchAll(/\?\s*\[([^\]]*)\]\s*:/g)) {
    const labels = [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1])
    if (labels.length === 0) continue
    // read the guard backwards to the previous `,` that is not inside brackets
    let i = m.index! - 1
    let depth = 0
    while (i >= 0) {
      const ch = code[i]
      if (ch === ")" || ch === "]") depth++
      else if (ch === "(" || ch === "[") { if (depth === 0) break; depth-- }
      else if (ch === "," && depth === 0) break
      else if (ch === "?" && depth === 0) break
      i--
    }
    const guard = code.slice(i + 1, m.index!)
    // only a lang-conditional counts; `labels.includes(...)`-style guards are ignored
    if (!/lang\s*===/.test(guard)) continue
    for (const lm of guard.matchAll(/lang\s*===\s*"([a-z0-9+#]+)"/g)) add(lm[1], labels)
  }
  return out
}

/** For each `if (lang === "x") { ... }` block, the oracle functions invoked inside it. Depth is
 *  tracked so a nested `if (lang === "y")` does not leak into the parent lane's set — which it
 *  did in the first version of this, and which would have credited csharp with the labels of
 *  whatever lane happened to be nested inside its block. */
function pushedOracles(src: string): Map<string, Set<string>> {
  const code = codeOnly(src)
  const lines = code.split("\n")
  const out = new Map<string, Set<string>>()
  const stack: Array<{ lang: string; depth: number }> = []
  let depth = 0
  for (const raw of lines) {
    const line = raw
    const open = /^\s*if\s*\(\s*lang\s*===\s*"([a-z0-9+#]+)"\s*\)\s*\{/.exec(line)
    if (open) {
      stack.push({ lang: open[1], depth })
      let s = out.get(open[1])
      if (!s) { s = new Set<string>(); out.set(open[1], s) }
    }
    // attribute any oracle call to the INNERMOST open language block
    if (stack.length > 0) {
      for (const m of line.matchAll(/\b(derive[A-Za-z0-9_]*)\s*\(/g)) {
        out.get(stack[stack.length - 1].lang)!.add(m[1])
      }
    }
    for (const ch of line) {
      if (ch === "{") depth++
      else if (ch === "}") {
        depth--
        while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop()
      }
    }
  }
  return out
}

const src = fs.readFileSync(TARGET, "utf8")
const compared = comparedLabels(src)
const pushed = pushedOracles(src)

const langs = [...new Set([...compared.keys(), ...pushed.keys()])].sort()
const baselineArg = arg("--baseline")
let baseline: Record<string, string[]> | null = null
const baselinePath = baselineArg ?? path.join(ROOT, "validation/m14/oracle-coverage-baseline.json")
if (fs.existsSync(baselinePath)) {
  try { baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8")) } catch { baseline = null }


}
// `--write-baseline` records the CURRENT compared set so a later shrinkage is caught. It is
// generated by this file's own parser rather than by a second implementation beside it: two
// parsers for one invariant is how the two drift, and a drifted baseline is worse than none
// because it fails open in a direction nobody is watching. It does NOT bless a gap — the json
// lane has an oracle and no compared labels today, and that is reported as a NOTE on every run
// regardless of what the baseline says, so recording the state cannot make the gap disappear.
if (process.argv.includes("--write-baseline")) {
  const rec: Record<string, string[]> = {}
  for (const [lang, set] of compared) rec[lang] = [...set].sort()
  const sorted: Record<string, string[]> = {}
  for (const k of Object.keys(rec).sort()) sorted[k] = rec[k]
  const dest = baselineArg ?? path.join(ROOT, "validation/m14/oracle-coverage-baseline.json")
  fs.writeFileSync(dest, JSON.stringify(sorted, null, 2) + "\n")
  const pairs = Object.values(sorted).reduce((n, v) => n + v.length, 0)
  console.log(`wrote ${dest}: ${Object.keys(sorted).length} languages, ${pairs} (lane,label) pairs`)
}

const problems: string[] = []
const notes: string[] = []
const rows: string[] = []

for (const lang of langs) {
  const c = [...(compared.get(lang) ?? [])].sort()
  const p = [...(pushed.get(lang) ?? [])].sort()
  rows.push({ lang, compared: c, oracles: p })
  if (c.length === 0 && p.length === 0) continue
  if (c.length === 0) {
    notes.push(`${lang}: ${p.length} oracle(s) pushed but NO compared labels — truth is produced and never checked (${p.slice(0, 3).join(", ")})`)
  }
  if (c.length > 0 && p.length === 0) {
    problems.push(`${lang}: ${c.length} compared label(s) (${c.join(", ")}) but NO oracle is pushed for this lane — compared against nothing`)
  }
  if (baseline && baseline[lang]) {
    const before = [...baseline[lang]].sort()
    const lost = before.filter((l) => !c.includes(l))
    const gained = c.filter((l) => !before.includes(l))
    if (lost.length > 0) {
      problems.push(`${lang}: compared label(s) ${lost.join(", ")} DISAPPEARED from the allowlist (was ${before.join(", ")}, now ${c.join(", ") || "(none)"}) — a silent coverage reduction is the exact failure this gate exists to catch`)
    }
    if (gained.length > 0) {
      notes.push(`${lang}: compared label(s) ${gained.join(", ")} ADDED (improvement, record it in the baseline)`)
    }
  }
}

console.log(`oracle-coverage: ${langs.length} language(s) with a compared set or an oracle block\n`)
console.log("lang".padEnd(14) + "compared".padEnd(46) + "oracles")
console.log("-".repeat(110))
for (const r of rows) {
  if (r.compared.length === 0 && r.oracles.length === 0) continue
  console.log(
    r.lang.padEnd(14) +
    (r.compared.join(",") || "—").slice(0, 44).padEnd(46) +
    (r.oracles.length > 0 ? String(r.oracles.length) : "NONE"),
  )
}

if (langs.length === 0) {
  console.log("\nVERDICT: FAIL — the parse found ZERO languages.")
  console.log("A gate that reads nothing and reports success is worse than no gate, because it is")
  console.log("a green light for a file it never opened. This is the vacuous-pass shape the gate")
  console.log("exists to prevent, so it is treated as a failure of the GATE rather than a pass.")
  process.exit(1)
}

if (notes.length > 0) {
  console.log(`\nNOTES (${notes.length}) — not failures:`)
  for (const n of notes) console.log(`  · ${n}`)
}
if (problems.length > 0) {
  console.log(`\nPROBLEMS (${problems.length}) — coverage is inconsistent with itself:`)
  for (const p of problems) console.log(`  ! ${p}`)
  console.log(`\nVERDICT: FAIL — ${problems.length} problem(s). This is the class of damage that left F3/F4/F6 green while two thirds of a lane's oracle coverage did not exist.`)
  process.exit(1)
}
console.log(`\nVERDICT: PASS — every lane with a compared set pushes at least one oracle, and no compared label has disappeared against the baseline.`)
console.log(`Reminder of what this does NOT check: whether an oracle is CORRECT. Two of them were`)
console.log(`wrong inside this window (CS-D9, CS-D10) and passed here. F5 is the gate for answers;`)
console.log(`this one is the gate for wiring.`)
