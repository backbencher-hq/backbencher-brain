<?php declare(strict_types=1);

/**
 * M60 php fixture: A NAMED FUNCTION DECLARED INSIDE A CALLABLE — authored BEFORE the fix.
 *
 * THE SHAPE IS TAKEN FROM THE POPULATION, not invented. Measured over all 5,094 admitted php files
 * (tree walk, `validation/m14/fixtures/php/nested-*.mts` probe, 2026-10-07): there are exactly 25
 * `function_definition` nodes whose path to the program root passes through a callable, in 4 files.
 * TWENTY-TWO of them are the recovery casualties of `markdown.php` (already published by the
 * recovery escape, one layer up). THE OTHER THREE are this shape, and all three are Slim's tests:
 *
 *   slim/tests/AppTest.php:1563                  `function handle(...)` inside `testInvokeFunctionName`
 *   slim/tests/CallableResolverTest.php:30       `function testAdvancedCallable(...)` inside `setUpBeforeClass`
 *   slim/tests/MiddlewareDispatcherTest.php:32   `function testProcessRequest(...)` inside `setUpBeforeClass`
 *
 * It is the classic PHPUnit/Slim test-helper idiom: a helper installed from `setUpBeforeClass`
 * whose name becomes a GLOBAL function when that method runs.
 *
 * WHY IT IS A DEFECT AND NOT A NAMED LIMIT. The symbol walk publishes a declaration it can reach:
 * a `function_definition` directly in the file, inside a class body, or inside a top-level `if`
 * (phpunit's `src/Framework/Assert/Functions.php` guards 251 helpers with
 * `if (!function_exists('assertSame')) { function assertSame(...) {...} }` and ALL 251 publish —
 * measured, and the reason the census's first nesting probe, which asked only "is the parent a
 * `compound_statement`?", reported 250 false positives in that one file). What the walk STRUCTURALLY
 * cannot reach is a declaration inside a CALLABLE's body: those bodies are walked by `walkBody`,
 * whose job is call/read edges and scope, and which never publishes symbols. The store therefore
 * ends up WITHOUT a declaration the file contains while `walkBody` keeps emitting edges SOURCED AT
 * that name (`references` from `testProcessRequest` to `ServerRequestInterface`, two of them) — a
 * store-vs-analyzer divergence, the bucket the lane's whole verification round is about.
 *
 * WHY PUBLISHING IT IS THE CORRECT READING RATHER THAN A DEPARTURE. Three independent reasons, each
 * measured:
 *   1. PHP SEMANTICS: a named function declared in a body enters the GLOBAL function table when the
 *      enclosing code runs. It is not a local binding the way a Python `def` inside a `def` or a
 *      Ruby `def` inside a `def` is — and those two lanes do NOT publish theirs while javascript and
 *      typescript DO publish a nested `function innerHelper() {}` (measured against the pinned
 *      grammars, 2026-10-07). PHP's semantics sit with the publishing half of the family.
 *   2. THE ANALYZER ALREADY MODELS IT: `collectPhpFileScope` registers every nested named function
 *      as a FILE-SCOPE function value ("Global effects, visible everywhere regardless of nesting"),
 *      so the name is already used to resolve bare callables. A name the analyzer resolves against
 *      but never publishes is the same inconsistency the orphan-endpoint round fixed.
 *   3. THE FIX MUST NOT RE-WALK THE BODY: the nested function's body has ALREADY been walked by the
 *      enclosing callable's `walkBody`, which is why publication here adds the symbol and NOT a
 *      second copy of every edge inside it. The rejected reading — publishing it with the enclosing
 *      class as owner — would make a global function look like a method, and it is pinned by the
 *      `forbidSymbols` rows below.
 *
 * WHAT THIS FIXTURE PINS: `innerValue` and `nestedHelper` publish as KIND `function` with the
 * namespace as their owner (not the class, not a bare unowned name), each exactly once, contained by
 * the namespace exactly once, and the call `useHelper -> nestedHelper` — emitted pre-fix against a
 * declaration the store did not have — resolves against it.
 */

namespace Fixture\NestedFunctions;

function outerEntry(): string
{
    // The declaration the symbol walk cannot reach: it sits inside another callable's body.
    function innerValue(): string
    {
        return 'inner';
    }

    // and a call to it from the SAME body it is declared in — pre-fix this call names a symbol the
    // store never received.
    return innerValue();
}

function decorate(string $s): string
{
    return '[' . $s . ']';
}

class NestedHost
{
    public static function registerHelper(): void
    {
        // The Slim shape verbatim: a helper function installed from a static method. Its body calls
        // a TOP-LEVEL function, so the source attribution of an edge inside it is observable.
        function nestedHelper(string $name): string
        {
            return decorate($name);
        }
    }

    public function useHelper(): string
    {
        return nestedHelper('x');
    }
}
