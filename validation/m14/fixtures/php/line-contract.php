<?php
// php/line-contract — M60 (#929). The M59.A7 / R6 line base, once per label.
//
// php carried a line on exactly ONE label — `references`, the R9 declared-type
// graph added 2026-09-22 — until this fixture. MEASURED at HEAD over
// phpunit+phpmyadmin: 2,123 of 2,418 corpus edges (87.8%) had no line_number,
// while the completion matrix's `lines` cell read PASS, because M60.P1 asks
// whether the field is written ANYWHERE rather than whether every edge carries
// one. Neither the differential (which matches on label/from/target and never on
// the line) nor the twelve php fixtures that preceded this one could see it.
//
// Contract (R6): every relationship carries the line of the node that NAMES it —
// here one node per label, tabulated in the expectation's `comment` fields.

trait Named
{
    public string $label = 'n';
}

interface Shape
{
    public function area(): float;
}

abstract class Figure implements Shape
{
    use Named;

    public string $title = 'figure';

    public function area(): float
    {
        $w = $this->width;
        return (float) $w;
    }
}

class Circle extends Figure
{
    public function area(): float
    {
        $r = $this->radius;
        return 3.0 * $r * $r;
    }
}

function build(): Circle
{
    include_once 'vendor/autoload.php';
    $shape = new Circle();
    $shape->area();
    return $shape;
}
