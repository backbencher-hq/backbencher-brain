// CS-DEEP-12 — corpus FREQUENCY for the three convictions, with a corrected counter.
//
// cs-deep-11's counter was WRONG in the lane's favour: its pattern made the dotted
// prefix optional (`(\\.[A-Za-z_][A-Za-z0-9_]*)*`), so it counted PLAIN generics too and
// reported 3,072 occurrences in 729 files — a number that reads like a much bigger
// defect than it is. Requiring at least one dot is the difference between the shape and
// its working twin, and the number is the whole point of the measurement.
//
//   D1  a QUALIFIED generic in a declared-type position loses its type arguments
//   D2  a GENERIC attribute publishes no decorator (unqualified) / the whole generic
//       spelling (qualified)
//   D3  a `using` ALIAS whose target is a type EXPRESSION publishes the expression
//
// Every counter here is derived from the TEXT with no analyzer involved, so it is a
// frequency claim about real code, and each is printed with the exact pattern that
// produced it.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

/** A declaration line: modifiers, then a base with AT LEAST ONE dot, then `<`. */
const QUALIFIED_GENERIC_DECL = new RegExp(
  String.raw`(^|\n)[ \t]*((public|private|protected|internal|static|readonly|virtual|override|sealed|abstract|partial|new|const|extern|unsafe|async|file|required|volatile|ref|event)[ \t]+)+[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+<[^;={]*>`,
  "g",
)
/** The same shape with NO dot — the working twin, printed so the two are comparable. */
const PLAIN_GENERIC_DECL = new RegExp(
  String.raw`(^|\n)[ \t]*((public|private|protected|internal|static|readonly|virtual|override|sealed|abstract|partial|new|const|extern|unsafe|async|file|required|volatile|ref|event)[ \t]+)+[A-Za-z_][A-Za-z0-9_]*<[^;={]*>`,
  "g",
)
/** A generic attribute application: `[Name<...>]` or `[Ns.Name<...>]`. */
const GENERIC_ATTRIBUTE = /\[(?:global::)?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*<[^\]]*>\s*(\(|\])/g
/** A using alias whose target is a type expression: `using X = A.B<...>;` or `...[];`. */
const ALIAS_TYPE_EXPRESSION = /(^|\n)[ \t]*using[ \t]+(?:global[ \t]+)?(?:static[ \t]+)?[A-Za-z_][A-Za-z0-9_]*[ \t]*=[ \t]*(?:global::)?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*(?:<[^;]*>|\[[^\]]*\])[ \t]*;/g

async function main() {
  const listFile = arg("--list")
  if (!listFile) { console.error("usage: cs-deep-12-frequencies.ts --list <paths> [limit]"); process.exit(2) }
  const limit = Number(arg("--limit") ?? 1500)
  const files = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, limit)

  const c = { d1: 0, d1f: 0, plain: 0, plainf: 0, d2: 0, d2f: 0, d3: 0, d3f: 0 }
  const d1s: string[] = []
  const d2s: string[] = []
  const d3s: string[] = []
  let filesRead = 0

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    filesRead++
    QUALIFIED_GENERIC_DECL.lastIndex = 0
    const q = src.match(QUALIFIED_GENERIC_DECL)
    if (q) { c.d1 += q.length; c.d1f++; if (d1s.length < 10) for (const m of q.slice(0, 2)) d1s.push(`${path.basename(f)}: ${m.replace(/^[\s\S]*?\n/, "").trim().slice(0, 120)}`) }
    PLAIN_GENERIC_DECL.lastIndex = 0
    const p = src.match(PLAIN_GENERIC_DECL)
    if (p) { c.plain += p.length; c.plainf++ }
    GENERIC_ATTRIBUTE.lastIndex = 0
    const a = src.match(GENERIC_ATTRIBUTE)
    if (a) { c.d2 += a.length; c.d2f++; if (d2s.length < 10) d2s.push(`${path.basename(f)}: ${a[0].slice(0, 110)}`) }
    ALIAS_TYPE_EXPRESSION.lastIndex = 0
    const t = src.match(ALIAS_TYPE_EXPRESSION)
    if (t) { c.d3 += t.length; c.d3f++; if (d3s.length < 10) d3s.push(`${path.basename(f)}: ${t[0].replace(/^[\s\S]*?\n/, "").trim().slice(0, 120)}`) }
  }

  console.log(`files read: ${filesRead}\n`)
  console.log(`D1  qualified generic in a declared-type position : ${c.d1} occurrences in ${c.d1f} files`)
  console.log(`    (the working twin, a PLAIN generic          : ${c.plain} occurrences in ${c.plainf} files)`)
  console.log(`D2  generic attribute application               : ${c.d2} occurrences in ${c.d2f} files`)
  console.log(`D3  using alias whose target is a type expr     : ${c.d3} occurrences in ${c.d3f} files`)
  if (d1s.length) console.log(`\nD1 samples:\n   ${d1s.join("\n   ")}`)
  if (d2s.length) console.log(`\nD2 samples:\n   ${d2s.join("\n   ")}`)
  if (d3s.length) console.log(`\nD3 samples:\n   ${d3s.join("\n   ")}`)
}

if (import.meta.main) await main()
