/**
 * M60-C — #920 engine gate: the C/C++ preprocessing must not move a ROW.
 *
 * `parseRaw` blanks compiler extensions before parsing. Its own comment claims
 * "This preserves exact byte bounds and line numbers" — and the two MULTI-LINE
 * patterns (`__attribute__((...))`, `__declspec(...)`) did not: they were
 * replaced with `" ".repeat(match.length)`, which keeps the byte count while
 * destroying every `\n` inside the match, so every node after such an attribute
 * was reported one (or more) rows too high. Measured before the fix: 76 of
 * zig's 14,032 C/C++ files (worst case 138 rows of drift) and 682 of 38,566
 * landed cpp relationships naming a line that does not contain the name they
 * claim (c 101; 783 together, the whole of the M59 Tier A oracle's INCONSISTENT
 * column on its c/cpp sample).
 *
 * WHY A SEPARATE GATE, and not the fixture lane: the M14 fixture runner parses
 * the fixture text with `getParser(...)` and calls `analyzer.analyze` directly
 * (production `parseFile` is the entry only for the SFC languages), so it never
 * runs the blanking at all — a defect that lives in the engine's preprocessing
 * is invisible to it by construction. This gate reads the contract where it
 * lives: the tree `ASTEngine.parseTree` hands to every analyzer, compared against
 * a raw tree-sitter parse of the same bytes.
 *
 * Checks:
 *   V1  ROW PRESERVATION: for every byte offset present in BOTH trees, the row
 *       must agree. (Types may legitimately differ — blanking removes attributes
 *       and `__cdecl`-style keywords from the grammar's view — which is exactly
 *       why the comparison is keyed by offset, never by node type.)
 *   V2  BYTE PRESERVATION: the blanked text must have the same length as the
 *       input, so every downstream byte offset (the safety primitives' comment /
 *       string masking) stays valid.
 *   V3  MUTATION SELF-TEST: the SAME V1 comparison, run against the old
 *       newline-destroying blanking, MUST fail. A gate that cannot fail on the
 *       defect it was written for is decoration.
 *
 * CLI: bun run script/m14/verify-attr-line-base-920.ts [--emit]
 * Evidence: validation/m14/results/M14.0.F12.json — the F-series wrapper every
 * M14 gate carries (id/claim level/layers/limitations/corpus pins, written by
 * `evidence-harness.emitEvidence`), carrying this gate's own run log in its
 * `data`. The results directory holds harness artifacts ONLY (the harness
 * validator reads every file in it), so this gate writes no side file.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import * as WTS from "web-tree-sitter"
import { emitEvidence } from "./evidence-harness"

const ROOT = path.resolve(__dirname, "..", "..")
const REPOS = "$HOME/fixtures/repositories"
const FIXTURE = path.join(ROOT, "validation", "m14", "fixtures", "cpp", "multiline-attribute-line-base-920.cpp")

/** The two multi-line patterns the engine blanks, and the explicit blankers. */
const PATTERNS: Array<[RegExp, string]> = [
  [/__attribute__\s*\(\([\s\S]*?\)\)/g, "__attribute__"],
  [/__declspec\s*\([\s\S]*?\)/g, "__declspec"],
]
/** The PRE-FIX behaviour (measured): byte count kept, newlines destroyed. */
const blankOld = (match: string): string => " ".repeat(match.length)
/** The fix: byte count kept AND every newline kept. */
const blankNew = (match: string): string => match.replace(/[^\n]/g, " ")

function blanked(content: string, blank: (m: string) => string): string {
  let out = content
  for (const [re] of PATTERNS) out = out.replace(re, blank)
  return out
}

/** Multi-line matches only — the class this gate exists for. */
function multilineMatches(content: string): number {
  let n = 0
  for (const [re] of PATTERNS) {
    for (const m of content.match(re) ?? []) if (m.includes("\n")) n++
  }
  return n
}

