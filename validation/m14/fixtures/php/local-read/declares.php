<?php
declare(strict_types=1);

namespace Fixture\LocalRead;

/**
 * The declaration half. `Telemetry::$counter` and `Report::$summary` are ordinary, common English
 * names in an unrelated class in another file. Nothing here is imported by `reads.php` and nothing
 * in `reads.php` depends on it — which is exactly why the phantom link is worth a fixture: the
 * dependency is INVENTED by a name lookup, not observed.
 */
class Telemetry
{
    public int $counter = 0;
}

class Report
{
    public array $summary = [];
}
