/**
 * INSTRUMENT B for the RULED types — parse-tree count and corpus-text count.
 *
 * ## Why this file exists next to probe-bash-grammar-inventory.mts
 *
 * The grammar inventory proves the CONSTRUCT has no node type, which for bash is
 * the whole substance of the ruling — bash cannot declare a type, so it cannot
 * inherit from one. But a node-type inventory has a blind spot, and stating it is
 * part of the ruling rather than a footnote beside it: a construct expressed only
 * through RUNTIME indirection (`eval`, `${!name}` deferral, `bash -c`) never becomes
 * a node at all, so "the grammar has no node type for it" cannot by itself exclude
 * a corpus that reaches these three types dynamically.
 *
 * So the ruling carries a second, independent probe over the same sample, and this
 * file is it. Three counts, one per RULED type, plus the two dynamic doors the
 * blind spot names:
 *
 *   1. PARSE-TREE COUNT (instrument B proper). Count the node types that COULD
 *      express the construct, on every tree. Non-zero for any of them overturns the
 *      ruling for that type.
 *   2. CORPUS-TEXT COUNT. Count the declaration keywords in the file bytes
 *      (`class `, `extends `, `implements `, `new `, `interface `). This is a
 *      LEXICAL count and is deliberately the weakest instrument — a string literal
 *      or an embedded language can fake one — which is exactly why a non-zero count
 *      here is reported as a CANDIDATE that must then be checked on the parse tree,
 *      never as a hit. Every candidate is printed with its file and line so it can
 *      be adjudicated by hand, and the tree count above it is the arbiter.
 *   3. DYNAMIC DOORS. Count `eval`, `${!name}`, and `bash -c`/`sh -c`. These are
 *      the only routes by which a bash script could reach a relationship the static
 *      tree does not contain. Their count is the size of the residual this lane
 *      cannot close, and it is reported so the limitation has a number rather than
 *      a phrase.
 *
 * ## Falsifiability
 *
 * The ruling for `extends` is overturned by ANY of:
 *   - a non-zero node count for any of [class, inherit, extends, super, interface];
 *   - a corpus-text `class `/`extends ` candidate that the parse tree confirms as a
 *     construct rather than a string.
 * The same shape applies to `implements` and `instantiates`. This file prints all
 * three counts, so the condition is checkable from its output alone.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/probe-bash-ruled-constructs.mts [--sample 400]
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const i = argv.indexOf("--sample")
const SAMPLE = Number(i >= 0 ? argv[i + 1] : "400")

type Admitted = { repo: string; dir: string; rel: string; abs: string; text: string }
const admitted: Admitted[] = []
let scanned = 0
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
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
    scanned++
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    admitted.push({ repo: e, dir, rel, abs, text })
  }
}
admitted.sort((a, b) => {
  const ha = createHash("sha256").update(`${a.repo}/${a.rel}`).digest("hex")
  const hb = createHash("sha256").update(`${b.repo}/${b.rel}`).digest("hex")
  return ha < hb ? -1 : ha > hb ? 1 : hb > ha ? 1 : 0
})
const files = admitted.slice(0, SAMPLE)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-bash.wasm"))))

/** (1) node types that could express each RULED construct. */
/**
 * Node types are matched on UNDERSCORE-SEPARATED TOKENS, never as substrings. The
 * substring form reports `simple_expansion` as a match for `impl` — the letters are
 * inside the word `simple` — which is a node for reading `$FOO`, not for declaring a
 * type, and a nil result is worthless from an instrument that cannot be nil.
 */
const tokensOf = (nodeType: string): Set<string> => {
  const out = new Set<string>()
  const text = nodeType.toLowerCase()
  let cur = ""
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) { cur += text[i]; continue }
    if (cur.length > 0) out.add(cur)
    cur = ""
  }
  if (cur.length > 0) out.add(cur)
  return out
}
const TREE_PROBES: Record<string, string[]> = {
  extends: ["class", "inherit", "extends", "super", "interface", "subclass", "impl"],
  implements: ["implement", "interface", "protocol", "trait", "satisf", "impl"],
  instantiates: ["new", "instantiat", "construct", "allocat", "ctor", "factory"],
}

