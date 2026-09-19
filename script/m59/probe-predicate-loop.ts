// script/m59/probe-predicate-loop.ts — M59 #887 ROOT CAUSE
//
// The matrix sweep froze for 7–9 minutes at ~87% CPU, and its own stall watchdog
// could not report it. Both facts have one cause: `declaredHere`'s keyword search
// could not make progress.
//
//     at = head.lastIndexOf(kw, at - 1)
//
// String.prototype.lastIndexOf CLAMPS a position < 0 to 0, so on the iteration
// where `at` becomes 0 the next call returns 0 again — the same index, from the
// same deterministic input, forever. Reaching it needs `head` to START with a
// declaration keyword whose following character is a word character, so every
// boundary check refuses the match:
//
//     head = "integerValue."   → "int" at 0, head[3] = "e" (fails the boundary)
//                                lastIndexOf("int", -1) = 0 → at = 0 → spin
//
// Because the spin is CPU-bound (not an unsettled promise), no timer-based
// watchdog can fire during it: the only bound that catches this class is a
// progress guarantee inside the loop itself. That is why this probe proves
// NON-PROGRESS AS A FIXPOINT (same state → same result → never terminates)
// instead of counting iterations.
//
// Checks:
//   A  the JS semantics that make it possible (clamping at position < 0)
//   B  the old shape reaches a non-progressing fixpoint on the column-0 shapes
//      real corpus code has (both a call form and the Exposed line that hung)
//   C  the fixed shape terminates and answers the same question correctly
//   D  the real kotlin slice (Exposed, 150 files) CONTAINS such lines — this was
//      not hypothetical; hits are counted and sampled with their source text
//   E  the shipped predicate in matrix-tool-language.ts carries the guarded form
//      (so reverting the fix fails this probe, not a future 7-minute silence)
//
// Usage: npx tsx script/m59/probe-predicate-loop.ts [--files=150]

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS = "$HOME/fixtures/repositories/Exposed"
const OUT = path.join(ROOT, "validation/m59/results/predicate-loop.json")
const MATRIX = path.join(ROOT, "script/m59/matrix-tool-language.ts")
const CAP = Number(process.argv.find((a) => a.startsWith("--files="))?.split("=")[1] ?? 150)

// Verbatim copy of the shipped keyword list (drift would make this probe lie).
const DECL_KEYWORDS = [
  "fun", "def", "void", "int", "long", "double", "float", "boolean", "bool", "char", "byte", "short",
  "String", "Object", "public", "private", "protected", "internal", "static", "final", "abstract",
  "synchronized", "native", "override", "open", "suspend", "operator", "inline", "external", "function",
]

/** Replace quoted spans with spaces so strings cannot fake code or open a comment. */
function stripStrings(line: string): string {
  let out = ""
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === "\\") {
        out += "  "
        i++
        continue
      }
      if (ch === quote) {
        quote = null
        out += ch
        continue
      }
      out += " "
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch
      out += ch
      continue
    }
    out += ch
  }
  return out
}

type Verdict = { declared: boolean; spun: boolean; proof?: string }

/**
 * The shipped `declaredHere`, parameterized by the keyword-search shape.
 *   mode "old" — `at = head.lastIndexOf(kw, at - 1)` (the shipped, hanging form)
 *   mode "new" — `at = at > 0 ? head.lastIndexOf(kw, at - 1) : -1` (the fix)
 */
