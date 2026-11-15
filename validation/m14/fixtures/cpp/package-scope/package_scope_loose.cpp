// task-22b package-scope fixture — the C++ PACKAGE-SCOPE CLAIM, the LOOSE match. Parse-only.
//
// The include root and the namespace are `nlohmann` and the manifest declares the package
// `nlohmann_json`: the relation between a package's NAME and its include root is a CONVENTION, and this
// is the case where the convention needs the looser half of the rule (a word-boundary prefix). The claim
// carries the MANIFEST'S OWN SPELLING (`nlohmann_json`), never the include root (`nlohmann`), so the
// arbiter's exact-match verification holds and the claim can never refute itself.
#include <nlohmann/json.hpp>

namespace nlohmann { int json_size(int); }

int target(int x) {
    int c = nlohmann::json_size(x);   // CLAIM {package: "nlohmann_json", name: "json_size"}
    return c;
}
