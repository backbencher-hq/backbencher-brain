import { parseFile } from "../../../src/ast/pool-worker"
import { ASTEngine } from "../../../src/ast/engine"
const f = "<corpus-root>/bb_tests/repositories/alamofire/Source/Core/WebSocketRequest.swift"
const src = await Bun.file(f).text()
const lang = ASTEngine.detectLanguage(f, src)
console.log("detected:", lang)
const parser = await ASTEngine.getParser("swift")
const tree = parser.parse(src)
console.log("tree hasError:", (tree.rootNode as any).hasError)
const p = await parseFile(f, process.cwd())
console.log("pipeline errors:", JSON.stringify((p.errors ?? []).map((e: any) => e.message?.slice(0, 90)), null, 1))
