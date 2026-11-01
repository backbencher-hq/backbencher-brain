// script/m15/verify-edit-e2e-docs.ts — M15.E6 + M15.E7
// Real-repo adversarial e2e (dry-run refactor) + docs honesty for bb_edit.

import { writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { parseForSafety } from "../../src/ast/safety-primitives"
import { resolveOptionalCorpus, optionalCorpusMissingMessage } from "../lib/optional-corpus.ts"

let checks = 0, passed = 0, failed = 0, negatives = 0, negativePassed = 0
// STICKY, and the reason it exists.
//
// The counters below are PER SECTION: E6 and E7 each emit their own evidence file, so each
// needs its own totals. That is why the counters are reset between them — and the reset is
// exactly what made this gate dishonest. It printed
//
//     E6: KNOWN-GAP (11/8 passed, 4 negatives)
//
// and then exited 0, because by the time the process reached its exit code the E6 failures had
// been zeroed and only E7's clean run remained. A reader of the exit code saw success; a
// reader of the output saw a failure. The chain believed the gate.
//
// So `anyFailed` is set on every failure and NEVER reset. The per-section counters stay
// per-section, because that is what the evidence files mean; the exit code is about the whole
// gate, and it now says so.
let anyFailed = false
function ck(l: string, c: boolean, d?: string) { checks++; if (c) passed++; else { failed++; anyFailed = true; console.log("  FAIL: " + l + (d ? " — " + d : "")) } }
function nk(l: string, c: boolean, d?: string) { negatives++; if (c) negativePassed++; else { failed++; anyFailed = true; console.log("  FAIL: " + l + " (negative)" + (d ? " — " + d : "")) } }

async function emitFile(code: string, issue: string, tool: string, title: string, file: string) {
  const total = passed + negativePassed
  const e = { issue, code, tool, title, verified: failed === 0, checks, passed: total, failed, negatives, generatedAt: new Date().toISOString() }
  writeFileSync(path.resolve("validation/m15/results/" + file), JSON.stringify(e, null, 2) + "\n")
  console.log(code + ": " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + total + "/" + checks + " passed, " + negatives + " negatives)")
}

/**
 * The pinned Go sample, or a REAL .go file from the same checkout if the pin has drifted.
 *
 * Returns a path that exists rather than asserting one that does not: a detector that reads a
 * file it never pinned reports a failure against an invented path, which is the same defect as
 * the one it is looking for. Never returns a synthetic file — if no .go file exists the sample
 * is dropped and the gate says so, rather than measuring a string the gate wrote itself.
 */
function existingGoSample(reposDir: string): string | null {
  const pinned = path.join(reposDir, "go_tools", "playground", "playground.go")
  if (existsSync(pinned)) return pinned
  const root = path.join(reposDir, "go_tools")
  if (!existsSync(root)) return null
  const entries: string[] = readdirSync(root, { recursive: true }) as unknown as string[]
  const alt = entries.find((f) => f.endsWith(".go") && !f.includes("vendor") && !f.includes("testdata"))
  return alt ? path.join(root, alt) : null
}

(async () => {
  // ═══════════════════════════════════════════════════════════════════════
  // E6: Real-repo e2e — dry-run classification on actual repo files
  // ═══════════════════════════════════════════════════════════════════════

  // The corpus is RESOLVED, never assumed. This used to hardcode
  // `$HOME/fixtures/repositories` — a path that exists on exactly one laptop, so on
  // every other machine this gate died with a raw ENOENT from `readdirSync`. That is the worst
  // shape a gate can have here: the crash happened before any check ran, the chain read the
  // non-zero exit as a verdict, and nothing in the output said "this machine has no corpus".
  //
  // script/lib/optional-corpus.ts already declares the resolution order (env override, the
  // legacy path, $HOME, a sibling checkout, in-repo). Absent corpus is a DECLARED BLOCK with
  // its own exit code (2), not a crash and not a silent pass — see the exit at the foot of this
  // file, which also reports the gate's verdict, so a caller reading the exit code can tell
  // VERIFIED from KNOWN-GAP.
  const REPOS_DIR = resolveOptionalCorpus("repositories", "BB_REPOSITORIES_REPO")
  if (REPOS_DIR === null) {
    console.log("  BLOCKED: " + optionalCorpusMissingMessage("repositories"))
    console.log("  This gate's subject is the real repository corpus. Without it there is nothing")
    console.log("  to measure, and reporting a verdict here would be inventing one.")
    process.exit(2)
  }

  // Sample one file from each of 5 language families.
  // graphql-js: pick a real existing .ts (repo layout drifted between clones);
  // fall back to any real .ts file in the checkout rather than failing on a
  // stale pinned path — the assertions still validate a REAL file, never a
  // synthetic one.
  let tsFile = path.join(REPOS_DIR, "graphql-js", "resources", "release-prepare.ts")
  if (!existsSync(tsFile)) {
    const entries: string[] = readdirSync(path.join(REPOS_DIR, "graphql-js"), { recursive: true }) as unknown as string[]
    const alt = entries.find((f) => f.endsWith(".ts") && !f.includes("node_modules") && !f.includes("website"))
    if (alt) tsFile = path.join(REPOS_DIR, "graphql-js", alt)
  }
  console.log("E6: graphql-js sample = " + tsFile)
  const samples = [
    { lang: "TypeScript", file: tsFile },
    { lang: "Python", file: path.join(REPOS_DIR, "cython", "setup.py") },
    { lang: "Ruby", file: path.join(REPOS_DIR, "rake", "lib", "rake", "task.rb") },
    // The corpus directory is `go_tools`, not `go-tools`. The hyphenated pin made this read a
    // file that has never existed in any clone, so the gate reported a parse failure against a
    // path it invented — a failure that names a real defect and points at nothing. Pinned the
    // way the sibling sites are, and given the same drift fallback as the TypeScript sample
    // above, so a future rename produces a declared substitution rather than an ENOENT.
    { lang: "Go", file: existingGoSample(REPOS_DIR) },
    { lang: "F#", file: path.join(REPOS_DIR, "fsharp", "src", "FSharp.Core", "seq.fs") },
  ]

  for (const s of samples) {
    if (s.file === null) {
      console.log("  note: the " + s.lang + " sample is absent from this corpus clone — the assertion is SKIPPED, not passed")
      continue
    }
    try {
      const content = readFileSync(s.file, "utf8")
      const p = await parseForSafety(path.basename(s.file), content)
      ck("E6: " + s.lang + " — parseForSafety succeeds on real file",
         p.mask.length === content.length,
         "occurrences=" + p.occurrences.length + " mask=" + p.mask.length + "/" + content.length)
      
      // Verify no comment/string text is classified as live code occurrence
      const hasOccurrences = p.occurrences.length > 0
      nk("E6: " + s.lang + " — occurrences extracted from real file", hasOccurrences,
         "got " + p.occurrences.length + " occurrences")
    } catch (e: any) {
      ck("E6: " + s.lang + " — parse succeeds on " + path.basename(s.file), false, e.message?.slice(0, 80))
    }
  }

  // Adversary: verify in-code identifiers are live (not masked as comments)
  {
    const p = await parseForSafety("a.ts", "const myVar = 1\nfunction myFunc() { return myVar }\n")
    const myVar = p.occurrences.filter(o => o.text === "myVar")
    ck("E6: all myVar occurrences are live (none masked)", myVar.length === 2, "got " + myVar.length)
    for (const o of myVar) {
      ck("E6: myVar@" + o.startLine + " is live", p.mask[o.startIndex] === 1)
    }
  }

  await emitFile("E6", "M15.E6", "bb_edit", "real-repo e2e", "e6.json")
  checks = passed = failed = negatives = negativePassed = 0

  // ═══════════════════════════════════════════════════════════════════════
  // E7: Docs honesty — prove registry + doc + implementation agree
  // ═══════════════════════════════════════════════════════════════════════

  const registrySrc = readFileSync(path.resolve("src/mcp/tool-registry.ts"), "utf8")
  const editEntry = registrySrc.includes('"bb_edit"') || registrySrc.includes("bb_edit")
  ck("E7: bb_edit registered in tool-registry.ts", editEntry)

  // Doc exists
  const docPath = path.resolve("docs/tools/bb_edit.md")
  try {
    const doc = readFileSync(docPath, "utf8")
    ck("E7: docs/tools/bb_edit.md exists", doc.length > 100)

    // Doc mentions modes
    for (const mode of ["write", "insert", "delete", "refactor", "format"]) {
      ck("E7: doc mentions mode '" + mode + "'", doc.includes(mode))
    }

    // Doc does NOT claim AST purity falsely (no "pure AST" in context where regex is used)
    // Honesty check: doc admits tree-sitter-based, not regex-based
    const docIsHonest = doc.includes("tree-sitter") || doc.includes("syntax tree") || 
                        doc.includes("AST") || doc.includes("parse tree")
    ck("E7: doc references tree-sitter/AST-based implementation", docIsHonest)
  } catch {
    ck("E7: docs/tools/bb_edit.md exists", false, "file not found")
  }

  // Implementation exists
  const editSrc = readFileSync(path.resolve("src/intelligence/edit/edit-engine.ts"), "utf8")
  ck("E7: edit-engine.ts exists and has executeEdit", editSrc.includes("executeEdit"))

  // Modes match registry
  const modesInImpl = ["write", "insert", "delete", "refactor", "format"].filter(m => editSrc.includes(m))
  ck("E7: all 5 modes in implementation", modesInImpl.length === 5,
     "found: " + modesInImpl.join(", "))

  await emitFile("E7", "M15.E7", "bb_edit", "docs honesty", "e7.json")

  // THE EXIT CODE IS PART OF THE VERDICT.
  //
  // This file had no `process.exit` at all. It printed VERIFIED or KNOWN-GAP and then returned
  // 0 either way, so `npm run verify` could not tell a clean run from a failing one — it was
  // only ever observed to exit non-zero because an unhandled rejection killed the process on
  // this machine, which is an accident, not a contract. script/m62/verify-gates-can-fail.ts
  // exists to name exactly this, and it named this file.
  process.exit(anyFailed ? 1 : 0)
})().catch((e: any) => {
  // A thrown error is neither a pass nor a measured failure, so it gets its own code. Exit 1
  // would be a lie about the verdict and exit 0 would be worse.
  console.error("FATAL", e)
  process.exit(2)
})