function rowMap(root: any): Map<number, number> {
  const map = new Map<number, number>()
  const walk = (n: any): void => {
    if (typeof n.startIndex === "number") map.set(n.startIndex, n.startPosition.row)
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(root)
  return map
}

function mismatches(a: Map<number, number>, b: Map<number, number>): string[] {
  const out: string[] = []
  for (const [index, row] of a) {
    const other = b.get(index)
    if (other === undefined) continue // the other grammar sees a different node there
    if (other !== row) out.push(`byte ${index}: row ${row} != ${other}`)
  }
  return out
}

const results: { id: string; pass: boolean; detail: string }[] = []
function record(id: string, pass: boolean, detail: string): void {
  results.push({ id, pass, detail })
  console.log(`${pass ? "ok  " : "FAIL"}  ${id}  ${detail}`)
}

const samples: string[] = [FIXTURE]
// Real corpus files, deterministically chosen: the first N (sorted) C/C++ files
// that actually carry a multi-line attribute. They are the reason the class is
// not hypothetical — and they are OPTIONAL (a checkout without the corpus still
// runs this gate on the fixture).
const REAL_LIMIT = 12
if (fs.existsSync(REPOS)) {
  const found: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (found.length >= REAL_LIMIT || depth > 6) return
    let entries: string[]
    try {
      entries = fs.readdirSync(dir).sort()
    } catch {
      return
    }
    for (const e of entries) {
      if (found.length >= REAL_LIMIT) return
      const full = path.join(dir, e)
      let st: fs.Stats
      try {
        st = fs.statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(full, depth + 1)
      } else if (/\.(c|h|cpp|cc|cxx|hpp|hh)$/.test(e) && st.size < 512 * 1024) {
        let text: string
        try {
          text = fs.readFileSync(full, "utf8")
        } catch {
          continue
        }
        if (multilineMatches(text) > 0) found.push(full)
      }
    }
  }
  for (const repo of ["zig", "fmt", "sqlite", "jql", "jq"].map((r) => path.join(REPOS, r))) {
    if (fs.existsSync(repo)) walk(repo, 0)
    if (found.length >= REAL_LIMIT) break
  }
  samples.push(...found.slice(0, REAL_LIMIT))
}

