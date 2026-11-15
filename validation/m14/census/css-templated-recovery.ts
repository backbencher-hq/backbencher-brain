/**
 * CSS TEMPLATED-VALUE RECOVERY PROBE — how many admitted stylesheets does a `{{...}}`
 * placeholder destroy, and what does the destruction cost?
 *
 * ## Why this file exists
 *
 * `css-incoming-split.ts` found 8 `references` target names that a whole-corpus declaration
 * search located as `<name>:` inside an ADMITTED `.css` file the analyzer was handed. All 8
 * are in one file, `dbeaver/plugins/org.jkiss.dbeaver.ui.ai/web/styles.css`, and the reason
 * is structural rather than a naming collision:
 *
 *     :root {
 *         --background-color: {{BACKGROUND_COLOR}};
 *         --background-color-inactive: {{BACKGROUND_COLOR_INACTIVE}};
 *         ... 12 more
 *     }
 *
 * `tree-sitter-css` has no production for `{{`. It parses `--background-color: {{X}};` as a
 * NESTED `rule_set` — `selectors/tag_name = "--background-color"`, an `ERROR` holding `: {`,
 * and a nested `block` — and that nested rule_set consumes the closing brace, so the
 * enclosing `:root` block ends there. MEASURED on that file: 188 reported parse errors,
 * 3 published symbols, 1 of the 14 custom properties, and the published `--background-color`
 * is a `type`-kind symbol named after a SELECTOR — the declaration was read as a rule.
 *
 * That is the general shape worth measuring: a templated value ends the block it is in. This
 * probe counts the population (admitted files containing a `{{`, `<%` or `${` placeholder),
 * then measures the cost per file — reported parse errors, published symbols, custom
 * properties declared in the source versus published by the analyzer, and whether the first
 * templated declaration was published as a `type`-kind symbol instead of a `variable`.
 *
 * ## What it can and cannot fix
 *
 * The grammar cannot represent `{{`, so the lost declarations are not in the tree as
 * `declaration` nodes and no tree walk recovers them. The analyzer CAN however stop
 * publishing the misread: a `rule_set` whose sole selector is a `tag_name` beginning `--`
 * is a declaration that the grammar misread as a rule, and publishing it as `type` asserts
 * a nested rule that does not exist. This probe measures that population so the choice is
 * made on numbers rather than on one file.
 *
 * ## ZERO REGEX
 *
 * `hasPlaceholder` reads `charCodeAt` over the two-character and three-character openings
 * and the two-character closing. No regex.
 *
 * ## READ-ONLY. Writes nothing unless --json is given.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const jsonAt = argv.indexOf("--json")
const JSON_OUT = jsonAt >= 0 ? String(argv[jsonAt + 1]) : ""

/** True when `s` contains a template placeholder opening. charCode only. */
function hasPlaceholder(s: string): boolean {
  for (let i = 0; i < s.length - 1; i++) {
    const a = s.charCodeAt(i)
    const b = s.charCodeAt(i + 1)
    if (a === 123 /* { */ && b === 123) return true // {{
    if (a === 60 /* < */ && b === 37 /* % */) return true // <%
    if (a === 36 /* $ */ && b === 123) return true // ${
  }
  return false
}

/** Count `--name:` declaration openings in `s`. charCode only; a source-level census, not
 *  an analyzer read — the analyzer's own count comes from the parse below. */
function countDeclaredCustomProperties(s: string): number {
  const names = new Set<string>()
  for (let i = 0; i + 1 < s.length; i++) {
    if (s.charCodeAt(i) !== 45 /* - */ || s.charCodeAt(i + 1) !== 45) continue
    let j = i + 2
    let name = ""
    while (j < s.length) {
      const c = s.charCodeAt(j)
      const ok = (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45 || c === 95
      if (!ok) break
      name += s[j]
      j++
    }
    if (name.length === 0) continue
    // Skip the colon inside a comment or a string would need a lexer; instead require the
    // opening `--` to be at the start of a line or preceded by whitespace or `{`, which is
    // where a declaration can begin. Anything else is a mention inside a value.
    const prev = i > 0 ? s.charCodeAt(i - 1) : 32
    const atLineStart = prev === 32 || prev === 9 || prev === 123 || prev === 10 || prev === 13 || prev === 59
    if (!atLineStart) continue
    let k = j
    while (k < s.length && (s.charCodeAt(k) === 32 || s.charCodeAt(k) === 9)) k++
    if (s.charCodeAt(k) !== 58 /* : */) continue
    names.add(name)
    i = j
  }
  return names.size
}

/** Names of the custom properties `s` declares, by the same charCode walk. */
function declaredNames(s: string): Set<string> {
  const names = new Set<string>()
  for (let i = 0; i + 1 < s.length; i++) {
    if (s.charCodeAt(i) !== 45 || s.charCodeAt(i + 1) !== 45) continue
    let j = i + 2
    let name = ""
    while (j < s.length) {
      const c = s.charCodeAt(j)
      const ok = (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45 || c === 95
      if (!ok) break
      name += s[j]
      j++
    }
    if (name.length === 0) continue
    const prev = i > 0 ? s.charCodeAt(i - 1) : 32
    const atLineStart = prev === 32 || prev === 9 || prev === 123 || prev === 10 || prev === 13 || prev === 59
    if (!atLineStart) continue
    let k = j
    while (k < s.length && (s.charCodeAt(k) === 32 || s.charCodeAt(k) === 9)) k++
    if (s.charCodeAt(k) !== 58) continue
    names.add(name)
    i = j
  }
  return names
}

// ---------------------------------------------------------------- corpus walk

type File = { repo: string; rel: string; abs: string; text: string }
const every: File[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "css") continue
    if (!hasPlaceholder(text)) continue
    every.push({ repo: e, rel, abs, text })
  }
}

