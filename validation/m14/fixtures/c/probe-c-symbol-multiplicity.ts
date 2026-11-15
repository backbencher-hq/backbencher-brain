/**
 * probe-c-symbol-multiplicity — DOES THE C ANALYZER PUBLISH ONE SYMBOL FOR A NAME, OR MORE?
 *
 * Author: Muhammad Ishaq Khan. Probe, not production code. READ-ONLY.
 *
 * THE QUESTION. The gate's key space counts ONE DECLARATION PER SYMBOL:
 * `incoming-gate.ts:1457-1462` — `countKey(name, kind, file, line, …)` increments `pooledDecl` for
 * EVERY symbol with that name, and `classifyEdge` reads `decls > 1` as AMBIGUOUS.
 *
 * **So the wall's buckets (which count HEADER DECLARATION ENTRIES, from a text-level scan) and the
 * arbiter's key space (which counts ANALYZER SYMBOLS over the admitted files) ARE NOT THE SAME
 * COUNT.** The java lane found exactly this shape for java: the analyzer publishes a constructor
 * under its CLASS's name, so every class answers TWICE to its own name and 34,331 rows are
 * ambiguous although the project declares the name exactly once (Master Review §8.2 3.15).
 *
 * **THE C QUESTION IS: does the C analyzer publish a name more than once per file?** The three
 * shapes that could do it:
 *   S1 · a PROTOTYPE and a DEFINITION of the same function in one file;
 *   S2 · a `typedef struct X { … } X;` — the TAG and the TYPEDEF are both named X;
 *   S3 · a `static` function in a header, and the header is parsed ONCE (the gate parses each
 *        admitted file once and does not expand includes) — so a header contributes its own
 *        declarations once, NOT once per including file. **This probe asserts S3, because if it
 *        were false the whole header-declaration-space idea would be priced wrong.**
 *
 * The probe parses SYNTHETIC sources with the REAL analyzer and prints, per name, how many symbols
 * the analyzer published. It measures the SHAPE; the population size is the `c,h` arm's job.
 */
import { getParser } from "../../../../src/ast/engine"
import { RealCAnalyzer } from "../../../../src/ast/real-c-analyzer"

const CASES: Array<{ id: string; source: string }> = [
  {
    id: "S1 prototype + definition in one file",
    source: `int f(int n);
int f(int n) { return n + 1; }
`,
  },
  {
    id: "S2 typedef of a struct with the SAME name",
    source: `typedef struct X { int a; } X;
`,
  },
  {
    id: "S2b typedef of a struct with a DIFFERENT name",
    source: `typedef struct X { int a; } XOther;
`,
  },
  {
    id: "S3 a static function in a header (the header is parsed once)",
    source: `static int helper(int n) { return n; }
int caller(int n) { return helper(n); }
`,
  },
  {
    id: "S4 an extern declaration and a definition",
    source: `extern int g(int n);
int g(int n) { return n; }
`,
  },
  {
    id: "S5 an enum and an enumerator",
    source: `enum E { ONE, TWO };
int use(void) { return ONE + TWO; }
`,
  },
]

async function main(): Promise<void> {
  const parser = await getParser("c" as any)
  console.log("probe-c-symbol-multiplicity — how many SYMBOLS does the C analyzer publish per name?")
  console.log("")
  for (const c of CASES) {
    const analyzer = new (RealCAnalyzer as any)()
    const res = await analyzer.analyze(parser.parse(c.source).rootNode, c.source, "probe/synthetic.c")
    const syms = (res.symbols ?? []) as any[]
    const byName = new Map<string, any[]>()
    for (const s of syms) {
      const n = String(s?.name ?? "")
      if (!n) continue
      if (!byName.has(n)) byName.set(n, [])
      byName.get(n)!.push(s)
    }
    const rels = (res.relationships ?? []) as any[]
    console.log(`── ${c.id}`)
    console.log(`   symbols: ${syms.length}`)
    for (const [name, list] of [...byName.entries()].sort()) {
      const kinds = list.map((s) => String(s?.kind ?? "?")).join(", ")
      const lines = list.map((s) => Number((s as any)?.range?.startLine ?? 0)).join(",")
      const flag = list.length > 1 ? "   ← MORE THAN ONE" : ""
      console.log(`     ${name.padEnd(14)} ×${list.length}  kinds=[${kinds}] lines=[${lines}]${flag}`)
    }
    const exportsRels = rels.filter((r) => String(r.type) === "exports")
    console.log(`   relationships: ${rels.length} (exports ${exportsRels.length})`)
    console.log("")
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
