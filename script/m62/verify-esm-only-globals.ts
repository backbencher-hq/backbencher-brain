#!/usr/bin/env tsx
// script/m62/verify-esm-only-globals.ts — no ES module may use __dirname or __filename.
//
// FOUND 2026-10-11 while fixing script/m14/verify-parse-success.ts. That gate died at
// load with
//
//   ReferenceError: __dirname is not defined in ES module scope
//
// printed a stack trace, and exited — having run no check at all. It is in
// `npm run verify`. package.json declares `"type": "module"`, so `__dirname` is never
// defined in any of these files; the identifier is a CommonJS leftover that survived
// because nothing type-checks it (`tsc` accepts `__dirname` under @types/node) and
// nothing ran it in this session until now.
//
// The repo already has the correct idiom and uses it elsewhere:
//
//   script/m14/html-ontology-census.ts:91   const SELF = fileURLToPath(import.meta.url)
//
// so this is not a new convention — it is an existing one applied inconsistently.
//
// THE TRAP, and the reason a naive grep is wrong here. Three files in `npm run verify`
// contain the STRING "__dirname" without using the identifier:
//
//   script/m14/verify-js-census.ts:194   a list of names to reject as phantom globals
//   script/verify-engine.ts:101          likewise
//   script/verify-index.ts:89            likewise — inside a SQL string literal
//
// Those are data about global names, not uses of the global. A scan that counts them
// would report three healthy files as broken and, worse, would tempt someone into
// "fixing" a query that is correct. So this gate looks for the identifier in CODE —
// blanking comments first, and distinguishing a bare reference from a quoted name —
// rather than counting occurrences.
//
// WHAT IT CHECKS. A bare `__dirname` / `__filename` reference in a .ts/.mts file under
// script/ or src/, in a file that the verify chain actually runs. Files that merely
// NAME the globals as data are not reported, and the self-test below proves it.

import { readFileSync } from "node:fs"
import path from "node:path"

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}

// This gate stays red, and it is not in verify-suite.mts, until the files it names stop
// using CommonJS-only globals in an ES module. That is the declaration
// script/m62/verify-suite-coverage.ts looks for.
//
// The 95 remaining are mostly probes and scratch outside any chain. The 11 in the chain
// were NOT individually executed — 11 were measured to crash and fixed, and the rest are
// reported as latent rather than as observed failures, because claiming a crash I did not
// witness is the exact error this session has been correcting.

const ROOT = process.cwd()
const { walkSourceFiles, blankCommentsAndStrings } = await import("./path_encoding_scan.ts")

