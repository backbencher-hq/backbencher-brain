<?php
namespace App\Base;

class BaseService {
    public function __construct() {}

    public function save($record) {
        $this->persist($record);
    }

    protected function persist($record) {
        return $record;
    }
}

// Appended by the php truth round (2026-10-07): ONE file-scope `define()` so the human-audited
// ground truth in validation/m12/ground-truth/php.json covers the `exports` relationship kind —
// the type whose RULING this lane FALSIFIED (PHPD33 read "no exports kind" off a probe that could
// not match on any input; the construct is real: 60 literal `define()` calls in 20 admitted files,
// 57 of them at file scope, and the corpus emits 57 `exports` edges over 17 files).
//
// APPENDED, not inserted: a line in the middle would shift every line number the 74 existing facts
// cite, and those line numbers are the audit rather than a description of it. (71 before this row.)
//
// The shape is deliberate: it is a NAMESPACED file, so this row also pins that `define()` publishes
// the name it was given (`BASE_PREFIX`) and not a namespace-qualified spelling of it — `define()` is
// not namespace-sensitive in PHP, and an analyzer that qualified the name here would be naming a
// constant no caller can write.
define('BASE_PREFIX', 'base');