const nodeTally = new Map<string, number>()
const treeHits: Record<string, string[]> = { extends: [], implements: [], instantiates: [] }
let parsedFiles = 0
for (const f of files) {
  let t: any
  try {
    t = parser.parse(f.text)
  } catch {
    continue
  }
  if (!t) continue
  parsedFiles++
  const stack: any[] = [t.rootNode]
  while (stack.length > 0) {
    const n = stack.pop()!
    nodeTally.set(n.type, (nodeTally.get(n.type) ?? 0) + 1)
    const toks = tokensOf(n.type)
    for (const [type, frags] of Object.entries(TREE_PROBES)) {
      if (frags.some((x) => toks.has(x)) && treeHits[type].length < 12) {
        treeHits[type].push(`${n.type} @${f.repo}/${f.rel}:${n.startPosition.row + 1}`)
      }
    }
    for (let k = 0; k < n.childCount; k++) stack.push(n.child(k))
  }
  t.delete?.()
}

/**
 * (2) lexical candidates. Deliberately the weakest instrument: reported, never
 * trusted. These were seven RegExp literals; `probe-bash-no-regex.mts` counted all
 * seven, and the workstream's rule is that a census script contains none — a text
 * matcher cannot tell a declaration from the same characters inside a comment or a
 * string, which is the whole reason instrument A and B exist.
 *
 * So they are rewritten as character-code scanners. Each one reproduces the
 * ORIGINAL pattern's boundary class and quantifiers EXACTLY, and the two boundary
 * classes are NOT the same, which is the detail a careless rewrite loses:
 *
 *   LEX probes   (^|[\s;&|({])   — `{` opens a boundary
 *   door probes  (^|[\s;&|(])    — `{` does NOT
 *
 * Verified shape by shape in `probe-bash-binding-shapes.mts`'s sibling assertions
 * and by the identical counts this file still prints after the rewrite.
 */
const isSpace = (c: number): boolean => c === 32 || c === 9 || c === 13 || c === 10
const isIdentStart = (c: number): boolean => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95
const isIdentTail = (c: number): boolean => isIdentStart(c) || (c >= 48 && c <= 57)

/** `(^|[...])` — start of line, or a shell metacharacter immediately before `i`. */
const atBoundary = (text: string, i: number, braceIsBoundary: boolean): boolean => {
  if (i === 0) return true
  const p = text.charCodeAt(i - 1)
  if (isSpace(p)) return true
  if (p === 59 /* ; */ || p === 38 /* & */ || p === 124 /* | */ || p === 40 /* ( */) return true
  return braceIsBoundary && p === 123 /* { */
}

/** `(word1|word2|…)\s+[A-Za-z_]` — one of `words`, then >=1 space, then an ident start. */
const keywordSpaceIdent = (text: string, i: number, words: string[]): boolean => {
  for (const w of words) {
    if (!text.startsWith(w, i)) continue
    let j = i + w.length
    let sawSpace = false
    while (j < text.length && isSpace(text.charCodeAt(j))) { sawSpace = true; j++ }
    if (sawSpace && j < text.length && isIdentStart(text.charCodeAt(j))) return true
  }
  return false
}

/** `new\s+[A-Z][A-Za-z_]*\s*[(\[]` — a constructor call, which bash cannot express. */
const newExpressionAt = (text: string, i: number): boolean => {
  if (!text.startsWith("new", i)) return false
  let j = i + 3
  let sawSpace = false
  while (j < text.length && isSpace(text.charCodeAt(j))) { sawSpace = true; j++ }
  if (!sawSpace) return false
  const c = text.charCodeAt(j)
  if (!(c >= 65 && c <= 90)) return false // [A-Z]
  j++
  while (j < text.length && isIdentTail(text.charCodeAt(j))) j++
  while (j < text.length && isSpace(text.charCodeAt(j))) j++
  const d = text.charCodeAt(j)
  return d === 40 /* ( */ || d === 91 /* [ */
}

