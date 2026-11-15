import java.util.List

/**
 * Every declaration below is public and top-level, and this file declares NO
 * package. That combination is the subject of the fixture: kotlin, unlike java
 * (JLS 7.4.2), does NOT forbid importing from the unnamed package, so these
 * names ARE reachable — and the `exports` edge still declines to publish them,
 * because the edge's SOURCE is the package and the root package has no name to
 * publish it under.
 *
 * That exclusion is a LIMITATION OF THE EDGE SHAPE, not a language rule, and it
 * is the one clause of the six that is not. It is pinned here so that it cannot
 * be quietly dropped, and its cost is measured in
 * docs/analyzers/real-kotlin-analyzer.md: 693 of 2,613 top-level ownerless
 * public declarations on a 1,500-file window sit in the root package, 3 of them
 * in `.kt` files and the rest in `testData/` fragments (the corpus is 71%
 * testData). On the production subset, 1,045 of 1,056 files carry a package
 * header and 0 of 1,748 top-level public declarations are excluded by it.
 */
class RootPackageClass

fun rootPackageHelper(): Int = 1

internal class RootPackageInternal

private class RootPackagePrivate

fun rootPackageUses(list: List<String>): Int = list.size