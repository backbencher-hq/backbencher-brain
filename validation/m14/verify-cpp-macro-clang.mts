import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

if (process.argv.includes("--mutate-recovery")) {
  Bun.plugin({
    name: "disable-cpp-macro-class-recovery",
    setup(build) {
      build.onLoad({ filter: /real-cpp-analyzer\.ts$/ }, ({ path }) => {
        const source = readFileSync(path, "utf8")
        const recovery = "const decorated = macroDecoratedClassDecl(node)"
        assert.ok(source.includes(recovery), "mutation must reach the recovery branch")
        return { contents: source.replace(recovery, "const decorated = null"), loader: "ts" }
      })
    },
  })
}

const { parseFile } = await import("../../src/ast/engine")

interface ClangNode {
  kind: string
  name?: string
  completeDefinition?: boolean
  isImplicit?: boolean
  inner?: ClangNode[]
}

const fixture = new URL("./fixtures/cpp/macro-decorated-class.cpp", import.meta.url)
const source = readFileSync(fixture, "utf8")
const clang = process.env.CLANGXX || "clang++"
const ast: ClangNode = JSON.parse(execFileSync(clang, [
  "-std=c++17", "-DGTEST_API_=", "-DSTDCALL_DECL=", "-x", "c++",
  "-fsyntax-only", "-Xclang", "-ast-dump=json", "-",
], { input: "class UnitTest;\n" + source, encoding: "utf8" }))

const records = (ast.inner ?? []).filter(node =>
  node.kind === "CXXRecordDecl" && node.completeDefinition && node.name,
)
assert.ok(records.some(record => record.name === "UnitTestImpl"))
assert.ok(records.some(record => record.name === "Reporter"))
const expected = records.flatMap(record => (record.inner ?? [])
  .filter(node => !node.isImplicit && node.name && ["CXXMethodDecl", "CXXConstructorDecl", "FieldDecl"].includes(node.kind))
  .map(node => JSON.stringify([record.name, node.kind === "CXXConstructorDecl" ? "constructor" : node.name])),
)
const result = await parseFile("macro-decorated-class.cpp", source)
assert.deepEqual(result.errors, [])
const actualClasses = result.symbols.filter(symbol => symbol.kind === "class").map(symbol => symbol.name)
assert.deepEqual(actualClasses.sort(), records.map(record => record.name).sort())
const actual = result.relationships
  .filter(edge => edge.type === "contains" && actualClasses.includes(edge.source))
  .map(edge => JSON.stringify([edge.source, edge.target]))
assert.deepEqual([...new Set(actual)].sort(), [...new Set(expected)].sort())
console.log(`Clang comparison passed for ${records.length} definitions and ${expected.length} member edges`)
process.exit(0)
