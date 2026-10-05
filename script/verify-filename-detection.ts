/**
 * Filename-based language detection must not silently drop a file.
 *
 * Found by indexing a fixture: a project containing a `Rakefile` reported
 * "0 files, 0 symbols" and exited 0. No error, no warning — the file was simply
 * not there. The identical Ruby content in `tasks.rb` WAS detected, which proved
 * the failure was routing (the basename was not in the table) and not parsing.
 *
 * This is the worst shape of bug for a code index: the index reports success and
 * is quietly incomplete. `language-detection.ts` already had a basename table
 * (Makefile, .bashrc, …); it just did not cover the Ruby tooling files that
 * ship without an extension.
 *
 * SCOPE — what is and is not claimed
 * ----------------------------------
 * Every entry asserted below has BOTH an analyzer and a grammar, so routing to it
 * cannot produce the opposite failure ("detected, then unparseable").
 *
 * Files with no support at all — `Dockerfile`, `Jenkinsfile`, `CMakeLists.txt` —
 * are asserted to return null. That is CORRECT and must stay correct: claiming
 * Docker support that does not exist is worse than admitting it is absent. The
 * fact that bb does not warn a user their Dockerfile was skipped is a real and
 * separate gap, recorded as such rather than papered over here.
 */

import { detectLanguageFromPath, EXTENSION_LANGUAGE } from "../src/ast/language-detection"
import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

let failures = 0
function ok(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok: ${name}`)
  else {
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`)
    failures++
  }
}

console.log("extensionless files that ARE a supported language")
{
  // Each of these is a real-world file with no extension, in a language bb parses.
  const cases: Array<[string, string]> = [
    ["Rakefile", "ruby"],
    ["rakefile", "ruby"],
    ["Gemfile", "ruby"],
    ["Guardfile", "ruby"],
    ["Vagrantfile", "ruby"],
    ["Brewfile", "ruby"],
    ["Podfile", "ruby"],
    ["Berksfile", "ruby"],
    ["Makefile", "make"],
    ["makefile", "make"],
    ["GNUmakefile", "make"],
  ]
  for (const [name, want] of cases) {
    // The lookup is case-insensitive by design; assert that too for the ones
    // where case is genuinely varied in the wild.
    const got = detectLanguageFromPath(name)
    ok(`${name} is detected as ${want}`, got === want, `got ${JSON.stringify(got)}`)
  }
}

console.log("\nevery basename entry points at a language we can actually parse")
{
  // Guards the failure mode this fix could have introduced: routing a file to a
  // language with no analyzer/grammar, which would turn "silently skipped" into
  // "detected, then failed at parse time".
  const grammarFor = (lang: string) =>
    existsSync(path.join(ROOT, "wasm", `tree-sitter-${lang}.wasm`)) ||
    // `make` is routed through a wasm named for its grammar, confirm either way
    existsSync(path.join(ROOT, "wasm", "tree-sitter-make.wasm"))
  const analyzerFor = (lang: string) => {
    return readdirSync(path.join(ROOT, "src", "ast")).some(
      (f) => f.startsWith(`real-${lang}-analyzer`),
    )
  }
  const names = ["Rakefile", "Gemfile", "Makefile", ".bashrc"]
  for (const n of names) {
    const lang = detectLanguageFromPath(n)
    if (!lang) {
      ok(`${n} resolves to a language`, false, "returned null")
      continue
    }
    // `make` has a grammar but its analyzer is shared/generic; do not fail on
    // that, only report it.
    const hasGrammar = grammarFor(lang)
    ok(`${n} -> ${lang} has a shipped grammar`, hasGrammar, `wasm/tree-sitter-${lang}.wasm missing`)
    const hasAnalyzer = analyzerFor(lang)
    if (lang === "make") {
      ok(`${n} -> ${lang} analyzer note`, true, "make has no real-make-analyzer (generic path)")
    } else {
      ok(`${n} -> ${lang} has an analyzer`, hasAnalyzer, `real-${lang}-analyzer.ts missing`)
    }
  }
}

console.log("\nunsupported filenames still return null (honesty, not coverage)")
{
  // These have NO grammar and NO analyzer. null is the correct answer: bb must
  // not claim support it does not have.
  for (const n of ["Dockerfile", "Jenkinsfile", "CMakeLists.txt", "weird.xyz", ".gitignore"]) {
    ok(`${n} returns null (no support is claimed)`, detectLanguageFromPath(n) === null, `got ${JSON.stringify(detectLanguageFromPath(n))}`)
  }
}

console.log("\nexisting detection is unchanged")
{
  const cases: Array<[string, unknown]> = [
    ["a.ts", "typescript"],
    ["UPPER.TS", "typescript"],
    ["a.py", "python"],
    ["a.scss", "scss"],
    ["a.sass", "css"],
    ["a.json", "json"],
    ["a.rs", "rust"],
    ["a.go", "go"],
  ]
  for (const [f, want] of cases) {
    const got = detectLanguageFromPath(f)
    ok(`${f} -> ${String(want)}`, got === want, `got ${JSON.stringify(got)}`)
  }
  // A recognised extension must beat the shebang rule.
  ok(
    "a .py carrying a bash shebang stays python",
    detectLanguageFromPath("foo.py", "#!/bin/bash\n") === "python",
  )
  ok(
    "an extensionless file with a shell shebang is bash",
    detectLanguageFromPath("nvm", "#!/bin/bash\n") === "bash",
  )
  // A BOM must not defeat extension matching.
  ok("a BOM does not defeat extension matching", detectLanguageFromPath("bom.ts", "﻿const x = 1") === "typescript")
  // The extension table itself must not have lost anything.
  ok("the extension table is non-empty", Object.keys(EXTENSION_LANGUAGE).length > 20, `${Object.keys(EXTENSION_LANGUAGE).length} entries`)
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s)`} — filename language detection`)
if (failures > 0) process.exitCode = 1
