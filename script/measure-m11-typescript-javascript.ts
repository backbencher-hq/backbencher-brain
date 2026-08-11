import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { getProjectId } from "../src/cli/index"
import { BrainDatabase } from "../src/brain/database"
import { indexProjectParallel } from "../src/ast/parallel-indexer"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const fixture = resolve(root, "validation/m11/fixtures/typescript")
const project = join(tmpdir(), `bb-m11-tsjs-${process.pid}`)
rmSync(project, { recursive: true, force: true })
cpSync(fixture, project, { recursive: true })
const projectId = getProjectId(project)
const logger = { log: (..._args: any[]) => {}, write: (_text: string) => {} }

function compilerNames(filePath: string): string[] {
  const content = readFileSync(filePath, "utf8")
  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : filePath.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind)
  const names: string[] = []
  const visit = (node: ts.Node) => {
    const named = node as ts.NamedDeclaration
    if (named.name && ts.isIdentifier(named.name)) names.push(named.name.text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...new Set(names)].sort()
}

await indexProjectParallel(projectId as any, project, { logger })
const db = await BrainDatabase.getRawInstance(projectId as any)
const symbols = db.prepare("SELECT name, symbol_type AS kind, line_start AS start_line, line_end AS end_line FROM brain_symbol WHERE project_id = ? ORDER BY name, line_start").all(projectId) as Array<{ name: string; kind: string; start_line: number; end_line: number }>
const relationships = db.prepare("SELECT relationship_type AS relationship_type, COUNT(*) AS count FROM brain_relationship WHERE project_id = ? GROUP BY relationship_type ORDER BY relationship_type").all(projectId) as Array<{ relationship_type: string; count: number }>
const imports = db.prepare("SELECT import_path, imported_name, imported_as, import_type, is_external, package_name FROM brain_import WHERE project_id = ? ORDER BY import_path, imported_name").all(projectId) as Array<{ import_path: string; imported_name: string; imported_as: string | null; import_type: string; is_external: number; package_name: string | null }>
const files = db.prepare("SELECT path, language FROM brain_file WHERE project_id = ? ORDER BY path").all(projectId) as Array<{ path: string; language: string }>
const compiler = Object.fromEntries(["base.ts", "service.ts", "view.tsx", "commonjs.js"].map((name) => [name, compilerNames(join(project, name))]))
const result = { schemaVersion: 1, fixture: "validation/m11/fixtures/typescript", projectId, compiler, files, symbols, relationships, imports }
const output = resolve(root, "validation/m11/results/typescript-javascript-observed.json")
mkdirSync(resolve(output, ".."), { recursive: true })
writeFileSync(output, JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify({ files: files.length, symbols: symbols.length, relationships, compilerSymbolNameSets: Object.fromEntries(Object.entries(compiler).map(([key, value]) => [key, (value as string[]).length])) }, null, 2))
rmSync(project, { recursive: true, force: true })
rmSync(BrainDatabase.getDbPath(projectId), { recursive: true, force: true })
