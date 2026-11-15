/**
 * TREE DUMP for the corpus's export-shaped sites. Adjudication aid for
 * probe-bash-silent-types.mts: prints the node shape of every line the corpus
 * contains an `export` token on, so "is this a site" is decided on the TREE
 * (a case-arm pattern is not an export) and the missed shapes become visible.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/probe-bash-export-shapes.mts [--repo bash-completion]
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..")
const CORPUS = process.env.BB_CORPUS || "/home/ishaq2321/bb_tests/repositories"
const REPO_DIR = process.env.BB_BASH_REPO || "bash-completion"
const { getParser } = await import(`${REPO_ROOT}/src/ast/engine.ts`)

const FILES = [
  "completions-core/cvs.bash",
  "completions-core/wget.bash",
  "completions-fallback/pipenv.bash",
  "completions-fallback/jungle.bash",
  "test/docker/entrypoint.sh",
  "test/docker/debian10/install-packages.sh",
  "test/docker/ubuntu14/install-packages.sh",
]

const show = (n: any, depth = 0, max = 6): string => {
  if (depth > max) return "…"
  const kids: string[] = []
  for (let i = 0; i < n.namedChildCount; i++) kids.push(show(n.namedChild(i), depth + 1, max))
  const t = JSON.stringify(n.text.length > 60 ? n.text.slice(0, 60) + "…" : n.text)
  return `${n.type}${n.isNamed ? "" : "!"}@${n.startPosition.row + 1}:${n.startPosition.column} ${t}${kids.length ? " [" + kids.join(", ") + "]" : ""}`
}

for (const rel of FILES) {
  const abs = join(CORPUS, REPO_DIR, rel)
  const content = readFileSync(abs, "utf8")
  const parser = await getParser("bash")
  const pr = await parser.parse(content, abs)
  const lines = content.split("\n")
  const exportLines = lines.map((l, i) => [i + 1, l] as const).filter(([, l]) => l.includes("export") && !l.trim().startsWith("#"))
  console.log(`\n=== ${rel} — ${exportLines.length} line(s) containing an export token`)
  for (const [ln, text] of exportLines) {
    console.log(`  line ${ln}: ${text.trim()}`)
    // find the smallest named node covering that line whose text contains 'export'
    let best: any = null
    const stack = [pr.rootNode]
    while (stack.length) {
      const n = stack.pop()
      if (n.startPosition.row + 1 === ln || (n.startPosition.row + 1 <= ln && n.endPosition.row + 1 >= ln)) {
        if (n.text.includes("export") && n.type !== "program" && n.type !== "list") {
          if (!best || n.endIndex - n.startIndex <= best.endIndex - best.startIndex) best = n
        }
        for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
      }
    }
    // owner = the tightest node carrying export; print its parent shape instead
    if (best) {
      let owner = best
      // climb to a statement-level container
      for (let i = 0; i < 0; i++) void i
      console.log(`     tightest: ${show(best, 0, 4)}`)
      // also print the statement node: nearest ancestor of type command/declaration_command/case_item
      const stack2 = [pr.rootNode]
      let stmt: any = null
      while (stack2.length) {
        const n = stack2.pop()
        const covers = n.startPosition.row + 1 <= ln && n.endPosition.row + 1 >= ln
        if (covers) {
          if (["command", "declaration_command", "case_item", "variable_assignment"].includes(n.type) && n.text.includes("export")) {
            if (!stmt || n.endIndex - n.startIndex <= stmt.endIndex - stmt.startIndex) stmt = n
          }
          for (let i = 0; i < n.namedChildCount; i++) stack2.push(n.namedChild(i))
        }
      }
      console.log(`     statement: ${stmt ? show(stmt, 0, 3) : "(none)"}`)
    } else console.log("     (no node contains the token)")
  }
}