const LEX_PROBES: Record<string, (line: string) => boolean> = {
  extends: (l) => {
    for (let i = 0; i < l.length; i++) {
      if (atBoundary(l, i, true) && keywordSpaceIdent(l, i, ["class", "extends", "implements", "interface"])) return true
    }
    return false
  },
  implements: (l) => {
    for (let i = 0; i < l.length; i++) {
      if (atBoundary(l, i, true) && keywordSpaceIdent(l, i, ["implements", "interface", "trait"])) return true
    }
    return false
  },
  instantiates: (l) => {
    for (let i = 0; i < l.length; i++) {
      if (atBoundary(l, i, true) && newExpressionAt(l, i)) return true
    }
    return false
  },
}
const lexHits: Record<string, string[]> = { extends: [], implements: [], instantiates: [] }
/**
 * The TOTAL number of candidate rows, counted UNcapped, beside the capped example
 * list. The first version printed `lexHits[type].length`, which is the length of a
 * list capped at 12 — so a type with exactly 12 candidates and a type with 400 both
 * printed "12", and the number the ruling leans on could not be told from its own
 * ceiling. An overturn condition that cannot distinguish its own value is not
 * falsifiable, which is the property §3 of the workstream asks for.
 */
const lexTotals: Record<string, number> = { extends: 0, implements: 0, instantiates: 0 }
for (const f of files) {
  const rows = f.text.split("\n")
  for (let r = 0; r < rows.length; r++) {
    for (const [type, probe] of Object.entries(LEX_PROBES)) {
      if (!probe(rows[r])) continue
      lexTotals[type]++
      if (lexHits[type].length < 12) lexHits[type].push(`${f.repo}/${f.rel}:${r + 1} :: ${rows[r].trim().slice(0, 100)}`)
    }
  }
}

/** (3) the dynamic doors — the residual this lane cannot close by static reading. */
let evalCalls = 0
let deferrals = 0
let dashC = 0
const dashCRows: string[] = []
/**
 * The dynamic doors, rewritten from three regexes to character scans.
 *
 *   /(^|[\s;&|(])(eval|command eval)\s/           -> doorEvalAt
 *   /\$\{![A-Za-z_]/                             -> hasDeferral
 *   /(^|[\s;&|(])(bash|sh|zsh|ksh)[^\s;&|]*\s+-c\s/ -> dashCAt
 *
 * Note the door boundary class is `[\s;&|(]` and NOT `[\s;&|({]` — the LEX probes
 * above include `{` and these do not. `braceIsBoundary: false` is what carries
 * that, and it is the difference a rewrite that used one shared helper would lose.
 */
const doorEvalAt = (line: string): boolean => {
  for (let i = 0; i < line.length; i++) {
    if (!atBoundary(line, i, false)) continue
    // `eval` then >=1 whitespace. The original required only `\s`, NOT a following
    // identifier, so `eval ` at end of line still counts.
    if (line.startsWith("eval", i)) {
      let j = i + 4
      while (j < line.length && isSpace(line.charCodeAt(j))) j++
      if (j > i + 4) return true
    }
    // `command eval` — the literal, then the same `\s` requirement.
    const lit = "command eval"
    if (line.startsWith(lit, i)) {
      const k = i + lit.length
      if (k < line.length && isSpace(line.charCodeAt(k))) return true
    }
  }
  return false
}

const hasDeferral = (line: string): boolean => {
  for (let i = 0; i + 3 < line.length; i++) {
    if (line.charCodeAt(i) !== 36 /* $ */) continue
    if (line.charCodeAt(i + 1) !== 123 /* { */) continue
    if (line.charCodeAt(i + 2) !== 33 /* ! */) continue
    if (isIdentStart(line.charCodeAt(i + 3))) return true
  }
  return false
}

