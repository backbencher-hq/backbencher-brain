<?php declare(strict_types=1);

/**
 * THIS FILE DECLARES NOTHING THE OTHER FIXTURE NEEDS — it exists to be the BASE that
 * `cross-file-override.php` inherits from, and the expectation beside it pins what it
 * declares so the companion index the other fixture consumes is itself pinned.
 *
 * WHY A FIXTURE NEEDS A COMPANION AT ALL. php's `overrides` label can only verify a base
 * whose declaration is VISIBLE: in this file, or through `AnalyzeContext.overrideCompanion`.
 * For 25 years of the lane's life nothing on any test path ever built that index, so the
 * cross-file path had no pin of any kind — not a fixture, not a mutant. Worse, the
 * differential's published match would not have caught a wrong target either: it compares
 * `(label, target)` through `normTarget`, which is the LAST SEGMENT, so a truth row naming
 * `TestCase.__construct` is satisfied by any other `__construct` override anywhere in the
 * draw. A capability carrying 1,080 edges — 11% of the lane's relationship volume once the
 * corpus index was built — was structurally unpinnable.
 *
 * `run-fixtures.ts` now accepts an opt-in `crossFileOverride` key in an expectation file:
 * an array of sibling sources to build the companion from. Opt-in because building it
 * automatically for every multi-source fixture directory would change results for every
 * lane that emits cross-file overrides, mid-flight, with no pin on the change.
 *
 * WHAT THIS FILE DECLARES, and why the shape matters. The base has FOUR methods: two the
 * subclass will redeclare, one it will NOT (so "inherited is not overridden" stays
 * checkable across files), and one with a name no subclass declares (so an over-broad rule
 * that invents edges has a row to land on). It also carries a STATIC method and a PRIVATE
 * one, because PHP's override semantics are visibility-sensitive and a rule that ignored
 * that would publish `Sub.privateHelper -> Base.privateHelper` as a real override.
 */

namespace Fixture\CrossFile;

/** The base class, declared in its own compilation unit — this file. */
abstract class BaseContract
{
    /** Redeclared by the subclass: a genuine cross-file override. */
    public function execute(): void
    {
    }

    /** Redeclared by the subclass, with a NARROWED return type. */
    public function describe(): string
    {
        return 'base';
    }

    /**
     * NOT redeclared by the subclass. Inheriting a method is not overriding it, and the
     * cross-file path must be as strict about that as the same-file path — the fixture
     * asserts the ABSENCE of `SubContract.inheritedOnly -> BaseContract.inheritedOnly`.
     */
    public function inheritedOnly(): void
    {
    }

    /** No subclass declares this, so no override edge may name it. */
    public function neverRedeclared(): void
    {
    }

    /** Static: redeclared by the subclass as static, which PHP permits. */
    public static function make(): static
    {
    }

    /** Private: a subclass method of the same name is a DIFFERENT method, not an override. */
    private function privateHelper(): void
    {
    }

    protected function protectedHelper(): void
    {
    }
}
