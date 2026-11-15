<?php
// M37.13 gate fixture: procedural/top-level discovery, enum implements,
// WP registrar calls, anonymous-class guard.
//
// 1. Top-level statements (PHP scripts, config/bootstrap files) previously
//    emitted ZERO relationship edges — the call/creation processors lived
//    only in walkBody. Now `new Application()` / `$app->boot()` /
//    `register_shutdown_function(...)` at program scope emit global-sourced
//    instantiates/calls (mirrors the differential oracle's generic walk).
// 2. enum implements: PHP 8.1 enums implement interfaces via the same
//    class_interface_clause shape as classes.
// 3. Hook registration calls the registrar; it does not invoke the callback.
// 4. Anonymous classes: methods inside `new class { }` are not symbolized
//    (no nameable owner); their bodies are still walked for calls.

interface Labeled
{
    public function label(): string;
}

interface Tagged
{
    public function tags(): array;
}

enum Status implements Labeled, Tagged
{
    case Active;
    case Pending;

    public function label(): string
    {
        return $this->name;
    }

    public function tags(): array
    {
        return ['status'];
    }
}

class Application
{
    public function boot(string $env): void
    {
        $label = Status::Active->label();
        echo $label . ' on ' . $env;
    }
}

// --- procedural bootstrap (top-level statements) ---
$app = new Application();
$app->boot('prod');
// 2026-10-05: this file used to pin `calls(global -> register_shutdown_function)` — the
// bare-FUNCTION-call-at-program-scope half of procedural discovery (1) below. php-src
// DECLARES `register_shutdown_function`, and PHP_BUILTINS is now derived from php-src
// rather than hand-written, so that edge is filtered. `cleanup_app()` is the same shape on a
// callee THIS file declares, so the property is witnessed by a present edge again;
// `register_shutdown_function` stays in the source and is pinned by forbidRelationships.
cleanup_app();
register_shutdown_function('cleanup_app');
add_action('init', 'boot');
add_filter('the_title', 'decorate');

function cleanup_app(): void
{
    echo 'cleanup';
}

function boot(): void
{
    echo 'boot';
}

function decorate(string $t): string
{
    return $t;
}

// --- anonymous class at top level: methods walked, not symbolized ---
$handler = new class {
    public function handle(): void
    {
        $app = new Application();
        $app->boot('anon');
    }
};
$handler->handle();
