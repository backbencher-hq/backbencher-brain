/**
 * Two open questions from the corpus differential:
 *   Q1  SWALLOW CLASS (#907) — a `kms "aead" { … }` block that the analyzer does
 *       not emit, inside a file whose first two lines are Go-template
 *       `{{decrypt(…)}}` expressions. Is a real definition being absorbed into
 *       a damaged enclosing node?
 *   Q2  attribute-key duplication — is `atlantis|atlantis_gh_team_whitelist` at
 *       lines 6 and 187 a genuine duplicate key in one block (Terraform rejects
 *       that) or two distinct blocks colliding?
 */
import { readFileSync, writeFileSync } from "node:fs"
import { ASTEngine } from "<corpus-root>/backbencher-brain/src/ast/engine"
import { RealHclAnalyzer } from "<corpus-root>/backbencher-brain/src/ast/real-hcl-analyzer"

const parser = await ASTEngine.getParser("hcl")
const analyzer = new RealHclAnalyzer()
const out: string[] = []

function tree(n: any, depth = 0, max = 14): string[] {
  const rows = [
    `${"  ".repeat(depth)}${n.type}${n.isNamed ? "" : " (anon)"}${n.isError ? " ERRORNODE" : ""}${n.isMissing ? " MISSING" : ""} «${n.text.replace(/\n/g, "\\n").slice(0, 70)}» L${n.startPosition.row + 1}-${n.endPosition.row + 1}`,
  ]
  if (depth >= max) return rows
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) rows.push(...tree(c, depth + 1, max))
  }
  return rows
}

// ---------------- Q1: the swallow class ----------------
{
  const f = "<corpus-root>/bb_tests/hcl/repos/boundary/internal/cmd/commands/config/fixtures/config_ext_decrypt.hcl"
  const src = readFileSync(f, "utf8")
  out.push(`\n${"=".repeat(78)}\nQ1  SWALLOW CLASS — ${f}\n${"=".repeat(78)}`)
  out.push(src.split("\n").map((l, i) => `  ${String(i + 1).padStart(3)} | ${l}`).join("\n"))
  const t = parser.parse(src)
  out.push("\nFULL TREE:")
  out.push(...tree(t.rootNode))
  const res = analyzer.analyze(t.rootNode as any, src, f)
  out.push(`\nEMITTED SYMBOLS (${res.symbols.length}):`)
  for (const s of res.symbols)
    out.push(`   ${s.kind.padEnd(8)} ${JSON.stringify(s.name)} scope=${JSON.stringify(s.scope)} L${s.range.startLine}`)
  out.push(`EMITTED RELATIONSHIPS (${res.relationships.length}):`)
  for (const r of res.relationships) out.push(`   ${r.type} ${r.source} -> ${r.target} @L${(r as any).line}`)

  // Minimal reconstruction: the same file with the two Go-template lines removed.
  const stripped = src
    .split("\n")
    .filter((l) => !l.includes("{{decrypt("))
    .join("\n")
  out.push(`\nMINIMAL RECONSTRUCTION (Go-template lines removed):\n${stripped.split("\n").map((l, i) => `  ${String(i + 1).padStart(3)} | ${l}`).join("\n")}`)
  const t2 = parser.parse(stripped)
  const res2 = analyzer.analyze(t2.rootNode as any, stripped, f)
  out.push(`\nRECONSTRUCTED SYMBOLS (${res2.symbols.length}):`)
  for (const s of res2.symbols)
    out.push(`   ${s.kind.padEnd(8)} ${JSON.stringify(s.name)} scope=${JSON.stringify(s.scope)} L${s.range.startLine}`)
  t.delete()
  t2.delete()
}

// ---------------- Q2: attribute-key duplication ----------------
{
  const f = "<corpus-root>/bb_tests/hcl/repos/tf-aws-components/deprecated/aws/ecs/atlantis.tf"
  const src = readFileSync(f, "utf8")
  const lines = src.split("\n")
  out.push(`\n${"=".repeat(78)}\nQ2  attribute duplication — ${f}\n${"=".repeat(78)}`)
  for (const [a, b] of [
    [1, 30],
    [180, 200],
  ]) {
    out.push(`  --- lines ${a}..${b} ---`)
    for (let i = a - 1; i < Math.min(lines.length, b); i++) out.push(`  ${String(i + 1).padStart(4)} | ${lines[i]}`)
  }
  const t = parser.parse(src)
  const res = analyzer.analyze(t.rootNode as any, src, f)
  out.push(`\nBLOCKS in this file:`)
  for (const s of res.symbols.filter((x) => x.kind !== "property"))
    out.push(`   ${s.kind.padEnd(8)} ${JSON.stringify(s.name)} scope=${JSON.stringify(s.scope)} L${s.range.startLine} meta=${JSON.stringify(s.metadata)}`)
  t.delete()
}

writeFileSync("<corpus-root>/bb_tests/hcl/out/open-questions.txt", out.join("\n") + "\n")
console.log(out.join("\n"))
