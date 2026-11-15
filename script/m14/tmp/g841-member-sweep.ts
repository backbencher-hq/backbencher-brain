// Class-body failure localization: when the whole class wraps in one ERROR node,
// bisect by MEMBER — parse each member's own text (wrapped in a minimal class) and
// report which ones fail. Turns "the file fails" into "this construct fails".
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

async function main() {
  const file = process.argv[2]
  if (!file) throw new Error("usage: bun script/m14/tmp/g841-member-sweep.ts <file.groovy>")
  const { ASTEngine } = (await import(path.join(ROOT, "src/ast/engine.ts"))) as any
  const parser = await ASTEngine.getParser("groovy")
  const text = readFileSync(file, "utf8")
  const root = parser.parse(text)?.rootNode
  const dir = mkdtempSync(path.join(tmpdir(), "g841mem-"))

  const members: Array<{ type: string; row: number; text: string }> = []
  const walk = (n: any): void => {
    const t = n.type as string
    if (
      t === "method_definition" || t === "function_definition" || t === "field_declaration" ||
      t === "constructor_definition" || t === "method_declaration"
    ) {
      members.push({ type: t, row: n.startPosition.row + 1, text: n.text })
      return
    }
    for (const c of n.namedChildren ?? []) walk(c)
  }
  walk(root)

  console.log(`${path.basename(file)}: ${members.length} member node(s) recovered from a failing parse`)
  const bad: typeof members = []
  for (const m of members) {
    const wrapped = `class W {\n${m.text}\n}\n`
    const f = path.join(dir, "M.groovy")
    writeFileSync(f, wrapped)
    const err = !!parser.parse(wrapped)?.rootNode?.hasError
    if (err) bad.push(m)
    console.log(`  ${err ? "FAIL" : "ok  "} L${String(m.row).padStart(4)} ${m.type}  ${JSON.stringify(m.text.split("\n")[0].slice(0, 70))}`)
  }
  console.log(`\nmembers that fail alone: ${bad.length} of ${members.length}`)
  for (const b of bad) {
    console.log(`\n--- failing member L${b.row} (${b.type}) ---\n${b.text.slice(0, 400)}`)
  }
  if (bad.length === 0) {
    console.log("no single member fails alone: the failure needs a COMBINATION of members or a class-level declaration — bisect by keeping members in order next.")
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
