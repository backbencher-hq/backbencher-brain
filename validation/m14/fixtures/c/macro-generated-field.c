/* c/macro-generated-field -- a member the analyzer cannot NAME must not be
 * published under the macro's name.
 *
 * Found 2026-09-28 (M14/M60 C wave) on the curl corpus. A vendored C family
 * declares bitfields through a macro:
 *
 *   #define BIT(x) int x : 1
 *   struct flags { int a; BIT(closing); BIT(keepalive); int b; };
 *
 * tree-sitter-c does not expand macros (C-D2: the preprocessor is textual), so
 * the field_declaration's type is the macro CALL `BIT(closing)` and the
 * declaration holds no declarator the extractor can read as a name. The old
 * extractor fell through to the macro call node and published a `property` named
 * after the MACRO. Measured: `curl/lib/cf-h2-proxy.c` emitted
 * `cf_h2_proxy_ctx.BIT` FIVE times and `tunnel_stream.BIT` three times, the same
 * shape three more times elsewhere in the same directory, and the memory-size
 * payload was computed from a field that does not exist.
 *
 * The real member name (`closing`) is NOT recoverable: whether the macro
 * parameter lands in name position is a property of the macro's REPLACEMENT
 * list, which is C-D2's ruled-out territory. So the honest output is silence --
 * no member, no containment edge -- and the loss is a declared limitation, not a
 * name invented from the macro that stands in for the declaration.
 *
 * The controls are the readings that must not change: a real bitfield
 * (`unsigned closing : 1`), a one-line member, and a function-pointer member
 * whose declarator IS readable.
 */
#define BIT(x) int x : 1
#define MEMBER(t, n) t n
#define RESERVED int

struct flags {
  int a;
  BIT(closing);
  BIT(keepalive);
  int b;
  unsigned real_bit : 1;   /* CONTROL: a real bitfield the grammar can read */
  int one_line;
  void (*callback)(int);    /* CONTROL: a declarator inside the declarator */
};

struct with_no_argument {
  int keep;
  RESERVED;                 /* the no-argument spelling: already silent */
  int also_keep;
};

struct member_macro {
  int head;
  MEMBER(int *, payload);   /* the real declarator `payload` is not recoverable either */
  int tail;
};
