import { readFileSync, writeFileSync, rmSync } from "node:fs"
import { execSync } from "node:child_process"
import { getParser } from "../run-fixtures"
const TMP = "src/ast/zz-tmp-head-cpp-analyzer7.ts"
writeFileSync(TMP, execSync(`git show HEAD:src/ast/real-cpp-analyzer.ts`, { encoding: "utf8", maxBuffer: 1 << 28 }))
const mod: any = await import(`../../../${TMP}`)
const f = "validation/m14/fixtures/cpp/qualified-declarator-name-924.cpp"
const src = readFileSync(f, "utf8")
const r: any = await new mod.RealCppAnalyzer().analyze((await getParser("cpp")).parse(src).rootNode, src, f)
rmSync(TMP, { force: true })
console.log("PRE-FIX SYMBOLS")
for (const s of r.symbols ?? []) console.log(`  L${s.range?.startLine} [${s.kind}] name=${JSON.stringify(s.name)} owner=${JSON.stringify(s.ownerName ?? null)} nameLine=${s.metadata?.nameLine}`)
