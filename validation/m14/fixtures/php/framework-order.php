<?php
// M60.R8 (#934) — the framework ORDER contract, isolated.
//
// The two `use` statements below are in the INVERSE of the lane's marker-table order
// on purpose: Symfony's marker fires first in this file and Laravel's fires second, so
// a lane that publishes `[...detectedFrameworks]` (a Set's insertion order) reports
// `["Symfony","Laravel"]` with Symfony as primary, while the marker table reports
// `["Laravel","Symfony"]` with Laravel as primary.
//
// That inversion is what makes this fixture load-bearing, and it is why the sibling
// `framework-surface-pins` could not hold this rule: there the namespace `App\...`
// fires Laravel first, so document order and table order agree and both answers pass.
//
// The family rule comes from the lane it was first fixed on. R8's register records
// python's second caught mutant as literally "the emitted order following import order
// instead of the marker table"; swift carries SWIFT_FRAMEWORK_ORDER, objective-c
// OBJC_FRAMEWORK_ORDER, and csharp's CS_FRAMEWORK_ORDER is the rule python's header
// cites. php had no table at all — so the primary pick was a property of the statement
// layout of one file, which is the defect, not the particular answer.

use Symfony\Component\Console\Command\Command;
use Illuminate\Support\Facades\DB;

class SyncCommand extends Command
{
    public function handle(): void
    {
        DB::table('jobs')->get();
    }
}
