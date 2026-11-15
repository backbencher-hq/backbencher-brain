// #907 acceptance 3, "or the residue is named": with the audit artifact in
// hand, classify EVERY residual lost definition from the source text rather
// than asserting it. Classes:
//   MACRO_ALIAS  `#define <name>` exists in the file or a header beside it —
//                clang sees the expansion site, the tree sees the macro body,
//                so the name is not derivable from an AST node.
//   CONDITIONAL  the name never appears as a definition in the file text — the
//                node clang reports comes from a conditional/expanded region the
//                analyzer's pass does not enter (flex-generated lexer.c).
//   STILL_NAMED  the definition IS in the text — a real open finding for the
//                lane, to be reported rather than hidden.
//
// Run: bun script/m14/tmp/c907-residue-class.ts
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"

const ROOT = "/home/ishaq2321/bb_tests/repositories/jq"
const d = JSON.parse(readFileSync("validation/m12/results/c-clang-def-audit.json", "utf8"))

function macroNames(file: string): Set<string> {
  const out = new Set<string>()
  const dirs = [dirname(file), join(ROOT, "src"), ROOT]
  const scan = (p: string) => {
    let txt = ""
    try { txt = readFileSync(p, "utf8") } catch { return }
    for (const m of txt.matchAll(/^\s*#\s*define\s+([A-Za-z_]\w*)/gm)) out.add(m[1])
  }
  scan(file)
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) if (f.endsWith(".h")) scan(join(dir, f))
  }
  return out
}

const classes: Record<string, string[]> = { MACRO_ALIAS: [], CONDITIONAL: [], STILL_NAMED: [] }
let total = 0
for (const row of d.perFile) {
  if (!row.lostDefs?.length) continue
  const abs = `${ROOT}/${row.file}`
  const src = readFileSync(abs, "utf8")
  const macros = macroNames(abs)
  for (const n of row.lostDefs) {
    total++
    if (macros.has(n)) { classes.MACRO_ALIAS.push(`${row.file}:${n}`); continue }
    const inText = new RegExp(`(^|[^\\w])${n}\\s*\\(`, "m").test(src)
    if (!inText) classes.CONDITIONAL.push(`${row.file}:${n}`)
    else classes.STILL_NAMED.push(`${row.file}:${n}`)
  }
}

console.log(`\n#907 residue classification — ${total} lost definitions (clang audit @ ${d.commit.slice(0, 8)})\n`)
console.log(`jv_print.c (the #907 file): lostDefs=${JSON.stringify(d.perFile.find((r: any) => r.file.endsWith("jv_print.c"))?.lostDefs)}\n`)
for (const [k, v] of Object.entries(classes)) {
  console.log(`${k}: ${v.length}`)
  for (const x of v.slice(0, 14)) console.log(`   ${x}`)
  if (v.length > 14) console.log(`   ... (+${v.length - 14})`)
  console.log()
}
console.log(`OPEN FINDINGS (STILL_NAMED): ${classes.STILL_NAMED.length}`)
