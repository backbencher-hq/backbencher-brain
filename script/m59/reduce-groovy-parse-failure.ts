// Delta-debug a groovy parse failure down to a MINIMAL failing source, so the
// next round works from a repro instead of a hunch about a file.
//
// THE PROPERTY IS NOT `hasError`. Measured, in this order, on
// end-to-end/spring-dependency-management/grails-app/controllers/UrlMappings.groovy:
//   - `hasError` alone reduced the 34-line file to a single `}` — any fragment no
//     Groovy parser could read satisfies it;
//   - adding a brace-balance guard produced the orphan block-comment body
//     `*  under the License.` — a truncated comment is itself an error;
//   - adding a "deleting the error node leaves clean source" guard produced
//     `constraints {` — an unclosed brace whose deletion leaves the empty
//     string, which parses clean.
// The first two are MANUFACTURED failures, and the census carries the same
// illusion: 31 of its 370 failing files report a bare `}` as their first error
// line. A candidate is therefore accepted only when all four hold:
//
//   1. it fails                  — rootNode.hasError;
//   2. the failure is LOCALIZED  — deleting the first non-zero-width
//                                  ERROR/MISSING node leaves source that parses
//                                  clean (the failure lives at its own span, not
//                                  in the file's global structure);
//   3. no protected range is cut — every comment / string literal of the ORIGINAL
//                                  that spans several lines is kept whole or
//                                  dropped whole, so the candidate cannot contain
//                                  half a comment or half a string;
//   4. the code delimiters match — braces, parens and brackets balance once the
//                                  protected ranges are removed.
//
// Two phases, both on line boundaries:
//   1. chunk removal — delete aligned blocks of decreasing size, keeping a
//      candidate that satisfies the property;
//   2. boundary trim — drop leading/trailing lines that are not needed.
// Nothing is claimed about WHY the reduced form fails: the failure is measured,
// the trigger is what a reader then has to explain.
//
// Usage: bun script/m59/reduce-groovy-parse-failure.ts <file> [--lines A:B] [--max-lines N]
//
// `--lines A:B` (1-based, inclusive) scopes the SEARCH to a region the caller
// names — typically `class X {` through its closing brace. It changes only the
// starting candidate set: every guard and every protected range stays exactly
// as it is, derived from the ORIGINAL file's tree, so a scoped run accepts a
// candidate precisely when the whole-file run would.
//
// Why an explicit range and NOT an auto-detected `--body`: measured on
// grails-mail/.../MailMessageBuilder.groovy, the outer class body is never
// recognized as a `class_body` (the recovery swallows it) while a NESTED class
// at line 69 produces the single `class_body` node in the whole parse. A mode
// that walked to the nearest body would silently reduce the nested class and
// report the outer body clean. See reviews/m59-841-class-body-localization.md.
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { spawnSync } from "node:child_process"

/**
 * Ask a real Groovy toolchain whether `source` is valid Groovy SYNTAX.
 * Compiles only to Phases.CONVERSION — parse + AST conversion, before semantic
 * analysis — so unresolved imports or a missing classpath cannot reject a file.
 * Returns "ACCEPTS" | "REJECTS" | "UNAVAILABLE" (never a guess).
 */
function groovyOracle(source: string): "ACCEPTS" | "REJECTS" | "UNAVAILABLE" {
  const lib = process.env.BB_GROOVY_LIB ?? findGradleGroovyLib()
  if (!lib) return "UNAVAILABLE"
  const tmp = path.join(os.tmpdir(), "bb-oracle-candidate.groovy")
  try {
    fs.writeFileSync(tmp, source)
  } catch {
    return "UNAVAILABLE"
  }
  const code = [
    "import org.codehaus.groovy.control.CompilationUnit",
    "import org.codehaus.groovy.control.Phases",
    "def f = new File(System.getenv('BB_ORACLE_FILE'))",
    "def cu = new CompilationUnit()",
    "cu.addSource(f.name, f.text)",
    "try { cu.compile(Phases.CONVERSION); println \"ACCEPTS\" } catch (Throwable t) { println \"REJECTS\" }",
  ].join("; ")
  const r = spawnSync("java", ["-cp", path.join(lib, "*"), "groovy.ui.GroovyMain", "-e", code], {
    env: { ...process.env, BB_ORACLE_FILE: tmp },
    encoding: "utf8",
    timeout: 120_000,
  })
  const out = `${r.stdout ?? ""}`
  if (out.includes("ACCEPTS")) return "ACCEPTS"
  if (out.includes("REJECTS")) return "REJECTS"
  return "UNAVAILABLE"
}

