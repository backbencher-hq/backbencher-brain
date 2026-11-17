// THE CLOSEST C++ CONSTRUCT TO `decorates`, MEASURED — AND WHY IT IS NOT THE VALUE.
//
// The canonical contract (src/ast/types.ts, Decorates): "A decorator is APPLIED TO a declaration
// ... the runtime applies it while the declaration is created". C++ has no such construct. Its
// closest neighbours are ATTRIBUTES: compiler metadata attached to a declaration. An attribute may
// carry a CALL expression in its argument list — `[[clang::annotate(compute(1))]]` below — and even
// then the call is evaluated inside the attribute's own grammar; nothing is applied to the
// declaration, no decorator value is produced, and the analyzer emits the call as what it is (a
// call), never a `decorates` edge. Macro-annotation forms (`API_EXPORT void f();`) are textual
// expansion, not application of a callable to a declaration.
#include <cstdint>

[[gnu::format(printf, 1, 2)]] void logf(const char* fmt, ...);
[[deprecated("use logf")]] void oldlog();
__attribute__((aligned(16))) struct Aligned { int x; };

int compute(int);
[[clang::annotate(compute(1))]] int annotated(int x);
