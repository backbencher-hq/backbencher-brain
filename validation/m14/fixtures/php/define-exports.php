<?php

// THE `exports` CONTRACT — a name this file PUBLISHES and does not declare.
//
// WHY THIS FIXTURE EXISTS
// -----------------------
// This lane ruled `exports` inapplicable on a MEASURED parse-tree count: 0
// occurrences of `class_alias` / `define` in 4,642 admitted corpus files. The
// `define` half of that probe could not fire — it compared `arguments.namedChild(0)`
// against `string` / `encapsed_string`, and tree-sitter-php puts an `argument` node
// between them:
//
//     function_call_expression
//       name "define"
//       arguments
//         argument          <- what namedChild(0) returned
//           encapsed_string <- the node the test wanted
//
// No corpus could falsify that zero, because no corpus makes it non-zero. A control
// corpus containing `define("X", 1);` read 0 too, until the wrapper was inspected.
// With the wrapper descended the corpus reads 60 occurrences in 20 files, so the
// type is a GAP and this is the contract for it.
//
// The three rules the edges below pin, each of which the corpus numbers depend on:
//   1. the callee RESOLVES TO THE GLOBAL `define` — the bare name `define`, or the
//      FULLY QUALIFIED spelling `\define`. PHP's own name-resolution rules make the
//      second one unconditional: "Fully qualified names always resolve to the name
//      without leading namespace separator", so a leading `\` leaves no namespace
//      lookup and no fallback for the rule to be wrong about. A QUALIFIED callee
//      (`Other\define`) and a RELATIVE one (`namespace\define`) are NOT this function:
//      the first resolves against the current namespace, and the second does not even
//      fall back — "Relative names always resolve to the name with namespace replaced
//      by the current namespace" — while the fallback to global exists only for
//      UNQUALIFIED names;
//   2. the first argument's VALUE is a string literal, read through the `argument`
//      wrapper — `define($n, …)` publishes a name nobody can write down;
//   3. the call is at FILE scope. A `define()` in a function body publishes the name
//      only if that function runs. A top-level `if` is NOT a scope: it executes when
//      the file is included, so it DOES publish — and that asymmetry is the reason a
//      fixture exists rather than a count.
//
// Authored BEFORE the analyzer run; the expectation's numbers come from the
// measurement that follows, and the forbids pin the defects this fixture is for.

namespace App\Config;

use Runtime\Missing\Helper;

const DECLARED_CONST = 'declared, not published';

// ---- EMITTED: two publications at file scope, one inside a top-level `if` ----
define('CLOOGLE_DB_HOST', 'localhost');
define('CLOOGLE_DB_USER', 'root');

if (PHP_SAPI !== 'cli') {
    // Not a scope. The file still runs this when it is included.
    define('CONDITIONAL_TOP_LEVEL', 2);
}

// ---- NOT EMITTED: nested in a function, so the FILE does not publish it ----
function lazyDefaults(): void
{
    define('LAZY_ONLY', 3);
}

// ---- EMITTED: the ABSOLUTE spelling of the same global function ----
// The shape the corpus ACTUALLY contains: phpunit's
// `tests/end-to-end/generic/_files/auto_prepend_file.php` is one file-scope
// `\define('AUTO_PREPEND_FILE_LOADED', true);` — a fixture whose entire purpose is that
// a prepended file publishes a constant every later script can read. Found by the
// define-audit in exports-probe.mts (1 occurrence, file-level, literal name) after the
// bare-name test had silently refused it, and it is why rule 1 is written as the
// callee's RESOLUTION rather than its spelling.
//
// RESTORED 2026-10-16: this block and the five shapes below it were dropped from this
// file by the merge `b8bb87d8d` ("the src reads and the final sweep"), which took an
// OLDER revision of the fixture while keeping the newer expectation — so the expectation
// pinned `AUTO_PREPEND_STYLE` and four forbidden names that no line of the fixture
// wrote, and the fixture read FAIL for reasons that had nothing to do with the analyzer.
// The analyzer accepts the shape (verified on the corpus file above, which emits
// `exports global -> AUTO_PREPEND_FILE_LOADED` with `calleeShape: absolute-fq`).
\define('AUTO_PREPEND_STYLE', true);

// ---- NOT EMITTED: a qualified callee is a different function ----
// `Other\define(...)` resolves to `App\Config\Other\define` — a userland function with
// that name, never PHP's `define`. (In this file the call is a fatal error at runtime:
// it exists here to pin the RESOLUTION rule, not to run.)
Other\define('NAMESPACED_OTHER', 5);

// ---- NOT EMITTED: a relative callee does NOT fall back to the global function ----
// `namespace\define(...)` resolves to `App\Config\define` and stops there. The fallback
// to the global function is a rule for UNQUALIFIED names only, so an `exports` edge from
// this call would assert a publication the call does not make — and the two spellings
// differ by five characters, which is exactly why a fixture pins them apart.
namespace\define('RELATIVE_NAMESPACE_SHAPE', 6);

// ---- NOT EMITTED: the scope rule is independent of the callee's spelling ----
// The new absolute shape must not arrive with a loophole: this is the SAME call as the
// emitted one above, one function body down, and the file still does not publish it.
function lazyAbsolute(): void
{
    \define('NESTED_ABSOLUTE', 7);
}

// ---- NOT EMITTED, and PRICED rather than assumed: the ALIASED spelling ----
// `use function define as pub;` then `pub('X', 1)` DOES publish — an unqualified name is
// translated through the file's FUNCTION import table, with a fallback to the global
// function. Measured over the whole admitted population by exports-probe.mts:
// `aliased-use-function` occurrences = 0, so implementing the import table for this one
// callee would change no edge, and the shape is recorded here (forbidden, with this
// reason) instead of being half-implemented.
use function define as pub;
pub('ALIASED_PUBLICATION', 8);

// ---- NOT EMITTED: an ALIAS of a class is a different call, and the name it publishes
//      is the alias, never the class it points at ----
class_alias('Original\\Widget', 'Widget');

// ---- NOT EMITTED: no literal name to publish, so no endpoint exists ----
function computed(string $name): void
{
    define($name, 4);
}

// ---- The published name is GLOBAL even inside a namespace ---------------------
// `DECLARED_CONST` is a namespace-scoped `const` declaration and is carried by
// `contains` (it has an owner). A `define()`d name resolves against the GLOBAL
// scope, so it gets NO ownerName and therefore no `contains` edge — publishing it
// is an `exports` edge, and conflating the two is what this contrast pins.

class Reader
{
    public function read(): string
    {
        // Reads of a published name resolve through the file-scope prescan, which
        // already knew `define()` names before this fixture existed.
        return CLOOGLE_DB_HOST . DECLARED_CONST;
    }
}