/** The Groovy toolchain bundled with a Gradle wrapper distribution, if present. */
function findGradleGroovyLib(): string | null {
  const roots = [
    path.join(os.homedir(), ".gradle", "wrapper", "dists"),
    path.join(os.homedir(), ".gradle", "caches"),
  ]
  for (const root of roots) {
    let dists: string[] = []
    try {
      dists = fs.readdirSync(root)
    } catch {
      continue
    }
    for (const d of dists) {
      const base = path.join(root, d)
      let subs: string[] = []
      try {
        subs = fs.readdirSync(base)
      } catch {
        continue
      }
      for (const s of subs) {
        for (const cand of [path.join(base, s, "lib"), path.join(base, s, "gradle-8.14", "lib")]) {
          try {
            if (fs.readdirSync(cand).some((f) => /^groovy-[0-9].*\.jar$/.test(f))) return cand
          } catch {
            /* keep looking */
          }
        }
      }
    }
  }
  return null
}

async function main(): Promise<void> {
  const file = process.argv[2]
  const maxLines = process.argv.includes("--max-lines")
    ? parseInt(process.argv[process.argv.indexOf("--max-lines") + 1])
    : 400
  const linesArg = process.argv.includes("--lines")
    ? process.argv[process.argv.indexOf("--lines") + 1]
    : null
  const scopeTo = (n: number): number[] => {
    if (!linesArg) return Array.from({ length: n }, (_, i) => i)
    const m = /^(\d+):(\d+)$/.exec(linesArg)
    if (!m) throw new Error(`--lines expects A:B (1-based, inclusive), got "${linesArg}"`)
    const a = Math.max(1, parseInt(m[1], 10))
    const b = Math.min(n, parseInt(m[2], 10))
    if (a > b) throw new Error(`--lines ${linesArg} is an empty range for a ${n}-line file`)
    return Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i)
  }
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P()
  parser.setLanguage(lang)

  // A file's LINES are what `wc -l` counts: one trailing newline does not add a
  // line, but `split("\n")` says it does. That phantom empty element is not
  // harmless noise — it was the only source of a candidate's trailing newline,
  // and it changed this tool's own answer: on MailMessageBuilder.groovy,
  // `--lines 1:431` selected ONE ELEMENT FEWER than an unscoped run over the same
  // region and reduced the file to a different "minimal" repro (199 lines, error
  // row 33) than the unscoped run (276 lines, error row 41). Both satisfied every
  // guard, so nothing flagged it: the tool disagreed with itself about one file.
  // The phantom element is therefore dropped from the search space, and the
  // trailing newline is restored on every reconstruction instead — so an explicit
  // range and an unscoped run over the same lines are the same candidate set.
  const raw = fs.readFileSync(file, "utf8")
  const src = raw.endsWith("\n") ? raw.slice(0, -1) : raw
  const orig = src.split("\n")
  const lineStart: number[] = []
  {
    let off = 0
    for (const l of orig) {
      lineStart.push(off)
      off += l.length + 1
    }
  }
  const lineOf = (index: number): number => {
    let lo = 0
    let hi = lineStart.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStart[mid] <= index) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  const firstError = (root: any): any => {
    let found: any = null
    const walk = (n: any): void => {
      if (found) return
      if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex) {
        found = n
        return
      }
      for (let i = 0; i < n.childCount && !found; i++) walk(n.child(i))
    }
    walk(root)
    return found
  }

  // Protected ranges: comments and string literals, outermost only (a string's
  // fragments are covered by the string itself).
  const rangesOf = (root: any): Array<{ start: number; end: number }> => {
    const out: Array<{ start: number; end: number }> = []
    const walk = (n: any): void => {
      if (/comment|string|gstring/.test(n.type)) {
        if (n.endIndex > n.startIndex) out.push({ start: n.startIndex, end: n.endIndex })
        return
      }
      for (let i = 0; i < n.childCount; i++) walk(n.child(i))
    }
    if (root) walk(root)
    return out
  }
  const blankRanges = (text: string, ranges: Array<{ start: number; end: number }>): string => {
    const chars = text.split("")
    for (const r of ranges) {
      for (let i = r.start; i < r.end && i < chars.length; i++) chars[i] = " "
    }
    return chars.join("")
  }
  const protectedRanges = rangesOf(parser.parse(src)?.rootNode)
  // Multi-line ranges, as the set of original line indices they occupy.
  const multiLine: Array<Set<number>> = protectedRanges
    .map((r) => {
      const a = lineOf(r.start)
      const b = lineOf(Math.max(r.start, r.end - 1))
      const s = new Set<number>()
      for (let i = a; i <= b; i++) s.add(i)
      return s
    })
    .filter((s) => s.size > 1)

  const whyRejected: string[] = []
  // ONE text, used for judging, printing AND writing. A fixed-point check found
  // the previous state inconsistent: `fails()` judged text with an appended
  // newline while the closing report parsed the output WITHOUT it, so the
  // written candidate — `out` plus a newline, re-read and re-normalized — did not
  // reproduce the failure it had just been accepted for, and reducing the
  // emitted repro said "does not fail, nothing to reduce". The judged text is now
  // exactly what the file contains after its single trailing newline, so a
  // candidate is a repro exactly when the file holding it is.
  const candidateText = (idx: number[]): string => idx.map((i) => orig[i]).join("\n")
  const fails = (idx: number[]): boolean => {
    const text = candidateText(idx)
    const root = parser.parse(text)?.rootNode
    if (!root?.hasError) return false
    // (2) the failure is localized
    const err = firstError(root)
    if (!err) {
      whyRejected.push("no ERROR/MISSING node")
      return false
    }
    const without = text.slice(0, err.startIndex) + text.slice(err.endIndex)
    const clean = parser.parse(without)?.rootNode
    if (!clean || clean.hasError) {
      whyRejected.push("deleting the failing node does not leave clean source (global-structure failure)")
      return false
    }
    // (5) THE FAILING NODE MUST NOT BEGIN ON THE CANDIDATE'S FIRST LINE.
    //
    // Guards 1–4 do not establish locality when the failure is the recovery
    // WRAPPER: tree-sitter wraps the unparseable remainder in one ERROR node, and
    // deleting that node leaves text with nothing left to fail on — so guard (2)
    // passes while the candidate carries no localizable trigger at all. Measured:
    // reducing `grails-mail/.../MailMessageBuilder.groovy` (whose original failure
    // is genuinely localized at row 45) produced a candidate of deleted-lines soup
    // whose report was `ERROR row 1 col 1 :: "/*\n * Copyright …"` — a wrapper, i.e.
    // the third generation of the manufactured repro this file's header documents.
    // A failure that starts on the first line cannot be told apart from the
    // wrapper by anything this tool measures, so it is REFUSED rather than emitted:
    // the contract is a minimal LOCALIZED repro, and a trustworthy "cannot localize
    // this file" is worth more than a candidate a reader will mistake for a trigger.
    if ((err.startPosition?.row ?? 0) === 0) {
      whyRejected.push("failing node begins on the candidate's first line (wrapper-shaped: not a localized trigger)")
      return false
    }
    // (3) no protected range is cut (measured on ORIGINAL line indices — the
    // ranges are the original file's, so this guard is index-based by design).
    const kept = new Set(idx)
    for (const range of multiLine) {
      let inside = 0
      for (const l of range) if (kept.has(l)) inside++
      if (inside !== 0 && inside !== range.size) {
        whyRejected.push("a multi-line comment/string would be cut in half")
        return false
      }
    }
    // (4) the code delimiters match — blanked with the CANDIDATE's OWN
    // tree-derived ranges, never the original file's offsets.
    //
    // This guard used to blank `protectedRanges` (offsets in the ORIGINAL src)
    // inside reconstructed candidate text. Those two index spaces coincide only
    // when the candidate IS the whole file, so for every reduced candidate the
    // blanks landed on the wrong spans and the check measured nothing: it
    // accepted a 199-line "repro" of MailMessageBuilder.groovy that in fact cuts
    // one `{` and one `(` (original file: balanced, control-measured), i.e. the
    // delimiter-cut artifact this header exists to prevent. A candidate's
    // balance is a property of the candidate, so it is measured on the
    // candidate.
    const code = blankRanges(text, rangesOf(root))
    const count = (ch: string): number => code.split(ch).length - 1
    const balanced = count("{") === count("}") && count("(") === count(")") && count("[") === count("]")
    if (!balanced) {
      whyRejected.push(
        `code delimiters unbalanced after blanking its own comments/strings ({}=${count("{") - count("}")} ()=${count("(") - count(")")} []=${count("[") - count("]")})`,
      )
    }
    return balanced
  }

  const all = scopeTo(orig.length)
  if (!fails(all)) {
    const last = whyRejected[whyRejected.length - 1] ?? "unknown"
    console.log(`the file does not fail under the reducer's property at this wasm — nothing to reduce`)
    console.log(`  reason: ${last}`)
    return
  }
  whyRejected.length = 0
  console.log(
    linesArg
      ? `scoped to lines ${all[0] + 1}..${all[all.length - 1] + 1} of ${orig.length}, fails (localized, integrity-checked)`
      : `original: ${orig.length} lines, fails (localized, integrity-checked)`,
  )

  let best = all.slice()
  let gran = Math.max(1, Math.floor(best.length / 2))
  while (gran >= 1) {
    let i = 0
    let changed = false
    while (i < best.length) {
      const cand = best.slice(0, i).concat(best.slice(i + gran))
      if (cand.length > 0 && fails(cand)) {
        best = cand
        changed = true
      } else {
        i += gran
      }
    }
    if (!changed) gran = Math.floor(gran / 2)
  }
  while (best.length > maxLines) {
    const cand = best.slice(1)
    if (fails(cand)) best = cand
    else break
  }

  const out = candidateText(best)
  console.log(`\nreduced to ${best.length} lines (original line numbers ${best[0] + 1}..${best[best.length - 1] + 1}):`)
  console.log("-".repeat(60))
  console.log(out)
  console.log("-".repeat(60))
  const root = parser.parse(out)?.rootNode
  console.log(`fails=${root?.hasError}`)
  const err = firstError(root)
  if (err) {
    console.log(
      `${err.isMissing ? "MISSING" : "ERROR"} ${err.type} row ${err.startPosition.row + 1} col ${err.startPosition.column + 1} :: ${JSON.stringify((err.text || "").slice(0, 160))}`,
    )
  }
  fs.writeFileSync("/tmp/g841-reduced.groovy", out + "\n")
  console.log("written to /tmp/g841-reduced.groovy")

  // ── GUARD (6): the language itself must accept the candidate ──────────────
  //
  // Guards 1–5 establish that the candidate fails OUR parser, locally, without
  // cutting a comment/string or a delimiter. They say nothing about whether it is
  // a GROOVY PROGRAM. Measured: the three smallest files of #841's residual each
  // reduced to a candidate that satisfies every one of guards 1–5 and that real
  // Groovy 3.0.24 REJECTS — a license header plus a lone `@Scaffold(Foo<Bar>)`, an
  // `… else { }` torso. Such a fragment is a manufactured repro in the same family
  // as the delimiter-cut and the wrapper, and it is exactly what a reader would
  // mistake for a trigger. The language is the only authority that can settle it,
  // so the emitted candidate is offered to a real Groovy toolchain when one can be
  // located, and the verdict is PRINTED with it. No toolchain, no verdict — and it
  // says so rather than implying the candidate is valid.
  const oracle = groovyOracle(out + "\n")
  if (oracle === "ACCEPTS") {
    console.log("oracle (real Groovy): ACCEPTS — the candidate is valid Groovy, so this is OUR gap")
  } else if (oracle === "REJECTS") {
    console.log("oracle (real Groovy): REJECTS — NOT a Groovy program; this candidate is a fragment,")
    console.log("  not a trigger. Do not read it as one.")
  } else {
    console.log("oracle (real Groovy): UNAVAILABLE — the candidate is UNVERIFIED against the language")
    console.log("  (set BB_GROOVY_LIB to a Groovy lib dir, or install the Gradle wrapper's toolchain)")
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
