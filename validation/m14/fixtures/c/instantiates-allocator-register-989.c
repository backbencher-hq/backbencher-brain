/* #989: `instantiates` -- the allocator register was the wrong shape, and the
 * edge was mislabelled while it was there.
 *
 * TWO DEFECTS, both measured on sqlite (359 files).
 *
 * 1. THE REGISTER. `MALLOC_FUNCTIONS` held `malloc, calloc, realloc, kmalloc,
 *    vmalloc` and nothing else. Counting every allocator call whose TYPE is
 *    recoverable from the parse -- an enclosing cast, or `sizeof(<type>)` in the
 *    argument list, which is where C states it -- gives 680 allocation sites of
 *    which 152 carry a same-file type:
 *
 *        sqlite3_malloc64   82 recoverable sites    NOT in the list
 *        sqlite3_malloc     45                      NOT in the list
 *        sqlite3_realloc64  23                      NOT in the list
 *        malloc              2                      in the list
 *
 *    150 of 152 -- 98.7% of what the language can express here -- produced
 *    nothing, and the 2 that did was the whole of what this relation emitted on
 *    the corpus. sqlite's four wrappers are added for that measurement. This is a
 *    REGISTER, not C's vocabulary: C's own allocator set is the five standard
 *    ones, and a project that wraps malloc under another name needs its name
 *    here or its allocation edges go missing. Named as a limit rather than
 *    fixed, because the general version of this rule needs whole-program typing.
 *
 * 2. THE LABEL. The edge set `evidenceClass: "usage_contextual"` inline, and
 *    `classifyEvidenceTier` skips any edge that already carries one -- so this
 *    lane's own family rule (`instantiates` -> `structural`) never ran. All 2
 *    corpus edges were mislabelled. `structural` is the honest class: the type
 *    comes from a CAST or a `sizeof`, both of which are syntax, and the
 *    confidence is 1.0.
 *
 * The TARGET rules are unchanged and are what make the edge honest: the type
 * must be one the file DECLARES, an untyped `void *` allocation instantiates no
 * named type, and `-> malloc` is never published (the defect #962 corrected). */

/* --- the shape that already worked: the standard allocator --- */
struct Node {
    int value;
};

Node *c989_standard(void) {
    return (Node *)malloc(sizeof(Node));
}

/* --- the widening: a PROJECT's allocator wrapper, same two statements. This is
       ext/fts3/fts3.c's `sqlite3_malloc64((sqlite3_int64)sizeof(Fts3Table))`. --- */
struct Table {
    int n;
};

Table *c989_wrapped(void) {
    return (Table *)sqlite3_malloc64(sizeof(Table));
}

/* --- the sizeof-only spelling through the wrapper --- */
struct Seg {
    int n;
};

Seg *c989_wrapped_sizeof_only(void) {
    return sqlite3_realloc64(0, sizeof(Seg));
}

/* --- NEGATIVE, and the substance of #962: an UNWRAPPED allocation has no edge.
       528 of sqlite's 680 allocation sites are of this shape -- bytes, not a
       named type -- and publishing one would put `instantiates` back to naming
       `malloc`. --- */
void *c989_untyped(int n) {
    return sqlite3_malloc(n);
}

/* --- NEGATIVE: a wrapper whose result is cast to a type the file does NOT
       declare. C-D2: the target would not resolve, and an edge whose target
       names nothing is the defect #962 corrected. --- */
extern struct Opaque *c989_external_type(void);
struct Opaque *c989_cross_file_target(void) {
    return (struct Opaque *)sqlite3_malloc(sizeof(struct Opaque));
}

/* --- NEGATIVE: `sqlite3_free` is not an instantiation. The FREE side of the
       register is separate, and #962 pinned that a free publishes nothing. --- */
void c989_frees(void) {
    sqlite3_free(c989_untyped(4));
}