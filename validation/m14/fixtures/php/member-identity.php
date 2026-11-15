<?php

declare(strict_types=1);

namespace Fixture\MemberId;

/**
 * MEMBER IDENTITY fixture — the analyzer's `Owner.member` qualified name.
 *
 * The property under test is not cosmetic: the store resolves a relationship target by
 * `qualified_name` EXACT match first, and that index (`SELECT qualified_name, MIN(id) ... GROUP BY
 * qualified_name`) hands a DUPLICATE qualified name to whichever row sorts first. While php
 * published no qualified name for a member, that index was a NAME index, so a bare member target
 * was attached to the alphabetically first declaration of that name anywhere in the project —
 * silently, and in the expensive direction (a reverse walk from the wrong class reports callers in
 * files that never mentioned it).
 *
 * The fixture therefore declares the SAME member names under several owners, so the qualified
 * spelling is the only thing that separates them, and it names one symbol per owner kind the rule
 * covers. `helperFn` is the deliberate omission: its owner is a NAMESPACE, whose correct identity is
 * already php's own `Fixture\MemberId\helperFn` (see `metadata.fqn`), and a dotted second spelling
 * for one declaration is exactly the aliasing this rule exists to remove.
 */
interface Persister
{
    public function persist(array $row): int;
}

trait LogsPersist
{
    public function persist(array $row): int
    {
        return 0;
    }
}

class AlphaStore implements Persister
{
    public const LIMIT = 10;

    private string $name = 'alpha';

    public function persist(array $row): int
    {
        return 1;
    }

    public function describe(): string
    {
        return 'alpha';
    }
}

class BetaStore implements Persister
{
    public function persist(array $row): int
    {
        return 2;
    }

    public function describe(): string
    {
        return 'beta';
    }
}

enum Level: string
{
    case Low = 'low';

    public function label(): string
    {
        return 'low';
    }
}

function helperFn(): int
{
    return 3;
}
