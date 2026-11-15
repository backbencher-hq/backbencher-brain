// ONTOLOGY `imports` (M60/#910 family). A `#include` is a FILE-LEVEL dependency,
// and it is emitted as the `imports` KIND — not `references`.
//
// The consumer that settles it is `src/lsp/graph_request.ts`, which builds its
// file-level `dependencies` section from
//
//   WHERE relationship_type = 'imports' AND source_symbol_id IS NULL
//     AND target_symbol_id IS NULL AND source_external = ?
//
// so an include stored as `references` is not mislabelled, it is UNREACHABLE by
// the one reader that answers "what does this translation unit depends on".
// The C lane made the same relabel in #910; nim's carries the same mutant.
//
// The three shapes this fixture separates, because collapsing any two of them is
// the defect the family keeps re-making:
//
//   1. `#include <vector>`   -> `imports`, one edge per MODULE (D3)
//   2. `#include "local.h"`  -> `imports`, quoted, not a system include
//   3. `using std::vector;`  -> `references`, a DIFFERENT fact: the source names
//      a namespace and brings its names into scope; it is not a file-level
//      dependency on a header, and an include dependency and a using-dependency
//      are two rows with two different targets (`vector` vs `std::vector`).
//
// `module` and `fileLevel` are the metadata `parallel-indexer.ts` reads to know
// which FILE a symbol-less dependency row belongs to, so both are pinned.

#include <vector>  // vector

#include "local_header.h"   /* local */

#include <string>
#include <string>

using std::vector;

struct Holder {
  std::vector<int> items;
  int size() const { return static_cast<int>(items.size()); }
};