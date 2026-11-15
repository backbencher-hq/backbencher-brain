<?php declare(strict_types=1);

// M60 php lane — STATIC vs DYNAMIC member names.
//
// A property read names a member only when the name is a STATIC `name` node.
// The old rule on both sides was a proxy — the analyzer skipped a name whose
// text starts with `$`, the oracle pushed the raw name-field text — and a proxy
// is exactly what the dynamic spellings break. Measured
// (script/m14/tmp/php-dynamic-member-shapes.ts) before either side was touched:
//
//   $postParams->$param      analyzer: NOTHING (skipped)   oracle: `uses -> $param`
//   $box->{'quoted'}         analyzer: `uses -> 'quoted'`  oracle: `uses -> 'quoted'`
//   $box->{1}                analyzer: `uses -> 1`         oracle: `uses -> 1`
//
// The first is the phpmyadmin MISSING (src/Http/ServerRequest.php:233, and
// src/Normalization.php). The other two are STRING/INTEGER LITERALS published as
// symbol names — and they are published IDENTICALLY on both sides, so no mirror
// could ever report them: they are invisible by construction, which is why this
// fixture (independent of the mirror) is the only thing that can hold them.
//
// The pinned grammar keeps the braces as anonymous `{`/`}` tokens around the
// name field, so the two forms are distinguishable:
//   $o->NAME   -> [variable_name, ~->, name]
//   $o->{NAME} -> [variable_name, ~->, ~{, name, ~}]
//
// A braced field is a DYNAMIC selection: the property is chosen at run time,
// the static graph holds no member symbol for it, and the field's own
// expression reads come from the ordinary rules for those nodes.

const FIELD = 'from_const';

class Box
{
    public $plain = 1;

    public function touch($param, array $arr, $key): void
    {
        // 40: static name — the member read
        $a = $this->plain;

        // 43: dynamic field, VARIABLE — the variable is read, the member is not
        $b = $this->$param;

        // 46: same, braced
        $c = $this->{$param};

        // 49: braced SUBSCRIPT — the subscript base reads, the member does not
        $d = $this->{$key[0]};

        // 52: braced STRING literal — no symbol exists here
        $e = $this->{'quoted'};

        // 55: braced INTEGER literal — no symbol exists here
        $f = $this->{7};

        // 58: braced FILE CONST — the constant selects the property, so it reads
        $g = $this->{FIELD};

        // 61: an inner static member inside a braced field reads normally
        $h = $this->{$this->plain};

        // 64: dynamic WRITE — a write is never a read
        $this->$param = 2;

        // 67: static read under a nullsafe receiver
        $i = $this->plain;

        // 70: subscript of a static member read
        $arr[$param] = 3;
    }
}
