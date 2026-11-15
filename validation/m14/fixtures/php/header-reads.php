<?php declare(strict_types=1);

// M60 php lane — reads in a callable's DECLARATION HEADER.
//
// The differential oracle gates its read rules on `inBody`, whose boundary is
// the callable SUBTREE: a parameter default and an attribute argument are
// inside it, so truth reads them as expressions. The analyzer's extracted walk
// visited those positions with a SUBSET of its read rules (file-const `name`
// reads and variable reads only — no class-constant, static-property or member
// branch), so `= self::DEFAULT` and `#[Attr(self::FLAG)]` emitted nothing.
//
// Measured on phpunit FULL EXTENT, this class produced the lane's only
// non-`calls` MISSING edge (`Result::from(..., int $shellExitCode =
// self::SUCCESS)`). This fixture pins every position and every read kind in
// one file.
//
// The declarations here are deliberately UNTYPED constants: the pinned
// grammar has no typed-constant production (`public const int X = 1;` — PHP
// 8.3, which phpunit itself uses at src/TextUI/Command/Result.php:21 — parses
// as an ERROR node). A fixture must parse cleanly, or its "shapes" are the
// recovery's shapes.

namespace App;

const FILE_LIMIT = 10;

function helper(): int
{
    return FILE_LIMIT;
}

// Fully-qualified calls: the callee's RAW text is `\spl_autoload_register`,
// and the target must still be the BARE name — with a builtin under the same
// spelling (`\is_file`) staying FILTERED, because PHP_BUILTINS holds bare
// names. Both shapes are pinned by forbidRelationships.
//
// 2026-10-05: PHP_BUILTINS is no longer a hand-written 218-name list but the
// whole internal surface derived from php-src, so BARE `spl_autoload_register`
// is now filtered too and this fixture's `calls -> spl_autoload_register`
// expectation is gone. That left the canonicalisation property — the one this
// fixture was written for — witnessed by an ABSENCE, which is weak: an analyzer
// that stopped canonicalising AND failed the table lookup would pass both
// forbid rows. So the property now has a POSITIVE control: a fully-qualified
// call to a name php-src does NOT declare must still publish its BARE leaf.
// `\App\helper` below is that control; `calls -> helper` (line 31) is its pin.
\App\helper();
\spl_autoload_register('helper');
\is_file('/tmp/x');

class Holder
{
    public const DEFAULT = 1;
    public const NAME = 'x';
    public static $registry = 0;

    // 30: attribute argument reading an in-file class constant
    #[\Attribute]
    public function touched(): void
    {
    }
}

#[\Attribute]
class Marker
{
}

#[\Attribute]
class Spec
{
}

// Same shape at CLASS level: not inside any callable, so truth is silent.
#[Spec(Holder::DEFAULT)]
class Decorated
{
}

class Service
{
    public const DEFAULT = 2;
    public static $static = 5;

    // 42: ATTRIBUTE argument on a METHOD is a header position inside the
    // callable subtree — truth reads it (inBody). The class-level attribute
    // below is the deliberate contrast: same shape, outside any callable, and
    // truth is silent there.
    #[Spec(Holder::DEFAULT, self::NAME)]
    public function specified(): void
    {
    }

    // 50: default = in-file file const
    public static function withFileConst(int $limit = FILE_LIMIT): int
    {
        return $limit;
    }

    // 56: default = class constant on another class
    public static function withClassConst(int $code = Holder::DEFAULT): int
    {
        return $code;
    }

    // 62: default = own class constant via self
    public static function withSelfConst(int $code = self::DEFAULT): int
    {
        return $code;
    }

    // 68: default = new expression
    public static function withNew(\stdClass $value = new \stdClass()): \stdClass
    {
        return $value;
    }

    // 74: promoted constructor property with a self default
    public function __construct(public int $mode = self::DEFAULT)
    {
    }
}
