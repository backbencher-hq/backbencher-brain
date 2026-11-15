// fixture: scala/import-multiline-825
// M59 (#825): an import reference's line is the line its TARGET is written on,
// not the line the import statement opens on. Measured on cats-effect
// TestInstances.scala: the module `cats.effect.kernel.testkit` opens on the
// `import` line, but the segment the edge's target is named after — the renamed
// selector `TestInstances => KernelTestkitTestInstances` — is written nine lines
// later, so the edge claimed a line its own name is not on. Every import edge
// below is checked against the source line, not against the analyzer's opinion.
package imports

import scala.collection.{
  mutable => mut,
  immutable
}

import scala.util.Try

class Uses {
  def f: Int = 1
}
