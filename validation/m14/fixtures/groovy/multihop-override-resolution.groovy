package probe

// M37.21 #610 groovy JD19 fixture: multi-hop nested-class override
// resolution. Black declares NO val, so BlackVal.val must resolve THROUGH
// the non-declaring ancestor Black to Node.val at confidence 1.0 (the
// pre-fix BFS fell through to the pass-3 first-parent guess and fabricated
// BlackVal.val -> Black.val at 0.5 — a wrong edge, worse than no edge).

class Tree {
    // JD18 family lesson (java/scala finding): an anonymous inner class body
    // declares REAL members that attribute to the anonymous type, never to
    // the enclosing class.
    Runnable task = new Runnable() {
        void run() { Tree.staticHelper() }
    }
    static void staticHelper() {}

    static abstract class Node {
        abstract Object val()
        Object left() { null }
    }
    static class Black extends Node {
        void redden() {}
    }
    static class BlackVal extends Black {
        @Override
        Object val() { null }
    }
    static class BlackBranch extends Black {
        @Override
        Object left() { null }
    }
}