console.log(`admitted css files containing a template placeholder: ${every.length}`)

let totalErrors = 0
let totalSymbols = 0
let totalDeclared = 0
let totalPublished = 0
let filesLosingProperties = 0
let filesWithMisreadRule = 0
let degraded = 0
const parseFailures: string[] = []
const rows: unknown[] = []

for (const f of every) {
  let r: any
  try {
    r = await parseFile(f.abs, path.dirname(f.abs))
  } catch (e) {
    parseFailures.push(`${f.abs}: ${(e as Error)?.message ?? e}`)
    continue
  }
  if (!r) {
    parseFailures.push(`${f.abs}: no result`)
    continue
  }
  if (r.fallback === true) degraded++
  const errors = Array.isArray(r.errors) ? r.errors.length : 0
  const syms = Array.isArray(r.symbols) ? r.symbols : []
  const rels = Array.isArray(r.relationships) ? r.relationships : []
  totalErrors += errors
  totalSymbols += syms.length

  const declared = declaredNames(f.text)
  const publishedVars = new Set<string>()
  let misread = 0
  for (const s of syms) {
    const name = String(s?.name ?? "")
    const kind = String(s?.kind ?? "")
    if (kind === "variable" && name.startsWith("--")) publishedVars.add(name)
    // A `type`-kind symbol whose name begins `--` is a DECLARATION the grammar read as a
    // nested rule: there is no such selector in CSS, so publishing it asserts a rule.
    if (name.startsWith("--") && kind !== "variable") misread++
  }
  totalDeclared += declared.size
  totalPublished += publishedVars.size
  if (declared.size > publishedVars.size) filesLosingProperties++
  if (misread > 0) filesWithMisreadRule++
  if (declared.size > 0 || errors > 0) {
    rows.push({
      file: `${f.repo}/${f.rel}`,
      bytes: f.text.length,
      errors,
      symbols: syms.length,
      relationships: rels.length,
      declaredCustomProperties: declared.size,
      publishedCustomProperties: publishedVars.size,
      misreadAsRule: misread,
      missingNames: [...declared].filter((n) => !publishedVars.has(n)).slice(0, 8),
    })
  }
}

console.log(`parsed ${rows.length} of ${every.length} | failures ${parseFailures.length} | degraded ${degraded}`)
console.log(`reported parse errors ${totalErrors} | symbols ${totalSymbols} | rels per file avg ${rows.length ? (totalSymbols / rows.length).toFixed(1) : "n/a"}`)
console.log(`custom properties declared in source ${totalDeclared} | published as variable ${totalPublished}`)
console.log(`files LOSING at least one custom property: ${filesLosingProperties} of ${rows.length}`)
console.log(`files publishing a declaration AS A RULE (kind != variable, name starts --): ${filesWithMisreadRule} of ${rows.length}`)
console.log("")
const worst = [...rows].sort((a: any, b: any) => b.errors - a.errors).slice(0, 20)
console.log("worst 20 by reported parse errors:")
for (const w of worst) {
  console.log(`  ${String(w.errors).padStart(6)} err  syms ${String(w.symbols).padStart(4)}  --props ${w.declaredCustomProperties}->${w.publishedCustomProperties}  misread ${w.misreadAsRule}  ${w.file}`)
  if (w.missingNames.length > 0) console.log(`        missing: ${w.missingNames.join(" ")}`)
}

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({
    tool: "css-templated-recovery",
    corpusRoot: CR,
    admission: "git-tracked, real dir, <=512KB, detectLanguageFromPath(abs,text)==='css', contains a {{ / <% / ${ placeholder",
    admittedWithPlaceholder: every.length,
    parsed: rows.length,
    parseFailures: parseFailures.length,
    degraded,
    reportedParseErrors: totalErrors,
    symbols: totalSymbols,
    customPropertiesDeclaredInSource: totalDeclared,
    customPropertiesPublishedAsVariable: totalPublished,
    filesLosingProperties,
    filesWithMisreadRule,
    files: rows,
  }, null, 2))
  console.log(`wrote ${JSON_OUT}`)
}