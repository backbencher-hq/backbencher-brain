<?php
declare(strict_types=1);

namespace Fixture\LocalRead;

/**
 * The read half of the phantom link. This file declares its OWN `$counter` inside a function
 * body, reads it, and names nothing outside itself. Locals are never published as symbols (the
 * family contract), so a bare `counter` target has exactly one thing it can bind to in a project
 * that also carries `declares.php`.
 */
function run(array $xs): int
{
    $counter = 0;
    foreach ($xs as $x) {
        $counter = $counter + $x;
    }
    return $counter;
}

/** A second local whose name matches a UNIQUE declaration elsewhere — the same shape, spelled
 *  through the file-scope arm rather than the frame arm. Kept beside the first so a future change
 *  that fixes one arm and not the other is visible here rather than in a corpus run. */
function tally(array $rows): array
{
    $summary = [];
    foreach ($rows as $row) {
        $summary[] = $row;
    }
    return $summary;
}
