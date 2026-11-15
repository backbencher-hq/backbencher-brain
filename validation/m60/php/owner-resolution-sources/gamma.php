<?php declare(strict_types=1);

/**
 * OWNER-RESOLUTION SOURCE 3 of 4 — a leaf-name collision on the OWNER, and why identity wins.
 *
 * Two classes called `Twin` live in different namespaces (this file and `delta.php`), and each
 * declares `solo`. A pass that keyed the owner channel on the NAME alone would find two candidate
 * owners and have to decline — and declining here would be a real loss, because PHP is not ambiguous
 * about it at all: `$this->solo()` inside one of them means THAT one.
 *
 * The store can answer it exactly, because the relation row's source method carries an
 * `owner_symbol_id` — the enclosing declaration BY IDENTITY — and when the receiver's published name
 * equals that declaration's name, the two are the same thing. That is the rule the pass applies
 * before any name lookup (its rule 0), and this file is the case that makes the rule load-bearing
 * rather than an optimisation: swap the rule out for a name lookup and this row goes back to NULL
 * while every other row in the set stays green.
 */

namespace Fixture\OwnerRes\Left;

class Twin
{
    public function solo(): void
    {
    }

    public function goCollidingOwner(): void
    {
        $this->solo();
    }
}
