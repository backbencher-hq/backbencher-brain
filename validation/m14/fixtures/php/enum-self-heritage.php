<?php

declare(strict_types=1);

/**
 * Canonical self-heritage controls. A leading backslash selects the global
 * namespace; it does not identify a namespaced enum of the same leaf name.
 * Bare self-references and exact qualified self-references are omitted.
 * Native same-leaf controls: validation/m14/verify-php-type-identities.mts.
 */

namespace Fixture\EnumSelf;

interface Marker
{
    public function mark(): string;
}

/** (1) The gap this file was authored to fail on. */
enum SelfQualified: string implements \SelfQualified
{
    case A = 'a';
}

/** (2) The bare spelling of the same fact, on all three branches. */
enum BareSelf implements BareSelf
{
    case B;
}

class BareSelfClass implements BareSelfClass
{
}

interface BareSelfIface extends BareSelfIface
{
}

/** (4) CONTROL — a real interface: the edge must exist. */
enum Honest implements Marker
{
    case C;

    public function mark(): string
    {
        return 'c';
    }
}

/** (5) Exact qualified self-reference: omit the edge. */
enum Separable implements \Fixture\EnumSelf\Separable
{
    case D;
}
