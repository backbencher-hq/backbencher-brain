/**
 * JAVASCRIPT EMITTED-TARGET VALIDITY CENSUS — are the endpoints the analyzer publishes real names?
 *
 * WHY THIS EXISTS. The terminal guard at the end of `analyze` drops a row only when `source` or
 * `target` is EMPTY (`!r.source || !r.target`). That is the R7 rule as far as it goes. But a target
 * that is non-empty and still not a NAME — source text, a fragment, a path, a keyword, a stray
 * punctuator — cannot be resolved, hovered or followed either, and every consumer that counts names
 * gets a row for a name no file contains. The differential cannot see this class: it matches
 * label + normTarget, so a garbage target and a real one compare as two different strings and the row
 * reads as MISSING rather than as invalid.
 *
 * WHAT IT CHECKS, per emitted row, from the grammar rather than a regex where it can:
 *
 *   endpoint-is-name      source and target are each an IdentifierName shape (a `#`-prefixed private
 *                         name is a name; a dotted path is NOT — the store resolves by leaf, so a
 *                         dotted target is a different question and is counted separately)
 *   target-looks-like-text source-text callee: contains a bracket, a brace, an operator, whitespace,
 *                         or is longer than any identifier
 *   path-shaped           contains `/` or `\` (a path, not a symbol)
 *   dotted                contains `.` (may be legal for a qualified name — reported, not condemned)
 *   keyword-ish           target is a reserved word the language never binds
 *
 * The point is the SPLIT: a row whose target is not a name is a defect; a row whose target is dotted
 * is a naming question with a documented contract. Mixing them is how a lane declares a false gap.
 *
 * READ-ONLY. Writes one artifact under validation/m14/tmp/.
 *
 *   bun run script/m14/javascript-target-validity-census.ts --repo=<dir> [--sample=120] [--json=<out>]
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { ASTEngine } from "../../src/ast/engine"

const ROOT = process.cwd()
const SIZE_CAP = 512 * 1024

function argOf(flag: string): string | null {
  const argv = process.argv.slice(2)
  const i = argv.indexOf(flag)
  if (i >= 0) return argv[i + 1] ?? null
  const hit = argv.find((a) => a.startsWith(flag + "="))
  return hit ? hit.slice(flag.length + 1) : null
}

const REPO = argOf("--repo") ?? "/home/ishaq2321/bb_tests/repositories/svelte"
if (!existsSync(REPO)) {
  console.error(`target-validity: corpus not found at ${REPO} (pass --repo=<dir>)`)
  process.exit(2)
}
const SAMPLE = Number(argOf("--sample") ?? 120)
const JSON_OUT = argOf("--json")
const BINDING_SEP = "\u0000"

/** An ECMAScript IdentifierName, spelled without a regex library: start = letter/`_`/`$`, then
 *  letters/digits/`_`/`$`; optional leading `#` for a private name. */
function isIdentifierName(s: string): boolean {
  if (s.length === 0) return false
  let i = 0
  if (s.charCodeAt(0) === 35 /* # */) {
    i = 1
    if (s.length === 1) return false
  }
  for (; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const isLetter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
    const isDigit = c >= 48 && c <= 57
    const isStart = isLetter || c === 95 || c === 36
    if (i === 0 || (i === 1 && s.charCodeAt(0) === 35)) {
      if (!isStart) return false
    } else if (!isStart && !isDigit) {
      return false
    }
  }
  return true
}

/** true when the string is only separator/empty on one side — no name at all */
function hasBindingSepOnly(s: string): boolean {
  if (!s.includes(BINDING_SEP)) return false
  const parts = s.split(BINDING_SEP)
  return !parts.some((p) => p.length > 0)
}

/** reserved words a declaration can never bind, so a target equal to one names nothing */
const RESERVED = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do",
  "else", "export", "extends", "finally", "for", "function", "if", "import", "in", "instanceof",
  "let", "new", "return", "super", "switch", "this", "throw", "try", "typeof", "var", "void",
  "while", "with", "yield", "await", "enum", "null", "true", "false",
])

const tracked: string[] = execFileSync("git", ["-C", REPO, "ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 512 * 1024 * 1024,
}).split("\0").filter(Boolean)

