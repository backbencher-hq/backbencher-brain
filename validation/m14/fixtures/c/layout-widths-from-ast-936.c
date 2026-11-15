/* c/layout-widths-from-ast-936 -- every legal C primitive spelling, not a curated list.
 *
 * Found 2026-09-29 (M14/M60 C wave) by the lane's clang reference probe,
 * `script/m14/tmp/c-audit/layout-vs-clang.ts`, which asks clang for the real
 * `sizeof`/`_Alignof` of every struct the analyzer publishes a size for.
 *
 * The finding was not that some sizes were off. It was that the `memorySize` /
 * `alignment` payload had NEVER been checked against anything, and the first
 * check put it at 46.9% agreement with clang on redis while the member SETS the
 * numbers were computed from were 97.1% identical. That split located the defect
 * in the arithmetic rather than in member extraction, which is a much smaller
 * piece of work: the layout maths matched a member's type SPELLING against two
 * hand-maintained whitelists, so every legal C primitive the author had not
 * thought to enumerate fell through to a 4/4 default. Counting occurrences across
 * the redis corpus, 1027 of 2056 member-type spellings (50%) took that path --
 * led by `long long` (130x, 8 bytes wide, computed as 4) and `unsigned char`
 * (45x, 1 byte wide, computed as 4).
 *
 * EVERY expected size below is clang's, not the analyzer's, taken from
 * `clang -std=c11` on x86-64 SysV. That is the point of the fixture: a layout
 * fixture written from the analyzer's own output would have recorded the defect
 * as the expectation.
 *
 *   WideLL            16  8    two `long long`, which the old table never had
 *   NarrowUC           2  1    two `unsigned char`, computed as 4/4 before
 *   MixedSI            8  4    `short int` + `unsigned int`
 *   AliasPair          4  2    a same-file `typedef uint16_t` and a CHAIN of aliases
 *   MacroDims          7  1    array dimensions written as a macro and an enum
 *   LongDoubleRefused 16 16    the one width the model REFUSES to guess
 *   Plain              1  1    the control
 *
 * #937 note: `typedef uint16_t fingerprint_t;` sits two lines above the member
 * that needs it, and `uint16_t` was already in the model's tables -- so this is
 * NOT a cross-file problem. Resolving a same-file alias is inside the per-file
 * model; a type declared in another header (C-D2) still is not.
 *
 * #941 note: `LongDoubleRefused` is the deliberate counter-case. `long double` is
 * 8 bytes on some ABIs, 12 on i386 and 16 here, so the model REFUSES it and
 * publishes 4/4 -- a lower bound, marked by `layoutUnknownMembers: 1`. The
 * fixture holds the case so the refusal cannot quietly become a guess.
 */
#include <stdint.h>

/* #936: widths the old spelling tables could not see. */
typedef struct { long long a; long long b; } WideLL;
typedef struct { unsigned char a; unsigned char b; } NarrowUC;
typedef struct { short int a; unsigned int b; } MixedSI;

/* #937: a same-file alias of a fixed-width name, then a CHAIN of aliases. */
typedef uint16_t fingerprint_t;
typedef fingerprint_t fp_alias_t;
typedef struct { fingerprint_t fp; fp_alias_t fp2; } AliasPair;

/* #939: an array dimension written as a macro and as an enum constant. */
#define ENTRIES 3
enum { SLOTS = 4 };
typedef struct { char fixed[ENTRIES]; char slots[SLOTS]; } MacroDims;

/* #936 refusal: `long double` is ABI-dependent, so it is not guessed. */
typedef struct { long double d; } LongDoubleRefused;

/* #941: a FLEXIBLE ARRAY MEMBER contributes ZERO bytes (C99 6.7.2.1p16). */
typedef struct { unsigned int encoding; unsigned char data[]; } FlexTail;

/* #944: a BITFIELD is not a full member of its declared type. */
typedef struct { uint32_t iskey : 1; uint32_t size : 29; } BitPacked;

/* CONTROL: the plain case that was always right. */
typedef struct { char c; } Plain;
