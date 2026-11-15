<?php

// php/mixes_in — THE R3 RELABEL'S CONTRACT (2026-10-23).
//
// A php trait `use` is the construct the ten could not spell honestly: the trait's members are
// flattened into the composing type, so it is neither a value READ (`uses`) nor an IMPORT (there
// is no module binding and no namespace scope created). The vocabulary's `mixes_in` member is
// exactly this shape, and this file pins the relabel in BOTH directions:
//
//   · the composition rows must be `mixes_in` with `metadata.isTraitUse` and the
//     DECLARED-STRUCTURAL evidence tier (the tier follows the construct, not the old label);
//   · the shape's four impostors must NOT be `mixes_in` — a namespace import is `imports`, a
//     closure capture is `uses`, and the adaptation block's method names are members, not traits.
//
// Every row below was authored from the CONTRACT (src/ast/types.ts:155-162 and the analyzer's
// `use_declaration` branch), not from an observed run; the run then has to meet it.

namespace Fixture\Mixins;

trait Named
{
    public function label(): string
    {
        return 'named';
    }
}

trait HasId
{
    private int $id = 0;

    public function id(): int
    {
        return $this->id;
    }
}

// A TRAIT COMPOSING A TRAIT: `mixes_in` is not a class-only relation, and php allows it.
trait Composite
{
    use Named;
}

// MULTI-TRAIT: one `use` naming two traits is TWO composition rows, one per trait.
class Figure
{
    use Named, HasId;

    public function area(): int
    {
        return 0;
    }
}

// ADAPTATION: `use Named { Named::label as private renamed; }` composes ONE trait (Named); the
// alias inside the block names a METHOD, so it must not become a target of any relation here.
class Adapted
{
    use Named {
        Named::label as private renamed;
    }
}

// QUALIFIED trait name: the target is the LEAF (`Remote`), exactly as the analyzer's leaf rule
// publishes every heritage/mixin target, and the trait is not declared in this file — the
// composition row is still published, because the directive is what the source writes.
class Qualified
{
    use \Lib\Remote;
}

// AN ENUM COMPOSES A TRAIT TOO (php 8.1): the composing type is the enum, not its case.
enum Suit
{
    use Named;

    case Hearts;
}

// ---- the impostors: three `use` spellings that are NOT trait composition -------------------

// 1. A NAMESPACE IMPORT — `imports`, never `mixes_in` (it binds a name, it composes nothing).
use Fixture\Mixins\Named;

// 2. A CLOSURE CAPTURE — `use ($x)` copies a value; it is a READ of `$x`, never `mixes_in`.
function capturer(): callable
{
    $x = 1;

    return function () use ($x): int {
        return $x;
    };
}

// 3. A MEMBER ACCESS on a composed trait's method — the composition is the row above; a call is
//    `calls`, a member read is `uses`, and neither may be re-published as a composition.
class Consumer
{
    public function run(): string
    {
        return (new Figure())->label();
    }
}
