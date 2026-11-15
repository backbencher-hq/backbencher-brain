/* The `part_of` split for `#include`, pinned in BOTH directions in one file.

   A QUOTED include is the translation unit's OWN fragment: the preprocessor splices the header's
   text into this unit, so the included file shares this unit's SINGLE scope — the vocabulary
   contract's `part_of`. An ANGLE include is another module's interface, and that stays `imports`.

   The target is the part's MODULE SYMBOL (the file stem), because a path is not in the space the
   arbiter resolves against; the path stays in metadata as `partPath`.

   L9  quoted  -> part_of  (the unit's own fragment: target is the stem `Service`)
   L10 quoted  -> part_of  (`util/Config.h` ⇒ `Config`)
   L11 angle   -> imports  (another module's interface, whatever the spelling)
   L12 angle   -> imports  (the standard library is never this unit's part) */
#include "Service.h"
#include "util/Config.h"
#include <stdio.h>
#include <pthread.h>

int main(void) {
  return 0;
}