const admitted: string[] = []
for (const rel of tracked) {
  const abs = path.join(REPO, rel)
  try {
    if (statSync(abs).size > SIZE_CAP) continue
    if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "javascript") continue
  } catch {
    continue
  }
  admitted.push(rel)
}
admitted.sort()
const stride = Math.max(1, Math.floor(admitted.length / SAMPLE))
const sample: string[] = []
for (let i = 0; i < admitted.length && sample.length < SAMPLE; i += stride) sample.push(admitted[i])

type Bad = {
  file: string
  line: number | null
  label: string
  source: string
  target: string
  why: string
}
const bad: Bad[] = []
const counts = {
  files: 0,
  rows: 0,
  emptyEndpoints: 0,
  nonNameTarget: 0,
  nonNameSource: 0,
  pathShaped: 0,
  importSpelling: 0,
  dotted: 0,
  keywordTarget: 0,
  longTarget: 0,
  withBindingSep: 0,
}

for (const rel of sample) {
  let src: string
  try {
    src = readFileSync(path.join(REPO, rel), "utf8")
  } catch {
    continue
  }
  let res: any
  try {
    res = await ASTEngine.parseFile(path.join(REPO, rel), src)
  } catch {
    continue
  }
  counts.files++

  for (const r of res.relationships ?? []) {
    const label = String(r.type ?? "")
    if (label === "") continue
    counts.rows++
    const source = String(r.source ?? "")
    const target = String(r.target ?? "")
    const md: any = r.metadata ?? {}

    if (source.length === 0 || target.length === 0) {
      counts.emptyEndpoints++
      if (bad.length < 40) {
        bad.push({ file: rel, line: r.line_number ?? null, label, source, target, why: "empty endpoint" })
      }
      continue
    }
    // a local-binding claim is `<callable> NUL <binding>`; the binding half is the name
    const hasSep = target.includes(BINDING_SEP) || source.includes(BINDING_SEP)
    if (hasSep) counts.withBindingSep++

    const t = target.includes(BINDING_SEP) ? (target.split(BINDING_SEP).pop() ?? "") : target
    const s = source.includes(BINDING_SEP) ? (source.split(BINDING_SEP).pop() ?? "") : source

    const tDotted = t.includes(".")
    const tPath = t.includes("/") || t.includes("\\")
    const tLong = t.length > 100
    // A RESERVED WORD IS NOT AUTOMATICALLY A DEFECT, and this is the part that needs the grammar
    // rather than a word list: `o.default`, `b.var()` and `b.new()` are all `property_identifier`
    // nodes, and a property may legally be spelled with a reserved word. The analyzer already
    // agrees — it reduces a member callee to its PROPERTY leaf and filters only the keywords it
    // reads as keywords (`super`, `import`). So a keyword target is a defect only when it did NOT
    // come from a property position, which the row's own metadata states (`calleeExpression`).
    const tKeywordCandidate = RESERVED.has(t)
    // A MEMBER PROPERTY may legally be spelled with a reserved word, and the row says when it is:
    // a member CALL names the property in `calleeExpression` (`b.var(...)` -> "b.var"), and a member
    // READ carries `isFieldAccess` + `receiverRoot` (`next.class`, `node.catch`, `b.true`). The
    // analyzer already agrees — it reduces a member callee to its PROPERTY leaf — so counting these
    // as defects would condemn legal syntax (measured: all three of svelte's remaining "keyword
    // targets" were `next.class`, `node.catch` and `b.true`).
    const fromPropertyPosition =
      (typeof md.calleeExpression === "string" && md.calleeExpression.endsWith(`.${t}`)) ||
      (md.isFieldAccess === true && typeof md.receiverRoot === "string" && md.receiverRoot.length > 0)
    // `exports -> default` is the ECMAScript default export, which IS the module's public name and
    // is legal precisely because `default` is a keyword: it cannot be imported by any other spelling.
    const isDefaultExport = label === "exports" && t === "default"
    const tKeyword = tKeywordCandidate && !fromPropertyPosition && !isDefaultExport
    const tName = isIdentifierName(t)
    const sName = isIdentifierName(s)

    // THE IMPORT SPELLING IS `<module>:<item>` BY DOCUMENTED CONTRACT (docs/analyzers/javascript.md:
    // "A LOCAL relative/absolute module's NAMED specifier targets the DECLARED name", `<module>:*`,
    // `<module>:<item>`). A colon is therefore the module/item separator, not a defect, and the
    // TARGET is deliberately not an IdentifierName. Judging it as one would condemn the lane's whole
    // imports surface — which is what the first cut of this census did (every one of its 178/71
    // "defects" was an imports or exports row). The store resolves these through the module-aware
    // resolver, not the name pass, so they are a different question from an unnameable target.
    const isImportSpelling = label === "imports" && target.includes(":")

    if (isImportSpelling) counts.importSpelling++
    else if (tPath) counts.pathShaped++
    else if (tDotted) counts.dotted++
    if (tLong) counts.longTarget++
    if (tKeyword) counts.keywordTarget++

    // a dotted target is a naming question, not automatically invalid: `Lib.Base` is a legal
    // qualified name the extends edge publishes. Report it separately.
    let why = ""
    if (isImportSpelling) why = "" // the module:item contract; never a defect
    else if (tPath) why = "path-shaped target"
    else if (!tName && !tDotted) why = "target is not an IdentifierName"
    else if (tLong) why = "target longer than any identifier"
    else if (tKeyword) why = "target is a reserved word"

    if (why) {
      counts.nonNameTarget++
      if (bad.length < 40) {
        bad.push({ file: rel, line: r.line_number ?? null, label, source, target, why })
      }
    }
    // A SOURCE IS ALLOWED MORE THAN AN IDENTIFIER: it may be the `(file)` family sentinel (a legal
    // module-level actor this lane publishes deliberately), a dotted module basename (`lodash.core`),
    // or a hyphenated module basename (`generate-types`) — the module name is a FILE STEM, not an
    // identifier. Only a source that is not name-shaped by ANY of those rules is a defect.
    const sLooksLegal =
      sName ||
      s === "(file)" ||
      (s.length > 0 && s.length <= 100 && !/[\s/\\]/.test(s) && !hasBindingSepOnly(s))
    if (!sLooksLegal) {
      counts.nonNameSource++
      if (bad.length < 40) {
        bad.push({ file: rel, line: r.line_number ?? null, label, source, target, why: "source is not a name (not an identifier, module stem, or (file) sentinel)" })
      }
    }
  }
}

