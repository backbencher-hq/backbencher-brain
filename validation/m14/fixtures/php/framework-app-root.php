<?php
// M60.R8 (#931) — the Laravel app-root marker, isolated.
//
// The sibling fixture (`framework-surface-pins`) carries BOTH repaired markers,
// which means a revert of either one can hide behind the other's honest edge:
// that file imports `Illuminate\Support\Facades\DB`, so Laravel is detected
// there whether or not the `App\` prefix marker works. This file is the marker's
// OWN witness — a Laravel controller under the app root with NO framework import,
// which is the probe's `laravel-app-root-only` shape and the one the dead marker
// was written for (`text === "App\\"`, an exact match on a string no node's text
// carries, because a namespace never ends in a separator).
//
// Negative control in the same file's expectation: PHPUnit must NOT appear —
// nothing here extends `TestCase`.

namespace App\Http\Controllers;

class HomeController
{
    public function show(): string
    {
        return 'home';
    }
}
