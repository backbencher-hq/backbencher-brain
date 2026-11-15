/**
 * ANNOTATION-FORM PARSE-TREE PROBE — where an `annotation` node sits for every annotated
 * position Dart 3 permits, measured from the pinned tree-sitter-dart grammar before any
 * `references` emission is written for it.
 *
 * The owner ruling of 2026-10-18 makes annotations owed relationships, and the Java lane's
 * fixture (validation/m14/fixtures/java/annotation-references) is the model. Dart's grammar is
 * NOT Java's: there is no `marker_annotation` node (the handled-type list in
 * script/m14/spec/dart-completeness.json has exactly one: `annotation`), and an annotation is a
 * SIBLING of the declaration it decorates rather than a child of a `modifiers` node. The
 * sibling/child question is the whole emission design, so it is measured rather than assumed.
 *
 * Usage: bun run validation/m14/fixtures/dart/annotation-shapes-probe.ts
 */
import { getParser } from "../../../../src/ast/engine"

const SRC = `@deprecated
class Annotated {}

@pragma('vm:entry-point')
void annotatedTop() {}

class Holder {
  @deprecated
  int field = 1;

  @override
  String toString() => 'x';

  @JsonKey(name: 'renamed')
  final int serialized = 2;

  @Deprecated('gone')
  void method(@required int arg) {}
}

enum Kind {
  @deprecated
  old,
  fresh,
}

@immutable
@pragma('x')
final class Multi {}

@prefix.Qualified()
class PrefixedAnnotation {}

@Generic<int>()
class GenericAnnotation {}

void locals() {
  @deprecated
  final x = 1;
  print(x);
}
`

const parser = await getParser("dart")
const tree = parser.parse(SRC)
const root = tree.rootNode
const text = root.toString()
console.log(`error nodes: ${root.hasError ? "YES — a shape above is not legal in this grammar" : "none"}`)
console.log(`\n--- raw tree ---\n${text}`)
