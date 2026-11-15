// #924 row 2: the fix changed 154 symbols' KIND (method -> function) — the
// reduction says those functions were never members. Verify that reading site by
// site: dump the source line, the grammar's declarator children, and the
// before/after symbol for every affected position.
import { readFileSync, writeFileSync, rmSync } from "node:fs"
import { execSync } from "node:child_process"
import { getParser } from "../run-fixtures"

const TMP = "src/ast/zz-tmp-head-cpp-analyzer2.ts"
writeFileSync(TMP, execSync(`git show HEAD:src/ast/real-cpp-analyzer.ts`, { encoding: "utf8", maxBuffer: 1 << 28 }))
const headMod: any = await import(`../../../${TMP}`)
const curMod: any = await import("../../../src/ast/real-cpp-analyzer")
const head = new headMod.RealCppAnalyzer()
const cur = new curMod.RealCppAnalyzer()

const ROOTS: Array<[string, string, string[]]> = [
  ["fmt:cpp", "/home/ishaq2321/bb_tests/repositories/fmt", ["*.h", "*.cc", "*.cpp"]],
  ["nlohmann-json:cpp", "/home/ishaq2321/bb_tests/repositories/nlohmann-json", ["*.hpp", "*.cpp", "*.h"]],
]
function files(root: string, exts: string[]): string[] {
  const names = exts.map((e) => `-name '${e}'`).join(" -o ")
  return execSync(`find ${root} -type f \\( ${names} \\) -not -path '*/build/*' -not -path '*/.git/*'`, { encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\n").filter(Boolean).sort()
}

const rows: string[] = []
const kindCounts = new Map<string, number>()
for (const [, root, exts] of ROOTS) {
  for (const f of files(root, exts)) {
    const src = readFileSync(f, "utf8")
    const tree: any = (await getParser("cpp")).parse(src)
    const b: any = await head.analyze(tree.rootNode, src, f)
    const tree2: any = (await getParser("cpp")).parse(src)
    const a: any = await cur.analyze(tree2.rootNode, src, f)
    const mapA = new Map<string, any>()
    for (const s of a.symbols ?? []) mapA.set(`${s.range?.startLine}|${s.range?.startColumn}`, s)
    const rel = f.replace("/home/ishaq2321/bb_tests/repositories/", "")
    for (const sb of b.symbols ?? []) {
      const sa = mapA.get(`${sb.range?.startLine}|${sb.range?.startColumn}`)
      if (!sa || sa.kind === sb.kind) continue
      const kk = `${sb.kind}->${sa.kind}`
      kindCounts.set(kk, (kindCounts.get(kk) ?? 0) + 1)
      if (rows.length < 150) {
        rows.push(`  ${rel}:${sb.range?.startLine} [${sb.kind} -> ${sa.kind}] ${JSON.stringify(sb.name)} -> ${JSON.stringify(sa.name)}  scope ${JSON.stringify(sb.metadata?.scope ?? null)} -> ${JSON.stringify(sa.metadata?.scope ?? null)}\n      src: ${JSON.stringify((src.split("\n")[sb.range.startLine - 1] ?? "").trim().slice(0, 110))}`)
      }
    }
  }
}
rmSync(TMP, { force: true })
console.log("kind transitions:", JSON.stringify([...kindCounts.entries()].sort((x, y) => y[1] - x[1])))
console.log(rows.join("\n"))
