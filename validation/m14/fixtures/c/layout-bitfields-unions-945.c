/* c/layout-bitfields-unions-945 -- bitfield PACKING, and a union's first payload.
 *
 * Second half of the layout work begun in c/layout-widths-from-ast-936, and the
 * three defect classes it left behind once every unlisted primitive spelling was
 * fixed and the payload was finally correct on every type the analyzer claimed to
 * model. Each of the three was found by the same instrument,
 * `script/m14/tmp/c-audit/layout-vs-clang.ts`, and each is a case the previous
 * fixture could not express.
 *
 * #945 BITFIELD PACKING. A bitfield is not a member of its declared type's width;
 * it is a PACKING result. #944 charged every bitfield its declared type's full
 * width and published the result as a lower bound with a marker. Measured against
 * clang on redis, that was three of the five types the analyzer still got wrong:
 *
 *   rax.h raxNode     four uint32_t bitfields (three 1-bit flags + a 29-bit
 *                     counter) pack into ONE 4-byte unit; we published 16.
 *   quicklist.h quicklist  three bitfields charged 4 each; 56 published, 48 real.
 *   ebuckets.h ExpireMeta  48 published, 16 real.
 *
 * The rule that matters, and the one a "sum the bits and divide by 8"
 * implementation gets wrong, is the STRADDLE test: a field that would cross a
 * boundary of its declared type is moved up to the next such boundary. So
 * `uint32_t a:1, b:31, c:1` costs 8 bytes, not 4. That is why the model keeps a
 * cursor in BITS rather than reinterpreting the byte offset.
 *
 * #946 A UNION PUBLISHED NO LAYOUT AT ALL. `{ isUnion: true, cSpecific, isConditional }`
 * was the entire metadata object, so every fix from #936 to #945 landed on the
 * struct path only. A union's size was not wrong, it was ABSENT -- and no probe
 * could report on it, because the clang comparison filters on
 * `typeof memorySize === "number"` and silently skipped every union in the corpus.
 * An unmeasured payload is not a payload. 13 union symbols in a 150-file redis
 * sample now carry one; all 13 are anonymous, which is why the probe's type count
 * did not move.
 *
 * #947 A MEMBER NAMED AFTER A MACRO. libgit2 writes its function-pointer members
 * as `int GIT_CALLBACK(read)(...)` where `#define GIT_CALLBACK(name) (*name)`.
 * Tree-sitter resolves that to a single `field_identifier` reading `GIT_CALLBACK`
 * -- the real name `read` is consumed by the macro and is NOT a node in the parse.
 * So four members named `GIT_CALLBACK` were published in git_odb_stream and three
 * in git_odb_writepack, where the real members are read, write, finalize_write,
 * free, append and commit. A member named after a macro is a symbol that does not
 * exist in the program.
 *
 * The test for it is per-file and syntactic, and C is what makes it sound: a
 * function-pointer declarator must be parenthesised and dereferenced, so a member
 * whose declarator chain holds a `function_declarator` and NO `pointer_declarator`
 * anywhere cannot be a function pointer written in C. The comment at the bottom of
 * this file shows clang rejecting the un-expanded spelling, which is the same fact
 * from the other side.
 *
 * Note `GIT_CALLBACK` is defined in `common.h`, a DIFFERENT file, so the
 * analyzer's own macro inventory cannot see it -- which is exactly why an earlier
 * attempt at this fix (keying on a known macro name) failed and was withdrawn as
 * unsound. The rule here needs no knowledge of the macro at all.
 *
 * Every expected size below is clang's, from `clang -std=c11` on x86-64 SysV.
 */
#include <stdint.h>

/* #945: four bitfields in one 32-bit unit. */
typedef struct { uint32_t iskey : 1; uint32_t isnull : 1; uint32_t iscompr : 1; uint32_t size : 29; } Flags;

/* #945: the STRADDLE case, and the one that separates a real implementation from
 * a bit-sum. `a:1, b:31` exactly fills the 32-bit unit, so `c:1` cannot straddle it
 * and starts a SECOND one: 8 bytes. Sum the bits instead -- 33 bits is 5 bytes,
 * rounded to 8 by the 4-byte alignment, and you happen to land on the right
 * answer. `StraddleTight` below is the control that shows the two disagree in
 * substance: 1+30+1 = 32 bits fits one unit, so it is 4 bytes, and a bit-sum that
 * ignored unit boundaries would also say 4 -- so the pair pins the rule from both
 * sides rather than relying on the padded case to hide a wrong implementation. */
