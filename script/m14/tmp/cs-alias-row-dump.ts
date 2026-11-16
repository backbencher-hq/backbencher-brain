// Row dump for the alias-qualifier class: EVERY published csharp row for the 76 `::`-bearing
// `.cs` files in both pinned corpora, as `file\ttype\ttarget\tline`. Run in a pre-fix worktree
// and in the fixed tree, then reconcile: the 51 qualified rows must reappear as unqualified
// twins, and nothing else may move.
import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"

const ROOT = process.cwd()
const OUT = process.env.BB_DUMP
const CORPORA = ["<corpus-root>/bb_tests/repositories/powershell", "<corpus-root>/bb_tests/repositories/fsharp"]

async function main() {
  if (!OUT) throw new Error("BB_DUMP required")
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const rows: string[] = []
  const files: string[] = []
  for (const corpus of CORPORA) {
    const list = execSync(`grep -rl "::" --include=*.cs . 2>/dev/null | head -400`, { cwd: corpus, encoding: "utf8" })
      .split("\n").map((s) => s.trim()).filter(Boolean)
    for (const rel of list) {
      const file = path.join(corpus, rel)
      files.push(`${corpus.split("/").pop()}/${rel}`)
      const      res: any = await ASTEngine.parseFile(file, fs.readFileSync(file, "utf8"))
      for (const r of res.relationships ?? []) {
        rows.push(`${corpus.split("/").pop()}/${rel}\t${r.type}\t${r.target}\t${r.line_number ?? "-"}`)
      }
      for (const s of res.symbols ?? []) {
        const nm = String(s.name ?? "")
        const tp = String(s.returnType ?? s.metadata?.type ?? "")
        if (nm.includes("::") || tp.includes("::")) rows.push(`${corpus.split("/").pop()}/${rel}\tSYMBOL\t${nm}|${tp}\t-`)
        // Decorators are a payload too: the alias rule reaches the attribute-name position.
        // Recorded UNFILTERED (every decorator of every symbol in these files), because a
        // filter on `::` would hide the post-fix spelling and make the reconciliation
        // unverifiable — the exact trap the 51-target filter set for the relationship rows.
        for (const d of s.decorators ?? []) {
          rows.push(`${corpus.split("/").pop()}/${rel}\tDECORATOR\t${nm}|${d}\t-`)
        }
      }
    }
  }
  rows.sort()
  fs.writeFileSync(OUT, rows.join("\n") + "\n")
  console.log(`files=${files.length} rows=${rows.length} -> ${OUT}`)
}
main()
