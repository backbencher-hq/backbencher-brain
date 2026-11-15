<?php declare(strict_types=1);

/**
 * OWNER-RESOLUTION SOURCE 4 of 4 — the two shapes where the pass must DECLINE, both about the same
 * collision (`Twin` is declared here and in `gamma.php`, and each declares `solo`).
 *
 * They are different failures and both are asserted, because the fixes for them are different rules:
 *
 *   `parent::solo()` — the receiver is the BASE, so the analyzer publishes the base's name and NOT the
 *   enclosing class's. Rule 0 (identity) therefore does not apply, the name lookup finds two `Twin`s,
 *   and the row must stay NULL. A pass that fell back to the source's own owner here would attach the
 *   edge to `ChildOfAmbiguous`'s own `solo` — or to whichever `Twin` it happened to see first.
 *
 *   `$this->solo()` in a subclass — the receiver IS the enclosing class and identity resolves it, but
 *   the class's BASE is spelled `Twin` and two symbols carry that name, so the ancestor walk cannot
 *   say which one the heritage means. The branch has to END rather than guess: resolving through an
 *   arbitrary `Twin` would attach the edge to a real declaration on a class the source never named.
 */

namespace Fixture\OwnerRes\Right;

/** Declaration 2 of `solo` — the collision `gamma.php`'s rule 0 has to resolve through identity. */
class Twin
{
    public function solo(): void
    {
    }
}

/**
 * The receiver is the BASE, reached through `parent::`. The published owner is `Twin` — a name two
 * classes carry — and the enclosing class is not it, so this declines.
 */
class ChildOfAmbiguous extends Twin
{
    public function goAmbiguousParent(): void
    {
        parent::solo();
    }
}

/**
 * The receiver IS the enclosing class, so the owner is unambiguous — and the ANCESTOR is not. Both
 * `Twin`s declare `solo`, so the walk cannot choose one. This row stays NULL; a pass that took the
 * first match would report a resolution, and the resolution would be a coin flip.
 */
class ChildOfTwin extends Twin
{
    public function goAmbiguousAncestor(): void
    {
        $this->solo();
    }
}