typedef struct { uint32_t a : 1; uint32_t b : 31; uint32_t c : 1; } Straddle;
typedef struct { uint32_t a : 1; uint32_t b : 30; uint32_t c : 1; } StraddleTight;

/* #945: a width written as a macro, which is the common spelling. */
#define FLAG_BITS 4
typedef struct { unsigned int small : FLAG_BITS; unsigned int rest : 28; } MacroWidth;

/* #945: a zero-width bitfield is a BOUNDARY, not storage. */
typedef struct { unsigned int before : 3; unsigned int : 0; unsigned int after : 3; } ZeroWidth;

/* #945 CONTROL: bitfields followed by an ordinary member, which must start at the
 * next BYTE. */
typedef struct { unsigned int flag : 1; unsigned char byte; } BitThenByte;

/* #945/#948: a bitfield width this file cannot resolve, because the macro lives
 * in a header. `clang -std=c11` REJECTS this declaration -- `EXTERNAL_BITS` is
 * undeclared -- and that rejection is the finding rather than an inconvenience:
 * it means the only reachable input for an unresolvable bitfield width is a
 * cross-file macro, i.e. C-D2, so this case can never be verified against clang
 * and must be carried as a MARKED lower bound instead. It is in the fixture
 * because the refusal needs a reachable input, and an input that no compiler
 * accepts is still an input real headers produce every day. */
typedef struct { unsigned int a : EXTERNAL_BITS; unsigned int b : 1; } UnresolvedWidth;

/* #944: a bitfield whose DECLARED TYPE is a cross-file typedef. Distinct from
 * UnresolvedWidth above, which has a known type and an unknown WIDTH: here the
 * storage-unit size itself is unknown, because the unit is the declared type, so
 * the bitfield cannot be packed at all. `external_flags_t` is valid C wherever a
 * header defines it, which is the same C-D2 boundary. */
typedef struct { external_flags_t a : 3; unsigned int b : 1; } UnknownTypeBitfield;

/* #946: unions, which had no payload at all before this wave. */
typedef union { unsigned int u; double d; } UniU32;
typedef union { char c; unsigned char b[7]; } UniArr;
typedef union { unsigned int a; unsigned long b; unsigned long long c; } UniMix;

/* #946 CONTROL: a struct, the path that already worked. */
typedef struct { unsigned int u; double d; } StructMix;

/* #950: INLINE AGGREGATE MEMBERS -- C11's anonymous struct/union member. An
 * anonymous struct's fields are never registered, because a struct is registered
 * under its NAME and this one has none, so its width fell back to 4 unknown bytes
 * and the enclosing type was marked. Measured over the three declared corpora: 141
 * such members across 59 files.
 *
 * There is a second symptom with the same root, and it is why this case is here
 * rather than only in a probe. curl's ftplistparser.c has
 *
 *     union {
 *       struct { pl_unix_mainstate main; pl_unix_substate sub; } UNIX;
 *       struct { pl_winNT_mainstate main; pl_winNT_substate sub; } NT;
 *     } state;
 *
 * and the corpus census reported `anonymous_struct.main x2` and
 * `anonymous_struct.sub x2` as DUPLICATE member names. They are not duplicates:
 * they are members of two different structs, and they only looked like duplicates
 * because both anonymous structs are attributed to the placeholder owner
 * `anonymous_struct`, so the counter compared members of DIFFERENT types as if
 * they shared an owner. Fixing the width does not fix the attribution, and the
 * census counter still cannot tell the two apart -- stated as open, not as closed. */
typedef struct { struct { int a; int b; } inner; char c; } AnonStructMember;
typedef struct { union { int i; struct { char a, b; } pair; } u; char c; } AnonUnionMember;
typedef struct { struct { struct { int a; } mid; int b; } inner; char c; } NestedAnon;
typedef struct { struct { int a; int b; } rows[3]; char c; } AnonArrayMember;
typedef union { struct { char a; } s; long l; } AnonInUnion;

/* #947: a macro-mediated function pointer. `CALLBACK` expands to `(*name)`, and
 * without it this declaration is not C at all -- clang rejects it. */
#define CALLBACK(name) (*name)
typedef struct {
  int CALLBACK(real_name)(int a);
  int (*plain)(int a);
} MacroFunctionPointer;
