/**
 * Extract the three rust F5 oracles (plus the top-level helpers they reference)
 * from a harness snapshot into a standalone module, using the TypeScript AST so
 * the extraction is exact rather than brace-counted.
 *
 * WHY THIS EXISTS (rust master review, 2026-09-29): script/m14/differential.ts
 * does not parse at HEAD, and is under live edit by another lane. Two committed
 * versions were measured broken (a truncated HCL LANGS entry region at 19981 and
 * an earlier one at 18914); 4804a789 is the newest commit that parses. The rust
 * oracle LOGIC must not be re-implemented for a review to be worth anything, so it
 * is lifted verbatim from the parseable commit and the rust region is then
 * DIFFED against HEAD to prove the extracted code is the committed code.
 *
 * CLI: npx tsx script/m14/tmp/extract-rust-oracles.ts <snapshot.ts> <out.ts>
 */
import * as fs from "node:fs"
import * as ts from "typescript"

const [, , IN = "/tmp/opencode/diff-good.ts", OUT = "/home/sano/ishaq/backbencher-brain/script/m14/tmp/rust-oracles.snapshot.ts"] = process.argv
const WANT = ["deriveRustEdges", "deriveRustBareUses", "deriveRustDeclaredTypeRefs"]

const text = fs.readFileSync(IN, "utf8")
const sf = ts.createSourceFile("snap.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)

const decls = new Map<string, ts.Node>()
for (const st of sf.statements) {
  if (ts.isFunctionDeclaration(st) && st.name) decls.set(st.name.text, st)
  else if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) decls.set(d.name.text, st)
  else if (ts.isClassDeclaration(st) && st.name) decls.set(st.name.text, st)
}
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: false })

const want = new Set<string>(WANT)
const picked = new Map<string, ts.Node>()
for (const w of WANT) { const d = decls.get(w); if (!d) { console.error(`MISSING ${w} in ${IN}`); process.exit(1) } picked.set(w, d!) }

const seen = new Set<string>()
const queue = [...WANT]
while (queue.length) {
  const n = queue.shift()!
  if (seen.has(n)) continue
  seen.add(n)
  const d = decls.get(n)
  if (!d) continue
  // collect identifiers from EVERY visited node, including the three roots —
  // skipping the roots is how the first run pulled 0 helpers and then died on
  // `lastSegment is not defined`
  for (const id of collectIdents(d)) if (decls.has(id) && !picked.has(id)) queue.push(id)
  if (!picked.has(n)) picked.set(n, d)
}
function collectIdents(n: ts.Node): string[] {
  const out: string[] = []
  const visit = (x: ts.Node) => {
    if (ts.isIdentifier(x)) out.push(x.text)
    x.forEachChild(visit)
  }
  visit(n)
  return out
}

const header = `/** rust F5 oracles, lifted VERBATIM from ${IN} by extract-rust-oracles.ts (TS AST, not brace counting). Oracle logic unchanged; only packaging differs. */`
const body = [...picked.keys()].sort((a, b) => (WANT.includes(a) ? -1 : 1) - (WANT.includes(b) ? -1 : 1)).map((n) => printer.printNode(ts.EmitHint.Unspecified, picked.get(n)!, sf)).join("\n\n")
fs.writeFileSync(OUT, header + "\n\n" + body + "\n")
console.log(`extracted ${WANT.length} oracles + ${picked.size - WANT.length} helpers (${picked.size} nodes) -> ${OUT}`)
console.log(`helpers: ${[...picked.keys()].filter((k) => !WANT.includes(k)).sort().join(", ")}`)
