/**
 * M60 / M19 — every VOCABULARY DECLARATION must be reported on the line its
 * NAME is written on.
 *
 * The rule this exists to check is one line long: a symbol or a `contains` edge
 * whose target is a declared name carries that name's line, so that searching
 * the file for the name finds the reported line. XML makes that non-trivial
 * because a declaration's name lives in an ATTRIBUTE, and a formatted document
 * routinely puts the attribute on a different line from the tag:
 *
 *     <xsl:with-param          <- line 632, what the analyzer used to report
 *         name="content"      <- line 633, where the name is actually written
 *         select="…"/>
 *
 * A reader following either the symbol or the edge to line 632 lands on the
 * tag, not the name. Measured over the 2,500-file blast radius this gate
 * covers: 4 of 19,852 declarations, in two files — small, and small is not the
 * point. The point is that it was invisible to every other instrument, because
 * each of them asks the analyzer a question it can answer correctly while the
 * LINE is wrong, and the differential compares label+target only, never the
 * line.
 *
 * The check is deliberately narrow, and the narrowness is the finding rather
 * than a limitation:
 *
 *   - it reads the ANALYZER's own output, so it cannot tell a wrong line from a
 *     right one by agreement with anything — it goes back to the source text;
 *   - it only considers symbols carrying `isVocabDeclaration`, because that is
 *     the one case where the tag and the name are known to be different things.
 *     An ordinary element's tag IS its name and its tag line is correct, so
 *     widening the rule to "every symbol's line must contain its name" would
 *     fail on multi-line elements for the same reason and would be measuring the
 *     wrong invariant.
 *
 * Usage:
 *   npx tsx script/m12/xml-declared-name-lines.mts [--repos DIR] [--json]
 * Exit 0 when the census is clean, 1 when any declaration is mis-anchored.
 */
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..")
const DEFAULT_REPOS = process.env.XML_CORPUS_ROOT ?? "$HOME/fixtures/xml/repos"
const MAX_BYTES = Number(process.env.XML_MAX_BYTES ?? 2_000_000)

const EXTS = new Set([".xml", ".xsd", ".dtd", ".xsl", ".xslt", ".svg", ".rng"])

interface Offender {
  file: string
  line: number
  name: string
  declarationKind: string
  via: "symbol" | "edge"
  nameIsOnLine: number
  reportedLineText: string
}

function collect(dir: string, out: string[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === ".git") continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collect(full, out)
    else if (EXTS.has(path.extname(e.name).toLowerCase())) out.push(full)
  }
}

/**
 * True when `line` writes a `name=` attribute whose value is `name`.
 *
 * Three things this has to get right, each of which produced a false finding
 * when the matcher was stricter, and a gate that cries wolf is not a gate:
 *
 *   - whitespace around `=`. docx4j's `xslfo/fop.xsd` writes
 *     `<attributeGroup name = "block_properties">`, and a matcher that only
 *     accepted `name="x"` reported all 38 of its declarations as mis-anchored.
 *   - whitespace INSIDE the value. libxml2's `relaxng/OASIS/spectest.xml:2596`
 *     writes `name=" xmlns"` — a leading space the analyzer trims, per XSD's
 *     value normalization, before publishing `xmlns`. The anchor on 2596 is
 *     correct; a matcher that searched for `name="xmlns"` did not find it there
 *     and went looking, and found an UNRELATED `<attribute name="xmlns">` twelve
 *     lines down at 2608. That is the failure mode to fear most in a line gate:
 *     it reports a real-looking file and line for a defect that is not there.
 *   - regex metacharacters in the declared name. Built by escaping, and compared
 *     against the trimmed value, never interpolated raw.
 *
 * Returns true if ANY name attribute on the line carries the value, since a line
 * may legitimately spell more than one.
 */
function lineCarriesName(line: string, name: string): boolean {
  const re = /\bname\s*=\s*("([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    const value = (m[2] ?? m[3] ?? "").trim()
    if (value === name) return true
  }
  // The value may also be on a CONTINUATION line, which is the case M19 exists
  // for:
  //
  //     <xsd:element name=
  //         "InvalidModificationFault"
  //
  // Here line 233 carries the `name=` keyword and 234 carries the string. The
  // analyzer reports 234 — the line the name is actually written on, which is
  // the point of the gate — and 234 holds a BARE quoted value with no `name=`
  // on it, so the loop above cannot match it. A line that is exactly one
  // attribute value is the continuation of a declaration begun on an earlier
  // line, and the bare value is that declaration's name.
  //
  // Restricted to a line that is ENTIRELY the quoted value, so this cannot
  // manufacture a match on a line that merely mentions the name in prose or in
  // some other attribute's value.
  const bare = line.trim().match(/^(?:"([^"]*)"|'([^']*)')[,;\s]*$/)
  if (bare) {
    const value = (bare[1] ?? bare[2] ?? "").trim()
    if (value === name) return true
  }
  return false
}

