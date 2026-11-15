<?php declare(strict_types=1);

/**
 * RECEIVER OWNER — the construct matrix for the owner a member-position edge carries.
 *
 * ## WHY THIS FILE EXISTS
 *
 * A member is PUBLISHED as `(bare name, ownerName)`: `real-php-analyzer.ts` sets `ownerName` on
 * every method and `pool-worker.ts:1007` carries it into the store. The EDGE side carried no owner
 * at all, so `$this->render()`, `self::render()`, `parent::render()` and `Widget::render()` all
 * published the target string `render` and were indistinguishable from one another. `render` is a
 * method on many classes at once, so the reverse walk has to pick one declaration by a rule
 * nobody chose.
 *
 * The receiver node was on hand at every one of those emission sites and was discarded. This file
 * pins, per receiver shape, whether the owner is recoverable — and, as the half that actually
 * matters, where it is NOT and must not be invented.
 *
 * ## THE SIX EMISSION SITES, AND WHY SIX
 *
 * The first draft of this fixture covered the two CALL sites only. That is a quarter of the
 * population: the same discarded receiver governs member READS, static property reads and
 * constant fetches too, and those are the majority by volume. All six are pinned here:
 *
 *   calls        $this->m()  $this?->m()  self::m()  static::m()  parent::m()  C::m()  \A\B\C::m()
 *   uses/read    $this->p    self::$p     C::$p      static::$p
 *   uses/const   self::K     C::K         parent::K   \A\B\C::K
 *   uses/tearoff $this->m(...)  — a tear-off REFERENCES and never invokes
 *
 * ## THE THREE CASES WHERE THE OWNER MUST NOT APPEAR
 *
 * These are the pins that matter most, because the failure they guard against is silent and in the
 * expensive direction — a WRONG owner sends a reverse walk to a real method on the wrong class,
 * which is wrong refactoring advice rather than a missing edge:
 *
 *   (a) `$obj->m()` — a local variable. Its class is whatever was assigned to it; without type
 *       inference the tree does not say, so no owner is emitted. Not the enclosing class, which is
 *       the tempting wrong answer.
 *   (b) `$this->svc->m()` — the receiver is itself a member read. The chain starts at `$this` but
 *       the object's type is the PROPERTY's declared type, which this analyzer does not infer.
 *       Emitting the enclosing class here would be a guess about a different class.
 *   (c) `parent::m()` with NO DECLARED BASE — `OrphanCaller` declares no base, so there is no owner
 *       to name. `processObjectCreation` already takes this position for `new parent()` (a wrong
 *       edge is worse than no edge) and this file pins that the call side does the same.
 *
 * ## `::class` IS NOT A MEMBER
 *
 * `self::class` arrives as a `class_constant_access_expression` and is skipped by the existing
 * rule; it is here so a future owner rule cannot attach an owner to it by reading the node instead
 * of applying that rule.
 */

namespace Fixture\ReceiverOwner;

class DeclaredBase
{
    public function inherited(): string
    {
        return 'base';
    }

    public const BASE_CONST = 1;
}

class Target
{
    public static $count = 0;

    public function named(): string
    {
        return 'named';
    }

    public const TARGET_CONST = 2;
}

/**
 * Case (c): NO base clause at all, so `baseByClass` has no entry and `parent::` has no owner.
 *
 * Named apart from `External::goExternal` on purpose: an edge's SOURCE is the BARE method name
 * (`uses -> __construct`, `calls -> build` in the pinned fixtures), so two methods both called `go`
 * are one indistinguishable source to a fixture and neither case could be pinned.
 */
class OrphanCaller
{
    public function orphan(): string
    {
        return '';
    }

    public function goUndeclared(): string
    {
        return parent::orphan();
    }
}

class Receiver extends DeclaredBase
{
    public const OWN_CONST = 3;

    public static $staticProp = 0;

    private int $prop = 1;

    /** Untyped on purpose — see case (b): a declared type here would invite inference this file does not claim. */
    private $svc;

    public function everything(): int
    {
        // --- calls, owner recoverable ---
        $this->viaThis();
        $this?->viaNullsafeThis();
        self::viaSelf();
        static::viaStatic();
        parent::inherited();
        Target::named();
        \Fixture\ReceiverOwner\Target::named();
        \Fixture\ReceiverOwner\Qualified::onlyViaAbsolutePath();

        // --- calls, owner NOT recoverable: cases (a) and (b) ---
        $obj = new Target();
        $obj->viaPlainVariable();
        $this->svc->viaChainedReceiver();

        // --- uses: reads, tear-off, static property, constant ---
        $read = $this->prop;
        $bound = $this->viaThis;
        $tear = $this->viaThis(...);
        $staticRead = self::$staticProp;
        $scopedRead = Target::$count;
        $ownConst = self::OWN_CONST;
        $targetConst = Target::TARGET_CONST;
        $baseConst = parent::BASE_CONST;
        $qualifiedConst = \Fixture\ReceiverOwner\Target::TARGET_CONST;
        $classKeyword = self::class;

        return $read + (int) $staticRead + (int) $scopedRead + (int) $ownConst + (int) $targetConst
            + (int) $baseConst + (int) $qualifiedConst + $bound->viaThis() + $tear->viaThis()
            + strlen($obj->viaPlainVariable() . $this->svc->viaChainedReceiver());
    }

    public function viaThis(): string
    {
        return 'this';
    }

    public function viaNullsafeThis(): ?string
    {
        return 'nullsafe';
    }

    public function viaSelf(): string
    {
        return 'self';
    }

    public static function viaStatic(): string
    {
        return 'static';
    }

    public function viaPlainVariable(): string
    {
        return 'plain';
    }

    public function viaChainedReceiver(): string
    {
        return 'chained';
    }
}

/**
 * A class reachable ONLY through a FULLY-QUALIFIED static call.
 *
 * `\Fixture\ReceiverOwner\Target::named()` shares its target string with `Target::named()` one
 * line above, and a fixture row matches with `some()` — so on its own the qualified form is
 * satisfied by the unqualified edge and the reduction to a leaf name is never pinned. This
 * method has no unqualified twin, so the ONLY edge that can satisfy a row for it is the
 * fully-qualified one, and `meta.owner: "Qualified"` therefore states the reduction rather
 * than the surrounding context.
 */
class Qualified
{
    public function onlyViaAbsolutePath(): string
    {
        return 'qualified';
    }
}

/**
 * A FOURTH case, which is NOT a "no owner" case and is easy to mistake for one.
 *
 * A class with NO base clause (`OrphanCaller`, above) cannot resolve `parent::`. A class whose
 * base is declared but lives in ANOTHER file CAN: the owner is the base's own name, which this
 * file does not publish. So the edge is right and unresolved, and a consumer must not read
 * `unresolved` as `wrong`.
 *
 * It is pinned as its own class because collapsing it into case (c) would make an owner rule that
 * is merely incomplete — it cannot see other files — look like one that invents.
 */
class External extends DeclaredInAnotherFile
{
    public function goExternal(): string
    {
        return parent::orphan();
    }
}