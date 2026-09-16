// G7 residual sizing: Groovy has six string forms and THREE of them interpolate
// ("""…""" with $name and ${…}; /slashy/; $/dollar-slashy/$). G7 closed the
// double-quoted family. This measures how much surface the two remaining forms
// carry on the corpus — because the fix for them is a GRAMMAR RESTRUCTURE
// (`slashy_string` is one token today, chosen in W18 so `/` cannot collide with
// division), and that trade needs the size of what it buys.
//
// Two independent counts:
//   * `slashy-with-$` — read off the TOKEN the pinned grammar actually produces
//     (a slashy_string whose text contains `$`), not off a regex of my own.
//   * `dollar-slashy` — `$/ … /$` in source, a form the grammar does not model
//     at all. Counted from the TEXT so it survives files this construct breaks.
//
// Usage: bun script/m59/measure-groovy-string-forms.ts [--repo grails-core] [--limit 2000]
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

const ROOT = "$HOME/mcp/backbencher-brain"
const arg = (k: string, d: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const REPO_NAME = arg("--repo", "grails-core")
const CORPUS = `$HOME/fixtures/repositories/${REPO_NAME}`
const LIMIT = parseInt(arg("--limit", "2000"))
const EXTS = [".groovy", ".gradle", ".gsp"]
const SKIP = new Set([".git", "node_modules", "build", "target", ".gradle", "out", "dist"])

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) walk(path.join(dir, e.name), out)
    } else if (EXTS.some((x) => e.name.endsWith(x))) out.push(path.join(dir, e.name))
  }
  return out.sort()
}

async function main(): Promise<void> {
  // web-tree-sitter directly, mirroring the fixture runner's plumbing: the
  // slashy counts are read off the TREE, so they do not depend on my own regex.
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-groovy.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)

  const files = walk(CORPUS).slice(0, LIMIT)
  let slashyTotal = 0
  let slashyWithDollar = 0
  const slashyFiles = new Set<string>()
  const dollarSlashyFiles = new Set<string>()
  let dollarSlashySites = 0
  let parseFail = 0
  for (const f of files) {
    const src = readFileSync(f, "utf8")
    const ds = (src.match(/\$\/[^\n]*?\$\//g) ?? []).length
    if (ds > 0) {
      dollarSlashyFiles.add(f)
      dollarSlashySites += ds
    }
    const tree = parser.parse(src)
    // hasError is the criterion the product uses; counting `type === "ERROR"`
    // nodes over-reports (a zero-width node past EOF is not an error).
    if (tree.rootNode.hasError) parseFail++
    const visit = (n: any): void => {
      if (n.type === "slashy_string") {
        slashyTotal++
        // Interpolation-SHAPED only. A bare `$` is not interpolation: `/^$/` and
        // `/$/` are regex anchors and stay literal in Groovy, so counting any
        // `$` would inflate the residual with things the fix must NOT read.
        if (/\$\{|\$[A-Za-z_]/.test(n.text)) {
          slashyWithDollar++
          slashyFiles.add(f)
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) visit(c)
      }
    }
    visit(tree.rootNode)
  }
  console.log(`repo                : ${REPO_NAME} @ ${CORPUS}`)
  console.log(`files scanned       : ${files.length} (${EXTS.join(",")})`)
  console.log(`parse-failing files : ${parseFail}`)
  console.log(`slashy_string tokens: ${slashyTotal}`)
  console.log(`  of which contain $: ${slashyWithDollar} in ${slashyFiles.size} file(s)`)
  console.log(`dollar-slashy sites : ${dollarSlashySites} in ${dollarSlashyFiles.size} file(s)`)
  for (const f of [...slashyFiles].slice(0, 6)) console.log(`  slashy-$: ${path.relative(CORPUS, f)}`)
  for (const f of [...dollarSlashyFiles].slice(0, 6)) console.log(`  $-slashy: ${path.relative(CORPUS, f)}`)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
