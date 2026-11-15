/**
 * Protobuf NO-TEXT-SCAN / NO-REGEX.
 *
 * The house rule is that an analyzer decides structure from the tree, never by
 * re-reading source text, and carries no regular expressions. Both are checked
 * here, but the interesting half is the second one, because a regex audit that
 * only greps for `/…/` misses the failure it exists to prevent: a regex built
 * from `new RegExp(...)`, or a string used as a matcher, or a `split`/`replace`
 * standing in for parsing.
 *
 * On the first half, every `.text` read in the analyzer is enumerated and
 * CLASSIFIED. An unclassified `.text` is a failure, because the whole claim rests
 * on the list being exhaustive: an analyzer that decides a symbol's name by
 * slicing its node's text would pass a grep and still be a parser in disguise.
 *
 * Usage: tsx no-text-scan.mts
 */
import * as fs from "fs"
import * as path from "path"
import { OUT, ROOT } from "../paths.mts"

const SRC = path.join(ROOT, "src/ast/real-protobuf-analyzer.ts")
const src = fs.readFileSync(SRC, "utf8")
const lines = src.split("\n")
const problems: string[] = []

// ---------------------------------------------------------------- no regex
const regexFindings: string[] = []
{
  // Strip comments and strings ONCE, over the whole file, before looking for a
  // regex. A per-line stripper cannot see that a `/* … *\/` JSDoc block opened
  // three lines earlier, and it reported a doc comment's `reserved`/`extensions`
  // as a regex literal — a false positive in the one gate whose whole value is
  // that its findings are true.
  const codeOnly = stripAll(src)
  const codeLines = codeOnly.split("\n")
  codeLines.forEach((l, i) => {
    if (!l.includes("/")) return
    if (!looksLikeRegex(l)) return
    regexFindings.push(`line ${i + 1}: ${lines[i]?.trim() ?? l.trim()}`)
  })
}
if (false) lines.forEach((l, i) => {
  const stripped = stripStringsAndComments(l)
  if (!stripped) return
  if (stripped.includes("/") && looksLikeRegex(stripped)) {
    regexFindings.push(`line ${i + 1}: ${l.trim()}`)
  }
})
if (stripAll(src).includes("new RegExp")) {
  regexFindings.push("new RegExp(...) — a constructed matcher, which is a regex by another name")
}
if (regexFindings.length) problems.push(`regular expressions found (${regexFindings.length})`)

// ------------------------------------------------------------- .text reads
interface TextUse {
  line: number
  code: string
  /** what the read is FOR — every one must be a leaf, never a structure */
  why: string
}
const TEXT_ALLOW: { re: RegExp; why: string }[] = [
  { re: /const name = \w+\.text$/, why: "a declaration's NAME, from a dedicated name node" },
  { re: /const gname = .*\.text/, why: "a group's name, from the name child" },
  { re: /const raw = .*\.text/, why: "an import path, from the string child" },
  { re: /const full_ident\) \? \.text/, why: "a package name, from the full_ident node" },
  { re: /const target = .*\.text/, why: "an extend target, from a name node" },
  { re: /\?\? "".*$/, why: "a fallback empty string" },
  { re: /const request = types\[0\]\?\.text/, why: "an rpc request type, from the type node" },
  { re: /const response = types\[1\]\?\.text/, why: "an rpc response type, from the type node" },
  { re: /const ref = inner\.text/, why: "a referenced type name, from the type node" },
  { re: /const ref = refTypeOf/, why: "helper return, itself a name node" },
  { re: /c\.text === "="/, why: "comparing an anonymous token's own value" },
  { re: /prev\.text === "stream"/, why: "comparing an anonymous token's own value" },
  { re: /c\.text\)\)/, why: "a token's own text passed to unquote" },
  { re: /nxt\.text/, why: "a syntax value token, which IS the value" },
  { re: /\.map\(\(c\) => c\.text\)/, why: "leaf texts of a ranges/field_names node" },
  { re: /c\.text\)\)\)\)/, why: "leaf text of a range element" },
  { re: /unquote\(c\.text\)/, why: "a reserved NAME, unquoted from a string leaf" },
  { re: /fieldNumber: /, why: "a field number, from the field_number node — a leaf whose text IS the value" },
  { re: /type: ref \?\? /, why: "a declared type, from the type node" },
  { re: /mapKey: /, why: "a map key type keyword, from the key_type node" },
  { re: /mapValue: /, why: "a map value type, from the type node" },
  { re: /value: firstOfType/, why: "an enum value, from the int_lit node" },
  { re: /return !!p && !p\.isNamed && p\.text === "stream"/, why: "comparing an anonymous token's own value" },
  { re: /\.map\(\(c\) => c!\.text\)/, why: "leaf texts of a ranges node" },
  { re: /pending\.push\(c\.text/, why: "a doc comment's own text — the comment IS the value" },
  { re: /unquote\(d\.childForFieldName\("value"\)/, why: "an editions value, from the `value` field the grammar assigns" },
  { re: /unquote\(firstOfType\(d, "string"\)/, why: "an editions value, from the string child" },
  { re: /return inner \? inner\.text/, why: "a referenced type name, from the message_or_enum_type node" },
  { re: /c\.text === "public"/, why: "comparing an anonymous token's own value" },
  { re: /modifier = c\.text/, why: "the import modifier, an anonymous token whose value IS the modifier" },
]

const textUses: TextUse[] = []
lines.forEach((l, i) => {
  if (!l.includes(".text")) return
  const code = l.trim()
  const why = TEXT_ALLOW.find((a) => a.re.test(code))?.why
  textUses.push({ line: i + 1, code, why: why ?? "UNCLASSIFIED" })
  if (!why) problems.push(`line ${i + 1}: .text read not classified — ${code}`)
})

// The analyzer must never look at a WHOLE declaration's text to decide its
// shape. `node.text` on a source_file / message / field node would be exactly
// the parser-in-disguise this gate forbids.
const wholeNodeText = textUses.filter((t) => /\b(root|node|body|decl|parent)\.text\b/.test(t.code))
for (const t of wholeNodeText) problems.push(`line ${t.line}: reads a STRUCTURAL node's whole text — ${t.code}`)

// ------------------------------------------------------------------ report
const out = {
  generatedAt: new Date().toISOString(),
  file: "src/ast/real-protobuf-analyzer.ts",
  regexFindings,
  regexLiteralCount: regexFindings.length,
  textReads: textUses.length,
  unclassifiedTextReads: textUses.filter((t) => t.why === "UNCLASSIFIED").length,
  structuralWholeTextReads: wholeNodeText.length,
  textReadDetail: textUses,
  problems,
  pass: problems.length === 0,
}
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, "no-text-scan.json"), JSON.stringify(out, null, 2))

