/**
 * PATTERN-FORM PARSE-TREE PROBE — the shapes DARTGAP2 is about, measured from the pinned
 * tree-sitter-dart grammar before any reader is written.
 *
 * DARTGAP2 (`script/m14/spec/dart-completeness.json`): the `qualified`-constant case is CLOSED
 * (commit 3d4d7fa4). What remains is the bare-identifier constant, and the null-check /
 * null-assert / relational / collection pattern forms. The question this probe answers is not
 * "what does Dart mean" — that is in the language spec — it is "which NODE TYPES does the pinned
 * grammar produce for each spelling", because the analyzer reads the grammar, not the spec.
 *
 * Every shape below is legal Dart 3. A reader written from the output of this probe cannot
 * disagree with the grammar it will run against.
 *
 * Usage: bun run validation/m14/fixtures/dart/pattern-forms-probe.ts
 */
import { getParser } from "../../../../src/ast/engine"

const SRC = `const int kOne = 1;
const int kNested = kOne;
enum Mode { off, on }
const Mode kMode = Mode.off;

void switchForms(Object x) {
  switch (x) {
    case kOne: print(1);
    case Mode.off: print(3);
    case kOne || kNested: print(4);
  }
}

void ifCaseForms(Object x) {
  if (x case kOne) print(5);
  if (x case kNested?) print(6);
  if (x case kOne!) print(7);
  if (x case > 0) print(8);
  if (x case >= kOne) print(9);
  if (x case [kOne, 2]) print(10);
  if (x case [kOne, ...]) print(11);
  if (x case {'a': kOne, 'b': _}) print(12);
  if (x case (kOne, 2)) print(13);
  if (x case (a: kOne, b: 2)) print(14);
  if (x case int? n) print(15);
  if (x case final int? m) print(16);
  if (x case kMode) print(17);
}

void bindingForms(Object x) {
  if (x case int n) print(n);
  if (x case (int a, int b)) print(a + b);
  if (x case [int first, ...rest]) print(first + rest.length);
  for (final (int p, int q) in <(int, int)>[]) print(p + q);
}

void objectForms(Object x) {
  if (x case String(length: final len)) print(len);
  if (x case Mode.off) print(0);
  switch (x) {
    case Mode mode: print(mode);
    case >= kOne: print(1);
    default: break;
  }
}

void destructuringDecls() {
  var (int a, int b) = (1, 2);
  var [int c, int d] = <int>[3, 4];
  var {'k': int e} = <String, int>{'k': 5};
  final [int f, ...rest] = <int>[6, 7];
  print(a + b + c + d + e + f + rest.length);
}
`

const parser = await getParser("dart")
const tree = parser.parse(SRC)
const root = tree.rootNode
const text = root.toString()
// One shape per line, indented, so a reader can see the nesting a reader would walk. The
// rewrite is display-only; the raw tree is printed whole if the caller asks for it.
const oneLine = text
  .replace(/\(/g, "(\n")
  .replace(/\)/g, ")")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.length > 0)
console.log(oneLine.slice(0, 400).join("\n"))
console.log(`\n--- raw (first 12,000 chars) ---\n${text.slice(0, 12000)}`)
console.log(`\nerror nodes: ${root.hasError ? "YES — a shape above is not legal in this grammar" : "none"}`)
