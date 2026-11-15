<?php
// M60.R8 (#931) — the php framework trigger surface.
//
// php was the ONE lane of the OO family with no framework fixture. Its markers
// were "proven by the probe" (`script/m60/framework-surface-probe.ts`) and the
// probe had said since 2026-09-22 that two of them claim a detection that does
// not happen — `claimMisses: 2` in `framework-surface-register.json`, with the
// note "measured GAP" written at both cases. Measured, disclosed, unfixed, and
// unfiled: R8 still read MET for this lane, because its runtime half (425 files,
// 0 findings) cannot see a marker that never fires. A marker that cannot fire is
// a detector every corpus calls clean.
//
// Both dead markers compared against text no call site could pass:
//   `text === "App\\"` — an exact match on a namespace string ENDING in a
//      backslash, which no node's text does. The Laravel app root is a PREFIX.
//   `text === "TestCase"` — tested against the NAMESPACE, which is empty for a
//      global-namespace class (and here it is `App\Http\Controllers`), while the
//      base clause that names the relationship was never passed at all.
//
// This file pins both spellings AND the ones that already worked, so a repair
// that silences the working path fails here too. The primary pick is pinned as
// well (php reads `frameworks[0]`, i.e. DOCUMENT order — python orders by its
// marker table and csharp by CS_FRAMEWORK_ORDER; php has no order table, which
// is recorded in the lane plan as a family-consistency item, not silently
// blessed by this fixture).

namespace App\Http\Controllers;

use Illuminate\Support\Facades\DB;

class UserController
{
    public function index(): array
    {
        return DB::table('users')->get()->all();
    }
}

// PHPUnit's global-namespace spelling: the base is written `TestCase` and the
// framework is never imported. This is the shape #931 says must detect.
class UserControllerTest extends TestCase
{
    public function testIndex(): void
    {
    }
}
