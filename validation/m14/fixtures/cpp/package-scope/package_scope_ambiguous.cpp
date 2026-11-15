// task-22b package-scope fixture — the C++ PACKAGE-SCOPE CLAIM, the AMBIGUOUS attribution. Parse-only.
//
// The unit includes TWO declared packages' headers, so the root `acme` matches more than one declared
// package's alias set under the looser half of the rule (`acme` is a word-boundary prefix of `acme_extra`).
// The attribution must be unambiguous, so the claim is WITHHELD. The rule the lane's verifier caught: the
// looser version claimed EVERY bare call in a unit as the declared package's member, which is false for
// the names that came from another header.
#include <acme/widget.h>
#include <acme/extra.h>

namespace acme { int make(); }

int target(int x) {
    int a = acme::make();   // NO CLAIM — two declared packages match the root `acme`
    return a;
}
