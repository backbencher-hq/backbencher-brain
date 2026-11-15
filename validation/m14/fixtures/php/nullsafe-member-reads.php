<?php
// M37.13 follow-up wave-2 gate fixture (php dual-lens #606, PHPD11):
// PHP 8 nullsafe member READS must emit uses exactly like the non-null
// form. `$this->svc->name` parses as member_access_expression with a
// "name" field; `$this->svc?->name` parses as
// nullsafe_member_access_expression with the SAME "name" field — the
// walkBody member-read branch only matched member_access_expression, so
// every nullsafe read silently dropped the trailing member edge (20
// occurrences across phpunit+phpmyadmin+slim, differential-invisible
// because the oracle shared the gate). Writes and RMW through nullsafe
// stay gated exactly like the plain form.

class Feature
{
    public string $name = 'feature';
    public ?Feature $nested = null;

    public function label(): string
    {
        return $this->name;
    }
}

class Consumer
{
    private ?Feature $feature = null;

    public function describe(): string
    {
        // nullsafe READS — trailing member must emit uses (was dropped)
        $n = $this->feature?->name;
        $d = $this->feature?->nested?->name;
        return (string)$n . (string)$d;
    }

    public function rewrite(string $v): void
    {
        // nullsafe WRITE — `name` is the LHS, never a read (already gated
        // by the byte-range first-child rule on both forms)
        $this->feature?->name = $v;
    }

    public function bump(): void
    {
        // nullsafe RMW — same augmented-assignment gate as plain form
        $this->feature?->name .= '!';
    }
}