// --- the detector, plus the self-tests that prove it discriminates --------------
// Bare identifier use: __dirname not preceded by a quote, and not part of a longer
// word. Strings are KEPT (a path in a string is real) but a quoted "__dirname" is a
// string VALUE, not a reference — so the negative lookbehind for a quote is the whole
// discriminator.
// The `g` flag is REQUIRED: String.prototype.matchAll throws on a non-global RegExp.
// Found by running the gate, not by reading it — it typechecks either way.
const BARE = /(?<!["'`\w])\b(__dirname|__filename)\b(?![\w])/g

// `require` is the same class of defect and was found in the same sweep: it does not
// exist in an ES module, `tsc` accepts it under @types/node, and a single occurrence
// inside a function body throws at RUN time — after the gate has done its work and
// thrown the result away. script/m14/verify-analyzer-hygiene.ts carried one and died
// with `ReferenceError: require is not defined in ES module scope` after 300 lines.
const REQUIRE = /(?<![."'\w])require\s*\(/g

function bareGlobals(src: string): string[] {
  const code = blankCommentsAndStrings(src, { keepStrings: true })
  const found = new Set<string>()
  for (const m of code.matchAll(BARE)) {
    // A quoted occurrence is data. Check the character right before the match.
    const at = m.index!
    if (at > 0 && /["'`]/.test(code[at - 1]!)) continue
    found.add(m[1]!)
  }
  for (const m of code.matchAll(REQUIRE)) {
    const at = m.index!
    // `createRequire(import.meta.url)` builds one legitimately; a bare `require(` does not.
    if (code.slice(Math.max(0, at - 40), at).includes("createRequire")) continue
    // A require() INSIDE A STRING is a test fixture, not a call. Two real cases, both in
    // `npm run verify`, both of which run fine today:
    //   script/m14/verify-js-census.ts:473     analyze("cjs", 'const m = require("./m.js") …')
    //   script/m15/verify-security-deep.ts:149 "  const { exec } = require('child_process')\n"
    // Both are handing a CJS sample to an analyzer to prove the CJS lane works. The
    // gate reported them anyway, and a gate that flags correct fixtures teaches people
    // to ignore it — the same lesson verify-indexer-option-contract.ts learned.
    //
    // The discriminator: walk BACK to the enclosing quote. A require() with an unclosed
    // quote before it on the same construct is string content.
    const before = code.slice(0, at)
    const lineStart = before.lastIndexOf("\n") + 1
    const line = before.slice(lineStart)
    const opensQuote = (line.match(/["'`]/g) ?? []).length % 2 === 1
    if (opensQuote) continue
    found.add("require()")
  }
  return [...found]
}

check(
  "the detector SEES a real bare use",
  bareGlobals(`const here = path.resolve(__dirname, "..")`).length === 1,
  `${bareGlobals(`const here = path.resolve(__dirname, "..")`).length} hit(s) for a real use`,
)

check(
  "the detector does NOT fire on a global NAMED as data",
  bareGlobals(`const PHANTOM = ["this", "window", "__dirname", "__filename"]`).length === 0,
  `${bareGlobals(`const PHANTOM = ["this", "window", "__dirname", "__filename"]`).length} hit(s) for a data list`,
)

check(
  "the detector does NOT fire on the same name inside a SQL literal",
  bareGlobals(`db.prepare("SELECT name FROM t WHERE name IN ('__dirname')")`).length === 0,
  `${bareGlobals(`db.prepare("SELECT name FROM t WHERE name IN ('__dirname')")`).length} hit(s) for a SQL string`,
)

check(
  "the detector SEES a bare require() in an ES module",
  bareGlobals(`function main() { const h = require("./evidence-harness"); return h }`).includes("require()"),
  "a bare require() inside a function body is reported",
)

check(
  "the detector does NOT fire on createRequire(import.meta.url), which is the correct ESM idiom",
  bareGlobals(`import { createRequire } from "node:module"; const require = createRequire(import.meta.url)`).length === 0,
  `${bareGlobals(`import { createRequire } from "node:module"; const require = createRequire(import.meta.url)`).length} hit(s) for createRequire`,
)

check(
  "the detector does NOT fire on a mention in a comment",
  bareGlobals(`// the old code used __dirname here\nconst x = 1`).length === 0,
  `${bareGlobals(`// the old code used __dirname here\nconst x = 1`).length} hit(s) for a comment`,
)

// --- the sweep -----------------------------------------------------------------
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
  type?: string
  scripts?: Record<string, string>
}
check(
  "package.json really does declare an ES module package (otherwise this gate is meaningless)",
  pkg.type === "module",
  `"type": ${JSON.stringify(pkg.type)}`,
)

const chain = Object.values(pkg.scripts ?? {}).join("\n")
const suite = readFileSync(path.join(ROOT, "script/m62/verify-suite.mts"), "utf8")
const runsInChain = (rel: string): boolean => chain.includes(rel) || suite.includes(rel)

const files = [...walkSourceFiles(path.join(ROOT, "script")), ...walkSourceFiles(path.join(ROOT, "src"))]
  .filter((f) => f.endsWith(".ts") || f.endsWith(".mts"))
  .map((f) => path.relative(ROOT, f))

const offenders: Array<{ file: string; globals: string[]; inChain: boolean }> = []
for (const rel of files) {
  const g = bareGlobals(readFileSync(path.join(ROOT, rel), "utf8"))
  if (g.length === 0) continue
  offenders.push({ file: rel, globals: g, inChain: runsInChain(rel) })
}

check(
  "no ES module uses __dirname, __filename or a bare require()",
  offenders.length === 0,
  offenders.length === 0
    ? `${files.length} file(s) scanned; every use of a CommonJS-only global is absent`
    : `*** ${offenders.length} file(s) use a CommonJS-only global in an ES module: ` +
      offenders.map((o) => `${o.file} (${o.globals.join(",")})`).slice(0, 10).join(", ") +
      `${offenders.length > 10 ? ` (+${offenders.length - 10} more)` : ""} ***`,
)

if (offenders.length > 0) {
  const inChain = offenders.filter((o) => o.inChain)
  console.log(`\n  run by the verify chain or the suite (${inChain.length}):`)
  for (const o of inChain) console.log(`    ${o.file}  —  ${o.globals.join(", ")}`)
  if (inChain.length > 0) {
    console.log(
      "\n  WHAT HAPPENS DEPENDS ON WHERE THE CALL IS, and this gate does not claim more\n" +
        "  than it measured. Both of these are CommonJS-only globals in a package that\n" +
        "  declares \"type\": \"module\", and `tsc` accepts both under @types/node — only\n" +
        "  RUNNING the file reveals them.\n\n" +
        "    AT LOAD    a top-level `__dirname` or `require()` throws before anything runs.\n" +
        "                Measured: 9 chain gates died with `ReferenceError: __dirname is not\n" +
        "                defined in ES module scope`, and script/m14/verify-analyzer-hygiene.ts\n" +
        "                died inside main() with `require is not defined`, AFTER 300 lines of\n" +
        "                work, throwing away every finding it had gathered.\n\n" +
        "    ON A PATH  a call inside a function is LATENT — it throws only when that branch\n" +
        "                runs. script/m19/verify-giant-intellij.ts and\n" +
        "                script/m40/verify-a9-purge.ts both threw on their first run here and\n" +
        "                are now fixed; the rest below were NOT individually executed, so they\n" +
        "                are reported as unreachable code, not as observed crashes.",
    )
  }
  console.log(`\n  not in a chain (${offenders.length - inChain.length}): ${offenders.length - inChain.length} file(s).`)
}

const failed = checks.filter((c) => !c.ok).length
console.log(`\nESM ONLY GLOBALS: ${failed === 0 ? "PASS" : `FAILED (${failed}) — see above`}`)
process.exit(failed === 0 ? 0 : 1)