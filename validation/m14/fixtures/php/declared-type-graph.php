<?php
// validation/m14/fixtures/php/declared-type-graph.php — the R9 declared-type reference
// graph for php: every position that WRITES a type name, and every shape a written type
// can take in this grammar.
//
// php has no generics and no type parameters, so the two name-as-type traps csharp's
// fixture had to pin (a tuple element's name, a bound type parameter) cannot arise here.
// What CAN: a nullable/union/intersection wrapper read as a name, a qualified name whose
// leaf is what a consumer resolves, php's `self`/`static`/`parent` relative types (which
// name no symbol in the file), and the primitive spellings the grammar tags separately.

namespace Fixture\DeclaredTypes;

class Dep {}
class Other {}
interface IShape {}

class Holder
{
    // property: bare, nullable, qualified, static, union, intersection
    private Dep $bare;
    private ?Dep $nullable;
    private \App\Lib\Dep $qualified;
    private static Other $staticOne;
    private Dep|Other $union;
    private Dep&IShape $intersection;

    // the two that must stay silent
    private int $count;
    private string $label;

    // property promotion: the type is written on the promoted parameter
    public function __construct(private readonly Dep $promoted)
    {
    }

    // return type and parameter types
    public function build(Dep $first, ?Other $second, IShape $shape): Dep
    {
        return $first;
    }

    // a relative return type: names no symbol in the file
    public function copy(): self
    {
        return $this;
    }

    // no return type at all: `void` is a primitive and must stay silent
    public function reset(): void
    {
    }
}
