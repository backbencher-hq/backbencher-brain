import { readFileSync } from "node:fs"
import { getParser } from "../run-fixtures"
const f = "validation/m14/fixtures/cpp/include-name-924.cpp"
const content = readFileSync(f, "utf8")
const parser = await getParser("cpp")
const mod: any = await import("../../../src/ast/real-cpp-analyzer")
const a = new mod.RealCppAnalyzer()
const r: any = await a.analyze(parser.parse(content).rootNode, content, f)
console.log("keys:", Object.keys(r))
