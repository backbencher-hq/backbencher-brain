<?php
// PHP-A: member-call receivers read (plain chains like nullsafe links).
// PHP-H: static property reads (calls were always covered, reads never).
// PHP-D: constant fetches (::class is a keyword, never a member).
// PHP-E: sole-`...` calls are tear-off references, never invocations.
// PHP-F: interpolation reads ($this never reads).
// PHP-B: subscript bases (write-position bases read the address).
// PHP-C: closure captures copy outer values.
// PHP-O1: trait uses (oracle hole: class-level, never inBody).
trait T {
  public function hello(): void {}
}

enum Suit: string {
  case Hearts = 'H';
}

class C {
  use T;

  public static int $total = 0;

  public function useAll(C $other, array $xs, array $m, string $name, int $n): void {
    $this->dep->run();
    $other->box->fetch($n);
    $a = C::$total;
    $b = self::$total;
    $c = static::$total;
    $e = Suit::Hearts;
    $k = Suit::class;
    $f = $this->handler(...);
    $g = strlen(...);
    $h = $this->run($n);
    $s1 = "hello $name!";
    $s2 = "sum {$n}";
    $s3 = "val {$other->count} end";
    $q = $xs[0];
    $xs[1] = 5;
    $w = $m['k'];
    $fn = function ($x) use ($cap) { return $x; };
  }

  public function writeOnly(C $c): void {
    $c->slot = 1;
    C::$total = 2;
  }
}
