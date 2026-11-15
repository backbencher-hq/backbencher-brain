<?php declare(strict_types=1);

/**
 * OWNER-RESOLUTION SOURCE 1 of 4 — the collision that makes every NAME-keyed strategy decline.
 *
 * `storeResults` resolves a target by NAME (`_res_name_unique` fires only when the name is unique
 * project-wide, and the dotted fallback needs a dot). A member name is not identifying: `persist` is
 * a method on several classes at once, so with two declarations in the project EVERY `persist` row
 * is left with a NULL `target_symbol_id` — which is the state `resolveMemberTargetsByOwner` exists
 * to act on. Without a collision in the fixture set that pass would be a no-op and a green gate
 * would prove nothing, so the collision is the point of this file rather than a side effect.
 *
 * These files are NOT under `validation/m14/fixtures/php/` on purpose: `run-fixtures.ts` treats a
 * SUBDIRECTORY there as a multi-file fixture project and would then demand an
 * `owner-resolution-sources.expectation.json` for inputs that are a store probe's, not the fixture
 * suite's. See `validation/m14/fixtures/php/owner-resolution-gate.mts` for the measuring half.
 */

namespace Fixture\OwnerRes;

/** Declaration 1 of `persist`. */
class AlphaStore
{
    public function persist(): void
    {
    }
}

/** Declaration 2 of `persist`. */
class BetaStore
{
    public function persist(): void
    {
    }
}

/**
 * THE DIRECT CHANNEL. `$this->persist()` written in `GammaStore` means `GammaStore::persist` and
 * nothing else — the receiver's own class declares it, so the candidate set narrows to one. The name
 * is ambiguous project-wide, so nothing else in the pipeline can resolve this row.
 *
 * The read is inside a method that is NOT named `persist`, so the edge's source and its target are
 * different symbols: an analyzer that got the receiver wrong would land on one of the two other
 * declarations rather than on this one, which is what the gate asserts against.
 */
class GammaStore
{
    public function persist(): void
    {
    }

    public function goDirect(): void
    {
        $this->persist();
    }
}
