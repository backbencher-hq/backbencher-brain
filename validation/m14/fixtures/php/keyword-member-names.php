<?php declare(strict_types=1);

/**
 * M60 php fixture: SEMI-RESERVED KEYWORDS AS MEMBER NAMES, authored before the run.
 *
 * PHP 7.0 made a list of keywords SEMI-RESERVED: a word on that list may not name a
 * top-level declaration, but it MAY name a method, a property or a class constant,
 * because a member is reached through its owner and cannot be confused with the type
 * position the keyword occupies. `self` and `parent` are exactly that kind of word, and
 * this file declares all three member forms of both.
 *
 * WHY IT EXISTS: the production symbol filter (`src/ast/pool-worker.ts`, `keepSymbol`)
 * refuses a symbol BY NAME for php — `RESERVED = { php: new Set(["self", "parent"]) }` —
 * with no reference to the kind or the owner. It therefore deletes a legal `$parent`
 * property while the analyzer still emits the `contains` edge that names it, which is an
 * edge whose endpoint has no symbol at all. Measured over the whole admitted php
 * population (5,094 files, 350,342 edges): exactly ONE such edge exists —
 * `contains Node -> parent` in
 * `phpmyadmin/src/Navigation/Nodes/Node.php:54` (`public Node|null $parent = null;`) —
 * and it is the only edge in the lane that names a declaration the store does not hold.
 *
 * The fixture's assertion is deliberately narrow, because the rule it pins is narrow:
 *   - the four member declarations of `parent`/`self` publish as symbols;
 *   - the `contains` edges to them exist (they always did — that is the defect);
 *   - the read/call sites that name them carry `metadata.owner`, so the edge resolves
 *     through `(ownerName, name)` rather than by a bare-name collision.
 *
 * NOT pinned here, and the reason: the half of the rule that must SURVIVE — a php CLASS,
 * INTERFACE, TRAIT, ENUM, NAMESPACE or top-level FUNCTION named `parent`/`self` — cannot
 * be written as valid php (`class parent {}` is a parse error), so it can only be
 * exercised by an injectable mutant. `php/drop-keyword-named-members` is that mutant, and
 * it is the reverse direction: it re-instates the name-only drop at the result level and
 * this file's `expectSymbols` rows are what catch it.
 *
 * GRAMMAR NOTE, probed against the pinned wasm before this file was written: a class
 * constant may be named `parent`/`self` (`const_element` -> `name`), a property may be
 * (`property_element` -> `variable_name`), and a method may be (`method_declaration` ->
 * `name`). All three are legal php 7+ and all three parse here.
 */

namespace Fixture\KeywordMembers;

class Holder
{
    public ?Holder $parent = null;

    public string $self = 'root';

    public const parent = 'P';

    public const self = 'S';

    public function self(): string
    {
        return 'method-named-self';
    }

    public function probe(): string
    {
        $p = $this->parent;   // property read -> uses parent, owner Holder
        $s = $this->self;     // property read -> uses self,   owner Holder
        $c = self::parent;    // class-constant fetch -> uses parent, owner Holder
        $d = static::self;    // class-constant fetch -> uses self,   owner Holder

        return $this->self() . $p . $s . $c . $d;
    }
}
