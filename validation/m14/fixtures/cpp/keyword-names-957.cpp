// D1 (#957): a name the language cannot spell is not a name. C++ has no
// identifier spelled with a keyword (ISO 14882 [lex.name]), so a published name
// that is one resolves to nothing for any consumer — at a call target, a `uses`
// target, or a symbol name.
//
// The cast family is the class #924's type-only set could not see. Measured on
// fmt/src/fmt-c.cc:48, the grammar reads `static_cast<int>(x)` as
// `call_expression[function=template_function[name=identifier(static_cast)]]` —
// the cast OPERATOR in the name slot, because the grammar has no node type for
// it. #924 fixed `unsigned(x)` and stopped there; this file is what the rest of
// the space looks like.
//
// `if`, `for` and `switch` are here as the strongest form of the argument: a
// control-flow keyword is not a callee in ANY language, so a `calls` edge to one
// is a fabrication with no reading at all.

#include <string>
#include <vector>

void unreachable_after(int x) { if (x) { return; } }

static int total = 0;

int main() {
    // 4,812 `static_cast` call targets over the real corpora; 1,013
    // `reinterpret_cast`; 76 `const_cast`; 20 `typeid`.
    unsigned a = static_cast<unsigned>(total);
    const char* p = reinterpret_cast<const char*>(&a);
    int b = const_cast<int>(a);
    int c = typeid(a).hash_code();

    // Contextual keywords are LEGAL identifiers and must stay callable. A set
    // that swept them in would be a different, wrong rule.
    int final = 1;
    int override_count = 2;
    int import_count = 3;
    int requires_count = 4;

    // Operator overloads are ordinary function NAMES. `operator` is in the
    // keyword set as an exact spelling only, so these must survive intact.
    auto add = [](int l, int r) { return l + r; };
    auto apply = [](int v) { return v; };

    return a + static_cast<int>(p[0]) + b + c + final + override_count
         + import_count + requires_count + add(1, 2) + apply(3);
}

// A callee spelled with a keyword, written as plainly as the language allows.
void casts_only() {
    (void)static_cast<int>(0.0);
    (void)dynamic_cast<int>(nullptr);
    (void)sizeof(int);
    (void)alignof(int);
    noexcept(true);
    throw;
}
