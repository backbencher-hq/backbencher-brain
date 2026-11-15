import { ASTEngine } from "../../../../src/ast/engine.ts"
const content = 'import { deadName } from "./mod"\n\nexport const keep = 1\n'
const r = await ASTEngine.parseFile("src/m.ts", content)
console.log("KEYS=" + Object.keys(r).join(","))
console.log("HAS_TREE=" + (r.tree !== undefined) + " ROOT=" + !!r.tree?.rootNode)
