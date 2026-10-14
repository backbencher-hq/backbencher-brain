/**
 * PY-D19 (round 10) — the WILDCARD-IMPORT axis's decision, extracted so it can be FALSIFIED.
 *
 * `from M import *` binds M's public namespace into THIS module, so a bare name in such a file has a
 * binding route that lives in M. When M is OUT OF VIEW — not a module this population declares — the
 * name cannot be checked from here and this population's index cannot hold M's namespace: the row
 * dangles for a structural reason rather than because the file failed to bind it.
 *
 * WHAT "OUT OF VIEW" MEANS, AND THE MEASUREMENT THAT FIXED IT. The test is the POPULATION'S DOTTED
 * MODULE PATHS: `pyspark/sql/types.py` declares `pyspark.sql.types`, and a star module is in view
 * when that path exists — or when some path lives UNDER it (`pyspark.sql` names the package
 * directory `pyspark/sql/`), because a package is just as checkable as a module. THE FIRST VERSION
 * OF THIS FUNCTION ASKED A DIFFERENT QUESTION and the corpus measurement convicted it: it treated
 * any file STEM anywhere in the population as in-view, and over the round-9 residual it blocked 169
 * of the 171 priced rows. The blocking reason was a NAME COLLISION across unrelated repositories —
 * cython's `Tools/dataclass_test_data/test_dataclasses.py` deliberately does `from dataclasses import
 * *` against the STANDARD LIBRARY, and some unrelated repo in the population has a file spelled
 * `dataclasses.py` somewhere in its tree, which is not evidence that the stdlib module is this
 * project's. The price this axis was written from (`.tmp-py/price-star-round9.py`) measured the gate
 * with the dotted-path test and blocked ZERO rows; the implemented rule is therefore the priced one,
 * and the collision case is pinned in the gate.
 *
 * THE GATE, and why it is not optional: the excuse is only defensible when EVERY module the file
 * star-imports is out of view. An IN-VIEW star module is CHECKABLE — the row being residual already
 * proves that module's public namespace does not declare the name — so a file that stars an in-view
 * module must NOT be excused. A relative star (`from . import *`) is in view by construction: it is
 * this project by definition, whatever the module index says.
 *
 * WHY THIS LIVES IN ITS OWN FILE. The verdict that uses it (`python-endpoint-resolution.ts`) is a
 * top-level script: importing it runs an 11,488-file census, so nothing about its decisions could be
 * tested without one. Round 9's lesson was that a guard with no falsifier is a claim with no
 * evidence — and this guard's whole content is the case where the excuse must NOT be handed out, so
 * the honest form is a function small enough to exercise directly, which
 * `validation/m14/fixtures/python/star-import-axis-gate.mts` does in every direction.
 *
 * Only a BARE name can be wildcard-bound: `a.b` and `M:item` are other spellings, so they are
 * refused before the modules are consulted.
 */
export function starImportBindsOutOfView(
  starModules: Iterable<string> | undefined,
  populationModulePaths: ReadonlySet<string>,
  target: string,
): boolean {
  const stars = starModules === undefined ? [] : [...starModules]
  if (stars.length === 0) return false
  if (target === "" || target.includes(":") || target.includes(".")) return false
  for (const mod of stars) {
    if (mod === "" || mod.startsWith(".")) return false // relative / undeclared: checkable
    if (populationModulePaths.has(mod)) return false
    // A PACKAGE PREFIX is a declaration too: `pyspark.sql` is declared by every path under it.
    const prefix = mod + "."
    for (const pm of populationModulePaths) {
      if (pm.startsWith(prefix)) return false
    }
  }
  return true
}
