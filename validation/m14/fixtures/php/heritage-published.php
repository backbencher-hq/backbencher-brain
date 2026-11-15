<?php declare(strict_types=1);

/**
 * HERITAGE PUBLISHED — the project-wide type hierarchy, on the SYMBOL.
 *
 * ## WHY THIS FILE EXISTS
 *
 * php published its heritage as EDGES (`extends`, `implements`) and never on the symbol. The store
 * seam that persists a hierarchy reads `symbol.metadata.superTypes` (parallel-indexer.ts:3590) and
 * writes `brain_symbol.super_types`; NULL is that column saying "declares no supertypes". So for
 * every php symbol the column was NULL, `retargetCrossFileOverrides` returned before its first
 * query (`if (supertypes.size === 0) return out`), and php had no project-wide hierarchy at all —
 * not a thin one, none. The edge-only form is enough for a consumer that walks the graph one file
 * at a time and is NOT enough for a consumer that has to answer "is this member inherited" from the
 * store, which is the shape the lane's ambiguity census priced at 24,223 endpoints
 * (`owner+inherited`, the only sound lever in the ladder) and which no implementation can do while
 * the column is NULL.
 *
 * ## WHAT THE ROWS PIN
 *
 * The payload must MIRROR the heritage edges the same declaration emits — same spellings, same
 * omissions, no re-derivation. That is the invariant, and every row below is one half of it:
 *
 *   class WithBaseAndInterfaces extends Base implements First, Second   -> [Base, First, Second]
 *   class WithInterfaceOnly implements First                            -> [First]
 *   class NoHeritage                                                   -> ABSENT, not []
 *   interface DerivedIface extends First, Second                       -> [First, Second]
 *   enum Suit implements Labeled                                       -> [Labeled]
 *
 * plus the two same-leaf shapes PHPD10 already settles for the EDGE, which the payload must not
 * re-decide for itself:
 *
 *   class FeaturesForm extends \Forms\User\FeaturesForm  -> ["Forms\User\FeaturesForm"]
 *       the qualification is KEPT, because the leaf (`FeaturesForm`) is the class's own name and
 *       collapsing it would make the class its own parent;
 *   class InvalidArgumentException extends \InvalidArgumentException
 *       the base is a global single segment that qualification cannot separate from the class's own
 *       name, so this file resolves it to NOTHING: no `extends` edge, and therefore no
 *       `superTypes` entry. A payload that re-derived the base from the node text would put
 *       `InvalidArgumentException` in this class's own heritage — a self-loop written into the
 *       column that exists to be walked.
 *
 * ## WHY ABSENT AND NOT EMPTY, AND WHY THE ROWS CAN TELL THE TWO APART
 *
 * `parallel-indexer.ts` writes NULL when `superTypes` is missing OR empty, and NULL is that column's
 * way of saying "declares no supertypes" — the same value an unmigrated row carries, which is the
 * honest degradation the retarget pass documents. So `[]` and absent ARE one fact downstream, and
 * the byte-level difference is a spelling choice rather than a claim. It is pinned anyway, and the
 * pin is exact: the runner's `meta.x: null` requires the value to be absent or null
 * (`mv !== undefined && mv !== null`), so a payload that published `[]` FAILS these rows. That is
 * the intended reading — the spelling cannot drift without a fixture going red and a decision being
 * made — and it is worth stating plainly because "absent and `[]` are the same thing" is true of
 * the STORE and false of these rows. What the rows additionally kill is a payload that names a
 * heritage this declaration does not have.
 *
 * ## THE ONE THING THIS FILE DOES NOT PROVE
 *
 * That the walk it enables is SOUND. The existing consumer keys its map on the symbol's bare
 * `name`, so two classes called `Child` in different namespaces merge their parents — the same
 * leaf-collision the `overrides` oracle bounded itself around. This fixture pins the payload, not
 * the consumer's key choice; that is a separate measurement and it is not claimed here.
 */

namespace Fixture\Heritage;

interface First
{
    public function firstThing(): string;
}

interface Second
{
    public function secondThing(): string;
}

interface Labeled
{
    public function label(): string;
}

class Base implements First
{
    public function firstThing(): string
    {
        return 'base';
    }
}

/** Both halves at once — the row that separates "the base only" from "base plus interfaces". */
class WithBaseAndInterfaces extends Base implements Second, Labeled
{
    public function secondThing(): string
    {
        return 'second';
    }

    public function label(): string
    {
        return 'labelled';
    }
}

/** Interfaces WITHOUT a base: the arm a base-only implementation gets right by accident. */
class WithInterfaceOnly implements Second
{
    public function secondThing(): string
    {
        return 'second';
    }
}

class NoHeritage
{
    public function nothing(): void
    {
    }
}

/** An interface's parents are `extends` edges, so they belong in its heritage too. */
interface DerivedIface extends First, Second
{
    public function ownThing(): string;
}

interface PlainIface
{
    public function plainThing(): string;
}

/** PHP 8.1 enums implement through the class_interface_clause shape. */
enum Suit implements Labeled
{
    case Hearts;
    case Spades;

    public function label(): string
    {
        return 'suit';
    }
}

namespace Forms\Setup;

/**
 * Same LEAF as its fully-qualified external base, declared in another file. PHPD10 keeps the
 * qualification on the edge; the payload must carry the SAME string, or a consumer holding the
 * column would be walking toward a class named after the one it started from.
 */
class FeaturesForm extends \Forms\User\FeaturesForm
{
    public static function getForms(): array
    {
        return ['derived'];
    }
}

/**
 * The global SPL builtin differs from this namespaced class even though the
 * display leaves coincide. Preserve its canonical global parent identity.
 */
class InvalidArgumentException extends \InvalidArgumentException
{
}
