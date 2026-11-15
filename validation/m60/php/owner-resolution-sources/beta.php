<?php declare(strict_types=1);

/**
 * OWNER-RESOLUTION SOURCE 2 of 4 — the inherited case, and three shapes that must NOT resolve.
 *
 * The negatives are the half that matters: a pass that resolves everything it sees would move the
 * same positive rows and be wrong in the direction that is expensive (an edge attached to a real
 * declaration that is not the one the source meant reads as confidence, not as a gap).
 */

namespace Fixture\OwnerRes;

/**
 * THE INHERITED CASE, and the one the census priced at 24,223 endpoints. `persist` is declared twice
 * in this project and NOT in `DerivedStore`, so the owner channel's direct step finds nothing; the
 * ancestor walk finds exactly one declaration in `BetaStore`, which is PHP's own method resolution
 * and not a preference.
 *
 * The module is deliberately named apart from the parent (`goInherited`, not `persist`) so the edge's
 * source cannot be confused with its target.
 */
class DerivedStore extends BetaStore
{
    public function goInherited(): void
    {
        $this->persist();
    }
}

/**
 * NEGATIVE 1 — NO OWNER AT ALL. `$obj` is a local variable whose class is whatever was assigned; the
 * analyzer publishes no `metadata.owner` for it BY DESIGN (a wrong owner would send a reverse walk to
 * a real method on the wrong class). With no owner the pass has no input, so the row must stay NULL —
 * and `persist` is ambiguous here, so nothing else can resolve it either.
 */
class PlainReceiver
{
    public function goPlain(): void
    {
        $obj = new AlphaStore();
        $obj->persist();
    }
}

interface DupIface
{
    public function dup(): void;
}

class DupBase
{
    public function dup(): void
    {
    }
}

/**
 * NEGATIVE 2 — TWO ANCESTORS DECLARE IT. `TwoAncestors` extends `DupBase` and implements `DupIface`,
 * and both declare `dup`. PHP itself would pick by method resolution order; this pass is not allowed
 * to, because "which one" is not deducible from the graph it holds. So the row must stay NULL, and a
 * rule that took the first ancestor would attach this edge to `DupBase` — a real method, on a real
 * class, which is exactly why the negative is asserted rather than assumed.
 */
class TwoAncestors extends DupBase implements DupIface
{
    public function goTwoAncestors(): void
    {
        $this->dup();
    }
}

/**
 * NEGATIVE 3 — THE BASE IS OUTSIDE THE PROJECT. `\RuntimeException` is not declared anywhere in the
 * indexed files, so there is no parent symbol to walk to and `getMessage` names a declaration this
 * pass cannot see. The row stays NULL rather than being resolved to a stranger; the boundary is the
 * population's, and it is a reason rather than a resolution.
 */
class ExternalBase extends \RuntimeException
{
    public function goExternalBase(): void
    {
        $this->getMessage();
    }
}
