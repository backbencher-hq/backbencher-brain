/**
 * PERL-MR11: does a `calls` edge lose a derivable receiver?
 *
 * Found by putting the question to the AST rather than to either derivation. The
 * differential reported 100% coverage with 0 unexplained on all seven corpora
 * throughout, and so did the fixtures, because the oracle derived a call target
 * by leaf name exactly as the analyzer did. Two implementations that share a
 * premise agree — and this lane has now found that failure mode three times (the
 * `use constant { ... }` dead branch, the oracle's `!inSub` gap, and this). So
 * the only way to see it is to read the tree and compare against what the
 * analyzer actually published.
 *
 * The rule, which is one rule with two labels:
 *
 *   receiver is a VALUE (`$self`, a chained call, a scalar)
 *       -> the leaf is correct; there is no class to name.
 *   receiver is a `package` node, or a bareword carrying `::`
 *       -> the class is PROVABLE, so the target is `Receiver.method`.
 *   receiver is a bare bareword with no `::`  (`app`)
 *       -> NOT provable. In practice this is a lexical far more often than a
 *          class — `app->log->level('fatal')` in mojo's t/mojo/cgi.t — so it
 *          keeps the leaf. The grammar types `app` and `Mojo::IOLoop` both as
 *          `bareword`, so node type cannot separate them and only the `::` can.
 *
 * This instrument reports all three, and checks the analyzer against the third.
 * A `mismatch` is an analyzer bug: the tree says one thing and the published
 * target says another.
 *
 * usage: bun script/m14/tmp/perl-receiver-scope.mts <corpusDir> [limit]
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(import.meta.dir, "..", "..", "..")
const OUT = process.env.BB_PERL_OUT ?? "/tmp"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const p = new P()
p.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-perl.wasm"))))
const { RealPerlAnalyzer } = await import(path.join(ROOT, "src/ast/real-perl-analyzer.ts"))
const { PERL_BUILTINS } = await import(path.join(ROOT, "src/ast/real-perl-analyzer.ts"))

const namesAClass = (n: any): boolean => {
  switch (n?.type) {
    case "bareword":
    case "autoquoted_bareword":
    case "package":
    case "ambiguous_function_call_expression":
      return true
    case "string_literal":
    case "interpolated_string_literal":
      return !String(n.text ?? "").includes("$")
    default:
      return false
  }
}
const fieldNodes = (n: any, name: string): any[] => {
  const out: any[] = []
  for (let i = 0; i < n.childCount; i++) if (n.fieldNameForChild(i) === name) out.push(n.child(i))
  return out
}
const leaf = (s: string) => String(s ?? "").split("::").filter(Boolean).pop() ?? ""

function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 12) return out
  let es: fs.Dirent[]
  try { es = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of es) {
    if (e.name === ".git" || e.name === "build") continue
    const q = path.join(dir, e.name)
    if (e.isDirectory()) walk(q, out, depth + 1)
    else if (/\.(pm|pl|t)$/.test(e.name)) out.push(q)
  }
  return out
}

const dir = process.argv[2]
const limit = Number(process.argv[3] ?? 100000)
const files = walk(dir).sort().slice(0, limit)

const tally: Record<string, number> = { calls: 0, valueReceiver: 0, provablePackage: 0, barewordVariable: 0, builtinMethod: 0, qualifiedExpected: 0, qualifiedPublished: 0, mismatch: 0 }
const samples: any[] = []
const mismatches: any[] = []

for (const f of files) {
  let src: string
  try { src = fs.readFileSync(f, "utf8") } catch { continue }
  // `.rootNode` — `p.parse()` returns a Tree, and walking the Tree itself has
  // `childCount === 0`, so the walk finds nothing and reports a clean 0% rather
  // than failing. A measurement that cannot distinguish "no defects" from
  // "walked nothing" is not a measurement.
  const root:any = p.parse(src).rootNode
  let res: any
  try { res = new RealPerlAnalyzer().analyze(root, src, f) } catch { continue }
  const published = new Set(
    (res.relationships ?? []).filter((r: any) => r.type === "calls").map((r: any) => `${r.source}\u001f${r.target}`),
  )
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()
    if (n.type === "method_call_expression") {
      const method = n.children.find((c: any) => c.type === "method")?.text ?? ""
      const inv = fieldNodes(n, "invocant").find((c: any) => c.isNamed) ?? n.namedChild(0)
      if (inv && method && !PERL_BUILTINS.has(method)) {
        tally.calls++
        if (!namesAClass(inv)) {
          tally.valueReceiver++
        } else if (inv.type === "package" || String(inv.text ?? "").includes("::")) {
          tally.provablePackage++
          const expected = `${leaf(inv.text)}.${method}`
          tally.qualifiedExpected++
          if (published.has(`global\u001f${expected}`)) tally.qualifiedPublished++
        } else {
          tally.barewordVariable++
          if (samples.length < 8) samples.push({ file: path.relative(dir, f), line: n.startPosition.row + 1, source: n.text.slice(0, 50), keptLeaf: method })
        }
      }
    }
    // `n.children` is undefined on some nodes of this grammar, and holds nulls
    // on others (an error node's missing child). Iterating by `childCount` /
    // `child(i)` with a guard is the idiom the analyzer itself uses; an
    // instrument has to be at least as careful as the thing it audits, and this
    // one threw on the first malformed node.
    for (let i = 0; i < (n.childCount ?? 0); i++) {
      const c = n.child(i)
      if (c) st.push(c)
    }
  }
  // a published target with a dotted receiver that the tree does not justify
  for (const r of (res.relationships ?? []).filter((x: any) => x.type === "calls")) {
    if (typeof r.target !== "string" || !r.target.includes(".")) continue
    if (PERL_BUILTINS.has(r.target.split(".").pop() ?? "")) {
      tally.mismatch++
      if (mismatches.length < 10) mismatches.push({ file: path.relative(dir, f), line: r.line_number, target: r.target, why: "method is a perl builtin and should have been suppressed" })
    }
  }
}

if (tally.calls === 0) {
  console.error(`corpus: ${dir}  files: ${files.length}`)
  console.error("  ZERO method calls were walked. That is the instrument failing, not a clean result —")
  console.error("  refusing to report 0% as if it were a measurement.")
  process.exit(2)
}
const pct = (100 * tally.provablePackage) / tally.calls
console.log(`corpus: ${dir}  files: ${files.length}`)
console.log(`  calls edges published                  : ${tally.calls}`)
console.log(`  receiver is a VALUE                    : ${tally.valueReceiver}   leaf is correct`)
console.log(`  receiver is a bare bareword (VARIABLE) : ${tally.barewordVariable}   leaf is correct — not provable`)
console.log(`  receiver is a PROVABLE package         : ${tally.provablePackage}   now published QUALIFIED`)
console.log(`  share of calls whose owner is derivable: ${pct.toFixed(1)}%`)
console.log(`  published targets with a dotted receiver that the tree does not justify: ${tally.mismatch}`)
if (samples.length) {
  console.log("\n  bare barewords correctly left as a leaf:")
  for (const s of samples) console.log(`    ${s.file}:${s.line}  ${s.source}  ->  '${s.keptLeaf}'`)
}
if (mismatches.length) {
  console.log("\n  MISMATCHES:")
  for (const m of mismatches) console.log(`    ${m.file}:${m.line}  ${m.target}  ${m.why}`)
}
fs.writeFileSync(path.join(OUT, "perl-receiver-scope.json"), JSON.stringify({ dir, files: files.length, ...tally, derivableSharePct: Number(pct.toFixed(2)), samples, mismatches }, null, 2) + "\n")
process.exit(tally.mismatch > 0 ? 1 : 0)
