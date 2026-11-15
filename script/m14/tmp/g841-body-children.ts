// Is the member sweep faithful? List the class body's DIRECT children (types + first
// line) so "55 members" can be compared against what the file actually declares.
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

async function main() {
  const file = process.argv[2]
  const { ASTEngine } = (await import(path.join(ROOT, "src/ast/engine.ts"))) as any
  const parser = await ASTEngine.getParser("groovy")
  const root = parser.parse(readFileSync(file, "utf8"))?.rootNode

  // EVERY class body, not the first one that happens to hold members: the first
  // version of this probe reported "3 children" because it had found the NESTED
  // class's body, which is exactly the kind of quiet wrong pick this project keeps
  // catching. The parent type is printed so each body is identifiable.
  const bodies: any[] = []
  const walk = (n: any): void => {
    if (n.type === "class_body") bodies.push(n)
    for (const c of n.namedChildren ?? []) walk(c)
  }
  walk(root)
  console.log(`class_body nodes in this parse: ${bodies.length}`)
  for (const b of bodies) {
    console.log(`  parent=${b.parent?.type} L${b.parent?.startPosition?.row + 1} · ${b.namedChildCount} named children · first=${JSON.stringify((b.namedChildren?.[0]?.text ?? "").split("\n")[0]?.slice(0, 50))}`)
  }
  const body = bodies.slice().sort((a, b) => b.namedChildCount - a.namedChildCount)[0]
  if (!body) {
    console.log("no class body found (parse recovery may have hidden it)")
    return
  }
  console.log(`\n=== largest body (parent=${body.parent?.type} L${body.parent?.startPosition?.row + 1}) ===`)
  const counts = new Map<string, number>()
  for (const c of body.namedChildren) counts.set(c.type, (counts.get(c.type) ?? 0) + 1)
  console.log(`class body direct children: ${body.namedChildCount}`)
  for (const [t, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)} ${t}`)
  console.log("\nfirst 12 children in order:")
  for (const c of body.namedChildren.slice(0, 12)) {
    console.log(`  L${String(c.startPosition.row + 1).padStart(4)} ${c.type.padEnd(28)} ${JSON.stringify(c.text.split("\n")[0].slice(0, 60))}`)
  }
  // how many of them are MISSING / ERROR?
  const bad = body.namedChildren.filter((c: any) => c.type === "ERROR" || c.isMissing)
  console.log(`\nchildren that are ERROR or MISSING: ${bad.length}`)
}

main().catch((e) => {
  console.error(String(e?.message ?? e))
  process.exit(1)
})
