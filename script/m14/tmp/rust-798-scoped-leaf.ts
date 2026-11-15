// rust #798 — is a scoped path's MODULE segment a `type_identifier` leaf?
// If it is, the declared-type pass's collectLeaves publishes the module as a
// reference target (`anyhow` for `anyhow::Error`), which the F5 oracle would
// mirror — a both-sides-shared name-surface defect the differential cannot see.
import { ASTEngine } from "../../../src/ast/engine"
import { RealRustAnalyzer } from "../../../src/ast/real-rust-analyzer"

const SRC = `
fn param(error: anyhow::Error, p: std::path::Path) -> ok::Thing {
    todo!()
}
fn parse<E>(raw: &str) -> u32
where
    anyhow::Error: From<E>,
{
    let _ = raw;
    0
}
struct S { f: anyhow::Error }
`

const parser = await ASTEngine.getParser("rust" as any)
const root: any = parser.parse(SRC).rootNode

const dump = (n: any, d = 0): void => {
  const t = n.type
  if (/type|scoped|identifier|parameter|where|field/.test(t)) {
    console.log(`${"  ".repeat(d)}${t} ${JSON.stringify(n.text)}`)
  }
  for (let i = 0; i < n.namedChildCount; i++) dump(n.namedChild(i), d + 1)
}
dump(root)

const analyzer = new RealRustAnalyzer()
const res: any = await analyzer.analyze(root, SRC, "probe.rs")
console.log("=== references targets ===")
for (const r of res.relationships ?? []) {
  if (r.type === "references") console.log(`  ${r.source} -> ${JSON.stringify(r.target)}  md=${JSON.stringify(r.metadata ?? {})}`)
}
