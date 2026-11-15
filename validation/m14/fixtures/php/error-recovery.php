<?php declare(strict_types=1);

/**
 * ERROR RECOVERY — the document-level contract, for php.
 *
 * WHY THIS FIXTURE EXISTS. php's completeness spec classifies `ERROR` as
 * `handled_verified`: the analyzer really does handle it — the error-collection
 * walk (src/ast/real-php-analyzer.ts, the block that pushes `ParseError` rows
 * from a `rootNode.hasError` walk) reads ERROR and `isMissing` nodes off the
 * whole tree. And the corpus proves the capability fires: two phpunit files are
 * real parse errors (tests/end-to-end/code-coverage/_files/parse-error/src/
 * CannotBeParsed.php, and a partial-function-application `?` placeholder).
 *
 * But the spec's claim had NO WITNESS. Not one of php's fixture sources produced
 * a tree-sitter `ERROR` node, so `script/m14/verify-fixture-coverage.ts` read
 * `uncovered: ERROR` and FAILED with "release blocked" — a `handled_verified`
 * assertion nobody had ever executed, which is the same class of thing the
 * grammar-driven construct census was built to find ("an assertion nobody has
 * ever looked at"). The sibling lanes that claim `ERROR` handled WITHOUT a
 * ruling all ship an error fixture: html/error-recovery.html, html/
 * error-budget-broken.html, toml/malformed-and-rejected.toml, svelte/
 * error-recovery.svelte. php was the only one of the four that did not.
 *
 * THE OBLIGATION, the same three-part contract html and toml pin:
 *
 *   1. the broken region is REPORTED as a diagnostic;
 *   2. it is NOT turned into a symbol or an edge — an `ERROR` node names nothing
 *      a consumer can navigate to, so publishing one would put an unresolvable
 *      identity in the graph;
 *   3. the declarations AROUND it still publish, INCLUDING THE ONES AFTER IT —
 *      degradation is PARTIAL, not total.
 *
 * (3) is the row that carries the weight. A walk that stopped at the recovery
 * node would publish `Before` and nothing else, and the file would still look
 * analysed because `Before` is right there. `After` is the assertion: it is
 * written BELOW the broken region on purpose, and if recovery ever regressed to
 * "give up at the ERROR", this fixture fails on a missing symbol rather than
 * quietly analysing a prefix.
 *
 * THE BROKEN SHAPE is `$b = ;` — an assignment with no right-hand side. It is
 * not an exotic spelling: it is verbatim the corpus's own
 * `tests/end-to-end/code-coverage/_files/parse-error/src/CannotBeParsed.php`,
 * so the fixture exercises the same shape a real php file in the pinned corpus
 * contains, rather than a construct invented to be unreadable.
 *
 * `Broken::m` is declared with the broken statement INSIDE ITS BODY, so the
 * fixture also pins that a method whose body fails to parse still publishes as a
 * symbol and as a `contains` edge from its class — the declaration is
 * syntactically complete even when its body is not.
 */

namespace Fixture\ErrorRecovery;

class Before
{
    public function survivesBefore(): void
    {
    }
}

/** A declaration whose BODY is broken: `$b = ;` has no right-hand side. */
class Broken
{
    public function m(): void
    {
        $b = ;
    }
}

/** Written BELOW the broken region. This is the assertion that matters. */
class After
{
    public function survivesAfter(): void
    {
    }
}
