// fixture: scala/declaration-name-anchoring
// M60 scala fold (2026-10-10). The anchor of a declaration is its NAME node —
// not the first non-trivia child, which for a MODIFIER-PREFIXED declaration is
// the modifier. tree-sitter-scala models `opaque` and `inline` as their own
// named child nodes, so `opaque type Size = Int` anchored the `Size` symbol on
// the `opaque` token (column 1, not 13) and `inline op: Int` picked `inline`.
// Measured over the 18,965-file scala corpus, 600-file lexicographic sample:
// 50,425 declaration name-field nodes, 141 disagreements — 22 `type_definition`
// and 119 `parameter` — every one of them a modifier, and every one of them on
// the SAME LINE, which is why no `contains`/`extends` row moved and only the
// symbol range did. The scanner is the family's own answer
// (`childForFieldName("name")`), which java, kotlin and groovy read.
package anchoring

opaque type Size = Int

final opaque type Guarded = String

class Holder[T] {
  def apply(inline op: Int, default that: Int): Unit = ()
}

object Ops {
  def ++(a: Int, b: Int): Int = a + b
}
