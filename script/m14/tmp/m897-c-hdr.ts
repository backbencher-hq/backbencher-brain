import { parseFile } from "../../../src/ast/pool-worker"
import { ASTEngine } from "../../../src/ast/engine"
const f = "/home/ishaq2321/bb_tests/repositories/fmt/test/gtest-extra.h"
const src = await Bun.file(f).text()
const lang = ASTEngine.detectLanguage(f, src)
console.log("detected language:", lang)
const parser = await ASTEngine.getParser(lang as any)
const tree = parser.parse(src)
console.log("tree hasError under detected grammar:", (tree.rootNode as any).hasError)
const p = await parseFile(f, process.cwd())
console.log("pipeline errors:", (p.errors ?? []).length)