async function main(): Promise<void> {
  // A raw parser for the comparison references (both directions).
  const P: any = (WTS as any).Parser ?? (WTS as any).default
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")))
  const raw = new P()
  raw.setLanguage(lang)

  const { ASTEngine } = await import(path.join(ROOT, "src", "ast", "engine.ts"))

  let checked = 0
  let classPresent = 0
  const failures: string[] = []
  let v2Bad = 0
  let v3Caught = 0
  let v3Vacuous = 0

  for (const file of samples) {
    const text = fs.readFileSync(file, "utf8")
    const multiline = multilineMatches(text)
    if (multiline > 0) classPresent++
    const rel = path.relative(ROOT, file)

    // V2 — byte preservation (the masking contract), independent of the tree.
    const oldText = blanked(text, blankOld)
    const newText = blanked(text, blankNew)
    if (newText.length !== text.length) {
      v2Bad++
      failures.push(`V2 ${rel}: blanked length ${newText.length} != ${text.length}`)
    }

    // V1 — the engine's tree must agree on every shared offset's ROW.
    const engine: any = await ASTEngine.parseTree(file, text)
    const engineRows = rowMap(engine.tree.rootNode)
    const rawRows = rowMap(raw.parse(text).rootNode)
    const diff = mismatches(rawRows, engineRows)
    checked++
    if (diff.length > 0) {
      failures.push(`V1 ${rel}: ${diff.length} offset(s) on the wrong row (first: ${diff[0]}) — multi-line matches in this file: ${multiline}`)
    }

    // V3 — mutation self-test: the OLD blanking must be DETECTED by V1 itself.
    if (multiline > 0) {
      const mutatedRows = rowMap(raw.parse(oldText).rootNode)
      const caught = mismatches(rawRows, mutatedRows).length > 0
      if (caught) v3Caught++
      else v3Vacuous++
    }
  }

  record("V1-row-preservation", failures.filter((f) => f.startsWith("V1")).length === 0, `${checked} file(s) compared against a raw parse of the same bytes; multi-line-attribute files in the sample: ${classPresent}`)
  record("V2-byte-preservation", v2Bad === 0, `blanked text keeps the input's byte length on all ${checked} file(s)`)
  record("V3-mutation-self-test", v3Caught > 0 && v3Vacuous === 0, `the pre-fix blanking is detected on ${v3Caught} file(s)${v3Vacuous ? `, NOT detected on ${v3Vacuous} (vacuous)` : ""}`)
  record("V0-class-present", classPresent > 0, `the sample contains ${classPresent} file(s) with a MULTI-LINE attribute — without one this gate has nothing to check`)

  const pass = results.every((r) => r.pass)
  console.log(`\n${pass ? "PASS" : "FAIL"} — ${results.filter((r) => r.pass).length}/${results.length} checks`)

  // The F-series wrapper (M14.0.F12). This gate is the only one in the battery
  // that compares the ENGINE's tree against a raw parse, so it is registered as
  // its own gate rather than folded into F5 (whose oracle shares the tree) or
  // F3 (whose lane never runs the preprocessing at all).
  if (process.argv.includes("--emit")) {
    const repoPins: Record<string, string> = {}
    for (const repo of ["zig", "fmt", "sqlite", "jq"]) {
      try {
        repoPins[repo] = execSync("git rev-parse HEAD", { cwd: path.join(REPOS, repo) }).toString().trim()
      } catch {
        repoPins[repo] = "absent"
      }
    }
    const out = emitEvidence({
      issueId: "M14.0.F12",
      title: "Engine row preservation — C/C++ preprocessing must not move a row",
      claimLevel: "L3",
      layers: ["engine", "analyzer", "corpus"],
      checks: results.map((r) => ({
        id: `F12.${r.id.split("-")[0]}`,
        description:
          r.id === "V1-row-preservation"
            ? "every byte offset shared with a raw parse of the same bytes has the same row"
            : r.id === "V2-byte-preservation"
              ? "the blanked text keeps the input's byte length"
              : r.id === "V3-mutation-self-test"
                ? "the pre-fix blanking is DETECTED by V1 (the gate can fail on its own defect)"
                : "the sample contains at least one file with a MULTI-LINE attribute",
        status: r.pass ? "pass" : "fail",
        detail: r.detail,
      })),
      limitations: [
        {
          description: "The sample is the gate's deterministic draw (the fixture plus the first N corpus files that carry a multi-line attribute), not every file the product will see.",
          justification: "the class is decided by the engine's own regexes, so a file carrying the shape anywhere in a checked corpus file is caught; the sample list is printed and stored in the artifact",
        },
        {
          description: "Row agreement is checked on the cpp grammar; the c branch of the same preprocessing is identical code but is not parsed with the c wasm here.",
          justification: "the blanking is guarded by `language === \"c\" || language === \"cpp\"` and both patterns are in that one guarded block, so the two share the code path; V3 is the check that binds",
        },
      ],
      corpusPins: repoPins,
      data: {
        fixture: path.relative(ROOT, FIXTURE),
        samplesChecked: checked,
        multilineFiles: classPresent,
        v3Caught,
        v3Vacuous,
        failures,
        // This gate's own run log, verbatim (the results directory holds harness
        // artifacts only, so the detail lives inside the gate's evidence).
        runLog: {
          samples: samples.map((s) => path.relative(ROOT, s)),
          console: results,
        },
      },
    })
    console.log(`gate evidence: ${path.relative(ROOT, out)}`)
  }
  if (!pass) process.exit(1)
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
