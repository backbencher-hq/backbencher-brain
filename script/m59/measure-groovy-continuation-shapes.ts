// M49-CONV #851 / #852 — how big are the two defect classes on real code?
//
// Measured from the GRAMMAR SHAPES, not from the analyzer's output, so the
// number is independent of the fix and cannot be flattered by it. The mapping
// from shape to pre-fix emission is exact and verified 1:1 on
// validation/m14/fixtures/groovy/continuation-shapes-851:
//
//   leading_dot_call WITHOUT an `arguments` field  -> pre-fix emitted
//     `calls -> <name>` and NO read (the same access on one line emits a read)
//   juxt_function_call whose `name` is a field_access -> pre-fix emitted a
//     `calls` target of the whole dotted text AND a leaked `uses` of the callee
//
// Sample = the same pinned 400-file list the m12 groovy lane reads
// (validation/m12/results/groovy-corpus-sample.txt), so the counts are
// comparable with that lane's own numbers.
//
// Usage: bun script/m59/measure-groovy-continuation-shapes.ts [--full] [--limit N]
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../src/ast/engine"

const REPO = "$HOME/fixtures/repositories/grails-core"
const SAMPLE = "validation/m12/results/groovy-corpus-sample.txt"
const args = process.argv.slice(2)
const full = args.includes("--full")
const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]) : Infinity

type Counts = {
  files: number
  parenlessReads: number
  parenfulCalls: number
  dottedJuxt: number
  plainJuxt: number
  filesWithParenless: Set<string>
  filesWithDotted: Set<string>
}

async function main(): Promise<void> {
  const revision = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  let files: string[]
  if (full) {
    files = execFileSync("git", ["-C", REPO, "ls-files", "*.groovy"], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    })
      .trim()
      .split("\n")
      .filter(Boolean)
      .sort()
  } else {
    files = readFileSync(SAMPLE, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
  }
  if (Number.isFinite(limit)) files = files.slice(0, limit)

  const c: Counts = {
    files: 0,
    parenlessReads: 0,
    parenfulCalls: 0,
    dottedJuxt: 0,
    plainJuxt: 0,
    filesWithParenless: new Set(),
    filesWithDotted: new Set(),
  }

  for (const file of files) {
    let src: string
    try {
      src = readFileSync(`${REPO}/${file}`, "utf8")
    } catch {
      continue
    }
    c.files++
    const parser = await ASTEngine.getParser("groovy" as any)
    const root = parser.parse(src)?.rootNode
    if (!root) continue
    const stack: any[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "leading_dot_call") {
        const hasArgs =
          n.childForFieldName?.("arguments") ??
          (n.namedChildren ?? []).find((x: any) => x.type === "argument_list")
        if (hasArgs) c.parenfulCalls++
        else {
          c.parenlessReads++
          c.filesWithParenless.add(file)
        }
      } else if (n.type === "juxt_function_call") {
        const name = n.childForFieldName?.("name")
        if (name?.type === "field_access") {
          c.dottedJuxt++
          c.filesWithDotted.add(file)
        } else c.plainJuxt++
      }
      for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
    }
  }

  const pct = (n: number) => `${((n / Math.max(1, c.files)) * 100).toFixed(2)}%`
  console.log(`\ngroovy corpus: ${REPO} @ ${revision.slice(0, 12)}`)
  console.log(`sample: ${full ? "FULL tracked corpus" : SAMPLE} — ${c.files} files\n`)
  console.log(`#851  paren-less continuation segment (leading_dot_call, no arguments):`)
  console.log(`        ${c.parenlessReads} occurrences in ${c.filesWithParenless.size} files (${pct(c.filesWithParenless.size)} of files)`)
  console.log(`        pre-fix each emitted 1 fabricated \`calls\` edge to a property name AND lost 1 member read`)
  console.log(`#851  paren-ful continuation segment (a genuine call, unchanged): ${c.parenfulCalls}`)
  console.log(`\n#852  dotted juxt callee (juxt_function_call name: field_access):`)
  console.log(`        ${c.dottedJuxt} occurrences in ${c.filesWithDotted.size} files (${pct(c.filesWithDotted.size)} of files)`)
  console.log(`        pre-fix each emitted 1 dotted \`calls\` target (duplicating one method as two graph nodes)`)
  console.log(`        and leaked 1 \`uses\` read of the callee`)
  console.log(`#852  plain juxt callee (undotted, unchanged): ${c.plainJuxt}\n`)
}
main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
