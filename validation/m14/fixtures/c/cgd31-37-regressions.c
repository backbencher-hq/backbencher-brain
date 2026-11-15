/* CGD31-37 regression fixture (M37 #601 Holy C wave). Each block pins one
   measured defect class; forbids assert the analyzer does NOT fabricate. */

/* --- CGD35: typedef alias over a builtin parses with a type_identifier
   declarator — `typedef long long int i64;` (showwal.c L29 shape). The alias
   must enter declaredTypes and every real type_identifier READ of i64 must
   emit `references i64`. (Old bug: treated the read as "declaring" →
   suppressed → references i64 missing.) */
typedef long long int i64;
typedef unsigned char u8;

static i64 widen(i64 x) {
    u8 b = (u8)(x & 0xff);
    return x + b;
}

/* --- CGD36: a function used as a VALUE before its definition (vdbeaux.c
   L2220 read-before-L2258-def shape) must resolve order-independently via
   declaredNames → `uses later_defined` pinned. Also a function-pointer table
   reading in-file functions (loadext.c L398 shape). */
static void later_defined(void) { (void)0; }

typedef void (*cleanup_cb)(void);
static void use_later(void) {
    void (*cb)(void) = later_defined;   /* uses later_defined */
    (void)cb;
}
static const cleanup_cb CALLBACKS[] = { later_defined }; /* uses later_defined */

static void later_defined_impl(void) {}

/* CGD36, ORDER-INDEPENDENT half. The block above reads `later_defined` AFTER its
   definition, so it exercises the ordinary symbol walk and never the declaredNames
   pre-pass -- its own comment claimed the read-BEFORE-def order and the file did
   not have it. These two rows are the read-before-definition shape the C lane
   actually loses edges on (vdbeaux.c: `p->xDel==sqlite3VdbeFrameMemDel` reads the
   function defined 38 lines later): the read sits ABOVE the definition, so the edge
   can only resolve through the pre-pass. */
static void read_defined_later(void) {
    void (*cb)(void) = defined_far_below;   /* uses defined_far_below */
    (void)cb;
}

static void defined_far_below(void) { (void)0; }

/* --- CGD31 + CGD37: method-table member CALL (os_kv.c shape) and the
   designated-initializer whose value is an identifier:
       .xRcrdRead = kvrecordRead   -> WRITE (no uses xRcrdRead)
       sqlite3KvvfsMethods.xRcrdRead(...) -> calls xRcrdRead ONLY (the
       callee-field leaf must not ALSO emit uses xRcrdRead). */
struct kv_methods {
    int (*read_impl)(int);
    int (*write_impl)(int);
};
static struct kv_methods the_methods;

static int kvrecordRead(int k) { return k; }
static int kvrecordWrite(int v) { return v; }

static const struct kv_methods method_table = {
    .read_impl = kvrecordRead,
    .write_impl = kvrecordWrite,
};

static int read_kv(int k) {
    return the_methods.read_impl(k);
}
static int write_kv(int v) {
    return the_methods.write_impl(v);
}

/* --- CGD33 + CGD34: a macro-qualified struct definition
   `static WSD_MACRO struct Mem3Like { ... }` (mem3.c/malloc.c/loadext.c
   SQLITE_WSD shape).

   HISTORY, because the shape changed under the fixture and the pins below are
   now recording something different: at the time this was authored the pinned
   grammar had no rule for a BARE macro identifier in the declaration-specifier
   sequence, so this declaration recovered as a phantom function_definition
   whose bare child named the struct, and the pins guarded the damage that
   recovery could do. The #743 grammar wave (commit that lands the c grammar
   fix) added `macro_prefixed_type_specifier`, so the block parses as a REAL
   struct: Mem3Like is a `struct`, the_mem3 is a `variable`, nPool is a
   `property`, and the file's ERROR count went 1 -> 0.

   The `uses Mem3Like` self-edge forbids are KEPT unchanged: the struct TAG
   must never gain one, and they now double as the regression guard that fires
   if the parse ever degrades back to the recovery shape. */
static WSD_MACRO struct Mem3Like {
    int nPool;
} the_mem3;

static void touch_mem3(void) {
    (void)the_mem3.nPool;
}

/* --- CGD32: macro-wrapped prototype `EXPORT(int, exported_fn)(...)` parses
   as a NESTED call_expression; the composite text target
   `EXPORT(int, exported_fn)` must never be emitted as a calls edge. */
static int exported_fn(int a) { return a; }

static int call_exported(void) {
    return exported_fn(1);
}
