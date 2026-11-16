import { ASTEngine } from "../../../src/ast/engine"
import { parseFile } from "../../../src/ast/pool-worker"
const f = "<corpus-root>/bb_tests/repositories/zig/lib/compiler/aro/aro/Attribute.zig"
const parser = await ASTEngine.getParser("zig")
const tree = parser.parse(await Bun.file(f).text())
console.log("tree hasError:", (tree.rootNode as any).hasError)
const p = await parseFile(f, process.cwd())
console.log("pipeline errors:", (p.errors ?? []).length)
console.log("first 3 pipeline errors:", JSON.stringify((p.errors ?? []).slice(0, 3), null, 1))
