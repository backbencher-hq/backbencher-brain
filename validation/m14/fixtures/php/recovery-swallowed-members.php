<?php declare(strict_types=1);

/**
 * M60 php fixture: RECOVERY SWALLOWS THE REST OF THE CLASS BODY — authored BEFORE the fix.
 *
 * THE SHAPE IS VERBATIM, MEASURED, AND NOT INVENTED. `FSharp.Formatting/csharp/MarkdownSharpTests/
 * source/php/markdown.php` (a vendored PHP-4/5 file) writes PHP-8-REMOVED curly-brace offset
 * syntax at line 910 — `$level = $matches[2]{0} == '=' ? 1 : 2;`. The pinned grammar does not
 * accept `{0}` as an offset, and the recovery does not merely mark a node: it leaves the
 * enclosing method's body OPEN, so every following declaration becomes a `function_definition`
 * NESTED INSIDE that method's `compound_statement`. Measured tree: `class_declaration`
 * Markdown_Parser 191-1576 > declaration_list > `method_declaration` _doHeaders_callback_setext
 * 905-1575 > its compound_statement contains the next twenty methods. Bisected rather than
 * guessed: replacing that ONE expression with `$matches[2][0]` moves 11 of 12 members back to
 * direct children of the declaration_list and drops the nested count from 9 to 0; replacing the
 * file's OTHER legacy offset (`switch ($token{0})` at 1560) does not, so the two damage sites
 * have different effects and only the first one swallows.
 *
 * THE STATEMENT FORM MATTERS, which is why this file does not use `return $s{0};`: measured, a
 * curly offset in a RETURN does not swallow, while the assignment-with-ternary form above does
 * (`$this->swallowedA()`-style members after it become nested). A fixture built on the return
 * form would have PASSED before the fix and proved nothing — the failure mode this lane keeps
 * finding in its own harnesses.
 *
 * WHY IT IS A CONTRACT VIOLATION AND NOT A NAMED LIMIT. `php/error-recovery` states the lane's
 * document-level contract for a file the parser cannot fully read — "(3) the declarations AROUND
 * it still publish, INCLUDING THE ONES AFTER IT — degradation is PARTIAL, not total" — and pins
 * it for the shape where recovery MARKS a node. This is the shape where recovery MIS-NESTS one,
 * which no fixture covered.
 *
 * WHAT THE ANALYZER DID WITH IT: published the members it saw as `method_declaration` and
 * silently dropped the rest, because a declaration inside a body is reached by `walkBody` (which
 * emits call/read edges and pops a scope) and never by the symbol walk. The corpus therefore
 * carries EDGES naming declarations the file has and the store never received: 19 `calls` edges
 * in that one file — the whole of the lane's residue in this bucket, 19 of 24 — while the file's
 * own `detab` was published as a TOP-LEVEL function because the second damage site truncated the
 * class body at 1571 (the source's class ends at EOF).
 *
 * THE READ THAT IS REJECTED, pinned as `forbidSymbols` below: publishing a swallowed declaration
 * as a GLOBAL FUNCTION. A `function` written inside a body is legal PHP and this lane already
 * models THAT for resolution — `collectPhpFileScope` registers nested named functions as
 * file-scope function values — but publication is a different question, and the source answers
 * it: these are written in the class body between members, so the store must describe the source
 * and not the damaged tree.
 */

namespace Fixture\RecoverySwallowed;

class Swallower
{
    public function intact(): string
    {
        return 'published before the damage, and unchanged by the fix';
    }

    public function damaged(string $s): string
    {
        // The cause, verbatim from markdown.php:910. PHP 8 removed `{}` offsets, so the pinned
        // grammar errors HERE and the body below stays open past this method's closing brace.
        $offset = $s{0} == 'x' ? 1 : 2;
        // and a call to a member written AFTER the damage, so the pre-fix state leaves an EDGE
        // whose target is not in the store — the defect's actual signature
        return $this->swallowedA() . (string) $offset;
    }

    public function swallowedA(): string
    {
        return 'a';
    }

    public function swallowedB(): string
    {
        return $this->swallowedA();
    }

    public const SWALLOWED_CONST = 'c';

    public function callsSwallowed(): string
    {
        return $this->swallowedB() . self::SWALLOWED_CONST;
    }
}
