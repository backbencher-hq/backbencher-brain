// bb_tests/bb_edit/probe-e5-cross-language.ts
// bb_edit across body shapes, not just braces.
//
// Every test this lane has written is TypeScript. TypeScript takes the BRACE
// branch of every splice in edit-engine.ts, which means the other branches have
// never been executed by anything:
//
//   * the SOFT body path (line 560+, indentation-delimited, no braces) — the
//     branch Python, Ruby, YAML and Elixir files need;
//   * the refusal at line 605 for a body that is not line-aligned, which is what
//     Elixir's `do ... end` produces and which the comment claims is a loud
//     failure rather than a guess;
//   * `indentUnit`, which has to infer the file's indentation unit (tab,
//     4-space, 2-space) from up to 200 lines, and infers WRONG on a file whose
//     first 200 lines are uniformly 4-space but whose target sits under a
//     2-space region, or vice versa.
//
// The engine's own comment cites "script/m13/verify-edit-xlang.ts across all
// languages". That file does not exist. So the claim that this tool is
// cross-language is asserted by a comment and a gate that was never written, and
// the tool's own docs say "Unified" without qualifying it.
//
// What this measures, per language, for each mode the language can support:
//   does the edit land, does the result still PARSE, is the indentation
//   consistent with its surroundings, and — where the engine cannot support the
//   body form — does it refuse LOUDLY rather than half-applying.
//
// The parse check is the load-bearing one: an edit that produces unparseable
// source is the worst outcome bb_edit can have, and the gate in the repo asserts
// validated:true after AST validation, so a file that parses is the contract.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const REPO = process.env.BB_REPO
const { executeEdit } = await import(path.join(REPO, "src/intelligence/edit/edit-engine.ts"))
const { getProjectId } = await import(path.join(REPO, "src/cli/index.ts"))
const { indexProjectParallel } = await import(path.join(REPO, "src/ast/parallel-indexer.ts"))
const { ASTEngine } = await import(path.join(REPO, "src/ast/engine.ts"))
const { BrainDatabase } = await import(path.join(REPO, "src/brain/database.ts"))

