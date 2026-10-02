/**
 * F10 / next-round probe — the shapes of every WRITTEN TYPE position in the pinned
 * php grammar, and which shape carries which node types.
 *
 * Written to be read BEFORE the independent declared-type oracle, so that oracle
 * is written from the grammar's own shapes and not by re-reading the analyzer.
 */
import { readFileSync } from "node:fs"
const ROOT = "$HOME/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
await P.init({ locateFile: () => `${ROOT}/node_modules/web-tree-sitter/tree-sitter.wasm` })
const g: any = await (wts as any).Language.load(readFileSync(`${ROOT}/wasm/tree-sitter-php.wasm`))
const p = new P(); p.setLanguage(g)

const SAMPLES: Record<string, string> = {
  "property bare": "<?php class C { private Dep $x; }",
  "property nullable": "<?php class C { private ?Dep $x; }",
  "property union": "<?php class C { private Dep|Other $x; }",
  "property intersection": "<?php class C { private Dep&IS $x; }",
  "property DNF": "<?php class C { private (Dep&IS)|null $x; }",
  "property qualified": "<?php class C { private \\App\\Lib\\Dep $x; }",
  "property leading-backslash": "<?php class C { private \\Dep $x; }",
  "return nullable": "<?php class C { public function m(): ?Dep {} }",
  "return union": "<?php class C { public function m(): Dep|Other {} }",
  "return static": "<?php class C { public static function m(): static {} }",
  "return parent": "<?php class C extends B { public function m(): parent {} }",
  "return self": "<?php class C { public function m(): self {} }",
  "return void": "<?php class C { public function m(): void {} }",
  "return never": "<?php class C { public function m(): never {} }",
  "return false": "<?php function f(): false {} }",
  "param bare": "<?php function f(Dep $a) {}",
  "param nullable": "<?php function f(?Dep $a) {}",
  "param union": "<?php function f(Dep|Other $a) {}",
  "variadic param": "<?php function f(Dep ...$r) {}",
  "promoted": "<?php class C { public function __construct(private Dep $d) {} }",
  "promoted variadic": "<?php class C { public function __construct(private Dep ...$d) {} }",
  "promoted qualified": "<?php class C { public function __construct(private \\App\\Dep $d) {} }",
  "arrow fn": "<?php $f = fn(Dep $x): Dep => $x;",
  "closure": "<?php $f = function(Dep $x): Dep { return $x; };",
  "interface const typed": "<?php interface I { const Dep X = 1; }",
  "file const typed": "<?php const Dep TOP = 1;",
}

const dump = (n: any, d = 0, out: string[] = []): string[] => {
  out.push(" ".repeat(d) + n.type + (n.isNamed ? "" : "·"))
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) dump(c, d + 1, out) }
  return out
}
for (const [label, src] of Object.entries(SAMPLES)) {
  const t = p.parse(src)
  // only the type-bearing subtree, so the output is about SHAPES not about tokens
  const lines = dump(t.rootNode).filter((l) => /type|name|variable_name/.test(l)).map((l) => l.trim())
  // field names the grammar actually publishes for the type positions
  const fields: string[] = []
  const st: any[] = [t.rootNode]
  while (st.length) {
    const n = st.pop()!
    if (["property_declaration", "const_declaration", "simple_parameter", "variadic_parameter", "property_promotion_parameter", "method_declaration", "function_definition"].includes(n.type)) {
      for (const f of ["type", "return_type"]) { const v = n.childForFieldName?.(f); if (v) fields.push(`${n.type}.${f}=${v.text}`) }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) st.push(c) }
  }
  console.log(`${label.padEnd(26)} ${lines.join(" | ")}`)
  if (fields.length) console.log(`${"".padEnd(26)}   FIELD: ${fields.join(", ")}`)
}
process.exit(0)
