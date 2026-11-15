// M14 ONTOLOGY — `#include` is a first-class `imports` edge, and a `using`
// declaration is NOT.
//
// The KIND was wrong before this, not the metadata: the edge carried
// `type: references` plus `metadata.isImport`. The cost was measured rather than
// argued — the one consumer that answers "what does this module depend on" is the
// LSP usages file-level section, which filters on
// `relationship_type IN ('imports','exports')` (src/lsp/graph_request.ts,
// src/lsp/graph_usages.ts), so a C++ include was invisible to it whatever its
// metadata said. The C lane reached the same conclusion for the identical
// construct and pins it with c/macro-composed-include, reverted by the
// `c/include-kind-downgraded` mutant; this is that change for cpp.
#include <vector>
#include "local_header.h"
#include <vector>          // repeated: ONE edge, THREE imports-array entries

// NEGATIVE: a macro-composed argument is not a statically resolvable header
// name (C-D2: the preprocessor is textual). It must publish no module and no
// edge of either kind.
#include MACRO_COMPOSED_HEADER

// A `using` declaration at file scope is a NAMESPACE import, not file
// inclusion, so it stays `references` with `using_dependency`. An include
// dependency and a using-dependency are two facts: they name different targets
// (`vector` vs `std::vector`) and a consumer asking "which headers does this
// file need" must not be answered with a using-directive.
using namespace std;
using std::pair;

// NEGATIVE: a class-body `using B::f;` is a member RE-EXPORT, not a module
// dependency, and it publishes neither an edge nor an import.
class Holder {
public:
    using std::swap;
    void member(void) const { }
};

// NEGATIVE: a function-local `using` is an execution artifact.
void localScope(void) {
    using std::vector;
    (void)sizeof(vector);
}

// NEGATIVE: the C++20 `import` keyword. MEASURED absent from the pinned
// grammar: 0 `import_declaration` / `module_import` nodes across 182 node types,
// and `import std;` ERROR-recovers into `declaration[declarator=std,
// type=import]`. It must publish no import edge, and the recovery artifact must
// not become a symbol.
namespace { int helper(void) { return 1; } }
void useHelper(void) { (void)helper(); }