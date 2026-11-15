<?php declare(strict_types=1);
/*
 * M12.PHP-GROUPED-USE — `use C\{D, E as F};` emitted NOTHING.
 *
 * A `use` declaration has two AST shapes:
 *   use App\Models\User;          -> namespace_use_clause as a DIRECT child
 *   use App\Models\{User, Post};  -> namespace_name + namespace_use_group
 *                                      ^prefix        ^the clauses live in here
 *
 * The analyzer only ever looked for a namespace_use_clause among the direct
 * children, so the grouped form matched nothing: no ImportInfo, no `imports`
 * edge, no framework detection. Grouped use is the idiomatic modern form.
 *
 * Why a full-corpus run did not catch it: `use X\{...};` occurs ZERO times in
 * phpunit@C8d6921f and ZERO times in phpmyadmin@4061095a. The corpora cannot
 * detect a construct they do not contain, and derivePhpEdges shared the same
 * blind spot, so analyzer and oracle agreed on an absence and the differential
 * reported 100% coverage over 4,139 files while missing this entirely. This
 * fixture is the construct matrix doing the job a corpus cannot.
 *
 * The members must be recorded QUALIFIED (C\D, not a bare D) because that is
 * the FQN PHP binds — and a bare `D` would collide with every other group in
 * any real codebase. The `as F` alias is carried on items, not on the target.
 */
namespace M12\GroupedUse;

use App\Models\User;
use App\Models\{Post, Comment};
use App\Support\{function slugify, const MAX_DEPTH};
use Vendor\Pkg\{Alpha as A, Beta};

interface Runner
{
    public function run(int $n): string;
}

final class Dispatcher implements Runner
{
    public function run(int $n): string
    {
        return slugify((string) $n) . MAX_DEPTH . A::class;
    }
}