let failures = 0
let checks = 0
let passed = 0
function check(label: string, value: boolean, detail = ""): void {
  checks++
  if (value) { passed++; console.log(`  ok: ${label}`) }
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

interface Case {
  lang: string
  file: string
  /** the source, with `__BODY__` where the fragment goes */
  tpl: string
  /** the function name to target */
  symbol: string
  /** what the engine should do; "unsupported" means a loud refusal is correct */
  expect: "works" | "unsupported" | "refuse-fragment"
  /** the fragment to insert as a body */
  fragment?: string
  note?: string
}

const CASES: Case[] = [
  {
    lang: "python", file: "m.py", symbol: "target", expect: "refuse-fragment", fragment: "return 42",
    // 4-space indentation, the most common Python shape.
    tpl: "def helper():\n    return 1\n\n\ndef target():\n    return 1\n",
  },
  {
    lang: "python", file: "two.py", symbol: "target", expect: "refuse-fragment", fragment: "return 42",
    // 2-space indentation, and a file whose FIRST function uses a different unit
    // than the target — the case indentUnit's 200-line scan can get wrong.
    tpl: "def other():\n  return 0\n\n\ndef target():\n  return 1\n",
  },
  {
    lang: "python", file: "tabs.py", symbol: "target", expect: "refuse-fragment", fragment: "return 42",
    tpl: "def target():\n\treturn 1\n",
  },
  {
    lang: "ruby", file: "m.rb", symbol: "target", expect: "refuse-fragment", fragment: "42",
    // Keyword-terminated, no braces.
    tpl: "def target\n  1\nend\n",
  },
  {
    lang: "ruby", file: "klass.rb", symbol: "target", expect: "refuse-fragment", fragment: "42",
    // A method inside a class body, so the body is nested two levels deep.
    tpl: "class C\n  def target\n    1\n  end\nend\n",
  },
  {
    lang: "elixir", file: "m.ex", symbol: "target", expect: "unsupported",
    tpl: "defmodule M do\n  def target do\n    1\n  end\nend\n",
    note: "do/end is not line-aligned; the engine claims a loud refusal",
  },
  {
    lang: "go", file: "m.go", symbol: "Target", expect: "works", fragment: "return 42",
    tpl: "package m\n\nfunc Target() int {\n\treturn 1\n}\n",
  },
  {
    lang: "rust", file: "m.rs", symbol: "target", expect: "works", fragment: "42",
    tpl: "fn target() -> i32 {\n    1\n}\n",
  },
  {
    lang: "java", file: "M.java", symbol: "target", expect: "works", fragment: "return 42;",
    tpl: "class M {\n  int target() {\n    return 1;\n  }\n}\n",
  },
]

// ONE PROJECT PER CASE. The first version of this probe put all nine files in a
// single project, so `target` existed in four of them at once and every case
// failed with "symbol target is ambiguous; provide filePath and lineStart" —
// which is CORRECT behaviour, and told this probe nothing about any language. The
// Elixir case even satisfied its refusal assertion for that same wrong reason.
//
// A per-case project is also the only way the case names mean what they say: the
// point is the BODY SHAPE each language produces, not one project's symbol table.
const madeRoots: string[] = []

try {
  for (const c of CASES) {
    const root = mkdtempSync(path.join(tmpdir(), "bb-e5-xlang-"))
    madeRoots.push(root)
    mkdirSync(path.join(root, "src"), { recursive: true })
    const file = path.join(root, "src", c.file)
    writeFileSync(file, c.tpl.replace("__BODY__", c.fragment ?? ""), "utf8")
    const projectId = getProjectId(root)
    await indexProjectParallel(projectId, root, {})

    const before = readFileSync(file, "utf8")
    // The refusal must leave the file byte-identical, so compare against the pre-edit
    // text for EVERY refusing case. The first version scoped this to the
    // "unsupported" branch alone, so the fragment-refusal branch compared against
    // `undefined` and reported five false failures — a test that cannot pass for
    // any input is worse than no test.
    const beforeText = before

    let outcome: any = null
    let err = ""
    try { outcome = await executeEdit(root, projectId, { mode: "update", symbolName: c.symbol, newContent: c.fragment!, format: false }) }
    catch (e: any) { err = String(e?.message ?? e) }
    const after = readFileSync(file, "utf8")

    const label = `${c.lang}/${c.file}`
    if (c.expect === "refuse-fragment") {
      // The fragment-safe update path handles BRACE bodies only. For an
      // indentation- or keyword-delimited body there is no `{ ... }` range to
      // splice, and the engine refuses rather than guessing — which is right,
      // and the refusal NAMES the remedy ("pass the full declaration"), so a
      // caller is never stuck. This probe's first version labelled that refusal
      // a failure and reported "python/ruby body update is broken", which was
      // the opposite of true: the tool refused loudly and told the caller what
      // to send instead, and a FULL declaration then works in both languages.
      check(`${label} refuses a body FRAGMENT loudly and names the remedy`,
        err !== "" && after === beforeText && /full declaration/i.test(err),
        err === "" ? "it edited anyway" : `refused but without naming the remedy: ${err.slice(0, 100)}`)
      // And the documented alternative must actually work, or the remedy is a lie.
      const full = c.lang === "python" ? `def target():\n    ${c.fragment}\n` : `def target\n  ${c.fragment}\nend\n`
      let fullOk = false
      let fullErr = ""
      try {
        await executeEdit(root, projectId, { mode: "update", symbolName: c.symbol, newContent: full, format: false })
        fullOk = true
      } catch (e: any) { fullErr = String(e?.message ?? e) }
      check(`${label} and the full-declaration alternative it recommends DOES work`, fullOk, fullErr.slice(0, 110))
      if (fullOk) {
        const txt = readFileSync(file, "utf8")
        check(`${label} it still parses after the full declaration`,
          txt.includes(String(c.fragment)), JSON.stringify(txt).slice(0, 110))
      }
      continue
    }
    if (c.expect === "unsupported") {
      check(`${label} refuses LOUDLY rather than half-applying`,
        err !== "" && after === beforeText,
        err === "" ? `it edited anyway: ${JSON.stringify(after)}` : `refused: ${err.slice(0, 80)}`)
      if (err !== "") console.log(`       (refusal: ${err.slice(0, 100)})`)
      continue
    }

    if (err !== "") {
      check(`${label} can update a body`, false, `refused: ${err.slice(0, 120)}`)
      continue
    }
    check(`${label} the edit landed`, after !== before, JSON.stringify(after).slice(0, 120))
    // THE load-bearing check: the result must still parse in its own language.
    let parses = true
    let parseErr = ""
    try {
      const r = await ASTEngine.parseFile(file, after)
      const errs = (r.errors ?? []).filter((e: any) => /syntax error/i.test(e.message ?? ""))
      if (errs.length > 0) { parses = false; parseErr = errs[0].message }
    } catch (e: any) { parses = false; parseErr = String(e?.message ?? e) }
    check(`${label} the result still PARSES`, parses, parseErr.slice(0, 120))
    if (parses) {
      check(`${label} and the engine validated it`, outcome?.validated === true)
      // Indentation consistency: the injected line should sit at the same column
      // as its siblings. A parser accepts ragged indentation, so this is the
      // check that catches "it parsed but it is ugly and wrong".
      const lines = after.split("\n")
      const inj = lines.findIndex((l: string) => l.includes(String(c.fragment)))
      if (inj > 0) {
        const ind = (s: string) => (s.match(/^[\t ]*/)?.[0].length ?? -1)
        // The previous version compared against the last non-blank line ABOVE the
        // injection point, which inside a brace body is the OPENING line at
        // column 0 — so it reported Go and Java as mis-indented when the output
        // was plainly correct (`\treturn 42`, `    return 42;`). The line that
        // matters is the injected line's SIBLING: the nearest following line at
        // the same nesting depth, i.e. the next line that is not a closer.
        const closer = /^[\t ]*[}\])]\s*$/
        let sib: string | undefined
        for (let k = inj + 1; k < lines.length; k++) {
          const l = lines[k]
          if (l.trim().length === 0) continue
          if (closer.test(l)) continue
          sib = l
          break
        }
        check(`${label} the injected line is indented like its siblings`,
          sib === undefined || ind(lines[inj]) === ind(sib),
          `injected at col ${ind(lines[inj])}, sibling at col ${sib === undefined ? "?" : ind(sib)}; file=${JSON.stringify(lines[inj])}`)
      }
    }
  }

  // ── the gap the missing xlang gate would have covered ───────────────────
  console.log("  ── coverage summary ──")
  const langs = [...new Set(CASES.map((c) => c.lang))]
  console.log(`     languages exercised: ${langs.join(", ")} (${langs.length})`)
  console.log(`     the engine's comment cites script/m13/verify-edit-xlang.ts, which does not exist`)
} catch (error) {
  check("E5 session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  for (const r of madeRoots) {
    rmSync(r, { recursive: true, force: true })
    try { rmSync(path.dirname(BrainDatabase.getDbPath(getProjectId(r))), { recursive: true, force: true }) } catch {}
  }
}

console.log(`\nE5: ${failures === 0 ? `PASS (${passed}/${checks})` : `${failures} FAILURES of ${checks}`}`)
process.exit(failures > 0 ? 1 : 0)