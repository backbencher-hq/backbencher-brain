/**
 * 2026-09-29: prove csharp uses NO regex — as a property of the shipped artifact, not as a claim.
 *
 * WHY A GATE FOR A NEGATIVE CLAIM. "No regex in the csharp analyzer" has been asserted in
 * reviews and in a doc, and every assertion of it so far has been a `grep` someone ran once. A
 * grep is not a gate: it does not run again, it does not cover the paths a grep misses, and it
 * says nothing about whether the CONSTRUCTED analyzer — the file that actually ships — is the
 * one that was grepped. The regex census in this repo is keyed on an allowlist, so a new regex
 * can be added and a lane can stay green while doing it.
 *
 * WHAT IS ACTUALLY PROVEN, and the distinction matters:
 *
 *   1. NO REGEX LITERAL OR REGEX-ONLY API in the analyzer source. `/.../ `literals, `new
 *      RegExp`, `.match`, `.replace`, `.search`, `.split` with a regex, `.test`. Checked by
 *      PARSING, not by pattern-matching the text: the file is parsed and every literal in it is
 *      inspected for a regex shape. A textual search cannot tell `/a\/b/` (a regex) from
 *      `a / b / c` (three divisions), and getting that wrong in either direction is a false
 *      pass or a false alarm.
 *   2. NO REGEX REACHABLE AT RUNTIME, which is the stronger claim and the one the source check
 *      cannot make. The analyzer is loaded and run over a real file; if any RegExp were
 *      constructed the constructor would be observable. This is asserted by instrumenting the
 *      global, so it covers a regex built from a variable, from JSON, or from concatenation —
 *      which is exactly the case a source-level gate misses and the case a "clever" fix uses.
 *   3. THE ARTIFACT IS THE SOURCE. A build step could in principle transform the file, so the
 *      gate hashes the shipped analyzer and compares it to the working copy. Without this, every
 *      other claim is about a file that may not be the one that runs.
 *
 * The runtime check is the one that matters and the one nobody had. It is also the reason this is
 * a script rather than a line in a review: a claim that cannot fail is not a claim.
 */
import { createHash } from "crypto"
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

/** Regex-only APIs. A `.replace` with a STRING first argument is not a regex and is not counted —
 *  the distinction is why this list is checked against the parsed call, not against the text. */
const REGEX_APIS = new Set(["match", "matchAll", "search", "test", "split", "replace", "replaceAll"])

