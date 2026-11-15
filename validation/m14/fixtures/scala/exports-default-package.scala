// A Scala file with NO package clause lives in the default package, where the
// compilation unit IS the module. The `exports` source there is the FILE_MODULE
// sentinel `(file)` — zig's spelling, and the same kind of published name as this
// lane's own `(script)` and `root`. The alternative, publishing an empty source,
// is the defect M60/SDJ-11 removed for imports: an edge with no endpoint names
// nothing.

class Loose

object Loose {
  def make(): Loose = new Loose
}

private class AlsoHidden

export other.module.Gamma