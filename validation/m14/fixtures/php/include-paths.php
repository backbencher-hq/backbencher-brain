<?php

// R10 (#835) — the include-path spelling contract.
//
// WHY THIS FIXTURE EXISTS
// -----------------------
// The pre-R10 rule read the RAW TEXT of any `binary_expression` in an
// include/require position, so a concatenation with a runtime part published a
// reconstructed EXPRESSION as the import module AND as a `references` target:
//
//     include $this->baseDir . 'revision-info.php';   // phpmyadmin src/Git.php:97
//     module / target = "$this->baseDir.'revision-info.php'"
//
// No php symbol is ever named with `$`, `->` or a quote, so that edge could never
// resolve — and the differential oracle derived its truth from the SAME rule, so
// BOTH sides emitted it and every per-edge gate read clean. The static-path rule
// now requires every operand to be statically known, and this fixture pins both
// halves of that line: what must still be emitted, and what must NOT be invented.
//
// Authored BEFORE the analyzer run; the expectation's numbers come from the
// measurement that follows, and the forbids pin the defect this fixture exists
// for.

namespace App;

const FILE_PREFIX = 'app';

class Holder
{
    private string $baseDir = '/srv';

    // ---- static: every operand is known at parse time → EMITTED -------------
    public function staticPaths(): void
    {
        include __DIR__ . '/helpers.php';
        require __DIR__ . '/runtime.php';
        include_once FILE_PREFIX . '/config.php';
        require_once __DIR__ . '/once.php';
        include 'plain.php';
        include __DIR__ . '/nested/' . 'deeper.php';
    }

    // ---- dynamic: a runtime operand → NO path, and no fabricated spelling ---
    public function dynamicPaths(string $dir, string $suffix): void
    {
        // A member access on `$this` is a runtime value, not a path segment.
        include $this->baseDir . '/revision-info.php';
        // A plain variable operand.
        include $dir . '/x.php';
        // A bare variable is already skipped — pinned so it stays that way.
        include $dir;
        // Interpolated double-quoted strings are dynamic even without a concat.
        include "{$dir}/interpolated.php";
        // The suffix on the right-hand side is just as dynamic.
        include __DIR__ . $suffix;
    }
}
