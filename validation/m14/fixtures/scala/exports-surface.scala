package com.example
package exports

// `exports` is the module's PUBLIC SURFACE, and until this label shipped the
// lane filled ParseResult.exports (an ExportInfo[] carried on the side) while
// publishing no relationship of the type — the same shape 12 lanes shared. The
// source of the edge is the module: the full CHAINED package path, which is what
// a reference site spells (`import com.example.exports.Widget`).

// A. IMPLICIT — every public TOP-LEVEL declaration is exported from its package.
// The package path is the CONCATENATION of the two clauses above, so this file's
// module is `com.example.exports` and not the last clause alone
// (`exports`) — metadata.packageName holds that fragment, and an edge built on
// it would name a package that does not exist.

// A COMPANION PAIR. The class is declared FIRST, which is the order in which the
// ExportInfo array's object-suppression works (measured: object-first leaves a
// repeated name — scala/scala Contexts.scala, `object ContextMode` line 2003,
// `class ContextMode` line 2109, 42 repeated names per 883 entries at 600 files
// — so that order cannot appear in a fixture at all: the runner's F3 export
// invariant rejects a repeated export name outright). The (module, name) dedupe
// is pinned further down instead, by a name that a declaration AND a Scala 3
// clause both introduce.
class Widget(val id: Int)

object Widget {
  def make(id: Int): Widget = new Widget(id)
}

trait Renderer

class Helper

val defaultId: Int = 7

def helperName: String = "helper"

// A backticked identifier IS a name, and its text contains a space. The house
// rule (M60/#924) is that quoting syntax is not part of a NAME, so the symbol is
// `odd name` and every edge that names it must use the same spelling. Before the
// surface was derived from `symbol.name`, the export array carried the RAW text
// "`odd name`" while the symbol carried the stripped one — two spellings of one
// public name, and the edge would have picked the wrong one.
val `odd name`: Int = 1

// NOT part of the surface: a private top-level class is invisible outside its
// file, so publishing it would be a fabricated endpoint.
private class Hidden

// Scala 3 re-export clauses. `export_declaration` used to be read only to set a
// pattern flag.
// `Widget` is introduced TWICE — declared above and re-exported here. The module
// exports the name once, so expectRelationshipCount pins exactly one edge.
export other.module.Widget

export other.module.Alpha
export other.module.{Beta, Gamma}
export other.module.{Delta => Renamed}
export other.module.{given Ordering[Int]}
export other.module.Epsilon

// These two re-export a SET the clause does not name: `*` is every member of
// another module and `given` is every instance implicit resolution finds for
// it. Neither has a name to publish, and an edge per imagined member would be
// fabrication. forbidRelationships below pins that no edge is published for
// them.
export other.module.*
export other.module.given