// go-heavy stress read — is the wasm `Aborted()` a poisoned PARSER INSTANCE, or
// a file the grammar's runtime genuinely cannot parse?
//
// Why this exists: script/m14/tmp/go-heavy-stress.ts found 2,879 of 13,488
// kubernetes files silently unparsed, every failure `Aborted()` and every one of
// them from `staging/src/k8s.io/dynamic-resource-allocation/**` ONWARD in sorted
// order — the signature of one trap killing a shared wasm instance, not of
// 2,879 bad files. This probe decides it with the smallest possible experiment:
// parse the first failing file (a) ALONE, (b) after the file that precedes it in
// sort order, and (c) after a fresh parser is fetched.
//
// Run: bun script/m14/tmp/go-heavy-wasm-trap.ts <repoRoot>
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"

const root = process.argv[2]
const trap = process.argv[3] ?? path.join(root, "staging/src/k8s.io/dynamic-resource-allocation/api/v1beta1/zz_generated.conversion.go")

const files: string[] = []
const walk = (dir: string, depth = 0) => {
  if (depth > 24) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name === ".git" || e.name === "node_modules" || e.name === "vendor") continue
      walk(path.join(dir, e.name), depth + 1)
    } else if (e.isFile() && e.name.endsWith(".go")) files.push(path.join(dir, e.name))
  }
}
walk(root)
files.sort()
const idx = files.indexOf(trap)
console.log(`trap file: ${path.relative(root, trap)} (index ${idx} of ${files.length})`)
console.log(`  size: ${fs.statSync(trap).size} bytes`)

const tryParse = (label: string, parser: any, f: string) => {
  try {
    const t = parser.parse(fs.readFileSync(f, "utf8"))
    console.log(`  ${label}: OK rootNode=${t?.rootNode ? t.rootNode.type : "null"} hasError=${t?.rootNode?.hasError}`)
    return true
  } catch (e: any) {
    console.log(`  ${label}: THREW ${String(e?.message ?? e).slice(0, 100)}`)
    return false
  }
}

// (a) alone, in a parser fetched first thing in this process
const p1 = await ASTEngine.getParser("go" as any)
console.log("\n(a) the trap file ALONE on a fresh parser:")
tryParse("alone", p1, trap)

// (b) the file that precedes it in sort order, then the trap file
const p2 = await ASTEngine.getParser("go" as any)
console.log(`\n(b) predecessor (${path.relative(root, files[idx - 1] ?? "")}) then the trap file:`)
if (files[idx - 1]) tryParse("predecessor", p2, files[idx - 1])
tryParse("trap after predecessor", p2, trap)

// (c) a fresh parser fetched AFTER the trap already failed
const p3 = await ASTEngine.getParser("go" as any)
console.log("\n(c) trap file on a parser fetched after a failure:")
tryParse("alone again", p3, trap)

// (d) the neighbours of the trap in sort order, to show the boundary
console.log("\n(d) boundary: files either side of the trap, in order, on one parser:")
const p4 = await ASTEngine.getParser("go" as any)
for (const f of [files[idx - 2], files[idx - 1], trap, files[idx + 1], files[idx + 2]].filter(Boolean)) {
  tryParse(path.relative(root, f), p4, f)
}
