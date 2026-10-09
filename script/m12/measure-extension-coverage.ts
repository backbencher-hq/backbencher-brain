#!/usr/bin/env npx tsx
/**
 * measure-extension-coverage.ts — measure a file extension before declaring it.
 *
 * Why this exists
 * ---------------
 * `EXTENSION_LANGUAGE` (src/ast/language-detection.ts) is not a list of formats the
 * grammar's own `file-types` metadata mentions; it is a list of formats a CORPUS has been
 * measured on. The `.nims`/`.nimble` entries state the rule in their comment: "declaring
 * a format is not evidence the analyzer models it, and routing on the declaration alone is
 * the claim-without-coverage class". This script is that measurement, so the next person
 * adding an extension does not have to invent it:
 *
 *     npx tsx script/m12/measure-extension-coverage.ts .mts .cts
 *
 * It reports, per extension: how many tracked files exist, what the ROUTER currently says
 * about them, and — for a language it can parse — files parsed, error files, error nodes,
 * symbols, relationships and imports. An extension with a nonzero file count and a healthy
 * parse is a candidate to declare; an extension with ZERO tracked files cannot be measured
 * at all and therefore must NOT be declared (`.cts` was in exactly that state when `.mts`
 * was added).
 *
 * Read-only: it parses in-process and writes nothing.
 */
import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../src/ast/engine"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

const exts = process.argv.slice(2)
if (exts.length === 0) {
  console.error("usage: npx tsx script/m12/measure-extension-coverage.ts .mts [.cts ...]")
  process.exit(2)
}

for (const ext of exts) {
  const files = execSync(`git ls-files '*${ext}'`, { maxBuffer: 1 << 28 })
    .toString()
    .split("\n")
    .filter(Boolean)

  console.log(`\n=== ${ext} ===`)
  console.log(`tracked files  : ${files.length}`)
  if (files.length === 0) {
    console.log(`router says    : (nothing to measure) — an extension with no corpus cannot be declared`)
    continue
  }

  const routed = [...new Set(files.map((f) => detectLanguageFromPath(f) ?? "null"))]
  console.log(`router says    : ${routed.join(", ")}`)

  // Parse with the language the extension WOULD route to once declared, so the numbers
  // describe the decision rather than the status quo.
  const language = routed.find((r) => r !== "null") ?? "typescript"
  let parsed = 0
  let errorFiles = 0
  let errorNodes = 0
  let threw = 0
  let symbols = 0
  let relationships = 0
  let imports = 0
  const examples: string[] = []

  for (const f of files) {
    try {
      const src = readFileSync(f, "utf8")
      const r: any = await (ASTEngine as any).parseFile(f, src, language)
      parsed++
      symbols += r.symbols?.length ?? 0
      relationships += r.relationships?.length ?? 0
      imports += r.imports?.length ?? 0
      const errs = (r.errors ?? []).length
      if (errs > 0) {
        errorFiles++
        errorNodes += errs
        if (examples.length < 5) examples.push(f)
      }
    } catch (e: any) {
      threw++
      if (examples.length < 5) examples.push(`${f} (${String(e?.message).slice(0, 60)})`)
    }
  }

  console.log(`parsed as      : ${language}`)
  console.log(`parsed         : ${parsed}`)
  console.log(`error files    : ${errorFiles}`)
  console.log(`error nodes    : ${errorNodes}`)
  console.log(`threw          : ${threw}`)
  console.log(`symbols        : ${symbols}`)
  console.log(`relationships  : ${relationships}`)
  console.log(`imports        : ${imports}`)
  if (examples.length) console.log(`examples       : ${examples.join(" | ")}`)
}
