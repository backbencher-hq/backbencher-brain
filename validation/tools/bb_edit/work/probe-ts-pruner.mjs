import { ImportPruner } from "/home/ishaq2321/mcp/backbencher-brain/src/ast/import-pruner.ts"
const file = "src/m.ts"
const cases = {
  "multi-name, dead first": [
    'import { deadName, liveName } from "./mod"',
    "",
    "export function keep(): number {",
    "  return liveName()",
    "}",
    "",
  ].join("\n"),
  "multi-name, dead second": [
    'import { liveName, deadName } from "./mod"',
    "",
    "export function keep(): number {",
    "  return liveName()",
    "}",
    "",
  ].join("\n"),
  "single dead": ['import { deadName } from "./mod"', "", "export const keep = 1", ""].join("\n"),
}
for (const [name, content] of Object.entries(cases)) {
  const out = await ImportPruner.prune(content, file)
  console.log(`\n### ${name}\n--- in:\n${content}--- out:\n${out}`)
}