function declaredHere(line: string, token: string, mode: "old" | "new"): Verdict {
  let i = line.indexOf("(")
  while (i !== -1) {
    let j = i - 1
    while (j >= 0 && line[j] === " ") j--
    const nameEnd = j
    while (j >= 0 && /[A-Za-z0-9_$]/.test(line[j])) j--
    if (j !== nameEnd && line.slice(j + 1, nameEnd + 1) === token) {
      const head = line.slice(0, j + 1)
      let kwEnd = -1
      for (const kw of DECL_KEYWORDS) {
        let at = head.lastIndexOf(kw)
        let guard = 0
        while (at !== -1) {
          const before = at === 0 ? "" : head[at - 1]
          const after = head[at + kw.length] ?? ""
          if (!/[A-Za-z0-9_$]/.test(before) && !/[A-Za-z0-9_$]/.test(after)) break
          let next: number
          if (mode === "old") {
            next = head.lastIndexOf(kw, at - 1)
            if (next === at) {
              return {
                declared: false,
                spun: true,
                proof: `head=${JSON.stringify(head)} kw=${JSON.stringify(kw)} at=${at}: lastIndexOf(kw, ${at - 1}) returned ${next} — identical state, deterministic, never terminates`,
              }
            }
          } else {
            next = at > 0 ? head.lastIndexOf(kw, at - 1) : -1
          }
          at = next
          if (++guard > 10_000) {
            return { declared: false, spun: true, proof: `head=${JSON.stringify(head)} kw=${JSON.stringify(kw)}: 10000 iterations, no boundary` }
          }
        }
        if (at !== -1 && at + kw.length > kwEnd) kwEnd = at + kw.length
      }
      if (kwEnd === -1) return { declared: false, spun: false }
      const between = head.slice(kwEnd)
      if (!/[=().;{}]/.test(between)) return { declared: true, spun: false }
    }
    i = line.indexOf("(", i + 1)
  }
  return { declared: false, spun: false }
}

/** Occurrences of `token` used as a call — verbatim from the shipped predicate. */
function occurrencesOf(line: string, token: string): number {
  let n = 0
  let idx = line.indexOf(token)
  while (idx !== -1) {
    const before = idx === 0 ? "" : line[idx - 1]
    if (!/[A-Za-z0-9_$]/.test(before)) {
      let j = idx + token.length
      const open = line[j] === "[" ? "[" : line[j] === "<" && line[j - 1] !== undefined && !/\s/.test(line[j - 1]) ? "<" : null
      if (open) {
        const close = open === "[" ? "]" : ">"
        let depth = 0
        let k = j
        let end = -1
        while (k < line.length && k - j < 120) {
          const ch = line[k]
          if (ch === open) depth++
          else if (ch === close) {
            depth--
            if (depth === 0) {
              end = k
              break
            }
          } else if (close === ">" && /[;)}{]/.test(ch)) break
          k++
        }
        if (end !== -1) j = end + 1
      }
      while (line[j] === " ") j++
      if (line[j] === "(") n++
      else if (line[j] === "{" && line[j + 1] !== "}") n++
      else if (line[j] === "?" && line[j + 1] === ".") {
        let k = j + 2
        while (line[k] === " ") k++
        if (line[k] === "(") n++
      }
    }
    idx = line.indexOf(token, idx + 1)
  }
  return n
}

// Same walk as the matrix, so this scans the slice the sweep actually indexed.
const SKIP_DIRS = new Set([
  ".git", "node_modules", "build", "target", "dist", "out", ".gradle", "__pycache__", "vendor",
  "test", "perf", "Microbenchmarks", "wwwroot", "testassets", "benchmarkapps", "testData",
  "coverage", "generated", "__generated__",
])

/** Kotlin-style declaration shape: `name(...): ReturnType` in a declaring line. */
function looksLikeDeclaration(line: string, token: string): boolean {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`${esc}\\s*\\([^()]*\\)\\s*:`)
  // A regex LITERAL needs a single-escaped word boundary. This line originally
  // carried a doubled escape, which matches a literal backslash followed by the
  // letter b and therefore never matched anything: it reported 0 declaration
  // shapes across 5,421 candidate lines until it was caught. (The RegExp above is
  // built from a template literal, where a doubled escape yields one.)
  return re.test(line) && /\b(fun|val|var|class|object)\b/.test(line)
}

function collectFiles(root: string, exts: string[], cap: number): string[] {
  const found: string[] = []
  const stack = [root]
  while (stack.length && found.length < cap) {
    const dir = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const e of [...entries].sort()) {
      if (found.length >= cap) break
      if (SKIP_DIRS.has(e)) continue
      const p = path.join(dir, e)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) stack.push(p)
      else if (st.size > 0 && st.size < 400_000 && exts.some((x) => p.endsWith(x))) found.push(p)
    }
  }
  return found
}

const checks: Array<{ id: string; pass: boolean; detail: string }> = []
const check = (id: string, pass: boolean, detail: string) => checks.push({ id, pass, detail })

