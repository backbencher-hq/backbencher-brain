import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { ASTEngine } from "../src/ast/engine"
import { detectLanguageFromPath } from "../src/ast/language-detection"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const matrix = JSON.parse(readFileSync(resolve(root, "validation/m11/parser-matrix.json"), "utf8")) as any
const workerSource = readFileSync(resolve(root, "src/ast/pool-worker.ts"), "utf8")
const buildConfig = readFileSync(resolve(root, "tsup.config.ts"), "utf8")
let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` ${detail}` : ""}`) }
}

check("parser matrix schema is version 1", matrix.schemaVersion === 1)
check("parser matrix syntax entry count is self-consistent", matrix.languages.length === matrix.syntaxEntryCount)
check("parser matrix language ids are unique", new Set(matrix.languages.map((item: any) => item.language)).size === matrix.languages.length)
check("dedicated parser count is self-consistent", matrix.languages.filter((item: any) => item.parser === "dedicated").length === matrix.dedicatedParserCount)
check("generic fallback count is self-consistent", matrix.languages.filter((item: any) => item.parser === "generic").length === matrix.genericFallbackCount)
check("matrix identifies 42 product targets", matrix.productTargetCount === 42)
check("worker imports shared detector", workerSource.includes('from "./language-detection"'))
check("worker does not maintain a duplicate extension map", !workerSource.includes("const langMap:"))
check("compiled build targets Node 20", buildConfig.includes('target: "node20"'))
check("compiled build includes stable worker entry", buildConfig.includes('"pool-worker": "src/ast/pool-worker.ts"'))

for (const item of matrix.languages) {
  const detected = detectLanguageFromPath(item.probe)
  check(`${item.language} detection`, detected === item.language, `expected=${item.language} actual=${detected}`)
  if (item.parser === "generic") continue
  const asset = resolve(root, "wasm", item.wasm.split("/").pop())
  check(`${item.language} WASM asset exists`, existsSync(asset), asset)
  try {
    const parser = await ASTEngine.getParser(item.language)
    const tree = parser.parse("// M11 parser probe\n")
    check(`${item.language} parser loads and parses`, !!tree)
    tree?.delete?.()
    const second = await ASTEngine.getParser(item.language)
    check(`${item.language} parser cache reloads`, second === parser)
  } catch (error) {
    check(`${item.language} parser loads and parses`, false, error instanceof Error ? error.message : String(error))
  }
}

try {
  const xmlParser = await ASTEngine.getParser("xml")
  const xmlTree = xmlParser.parse('<root><item id="1">value</item></root>')
  check("XML ABI-compatible parser produces document root", xmlTree?.rootNode.type === "document")
  check("XML valid fixture has no syntax error", xmlTree?.rootNode.hasError === false)
  xmlTree?.delete?.()
} catch (error) {
  check("XML ABI-compatible parser produces document root", false, error instanceof Error ? error.message : String(error))
}

for (const [extension, policy] of Object.entries(matrix.ambiguousExtensions) as Array<[string, { default: string | null; requiresContextFor?: string[]; requiresExplicitLanguage?: boolean }]>) {
  check(`${extension} explicit ambiguity policy exists`, Boolean(policy))
  const detected = detectLanguageFromPath(`fixture${extension}`)
  if (policy.requiresExplicitLanguage) check(`${extension} does not guess`, detected === null)
  else check(`${extension} default is deterministic`, detected === policy.default)
}

if (failures > 0) {
  console.error(`\nM11 PARSER MATRIX: FAIL (${failures} failure${failures === 1 ? "" : "s"})`)
  process.exit(1)
}
console.log("\nM11 PARSER MATRIX: PASS")
