<?php

// R10 (#835) — the dynamic-callee spelling contract.
//
// `$callable()` names nothing: the callee is a runtime VALUE. The pre-R10 rule
// read the callee node's raw text, so the lane published `calls -> $callable`
// (measured in phpmyadmin's tests: `calls -> $controller` in
// LicenseControllerTest.php:23) — a target no php symbol can ever be named, and
// the differential oracle derived the same truth from the same shape, so both
// sides agreed and no per-edge gate could see it. The value IS read, and that
// read is a `uses` edge; this fixture pins BOTH halves: the honest read is still
// emitted, and the fabricated callee name is not.

namespace App;

class Dispatcher
{
    public function dispatch(callable $handler, string $name): void
    {
        // A value callee: read, but never a calls target.
        $handler();

        // The same value invoked with arguments.
        $handler('payload');

        // A NAMED callee in the same method still produces its calls edge, so
        // the fixture cannot be satisfied by dropping `calls` altogether.
        $this->run($name);
    }

    public function run(string $name): void
    {
        strlen($name);
    }
}
