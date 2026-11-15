// JD6 regression fixture — an edge from a superseded body dies with the symbol.
//
// Three passes emit edges, and only one of them knew about superseded bodies.
// `extractCallRelationships` has re-checked `isNodeInDeadSpans` throughout;
// the edges pushed inline during the walk (heritage, CJS surface writes), the
// `exports` array that `extractExportRelationships` turns into rows, and
// `collectFieldAccessUses` did not. So a symbol removed as dead kept its edges
// and the graph gained rows whose source or target is not in the index — a
// dangling node that `bb_graph` and `bb_impact` will happily traverse.
//
// The trigger is a nested class inside a DUPLICATE method body (a class is the
// only symbol-yielding declaration legal inside a function body), so the fixture
// puts one in front of each leaking shape and then repeats the shapes LIVE, which
// is the half that matters: a filter that is too eager silently deletes real
// edges, and only the live assertions can catch that.

class Base {}

class Trigger {
  m() {
    class Inner extends Base {}
    module.exports.ghost = 1;
    return Inner;
  }
  m() {
    return 2;
  }
}

class Live {
  m() {
    class Inner extends Base {}
    return Inner;
  }
  n() {
    module.exports.real = 1;
    return this.stored;
  }
}