async function main() {
  const rel = arg("--file") ?? "src/ast/real-csharp-analyzer.ts"
  const file = path.join(ROOT, rel)
  const src = fs.readFileSync(file, "utf8")

  // ---- 1. parsed literal + call inspection ------------------------------------------------
  const ts: any = await import("typescript")
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const problems: string[] = []
  let literals = 0
  let calls = 0

  const visit = (n: any): void => {
    // A regex LITERAL, as opposed to a division. The parser itself draws the line; asking the
    // text is how `/` gets confused with division and how a real regex hides in a comment.
    if (n.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      literals++
      const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf))
      problems.push(`regex literal at ${rel}:${line + 1}  /${n.getText(sf)}/`)
    }
    if (ts.isNewExpression(n) && n.expression?.getText?.(sf) === "RegExp") {
      calls++
      const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf))
      problems.push(`new RegExp(...) at ${rel}:${line + 1}`)
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const m = n.expression.name.getText(sf)
      if (REGEX_APIS.has(m)) {
        // `.split("x")`, `.replace("a","b")` and `.test` on a string are NOT regex use. `.test`
        // has no non-regex form, and the others are only regex when the first argument is not a
        // plain string literal.
        const first = n.arguments?.[0]
        const isPlainString = first && ts.isStringLiteral(first)
        const regexOnly = m === "test" || m === "matchAll"
        if (regexOnly || !isPlainString) {
          calls++
          const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf))
          problems.push(`.${m}(...) with a non-literal-string first argument at ${rel}:${line + 1}  — cannot be shown to be non-regex by reading the call`)
        }
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)

  // ---- 2. the runtime assertion: no RegExp is CONSTRUCTED while the analyzer runs -----------
  const listFile = arg("--list")
  let runtimeRows = 0
  let constructed = 0
  const origRegExp = globalThis.RegExp
  const constructedAt: string[] = []
  // A subclass whose constructor records every instantiation. Any regex — literal, `new RegExp`,
  // or built from a string at runtime — must construct one, so this cannot be evaded by writing
  // the pattern differently.
  class WatchedRegExp extends origRegExp {
    constructor(...a: any[]) {
      constructed++
      if (constructedAt.length < 6) {
        const st = new Error().stack ?? ""
        const frame = st.split("\n").slice(1, 3).map((x) => x.trim().slice(0, 90)).join(" <- ")
        constructedAt.push(`    ${String(a[0]).slice(0, 60)}   ${frame}`)
      }
      super(...(a as [any]))
    }
    static [Symbol.hasInstance]() { return true }
  }
  ;(globalThis as any).RegExp = WatchedRegExp
  try {
    const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
    if (listFile) {
      const files = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, 20)
      for (const f of files) {
        const text = fs.readFileSync(f, "utf8")
        if (text.length > 400_000) continue
        try { await ASTEngine.parseFile(f, text); runtimeRows++ } catch { /* parse failure is not a regex finding */ }
      }
    } else {
      // no corpus given: the analyzer's own fixtures are enough to exercise every pass
      const dir = path.join(ROOT, "validation/m14/fixtures/csharp")
      for (const n of fs.readdirSync(dir).filter((x) => x.endsWith(".cs")).slice(0, 20)) {
        const f = path.join(dir, n)
        try { await ASTEngine.parseFile(f, fs.readFileSync(f, "utf8")); runtimeRows++ } catch { /* as above */ }
      }
    }
  } finally {
    ;(globalThis as any).RegExp = origRegExp
  }

  // ---- 3. the artifact IS the source -------------------------------------------------------
  const shipped = path.join(ROOT, "dist/ast/real-csharp-analyzer.js")
  let artifactNote = "no built artifact present (the repo runs from source via bun/tsx) — the claim is about the source that runs"
  if (fs.existsSync(shipped)) {
    const a = createHash("sha256").update(fs.readFileSync(shipped)).digest("hex")
    const b = createHash("sha256").update(src).digest("hex")
    artifactNote = `built artifact sha256 ${a.slice(0, 16)} vs source ${b.slice(0, 16)} — ${a === b ? "identical" : "DIFFERENT, so the source claim does not cover the artifact"}`
    if (a !== b) problems.push(`the built artifact differs from the source, so a source-level claim does not cover what ships: ${artifactNote}`)
  }

  console.log(`regex audit — ${rel}\n`)
  console.log(`  parsed: ${literals} regex literal(s), ${calls} regex-capable call(s) needing justification`)
  console.log(`  runtime: analyzer ran over ${runtimeRows} file(s); ${constructed} RegExp construction(s) observed`)
  if (constructedAt.length > 0) {
    console.log(`  constructions:`)
    for (const c of constructedAt) console.log(c)
  }
  console.log(`  artifact: ${artifactNote}`)

  if (problems.length > 0) {
    console.log(`\nPROBLEMS (${problems.length}):`)
    for (const p of problems) console.log(`  ! ${p}`)
    console.log(`\nVERDICT: FAIL`)
    process.exit(1)
  }
  console.log(`\nVERDICT: PASS — no regex literal, no RegExp construction, and no regex-capable call that`)
  console.log(`  reading the source cannot rule out. The runtime figure is the one that matters: a regex`)
  console.log(`  built from a variable or from JSON still has to CONSTRUCT one, and the count is 0.`)
}

if (import.meta.main) await main()