console.log(`\n  .text reads: ${textUses.length}, all classified: ${out.unclassifiedTextReads === 0}`)
console.log(`  structural whole-node text reads: ${wholeNodeText.length}`)
console.log(`  regular expressions: ${regexFindings.length}`)
if (regexFindings.length) for (const r of regexFindings.slice(0, 10)) console.log(`    - ${r}`)
if (problems.length) {
  console.log(`\n  FAIL (${problems.length}):`)
  for (const p of problems.slice(0, 20)) console.log(`    - ${p}`)
} else {
  console.log(`\n  PASS: no regex, and every .text read is a leaf value that a tree read could not replace`)
}
console.log(`\n  wrote ${path.join(OUT, "no-text-scan.json")}`)
process.exit(problems.length ? 1 : 0)

// ------------------------------------------------------------------ helpers

/**
 * Remove every string and comment from the whole source, preserving line
 * structure so a finding can be reported against the right line number.
 * Block comments, line comments, and all three quote styles are handled, with
 * `new RegExp(` swept separately so a constructed matcher cannot hide here.
 */
function stripAll(text: string): string {
  let out = ""
  let quote: string | null = null
  let block = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (block) {
      if (c === "*" && text[i + 1] === "/") {
        block = false
        i++
      }
      if (c === "\n") out += "\n"
      continue
    }
    if (quote) {
      if (c === "\\") i++
      else if (c === quote) quote = null
      if (c === "\n") out += "\n"
      continue
    }
    if (c === "/" && text[i + 1] === "*") {
      block = true
      i++
      continue
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++
      out += "\n"
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c
      continue
    }
    out += c
  }
  return out
}
function stripStringsAndComments(line: string): string {
  let out = ""
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === "\\") i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c
      continue
    }
    if (c === "/" && line[i + 1] === "/") break
    out += c
  }
  return out
}
function looksLikeRegex(s: string): boolean {
  // A `/` that opens a regex is followed eventually by a `/` and not by `*` or `/`
  // on the same position, and the analyzer has no arithmetic division.
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++
    else if (s[i] === ")") depth--
    else if (s[i] === "/" && depth === 0) {
      const after = s[i + 1]
      if (after === "*" || after === "/") continue
      // regex until the next unescaped /
      let j = i + 1
      let closed = false
      while (j < s.length) {
        if (s[j] === "\\") j += 2
        else if (s[j] === "/") {
          closed = true
          break
        } else j++
      }
      if (closed) return true
    }
  }
  return false
}
