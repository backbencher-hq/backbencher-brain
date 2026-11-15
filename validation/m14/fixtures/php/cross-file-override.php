<?php declare(strict_types=1);

/**
 * CROSS-FILE `overrides` — the half of the label that had no pin at all.
 *
 * `RealPhpAnalyzer.resolveOverrides` verifies an override only when the base's declaration
 * is VISIBLE: in this file, or through `AnalyzeContext.overrideCompanion`. Until the M60
 * round nothing on any test or gate path ever built that index, so:
 *
 *   - the cross-file path had NO fixture and NO mutant, so it could not fail;
 *   - the differential could not have caught it either, because the published match is
 *     `(label, target)` through `normTarget` — the LAST SEGMENT — so a truth row naming
 *     `TestCase.__construct` is satisfied by any other `__construct` override in the draw;
 *   - and the label's audited sample size over the two pinned corpora was ONE: a single
 *     row, in a vendored phpstan test fixture, absent from both canonical 60-file draws.
 *     On both published draws it compared 0 rows to 0 rows and read PASS.
 *
 * With a corpus-wide companion built from the grammar (1,092 verifiable pairs over
 * phpunit + phpmyadmin, 1,091 of them cross-file) the label became auditable — and then
 * it immediately paid for itself, by exposing a latent bug in the ORACLE's same-file
 * prescan that had been attributing an ANONYMOUS class's methods to the enclosing named
 * class. A latent bug is not a fixed one; it is a bug waiting for the input that reaches
 * it.
 *
 * The base is declared in `cross-file-override-base.php`. This file declares
 * `crossFileOverride: ["cross-file-override-base"]` in its expectation, so the runner
 * builds the companion from that ONE named source — self-describing, and free of the
 * noise an "all siblings" companion would carry.
 */

namespace Fixture\CrossFile;

require_once __DIR__ . '/cross-file-override-base.php';

use Fixture\CrossFile\BaseContract;

/**
 * A genuine cross-file override: `BaseContract` is declared in a different file, and the
 * companion index — built from the sibling source — is what makes the check possible at
 * all. Without it this class emits NOTHING, which is the honest answer for a base it cannot
 * see, and is why the guess M12.PHP-OVERRIDE-AUDIT removed had to go.
 */
final class SubContract extends BaseContract
{
    /** Overrides `BaseContract::execute` across a file boundary. */
    public function execute(): void
    {
        parent::execute();
    }

    /** Overrides `BaseContract::describe` with a narrowed return type — still an override. */
    public function describe(): string
    {
        return 'sub';
    }

    /**
     * A NAME the base does NOT declare. No override edge may name it: an
     * `overrideCompanion` lookup is a membership test, and a rule that treated the index
     * as "the base has methods" rather than "the base has THIS method" would mint
     * `SubContract.brandNew -> BaseContract.brandNew` — a method that exists nowhere.
     * This is the cross-file half of the "the base must DECLARE it" rule that
     * `php/override-fires-without-base-method` pins for the same-file half.
     */
    public function brandNew(): void
    {
    }

    /** Overrides the base's static method, which PHP permits. */
    public static function make(): static
    {
        return new static();
    }

    /**
     * Same NAME as the base's PRIVATE `privateHelper`, and a DIFFERENT method: PHP's
     * private methods are not inherited, so this cannot override anything. A
     * name-membership rule with no visibility filter would publish
     * `SubContract.privateHelper -> BaseContract.privateHelper`, and that edge would be
     * wrong in the way that matters most — it asserts a method relationship PHP forbids.
     * `php/override-fires-without-base-method` cannot catch this one: that mutant reads
     * the ANALYZER's symbols, and a private base method is not among them, so only a
     * fixture that declares both halves can.
     */
    private function privateHelper(): void
    {
    }

    protected function protectedHelper(): void
    {
    }
}

/**
 * A subclass whose base is in the SAME file — the already-audited path, kept here so the
 * fixture pins that the cross-file companion did not REPLACE same-file resolution but
 * sits behind it. `php/external-override` pins the same-file contract in depth.
 */
class LocalBase
{
    public function shared(): void
    {
    }

    /**
     * PRIVATE, and `LocalSub` declares a same-named private method. PHP does not inherit a
     * private method, so these are two unrelated methods and `LocalSub.privateHelper ->
     * LocalBase.privateHelper` is not an override. This is the row that found a real defect:
     * the analyzer published it at 0.95/structural, on the same-file path, before this round.
     */
    private function privateHelper(): void
    {
    }
}

class LocalSub extends LocalBase
{
    public function shared(): void
    {
    }

    /** Same NAME as the base's private method, and a different method entirely. */
    private function privateHelper(): void
    {
    }
}
