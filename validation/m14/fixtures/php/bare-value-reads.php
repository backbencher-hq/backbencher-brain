<?php
// PHP2: bare value reads — `$var` locals/params/captures/superglobals and
// bare `NAME` constants. Lookup: frame chain, then file functions, then
// superglobals (vars) / file consts (consts). Decl/write/label/type
// positions never read.
define('ROOT_PATH', '/srv/app');
const LIMIT = 10;
const RUN_NAME = 'run.main';
const FALLBACK = 0;

function helper(int $n): int {
  $doubled = $n * 2;
  return $doubled;
}

$greeting = 'hi';

class Reader {
  public int $base = LIMIT;
  public const KIND = RUN_NAME;

  public function run(int $n, array $xs): int {
    global $greeting;
    $total = $n;
    foreach ($xs as $item) {
      $total += $item;
    }
    [$first, $second] = $xs;
    try {
      $total += helper($first);
    } catch (\RuntimeException $e) {
      $total += strlen($greeting);
    }
    $fn = function ($x) use ($total) { return $x + $total; };
    $arrow = fn ($y) => $y + $n;
    $total += $fn($first) + $arrow($second);
    $total += count($xs) + $_GET['bonus'] + LIMIT + ROOT_PATH_LEN + $this->base;
    $srv = $_SERVER;
    $total += count($srv);
    return $total;
  }

  #[Route('/run', name: RUN_NAME)]
  public function attr(int $v = FALLBACK): int {
    return $v;
  }
}

enum Level: string {
  case Low = 'l';
  case High = RUN_NAME;
}

$result = helper(3);
$result += helper($result);
$reader = new Reader();
$result += $reader->run(1, [2]);
