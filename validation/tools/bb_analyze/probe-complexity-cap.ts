import path from "node:path"
import { getProjectId } from "../../../src/cli/index"
import { analyzeComplexity } from "../../../src/intelligence/analysis/complexity"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const DIR = path.join(ROOT, "validation/tools/bb_analyze/work/behaviour")
const r = await analyzeComplexity(getProjectId(DIR) as any, { scope: "file", target: "src" })
console.log(JSON.stringify({ symbolCount: r.symbolCount, breakdownLength: r.breakdown.length, filesInScope: r.filesInScope, filesMatchingScope: r.filesMatchingScope, scopeMatch: r.scopeMatch, declaredCapField: Object.keys(r).filter(k => /trunc|shown|returned/i.test(k)) }))
