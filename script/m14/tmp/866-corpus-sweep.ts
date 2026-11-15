// M49/M37 #866 change-surface sweep. Dumps, for every file of the EIGHT JVM
// corpus repos the F5 differential uses (primary + second corpus per language),
// the full symbol and relationship sets. Run once with --root=<pre-fix tree>
// and once against the working tree, then diff the two dumps:
//
//   * symbols that disappeared            -> must be zero
//   * symbols that appeared               -> the anon-body members
//   * relationship source MOVES at the    -> the initialiser calls that used to
//     same (type,target,line)                flatten onto the enclosing method
//
// Both runs read the same corpus files outside the repo, so the comparison is
// like-for-like: only src/ differs between the trees.
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT =
  process.argv.find((a) => a.startsWith("--root="))?.slice("--root=".length) ??
  "/home/ishaq2321/mcp/backbencher-brain"
const OUT =
  process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? "/tmp/866-sweep.json"

// `--lang=<name>` narrows the sweep to one language (used by #867, whose change
// is kotlin-only); with no filter every JVM language is dumped.
const ONLY = process.argv.find((a) => a.startsWith("--lang="))?.slice("--lang=".length)
const ALL_LANGS: Array<{ lang: string; ext: string; repos: string[] }> = [
  { lang: "java", ext: ".java", repos: ["grails-core", "clojure"] },
  { lang: "groovy", ext: ".groovy", repos: ["grails-core", "geb"] },
  { lang: "kotlin", ext: ".kt", repos: ["Exposed", "kotlinx-coroutines"] },
  { lang: "scala", ext: ".scala", repos: ["scala3", "cats-effect"] },
]
const LANGS = ONLY ? ALL_LANGS.filter((l) => l.lang === ONLY) : ALL_LANGS
const CORPUS_ROOT = "/home/ishaq2321/bb_tests/repositories"

function walk(dir: string, ext: string, out: string[] = []): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "build" || e.name === "target") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, ext, out)
    else if (e.name.endsWith(ext)) out.push(p)
  }
  return out
}

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const dump: Record<string, { symbols: string[]; rels: string[] }> = {}
  let files = 0
  for (const l of LANGS) {
    for (const repo of l.repos) {
      const dir = path.join(CORPUS_ROOT, repo)
      const files_ = walk(dir, l.ext).sort()
      for (const f of files_) {
        const rel = `${l.lang}|${path.relative(CORPUS_ROOT, f)}`
        let text: string
        try {
          text = readFileSync(f, "utf8")
        } catch {
          continue
        }
        let res: any
        try {
          res = await ASTEngine.parseFile(f, text)
        } catch {
          continue
        }
        const symbols = (res.symbols ?? []).map(
          (s: any) => `S|${s.name}|${s.kind}|${s.ownerName ?? "-"}|${s.range?.startLine ?? "-"}`,
        )
        const rels = (res.relationships ?? []).map(
          (r: any) =>
            `R|${r.type}|${typeof r.source === "object" ? r.source?.name : r.source}|${
              typeof r.target === "object" ? r.target?.name : r.target
            }|${r.line_number ?? "-"}`,
        )
        symbols.sort()
        rels.sort()
        dump[rel] = { symbols, rels }
        files++
        if (files % 500 === 0) console.error(`  ...${files} files`)
      }
    }
  }
  writeFileSync(OUT, JSON.stringify(dump))
  console.error(`ROOT=${ROOT}`)
  console.error(`files=${files}`)
  console.error(`out=${OUT}`)
}

main()