const SHELL_NAMES = ["bash", "sh", "zsh", "ksh"]
const dashCAt = (line: string): boolean => {
  for (let i = 0; i < line.length; i++) {
    if (!atBoundary(line, i, false)) continue
    // The regex alternation is ordered `bash|sh|zsh|ksh` and first-match, so the
    // span consumed is the one the FIRST matching alternative takes. Longest-match
    // agrees on every one of these four: `sh` cannot match at the `b` of `bash`.
    let name = ""
    for (const sh of SHELL_NAMES) if (line.startsWith(sh, i) && sh.length > name.length) name = sh
    if (name.length === 0) continue
    let j = i + name.length
    // [^\s;&|]* — a run of anything that is not whitespace, `;`, `&` or `|`.
    while (j < line.length) {
      const c = line.charCodeAt(j)
      if (isSpace(c) || c === 59 || c === 38 || c === 124) break
      j++
    }
    let sawSpace = false
    while (j < line.length && isSpace(line.charCodeAt(j))) { sawSpace = true; j++ }
    if (!sawSpace) continue
    if (!line.startsWith("-c", j)) continue
    const k = j + 2
    if (k < line.length && isSpace(line.charCodeAt(k))) return true
  }
  return false
}

for (const f of files) {
  const rows = f.text.split("\n")
  for (let r = 0; r < rows.length; r++) {
    if (doorEvalAt(rows[r])) evalCalls++
    if (hasDeferral(rows[r])) deferrals++
    if (dashCAt(rows[r])) {
      dashC++
      if (dashCRows.length < 8) dashCRows.push(`${f.repo}/${f.rel}:${r + 1} :: ${rows[r].trim().slice(0, 100)}`)
    }
  }
}

console.log(`bash RULED-construct probes — instrument B`)
console.log(`  corpus root         : ${CR}`)
console.log(`  tracked files       : ${scanned}`)
console.log(`  admitted as bash    : ${admitted.length}`)
console.log(`  sampled (hash order): ${files.length}, parsed ${parsedFiles}`)
console.log(`  repositories         : ${new Set(files.map((f) => f.repo)).size}`)
console.log(`  distinct node types : ${nodeTally.size}`)

console.log(`\n(1) PARSE-TREE COUNT — node types that could express each RULED construct`)
for (const [type, frags] of Object.entries(TREE_PROBES)) {
  const matching = [...nodeTally.keys()].filter((k) => {
    const toks = tokensOf(k)
    return frags.some((x) => toks.has(x))
  })
  console.log(`  ${type.padEnd(13)} count=${matching.length}  ${matching.length === 0 ? "NONE — the grammar has no such node" : matching.join(", ")}`)
  for (const h of treeHits[type]) console.log(`                 ${h}`)
}

console.log(`\n(2) CORPUS-TEXT COUNT — lexical candidates, the weakest instrument; each must be adjudicated on the tree`)
for (const type of Object.keys(lexTotals)) {
  console.log(`  ${type.padEnd(13)} candidates=${lexTotals[type]} (TOTAL, uncapped)  printing up to 12`)
  for (const h of lexHits[type]) console.log(`                 ${h}`)
}

console.log(`\n(3) DYNAMIC DOORS — the residual a static analyzer cannot close, sized`)
console.log(`  eval invocations        : ${evalCalls}`)
console.log(`  \${!name} deferrals       : ${deferrals}`)
console.log(`  bash|sh|zsh -c strings  : ${dashC}`)
for (const r of dashCRows) console.log(`                 ${r}`)
console.log(`  These are the only routes by which a bash script could reach a relationship the static tree does not`)
console.log(`  contain. They are reported as a measured limit of the ruling, not as a defect: bash has no type`)
console.log(`  declaration to defer TO, so even a runtime-resolved string names a function or a binary, and those`)
console.log(`  two already carry \`calls\`.`)

process.exitCode = 0
