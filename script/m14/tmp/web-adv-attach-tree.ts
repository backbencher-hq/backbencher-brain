// Dump the svelte tree for `{@attach handler}` to see if the handler name is
// recoverable (analyzer lane feasibility). Run: bun script/m14/tmp/web-adv-attach-tree.ts
import { ASTEngine } from "../../../src/ast/engine"

async function main() {
  const src = `<div {@attach myAttachment}>x</div>\n<div {@attach createAttachment(p)}></div>\n`
  const parser = await ASTEngine.getParser("svelte")
  const tree = parser.parse(src)
  const dump = (n: any, depth: number): void => {
    const text = (n.text ?? "").replace(/\n/g, "\\n").slice(0, 40)
    console.log(`${"  ".repeat(depth)}${n.type}${n.isMissing ? " MISSING" : ""} [${text}]`)
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) dump(c, depth + 1) }
  }
  dump(tree.rootNode, 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
