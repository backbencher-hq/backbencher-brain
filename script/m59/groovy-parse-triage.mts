// Parse-error triage for the groovy corpus: rank the failures by NORMALISED SIGNATURE
// so the next grammar fix is chosen by how much corpus weight it removes, not by which
// file happened to be read first.
//
// Why signatures, and not counts: "218 files fail" does not say what to work on. Two
// clusters can differ by 1 error each and still be the same defect, and a cluster of 1
// file with 42 errors is worth more attention than 42 files with 1 error each. The
// signature is built from the source around the FIRST error, with identifiers and
// literals collapsed, so the same defect groups regardless of the names involved.
//
// The template population is separated out and reported, not silently dropped: the
// declared `excludeDirs` in the lane audit already carves out scaffolding templates, and
// mixing them into a grammar-fix ranking would send the next round after a defect that is
// not in the grammar.
//
// Usage: tsx script/m59/groovy-parse-triage.mts [--top N]
import * as fs from "node:fs"
import { execSync } from "node:child_process"

const REPO = "$HOME/backbencher-brain"
const CORPUS = process.env.GROOVY_CORPUS ?? "$HOME/fixtures/xml/repos/grails-core"

// Same roots the lane audit declares as non-source, and matched the SAME way: by
// substring, against the corpus-relative path. If `excludeDirs` in
// script/m14/differential.ts changes, change this list with it -- otherwise the triage
// reports a population the audit no longer measures, and the two disagree about what
// "real source" means.
const TEMPLATE_ROOTS = [
  "src/main/templates/",
  "grails-profiles/base/templates/",
  "grails-profiles/profile/templates/",
  "grails-profiles/web/templates/",
  "grails-profiles/rest-api/templates/",
  "grails-profiles/plugin/templates/",
  "grails-test-examples/mongodb/gson-templates/",
  "/skeleton/",
]
const isTemplate = (rel: string): boolean => TEMPLATE_ROOTS.some(d => rel.includes(d))

/** Collapse a source window to a shape: identifiers and literals become ID, spacing goes. */
function normalise(window: string): string {
  return window
    .replace(/\/\/[^\n]*/g, " //")
    .replace(/'[^']*'/g, " STR")
    .replace(/"[^"]*"/g, " STR")
    .replace(/`[^`]*`/g, " STR")
    .replace(/\b\d+(?:\.\d+)?\b/g, " NUM")
    .replace(/[A-Za-z_$][A-Za-z0-9_$]*/g, "ID")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90)
}

async function main(): Promise<void> {
  const topIdx = process.argv.indexOf("--top")
  const top = topIdx >= 0 ? Number(process.argv[topIdx + 1]) : 25
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const p = new P()
  p.setLanguage(await L.load(fs.readFileSync(`${REPO}/wasm/tree-sitter-groovy.wasm`)))

  const files = execSync(`git -C ${JSON.stringify(CORPUS)} ls-files '*.groovy'`, {
    encoding: "utf8", maxBuffer: 1 << 28,
  }).split("\n").filter(Boolean)

  interface Cluster { files: string[]; errors: number; examples: string[] }
  const clusters = new Map<string, Cluster>()
  let badFiles = 0, totalErrors = 0, tmplFiles = 0, tmplErrors = 0
  const srcFiles: string[] = []

  for (const rel of files) {
    let src: string
    try { src = fs.readFileSync(`${CORPUS}/${rel}`, "utf8") } catch { continue }
    let t: any
    try { t = p.parse(src) } catch { continue }
    const errs: any[] = []
    const w = (n: any): void => {
      if (n.type === "ERROR" || n.isMissing) errs.push(n)
      for (let i = 0; i < n.childCount; i++) w(n.child(i))
    }
    w(t.rootNode)
    if (!errs.length) { srcFiles.push(rel); continue }
    badFiles++
    totalErrors += errs.length
    if (isTemplate(rel)) { tmplFiles++; tmplErrors += errs.length; continue }
    const first = errs[0]
    const line = first.startPosition.row
    const lines = src.split("\n")
    const sig = normalise(lines[line] ?? "")
    const c = clusters.get(sig) ?? { files: [], errors: 0, examples: [] }
    c.files.push(rel)
    c.errors += errs.length
    if (c.examples.length < 2) c.examples.push(`L${line + 1} ${(lines[line] ?? "").trim().slice(0, 78)}`)
    clusters.set(sig, c)
  }

  const ranked = [...clusters.entries()].sort((a, b) => b[1].errors - a[1].errors || b[1].files.length - a[1].files.length)
  const realFiles = ranked.reduce((a, [, c]) => a + c.files.length, 0)
  const realErrors = ranked.reduce((a, [, c]) => a + c.errors, 0)

  console.log("groovy parse-error triage — by normalised first-error signature")
  console.log(`  files in corpus        : ${files.length}`)
  console.log(`  files parsing clean    : ${files.length - badFiles}`)
  console.log(`  files with errors      : ${badFiles}   (${tmplFiles} template, ${realFiles} real source)`)
  console.log(`  ERROR/MISSING nodes    : ${totalErrors}   (${tmplErrors} template, ${realErrors} real source)`)
  console.log(`\n  ${ranked.length} distinct signatures among the real-source failures, ranked by error weight:\n`)
  console.log(`  ${"#".padStart(3)} ${"files".padStart(5)} ${"errors".padStart(7)}  signature`)
  ranked.slice(0, top).forEach(([sig, c], i) => {
    console.log(`  ${String(i + 1).padStart(3)} ${String(c.files.length).padStart(5)} ${String(c.errors).padStart(7)}  ${sig}`)
    for (const e of c.examples) console.log(`        ${e}`)
  })
  console.log(`\n  A fix is worth taking when its cluster's error weight is large AND the signature is`)
  console.log(`  one defect rather than a catch-all. Clusters that merely start with "ERROR" are`)
  console.log(`  downstream of an earlier decision on the same line — fix the upstream shape first.`)
}
main().catch((e) => { console.error(e); process.exit(1) })
