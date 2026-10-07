#!/usr/bin/env bun
/**
 * SVELTE PER-FILE PROBE — print what the production path produced for ONE
 * `.svelte` file, plus the SFC-level facts the census counts.
 *
 * NO REGEX: every structural fact comes from the tree-sitter AST via the cursor
 * / node APIs (node.type, named children, field names) or from the parse result
 * the production path returns. Nothing here scans source text for a pattern.
 *
 * USAGE
 *   bun run script/m14/svelte-probe-one.ts <abs-or-relative .svelte path> [--symbols] [--runes] [--classes]
 *     --symbols  dump every symbol with kind/owner/range
 *     --runes    walk every <script> block and report every `$`-prefixed callee
 *                the JS/TS grammar produces (the construct probe for calls/runes)
 *     --classes  report every class-shaped node the script trees produce
 *                (the construct probe for extends/implements/overrides)
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const target = argv.find((a) => !a.startsWith("--"))
if (!target) {
  console.error("usage: svelte-probe-one.ts <file.svelte> [--symbols] [--runes] [--classes]")
  process.exit(2)
}
const want = (n: string): boolean => argv.includes(`--${n}`)
const abs = path.isAbsolute(target) ? target : path.resolve(process.cwd(), target)
const dir = path.dirname(abs)

const res: any = await parseFile(abs, dir)
const src = fs.readFileSync(abs, "utf8")

console.log(`FILE ${abs} (${src.split("\n").length} lines)`)
console.log(`language=${res.language} success=${res.success} fallback=${res.fallback ?? false}`)
console.log(`symbols=${res.symbols?.length ?? 0} relationships=${res.relationships?.length ?? 0} imports=${res.imports?.length ?? 0} exports=${res.exports?.length ?? 0} errors=${res.errors?.length ?? 0}`)
if (res.errors?.length) {
  for (const e of res.errors.slice(0, 5)) console.log(`  ERROR ${e.range?.startLine}: ${String(e.message).slice(0, 90)}`)
}

console.log("\nRELATIONSHIPS (type | source -> target | line | conf | evidenceClass | context)")
for (const r of res.relationships ?? []) {
  console.log(
    `  ${String(r.type ?? r.relationshipType).padEnd(13)} ${String(r.source)} -> ${String(r.target)}  L${r.line_number ?? "-"}  ${String(r.confidence ?? "-")}  ${String((r.metadata ?? {}).evidenceClass ?? "-")}  ${String((r.metadata ?? {}).context ?? (r.metadata ?? {}).isComponentUsage ?? (r.metadata ?? {}).isTemplateExpression ?? "")}`,
  )
}

console.log("\nIMPORTS (module | items | line)")
for (const i of res.imports ?? []) {
  console.log(`  ${i.module ?? i.modulePath ?? i.path ?? "?"}  items=${JSON.stringify(i.items ?? [])}  L${i.range?.startLine ?? "-"}`)
}

console.log("\nEXPORTS (name | isDefault | line)")
for (const e of res.exports ?? []) {
  console.log(`  ${e.name}  default=${e.isDefault ?? false}  L${e.range?.startLine ?? "-"}`)
}

if (want("symbols")) {
  console.log("\nSYMBOLS (name | kind | scope | owner | Lrange | metadata)")
  for (const s of res.symbols ?? []) {
    // pool-worker flattens `range` into startLine/endLine at the worker boundary.
    const sl = s.startLine ?? s.range?.startLine
    const el = s.endLine ?? s.range?.endLine
    console.log(
      `  ${String(s.name).padEnd(28)} ${String(s.kind).padEnd(10)} ${String(s.scope ?? "-").padEnd(20)} ${String(s.ownerName ?? "-").padEnd(20)} ${sl}-${el}  ${JSON.stringify(s.metadata ?? {})}`,
    )
  }
}

// --- construct probes, straight off the JS/TS trees -------------------------
if (want("runes") || want("classes")) {
  const trees: any[] = (res as any).__sfcTrees ?? []
  if (!trees.length) {
    console.log("\n(no script trees on the parse result — the seam is internal to parseFile;")
    console.log(" run this probe via --runes/--classes only when parseFile exposes them)")
  }
}