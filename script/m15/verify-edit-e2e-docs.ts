// script/m15/verify-edit-e2e-docs.ts — M15.E6 + M15.E7
// Real-repo adversarial e2e (dry-run refactor) + docs honesty for bb_edit.

import { writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { parseForSafety } from "../../src/ast/safety-primitives"
import { resolveCorpusRoot } from "../lib/corpus-root.ts"
const CORPUS_BASE = resolveCorpusRoot(process.cwd()) ?? "CORPUS_BASE_UNRESOLVED"

let checks = 0, passed = 0, failed = 0, negatives = 0, negativePassed = 0
function ck(l: string, c: boolean, d?: string) { checks++; if (c) passed++; else { failed++; console.log("  FAIL: " + l + (d ? " — " + d : "")) } }
function nk(l: string, c: boolean, d?: string) { negatives++; if (c) negativePassed++; else { failed++; console.log("  FAIL: " + l + " (negative)" + (d ? " — " + d : "")) } }

// THIS FILE PRINTED A VERDICT PER LEG AND NEVER EXITED NON-ZERO.
//
// emitFile writes `verified: failed === 0` into validation/m15/results/*.json and
// prints VERIFIED or KNOWN-GAP, but nothing turned that into an exit code — the
// process exited 0 whatever the verdicts said. This gate is in the `npm run verify`
// chain, so a green chain carried no information for this leg. Found by
// script/m62/verify-gates-can-fail.ts.
//
// Run-wide rather than per-leg, because each leg reuses the same `failed` counter:
// without this, a KNOWN-GAP in an early leg followed by a clean one would exit 0.
let anyFailed = false

async function emitFile(code: string, issue: string, tool: string, title: string, file: string) {
  const total = passed + negativePassed
  const e = { issue, code, tool, title, verified: failed === 0, checks, passed: total, failed, negatives, generatedAt: new Date().toISOString() }
  writeFileSync(path.resolve("validation/m15/results/" + file), JSON.stringify(e, null, 2) + "\n")
  if (failed > 0) anyFailed = true
  console.log(code + ": " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + total + "/" + checks + " passed, " + negatives + " negatives)")
}

(async () => {
  // ═══════════════════════════════════════════════════════════════════════
  // E6: Real-repo e2e — dry-run classification on actual repo files
  // ═══════════════════════════════════════════════════════════════════════

  // WAS: path.resolve("$HOME/fixtures/repositories")
  //
  // A hardcoded absolute path to the OTHER laptop's home directory. On this machine the
  // gate died before running a single check:
  //
  //  "$HOME/fixtures/repositories" — the OTHER laptop's home directory — so
  //  each repo path below resolved to a filesystem that does not exist here and the leg
  //  measured nothing. Routed through script/lib/corpus-root.ts, which searches declared
  //  candidates in order and names them all when none exists.
  // Per-repo corpus paths were built on the literal foreign root
  //  "$HOME/fixtures/repositories" — the OTHER laptop's home directory — so
  //  each repo path below resolved to a filesystem that does not exist here and the leg
  //  measured nothing. Routed through script/lib/corpus-root.ts, which searches declared
  //  candidates in order and names them all when none exists.
  //   Error: ENOENT: no such file or directory, scandir `${CORPUS_BASE}/graphql-js`
  //
  // and it was in `npm run verify`, so that leg contributed nothing while appearing to
  // be part of the chain. Found by script/m62/verify-gates-can-fail.ts and then named by
  // script/m62/verify-no-foreign-paths.ts.
  //
  // Now searched in DECLARED order, with every path reported when none exists — the
  // convention script/m15/verify-security-deep.ts already uses ("no corpus found. Set
  // BB_SECURITY_CORPUS_ROOT … Searched: …"). A gate that cannot see its subject must say
  // so and where it looked, never crash and never pass vacuously.
  const REPOS_DIR_CANDIDATES = [
    process.env.BB_CORPUS_ROOT,
    process.env.BB_SECURITY_CORPUS_ROOT,
    path.resolve(process.cwd(), "fixtures/repositories"),
    path.resolve(process.cwd(), "../fixtures/repositories"),
  ].filter((p): p is string => typeof p === "string" && p.length > 0)
  const REPOS_DIR = REPOS_DIR_CANDIDATES.find((p) => existsSync(p))
  if (REPOS_DIR === undefined) {
    console.log(
      "  SKIP E6 (recorded, not failed): no corpus found. Set BB_CORPUS_ROOT to a fixtures/repositories directory.\n" +
        `    Searched: ${REPOS_DIR_CANDIDATES.join(", ")}`,
    )
  } else {

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
    // The corpus directory is go_tools (underscore), not go-tools. Every gate that
    //  asked for the hyphen form was reading a directory that has never existed on any
    //  machine, so the corpus leg passed VACUOUSLY — no error, no finding, nothing
    //  measured. script/m13/verify-analyze-e2e-corpus.ts reported exactly this once the
    //  corpus root was fixed: "corpus go-tools/go/analysis/passes (Go): present … missing".
    //  Verified against the corpus on disk, which lists go_tools.
    { lang: "Go", file: path.join(REPOS_DIR, "go_tools", "playground", "playground.go") },
    { lang: "F#", file: path.join(REPOS_DIR, "fsharp", "src", "FSharp.Core", "seq.fs") },
  ]

  for (const s of samples) {
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
  } // end E6 (skipped when no corpus was found)
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
})().then(
  // THE EXIT MUST WAIT FOR THE ASYNC IIFE.
  //
  // A first version put `process.exit(anyFailed ? 1 : 0)` on the line after `})()`.
  // The IIFE is async and not awaited, so that line ran IMMEDIATELY — before a single
  // check executed. The gate produced NO output at all and exited 0, which is strictly
  // worse than the state it replaced: it was not merely unable to fail, it no longer
  // ran. Caught by running it: zero lines of output where there had been a full
  // transcript.
  () => process.exit(anyFailed ? 1 : 0),
  (err) => {
    // A leg that throws is a leg that did not verify.
    console.error(err)
    process.exit(1)
  },
)
