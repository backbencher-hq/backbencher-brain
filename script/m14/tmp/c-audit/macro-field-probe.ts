/**
 * C audit probe: macro-generated struct FIELDS.
 *
 * A vendored C family declares bitfields through a macro:
 *
 *   #define BIT(x) int x : 1
 *   struct s { BIT(closing); BIT(keepalive); };
 *
 * tree-sitter-c cannot expand the macro (C-D2: the preprocessor is textual), so
 * the field_declaration's TYPE is the macro call `BIT(closing)` and its DECLARATOR
 * is... nothing the analyzer can read as a name. The question this probe answers
 * is not "is the macro expanded" -- C-D2 already rules that out -- but "what
 * SYMBOL does the analyzer publish for a field it cannot name", because a
 * fabricated member is exactly the phantom class CGD34 was opened for.
 *
 *   bun run script/m14/tmp/c-audit/macro-field-probe.ts
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..", "..", "..")
const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm"))))
const { RealCAnalyzer } = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))

const CASES: Array<{ label: string; src: string }> = [
  {
    label: "macro-generated bitfields (curl BIT pattern)",
    src: `#define BIT(x) int x : 1
struct flags {
  int a;
  BIT(closing);
  BIT(keepalive);
  int b;
};
`,
  },
  {
    label: "macro-generated plain field",
    src: `#define MEMBER(t, n) t n
struct holder {
  int before;
  MEMBER(int *, payload);
  int after;
};
`,
  },
  {
    label: "macro-generated field with NO argument",
    src: `#define RESERVED int
struct padded {
  int a;
  RESERVED;
  int b;
};
`,
  },
]

for (const c of CASES) {
  const res: any = new RealCAnalyzer().analyze(parser.parse(c.src).rootNode, c.src, c.label)
  const fields = res.symbols.filter((s: any) => s.ownerName === "flags" || s.ownerName === "holder" || s.ownerName === "padded")
  console.log(`\n=== ${c.label} ===`)
  console.log(c.src)
  console.log(`  symbols: ${res.symbols.length}; members of the struct: ${fields.length}`)
  for (const f of fields) {
    console.log(
      `    ${String(f.kind).padEnd(9)} ${JSON.stringify(f.name).padEnd(16)} L${f.range.startLine}` +
        ` owner=${f.ownerName} range=[${f.range.startLine}:${f.range.startColumn}-${f.range.endLine}:${f.range.endColumn}]`,
    )
  }
  const contains = res.relationships.filter((r: any) => r.type === "contains")
  console.log(`  contains edges: ${contains.map((r: any) => `${r.source}->${r.target}@L${r.line_number}`).join(", ")}`)
  const names = fields.map((f: any) => f.name)
  const dupes = names.filter((n: string, i: number) => names.indexOf(n) !== i)
  if (dupes.length) console.log(`  DUPLICATE MEMBER NAMES: ${JSON.stringify([...new Set(dupes)])}`)
  const st = res.symbols.find((s: any) => s.kind === "struct")
  if (st) console.log(`  struct metadata: ${JSON.stringify(st.metadata)}`)
}
