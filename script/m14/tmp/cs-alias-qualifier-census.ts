// The alias-qualifier class, measured across BOTH pinned corpora (not sampled).
//
// R10's 40-file draws convicted exactly ONE edge (`instantiates -> global::System.Resources.
// ResourceManager`, fsharp/vsintegration/.../Strings.Designer.cs:42). The corpora actually
// contain ~550 `global::` occurrences in 76 .cs files (grep), so the question the sample
// cannot answer is: WHICH positions publish the qualifier, and how many edges does each
// position carry? This walks every `::`-bearing file in both corpora and groups the
// published targets by relationship type — the class, not the sample.
import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"

const ROOT = process.cwd()
const CORPORA = ["/home/ishaq2321/bb_tests/repositories/powershell", "/home/ishaq2321/bb_tests/repositories/fsharp"]

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const byType = new Map<string, number>()
  const samples = new Map<string, string[]>()
  const symbolHits: string[] = []
  let files = 0, rels = 0, withQualifier = 0, symbolsWithQualifier = 0

  for (const corpus of CORPORA) {
    const list = execSync(`grep -rl "::" --include=*.cs . 2>/dev/null | head -400`, { cwd: corpus, encoding: "utf8" })
      .split("\n").map((s) => s.trim()).filter(Boolean)
    for (const rel of list) {
      const file = path.join(corpus, rel)
      const src = fs.readFileSync(file, "utf8")
      const res: any = await ASTEngine.parseFile(file, src)
      files++
      for (const r of res.relationships ?? []) {
        rels++
        const t = String(r.target ?? "")
        if (!t.includes("::")) continue
        withQualifier++
        const k = String(r.type)
        byType.set(k, (byType.get(k) ?? 0) + 1)
        const arr = samples.get(k) ?? []
        if (arr.length < 4) arr.push(`${t}  [${corpus.split("/").pop()}/${path.basename(file)} line ${r.line_number ?? "-"}]`)
        samples.set(k, arr)
      }
      for (const s of res.symbols ?? []) {
        const nm = String(s.name ?? "")
        const tp = String(s.returnType ?? s.metadata?.type ?? "")
        if (nm.includes("::") || tp.includes("::")) {
          symbolsWithQualifier++
          if (symbolHits.length < 6) symbolHits.push(`${nm} (kind=${s.kind}, type=${tp || "-"}) [${path.basename(file)}]`)
        }
      }
    }
  }

  console.log(`files parsed:                    ${files}`)
  console.log(`relationships:                   ${rels}`)
  console.log(`targets carrying "::":           ${withQualifier}`)
  console.log(`symbols whose name/type has ::"): ${symbolsWithQualifier}`)
  console.log(`\nby relationship type:`)
  for (const [k, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(14)} ${String(n).padStart(5)}`)
    for (const s of samples.get(k) ?? []) console.log(`      ${s}`)
  }
  if (symbolHits.length) {
    console.log(`\nsymbol samples:`)
    for (const s of symbolHits) console.log("  " + s)
  }
}
main()