async function main() {
  // ── A: the semantics ───────────────────────────────────────────────────────
  const clampHead = "integerValue."
  const clampPlain = clampHead.lastIndexOf("int")
  const clampNegative = clampHead.lastIndexOf("int", -1)
  check(
    "A-clamping-at-negative-position",
    clampPlain === 0 && clampNegative === 0 && /[A-Za-z0-9_$]/.test(clampHead[3]),
    `lastIndexOf("int")=${clampPlain}, lastIndexOf("int", -1)=${clampNegative} (clamped to 0), head[3]=${JSON.stringify(clampHead[3])} is a word char so the boundary check refuses the match`,
  )

  // ── B: the old shape spins ─────────────────────────────────────────────────
  // The keyword must sit at index 0 of `head`, and head is the line up to the
  // callee name — so the trigger needs the keyword at COLUMN 0 (indentation moves
  // it off index 0 and the search survives via the `at-1 → -1` path). Both shapes
  // below are real corpus forms:
  //   callTrigger    — a call on a name beginning `int…` at column 0
  //   declTrigger    — the Exposed line that actually hung the kotlin sweep
  const callTrigger = "integerValue.compareTo(x)"
  const declTrigger = "internal fun JdbcTransaction.isMarkedRollback(): Boolean = isRollback"
  const spinOf = (line: string, token: string) => declaredHere(line, token, "old")
  const oldCall = spinOf(callTrigger, "compareTo")
  const oldDecl = spinOf(declTrigger, "isMarkedRollback")
  check(
    "B-old-shape-hits-fixpoint",
    oldCall.spun === true && oldDecl.spun === true,
    oldCall.spun && oldDecl.spun
      ? `both trigger shapes spin — e.g. ${oldDecl.proof}`
      : `expected a non-progressing fixpoint on both shapes; call=${oldCall.spun} decl=${oldDecl.spun}`,
  )

  // ── C: the fixed shape terminates AND answers correctly ────────────────────
  const newCall = declaredHere(callTrigger, "compareTo", "new")
  const callOcc = occurrencesOf(callTrigger, "compareTo")
  check(
    "C-fixed-shape-terminates-on-call",
    newCall.spun === false && newCall.declared === false && callOcc === 1,
    `fixed verdict: spun=${newCall.spun} declared=${newCall.declared}; occurrences=${callOcc} → the line counts as a CALL (a declaration would have been suppressed)`,
  )
  // Control: a declaration the predicate DOES recognise must keep returning true
  // (otherwise the fix would turn every declaration into a "call").
  const plainDecl = "fun foo(): Int = 1"
  const plainVerdict = declaredHere(plainDecl, "foo", "new")
  check(
    "C-fixed-shape-still-detects-declarations",
    plainVerdict.spun === false && plainVerdict.declared === true,
    `"${plainDecl}" → declared=${plainVerdict.declared} (must stay true), occurrences=${occurrencesOf(plainDecl, "foo")}`,
  )
  // Recorded, NOT asserted: the real Exposed line is an extension-function
  // declaration and the shipped predicate returns declared=false for it, so its
  // declaration line is counted as a call SITE. That is pre-existing behaviour
  // (the receiver-dot rule) with its own consequence for `missed`; measuring it
  // here keeps it visible without this probe silently changing predicate
  // semantics. See section D's `declarationLinesCountedAsCalls`.
  const newDecl = declaredHere(declTrigger, "isMarkedRollback", "new")
  checks.push({
    id: "O-extension-declaration-verdict(documented, not asserted)",
    pass: true,
    detail: `"${declTrigger}" → declared=${newDecl.declared} — recorded as a separate finding, not a failure of this fix`,
  })

  // ── D: the corpus really contains them ────────────────────────────────────
  const files = existsSync(CORPUS) ? collectFiles(CORPUS, [".kt"], CAP) : []
  if (files.length === 0) {
    check("D-corpus-present", false, `no .kt files found under ${CORPUS} — this probe would prove nothing`)
  } else {
    const hits: Array<{ file: string; line: number; token: string; text: string; proof: string }> = []
    const declAsCall: Array<{ file: string; line: number; token: string; text: string }> = []
    let scannedLines = 0
    let tokenChecks = 0
    let notDeclared = 0
    let looksLikeDecl = 0
    for (const f of files) {
      const rel = path.relative(CORPUS, f)
      const lines = readFileSync(f, "utf8").split("\n")
      for (let li = 0; li < lines.length; li++) {
        const raw = lines[li]
        scannedLines++
        const line = stripStrings(raw)
        // Candidate tokens: every identifier used with `(` or `{` — i.e. exactly
        // the kind of callee name the sweep asks questions about.
        const re = /([A-Za-z_$][A-Za-z0-9_$]*)\s*[({]/g
        let m: RegExpExecArray | null
        const seen = new Set<string>()
        while ((m = re.exec(line)) !== null) {
          const token = m[1]
          if (seen.has(token)) continue
          seen.add(token)
          // The shipped code only calls declaredHere when the token occurs once.
          if (occurrencesOf(line, token) !== 1) continue
          tokenChecks++
          // Measured independently of the spin branch: the Exposed extension
          // declaration IS a spin trigger, and counting it only on the
          // non-spinning path made this number read as a misleading 0.
          if (!declaredHere(line, token, "new").declared) {
            notDeclared++
            if (looksLikeDeclaration(line, token)) {
              looksLikeDecl++
              if (declAsCall.length < 500) declAsCall.push({ file: rel, line: li + 1, token, text: raw.trim().slice(0, 120) })
            }
          }
          const v = declaredHere(line, token, "old")
          if (v.spun) {
            hits.push({ file: rel, line: li + 1, token, text: raw.trim().slice(0, 120), proof: v.proof ?? "" })
          }
        }
      }
    }
    check(
      "D-corpus-contains-spin-triggers",
      hits.length > 0,
      `${hits.length} (line, token) pair(s) in ${files.length} files would have spun (${tokenChecks} single-occurrence token checks over ${scannedLines} lines)`,
    )
    checks.push({
      id: "O-declaration-lines-counted-as-calls(documented, not asserted)",
      pass: true,
      detail: `${declAsCall.length} declaration-shaped line(s) with a single occurrence of the token are counted as call sites (of ${tokenChecks} token checks: notDeclared=${notDeclared}, looksLikeDeclaration=${looksLikeDecl}; e.g. ${declAsCall.slice(0, 2).map((d) => `${d.file}:${d.line}`).join(", ") || "none"}) — a separate finding for \`missed\` accuracy, unchanged by this fix`,
    })
    const payload = {
      probe: "M59.PREDICATE-LOOP",
      at: new Date().toISOString(),
      command: process.argv.join(" "),
      corpus: CORPUS,
      sliceFiles: files.length,
      scannedLines,
      tokenChecks,
      spinTriggerHits: hits.length,
      samples: hits.slice(0, 8),
      declarationLinesCountedAsCalls: declAsCall.length,
      declarationAsCallSamples: declAsCall.slice(0, 8),
      checks,
      verdict: checks.every((c) => c.pass) ? "CONFIRMED" : "FAILED",
    }
    mkdirSync(path.dirname(OUT), { recursive: true })
    writeFileSync(OUT, JSON.stringify(payload, null, 2))
    console.log(`\ncorpus: ${hits.length} spin trigger(s) in ${files.length} files (${tokenChecks} token checks)`)
    for (const h of hits.slice(0, 5)) console.log(`   ${h.file}:${h.line}  token=${h.token}  ${h.text}`)
    console.log(`evidence: ${path.relative(ROOT, OUT)}`)
  }

  // ── E: the shipped predicate carries the guarded form ─────────────────────
  const shipped = readFileSync(MATRIX, "utf8")
  const guarded = "at > 0 ? head.lastIndexOf(kw, at - 1) : -1"
  check(
    "E-shipped-predicate-is-guarded",
    shipped.includes(guarded),
    shipped.includes(guarded)
      ? `matrix-tool-language.ts contains the guarded search`
      : `matrix-tool-language.ts does NOT contain "${guarded}" — the spin is back`,
  )

  console.log("\n=== checks ===")
  for (const c of checks) console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.id} — ${c.detail}`)
  const ok = checks.every((c) => c.pass)
  console.log(ok ? "\nPROBE VERDICT: confirmed (root cause named; fix present and correct)" : "\nPROBE VERDICT: FAILED — see checks above")
  if (!ok) process.exitCode = 1
}

main().catch((e) => {
  console.error("PROBE ERROR:", e?.stack ?? e)
  process.exitCode = 2
})
