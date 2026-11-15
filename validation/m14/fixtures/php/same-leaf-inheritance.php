<?php
// PHPD10 (M37.13) gate fixture: same-leaf cross-namespace inheritance.
//
// A class may extend a DIFFERENT class that shares its leaf name in another
// namespace (`Setup\FeaturesForm extends User\FeaturesForm` — phpmyadmin's
// Setup form family; phpunit's `interface Exception extends \PHPUnit\Exception`).
// Leaf-collapsing the fully-qualified base fabricated SELF edges (extends
// FeaturesForm->FeaturesForm, verified self-overrides @0.95, `new parent()`
// -> self). Contract:
//   1. A qualified base whose leaf equals the class's own name keeps its
//      qualification (leading backslash stripped): extends FeaturesForm ->
//      Forms\User\FeaturesForm — never a self-edge.
//   2. A qualified base that qualification CANNOT disambiguate (global
//      single-segment: `class InvalidArgumentException extends
//      \InvalidArgumentException` — the SPL builtin) is unresolvable in the
//      leaf graph: NO extends edge (a self-loop is always fabrication).
//   3. The external same-leaf base is not declared in this file, so override
//      resolution emits the M37.10 first-parent guess @0.5 (inferred), never
//      a verified @0.95 self-override.

namespace Forms\Setup;

class LocalWidget
{
    public function run(): void
    {
        $b = new \Forms\Setup\FeaturesForm();
        $b->getName();
    }
}

namespace Forms\Setup\Derived;

// Same leaf as its fully-qualified external base (declared in another file).
class FeaturesForm extends \Forms\User\FeaturesForm
{
    public static function getForms(): array
    {
        return ['derived'];
    }
}

// SPL builtin with the class's own name — global single segment, no
// namespace to disambiguate: no extends edge may be fabricated.
class InvalidArgumentException extends \InvalidArgumentException
{
}