function firstLineCarrying(lines: string[], name: string, from: number): number {
  for (let i = from; i < lines.length; i++) if (lineCarriesName(lines[i], name)) return i + 1
  return -1
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const reposArg = argv.indexOf("--repos")
  const reposRoot = reposArg >= 0 ? argv[reposArg + 1] : DEFAULT_REPOS
  const asJson = argv.includes("--json")

  if (!fs.existsSync(reposRoot)) {
    console.error(`xml-declared-name-lines: corpus root absent: ${reposRoot}`)
    console.error("  set --repos <dir> or XML_CORPUS_ROOT")
    process.exit(1)
  }

  const wts: any = await import("web-tree-sitter")
  const Parser = wts.Parser ?? wts.default?.Parser ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-xml.wasm")))
  const { RealXmlAnalyzer } = await import(path.join(ROOT, "src/ast/real-xml-analyzer"))

  const files: string[] = []
  collect(reposRoot, files)
  files.sort()

  const parser = new Parser()
  parser.setLanguage(grammar)
  const analyzer: any = new RealXmlAnalyzer()

  const offenders: Offender[] = []
  let declarations = 0
  let parsed = 0
  let unreadable = 0

  for (const file of files) {
    let content: string
    try {
      const st = fs.statSync(file)
      if (st.size > MAX_BYTES) continue
      content = fs.readFileSync(file, "utf8")
    } catch {
      unreadable++
      continue
    }
    let tree: any
    try {
      tree = parser.parse(content)
    } catch {
      continue
    }
    if (!tree?.rootNode) continue
    parsed++

    let result: any
    try {
      result = await analyzer.analyze(tree.rootNode, content, path.relative(reposRoot, file))
    } catch {
      continue
    }
    const lines = content.split("\n")

    for (const sym of result.symbols ?? []) {
      if (!sym.metadata?.isVocabDeclaration) continue
      declarations++
      const line = sym.range?.startLine ?? 0
      const name = String(sym.name)
      if (line >= 1 && line <= lines.length && lineCarriesName(lines[line - 1], name)) continue
      const real = firstLineCarrying(lines, name, Math.max(0, line - 1))
      offenders.push({
        file: path.relative(reposRoot, file),
        line,
        name,
        declarationKind: String(sym.metadata?.declarationKind ?? "?"),
        via: "symbol",
        nameIsOnLine: real,
        reportedLineText: (lines[line - 1] ?? "").trim().slice(0, 100),
      })
    }

    for (const edge of result.relationships ?? []) {
      if (edge.type !== "contains") continue
      if (!edge.metadata?.declarationKind) continue
      declarations++
      const line = Number(edge.line_number ?? 0)
      const name = String(edge.target)
      if (line >= 1 && line <= lines.length && lineCarriesName(lines[line - 1], name)) continue
      const real = firstLineCarrying(lines, name, Math.max(0, line - 1))
      offenders.push({
        file: path.relative(reposRoot, file),
        line,
        name,
        declarationKind: String(edge.metadata?.declarationKind ?? "?"),
        via: "edge",
        nameIsOnLine: real,
        reportedLineText: (lines[line - 1] ?? "").trim().slice(0, 100),
      })
    }
  }

  const report = {
    corpusRoot: reposRoot,
    filesConsidered: files.length,
    filesParsed: parsed,
    filesUnreadable: unreadable,
    declarationsChecked: declarations,
    misanchored: offenders.length,
    offenders: offenders.slice(0, 40),
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`xml declared-name lines: ${files.length} file(s), ${parsed} parsed, ${declarations} declaration anchor(s) checked`)
    if (offenders.length === 0) {
      console.log(`  OK — every declaration is reported on the line its name is written on (0 of ${declarations} mis-anchored)`)
    } else {
      console.log(`  ${offenders.length} MIS-ANCHORED of ${declarations}:`)
      for (const o of offenders.slice(0, 25)) {
        console.log(`    ${o.via.padEnd(6)} ${o.file}:${o.line}  ${o.declarationKind} "${o.name}" (name is on line ${o.nameIsOnLine})`)
        console.log(`      reported line reads: ${o.reportedLineText}`)
      }
      if (offenders.length > 25) console.log(`    … and ${offenders.length - 25} more`)
    }
  }

  process.exit(offenders.length === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
