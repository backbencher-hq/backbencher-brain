<?php declare(strict_types=1);

/**
 * M37.10 regression fixture: the `overrides` VERIFICATION contract, at both ends.
 *
 * An `overrides` edge asserts that a base class DECLARES the method the subclass
 * redeclares. So there are two things to pin, and this file pins both — the second
 * one is the half that used to be untested.
 *
 * (1) IN-FILE BASE -> inferred override candidate. `LocalBase` is declared in this same file, so
 *     `LocalMiddle::handle` overriding `LocalBase::handle` passes bounded checks and emits
 *     at 0.85 with evidenceClass `inferred`.
 *
 * (2) THE BASE DOES NOT DECLARE IT -> NO EDGE, and this is the half this round added.
 *     `LocalChain::notOverridden` exists on the subclass and NOT on the base. A rule
 *     that emitted an override for every method of a class whose base is in the file
 *     would produce `LocalChain.notOverridden -> LocalBase.notOverridden`, and nothing
 *     in the fixture's previous revision would have caught it: the old file's negative
 *     half was the EXTERNAL guess (`AuditService.handle -> ExternalBase.handle`),
 *     which is a different code path. A phantom override is worse than a missing one
 *     — it is a fabricated method on a class that has no such method, and it is what
 *     the 0.5 "first-parent guess" was removed for.
 *
 * (3) A THREE-LEVEL CHAIN. `LocalChain extends LocalMiddle extends LocalBase`, and
 *     `LocalMiddle::handle` is an override of `LocalBase::handle` in its own right.
 *     Resolution is per-link, not transitive: a class is only compared against the
 *     base it DECLARES, so `LocalChain` must not also publish an edge to
 *     `LocalBase::handle`. The forbid rows below are the pin.
 *
 * HISTORY, because the file's own comment used to contradict it. The previous
 * revision of this header described the contract as: "external base -> deterministic
 * Pass-3 first-parent guess @0.5/inferred with reasonCode 'first-parent-guess' (family
 * parity with java/groovy, below the 0.7 patterns threshold)". M12.PHP-OVERRIDE-AUDIT
 * REMOVED that guess — `script/m12/php-override-audit.ts` measured it on
 * phpunit@c8d6921f and found 12 of 18 decidable edges FALSE (66.7%, a floor): e.g.
 * `StringEqualsStringIgnoringWhitespace.normalizeWhitespace` "overriding"
 * `Constraint.normalizeWhitespace` and `Repeat.times` "overriding" `Metadata.times`,
 * neither of which the base declares at all. The guess sat below the 0.7 threshold so
 * `pool-worker` already dropped it, so it bought no real cross-file override while
 * manufacturing a majority-false unverified bucket (198 edges on phpunit, 171 on
 * phpmyadmin). The paired `.expectation.json` was already correct — it pinned the
 * guess's ABSENCE — and this header was the stale half. A reader of the fixture
 * source would have concluded the analyzer emits a 0.5 edge it does not emit.
 *
 * WHY THE EXTERNAL CASE IS STILL HERE even though no cross-file override is emitted:
 * `AnalyzeContext.overrideCompanion` is never populated in production (M37.10), so an
 * external base cannot be verified and the honest answer is silence. Keeping the case
 * pins that silence, so a future round that populates the companion index has to
 * change this fixture deliberately rather than by accident.
 *
 * ON THE CORPUS, disclosed because a reader deserves to know what the differential
 * actually checked: over the two pinned corpora (4,463 tracked `.php` files) this
 * label has a sample size of ONE. Both sides derive exactly one row — `SkipConstruct
 * .__construct -> ParentConstructorClass.__construct` — and it lives in a VENDORED
 * phpstan test fixture under `phpunit/tools/.phpstan/vendor/`, which is in neither
 * canonical 60-file draw, so on both published draws the label compares 0 rows to 0
 * rows and reads PASS. The rule is correct; the corpora simply contain almost no
 * genuine same-file method overrides (2,631 classes have a base, 26 have it in the
 * same file, and the nearest ones redeclare nothing). That is why this fixture exists
 * and why the reverting mutants for it are the evidence the differential is not.
 */

namespace Fixture\OverrideVerification;

class ExternalBase
{
    // Declared in ANOTHER file, so nothing here can verify an override of it.
}

class LocalBase
{
    public function handle(): void
    {
    }

    public function shared(): string
    {
        return 'base';
    }
}

class LocalMiddle extends LocalBase
{
    public function handle(): void
    {
        parent::handle();
    }
}

/** Three-level chain: `LocalMiddle` is the declared base, and only that. */
class LocalChain extends LocalMiddle
{
    public function handle(): void
    {
        parent::handle();
    }

    /**
     * NOT on `LocalBase`, and NOT on `LocalMiddle`. The subclass declares it and
     * neither base does, so an `overrides` edge for it would be a fabricated method
     * on `LocalBase`.
     */
    public function notOverridden(): void
    {
    }
}

/** Its base is external, so nothing about its methods can be verified here. */
class AuditService extends ExternalBase
{
    public function handle(): void
    {
    }
}
