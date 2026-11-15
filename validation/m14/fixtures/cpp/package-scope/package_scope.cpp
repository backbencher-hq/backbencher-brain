// task-22b package-scope fixture — the C++ PACKAGE-SCOPE CLAIM, both directions. Parse-only: the headers
// below need not exist and the calls need not compile; what is asserted is the CLAIM the analyzer emits.
//
// THE RULE THIS FIXTURE PINS (the lane's ruling — CPP-PACKAGE-SCOPE-RULING.md §1): a C++ translation
// unit says which library a name comes from by the HEADER it includes, so the package-scope claim's
// membership half is the include-root test — and a QUALIFIED spelling (`ns::name`) names the same package
// in a second, independent way. The package names themselves come from the GOVERNING MANIFEST, which the
// caller supplies in `context.cppPackageScopePackages` — the gate's fact, because the gate is what has to
// read `CMakeLists.txt` anyway to verify the claim.
//
// THE BARE CALLS BELOW ARE THE NEGATIVE, AND THE REASON IS THE POINT: a bare name names no package, and
// the include test is a UNIT-level fact — it cannot say WHICH header a given name came from. The lane's
// own verifier produced the counterexample (a name that came from `<vector>` claimed as a package
// member), so the bare spelling is withheld. Bucket D — which is bare by construction — is therefore
// OUT OF THE CLAIM'S REACH, and that is the ruling's measured answer, not a defect of the emission.
#include <acme/widget.h>      // EXTERNAL, package-shaped root `acme` -> the include root of the namespace
#include <vector>             // a SINGLE-ROOT system header: names no package root
#include "local_helper.h"     // a PROJECT include: not external provenance

namespace acme { int make(); int count(int); }

int target(int x) {
    int a = acme::make();     // QUALIFIED + the root `acme` + `acme` declared -> CLAIM {package:"acme"}
    int b = acme::count(x);   // the second claimed shape
    int c = widget_count(x);   // BARE -> NO CLAIM (no per-name evidence)
    int d = local_helper(x);   // BARE -> NO CLAIM
    int e = vector_size(x);    // BARE -> NO CLAIM
    return a + b + c + d + e;
}
