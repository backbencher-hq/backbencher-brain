// task-22 citation fixture — the ISO C++ vocabulary emission, both directions. Parse-only: the unlisted
// and mis-qualified calls below need not compile; what is asserted is the CLAIM the analyzer emits.
#include <utility>

namespace mylib { int move(int v); }

int target(int x) {
    int a = std::move(x);            // LISTED, root std -> claim languageNamespace ["move"]
    std::string s = std::string("x");   // LISTED, root std -> claim ["string"] (an EXPRESSION, so it is a calls row)
    int b = std::max(a, x);          // LISTED, root std -> claim ["max"]
    int unlisted = std::for_each(nullptr, nullptr, 0);  // root std, symbol UNLISTED -> NO claim
    int project = mylib::move(a);    // listed symbol but root mylib -> NO claim
    int bare = move(x);              // unqualified -> NO claim
    return b + unlisted + project + bare;
}
