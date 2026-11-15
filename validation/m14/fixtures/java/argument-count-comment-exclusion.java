// M49 W9 fixture (F6 adjudication): ARGUMENT COUNT EXCLUDES COMMENTS.
//
// The calls-edge payload `metadata.argumentCount` exists so a downstream
// consumer can tell process(String) from process(int) without a resolver
// (JD20 bare-leaf target contract). Its counter skipped a node type named
// "comment", which is NOT a type in tree-sitter-java — comments serialize as
// `line_comment` / `block_comment` — so the skip never fired and a comment
// inside an argument list was counted as an argument:
//     b2(1 /* inline */, 2)   reported argumentCount 3  (must be 2)
//     e0(/* nothing */)       reported argumentCount 1  (must be 0)
// Probe-verified at the pre-fix lineage; every call below is its OWN target so
// the audit cannot be satisfied by a clean sibling call.
package com.acme.m49;

class CommentArity {
    void a2(int x, int y) { }
    void b2(int x, int y) { }
    void c2(int x, int y) { }
    void d1(int x) { }
    void e0() { }

    void run() {
        a2(1, 2);                  // 2 — control (no comment)
        b2(1 /* inline */, 2);     // 2 — trailing comment is not an argument
        c2( /* lead */ 1, 2);      // 2 — leading comment is not an argument
        d1(/* only */ 1);          // 1
        e0(/* nothing */);         // 0 — a comment-only list is EMPTY
    }
}