console.log(`target-validity census — ${path.basename(REPO)}`)
console.log(`  admitted ${admitted.length}   sampled ${sample.length}   parsed ${counts.files}`)
console.log(`  rows examined            ${counts.rows}`)
console.log(`  empty endpoint           ${counts.emptyEndpoints}`)
console.log(`  target not a name        ${counts.nonNameTarget}`)
console.log(`  source not a name        ${counts.nonNameSource}`)
console.log(`  (of which) path-shaped   ${counts.pathShaped}`)
console.log(`  (of which) dotted        ${counts.dotted}   <- a naming question, not a defect`)
console.log(`  (of which) reserved word ${counts.keywordTarget}`)
console.log(`  (of which) >100 chars    ${counts.longTarget}`)
console.log(`  rows using BINDING_SEP   ${counts.withBindingSep}   <- the local-binding claim class`)

if (bad.length > 0) {
  console.log(`\n  examples:`)
  for (const b of bad.slice(0, 12)) {
    console.log(`    ${b.file}:${b.line ?? "?"} ${b.label} ${b.source} -> ${JSON.stringify(b.target)}  (${b.why})`)
  }
}

if (JSON_OUT) {
  mkdirSync(path.dirname(JSON_OUT), { recursive: true })
  writeFileSync(
    JSON_OUT,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        repo: REPO,
        admittedFiles: admitted.length,
        sampledFiles: sample.length,
        parseCleanFiles: counts.files,
        counts,
        note:
          "Emitted-endpoint validity, measured from the analyzer's own output. The terminal guard drops only EMPTY endpoints; this census asks whether a NON-EMPTY target is still a name. A dotted target is counted separately because `Lib.Base` is the legal qualified spelling the extends edge publishes — it is a naming question, not a defect.",
        examples: bad,
      },
      null,
      2,
    ),
  )
  console.log(`  artifact: ${JSON_OUT}`)
}