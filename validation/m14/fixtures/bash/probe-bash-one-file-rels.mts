/**
 * Per-file relationship counts, through the PRODUCTION entry point.
 *
 * Why this exists. Two whole-corpus census runs, days apart, on the same
 * analyzer and the same 4,133 admitted files, differed by 67 relationships
 * while `overrides` / `imports` / `references` / `exports` were bit-identical.
 * Each run put a different number of files past the pinned wasm into
 * `extractFallback`, and a fallback file contributes 0 relationships for bash.
 * So the claim "the delta is one file that fell back" is checkable, and this is
 * the check: name the file and read off what the grammar would have given it.
 *
 * No regex: it prints what the analyzer returns.
 *
 *   npx tsx validation/m14/fixtures/bash/probe-bash-one-file-rels.mts <file>...
 */
import { parseFile } from "../../../../src/ast/pool-worker"

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error("usage: probe-bash-one-file-rels.mts <file>...")
  process.exit(2)
}

let grand = 0
for (const f of files) {
  const r: any = await parseFile(f)
  const by: Record<string, number> = {}
  for (const rel of r.relationships ?? []) by[rel.type] = (by[rel.type] ?? 0) + 1
  const n = (r.relationships ?? []).length
  grand += n
  const parts = Object.keys(by).sort().map((k) => `${k} ${by[k]}`)
  console.log(`${f}\n  symbols ${r.symbols?.length ?? 0}  relationships ${n}  ${parts.join(" · ")}`)
}
console.log(`\ntotal relationships across ${files.length} file(s): ${grand}`)