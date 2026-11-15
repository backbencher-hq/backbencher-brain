<?php
// Managed-OO payload fixture (php wave #268). Pins the analyzer's relationship
// + payload surface on real PHP architecture: interface contracts, class
// inheritance, trait composition, enums, static/magic methods, calls (builtin-
// filtered), member READS (uses — writes excluded), instantiates via `new`,
// namespace use imports, per-symbol complexity, and evidence tiers.

namespace App\Service;

use App\Models\Order;
use App\Contracts\Gateway as PaymentGateway;
use function json_encode;

require_once __DIR__ . '/bootstrap/app.php';

interface Authorizer
{
    public function authorize(float $amount): bool;
}

interface Refundable
{
    public function refund(float $amount): bool;
}

class BaseService
{
    protected string $name;

    public function __construct(string $name)
    {
        $this->name = $name;
    }
}

class PaymentService extends BaseService implements Authorizer, Refundable
{
    use Loggable;

    public const MAX_RETRIES = 3;
    private float $balance = 0.0;
    private PaymentGateway $gateway;

    public function __construct(PaymentGateway $gateway, string $name)
    {
        parent::__construct($name);
        $this->gateway = $gateway;
    }

    public function authorize(float $amount): bool
    {
        if ($amount <= 0) {
            return false;
        }
        if ($amount > $this->balance) {
            return false;
        }
        for ($i = 0; $i < self::MAX_RETRIES; $i++) {
            // 2026-10-05: this loop used to call `usleep(100)` and the expectation row
            // pinned `calls -> usleep`. php-src DECLARES `usleep`, and PHP_BUILTINS is now
            // derived from php-src rather than hand-written, so the edge is filtered and the
            // row could not be kept. Swapping in a trait method this file DECLARES keeps the
            // pinned property — a call inside a NESTED LOOP BODY attributed to the enclosing
            // method, evidence `usage_contextual` — witnessed by a present edge. `usleep`
            // stays in the loop and is now pinned by a forbidRelationships row instead, so the
            // builtin filter this fixture relies on is still witnessed after the table change.
            $this->backoff();
            usleep(100);
        }
        $this->balance -= $amount;
        return $amount > 0 && $this->balance >= 0 ? true : false;
    }

    public function refund(float $amount): bool
    {
        $this->balance += $amount;
        return true;
    }

    public static function create(string $name): self
    {
        return new PaymentService(new StripeGateway(), $name);
    }

    public static function spawn(): self
    {
        // Exercises all three relative scopes: self -> PaymentService,
        // static -> PaymentService (static best-effort), parent -> BaseService.
        $a = new self('a');
        $b = new static('b');
        $c = new parent('c');
        return $a;
    }
}

trait Loggable
{
    public function log(string $message): void
    {
        echo $message;
    }

    /**
     * Callee for the nested-loop call pinned by `calls -> backoff` from `authorize`. Declared
     * HERE so the edge is local on both ends and php-src cannot label it external — the
     * `labelExternalTargets` per-file guard.
     */
    public function backoff(): void
    {
    }
}

class OrderService
{
    use Loggable;

    public function process(Order $order): void
    {
        $this->log('processing ' . $order->id);
        $gateway = new PaymentService(new StripeGateway(), 'main');
        $ok = $gateway->authorize($order->total);
        if ($ok) {
            $this->dispatch($order);
        }
    }
}

enum OrderStatus: string
{
    case Pending = 'pending';
    case Paid = 'paid';
}

// F6 coverage (2026-09-02): try/catch, do-while, foreach, function_definition,
// include/require expressions, intersection/union/optional types, match,
// nullsafe member call, property promotion, switch, variadic parameter,
// encapsed_string — declared handled_verified, now exercised.
require __DIR__ . '/nonexistent-helper.php';
include __DIR__ . '/nonexistent-legacy.php';
require_once 'nonexistent-shared.php';
include_once 'nonexistent-legacy2.php';

function f6_global_helper(?int $base, string|Countable ...$labels): string
{
    $count = 0;
    while ($count < 3) {
        $count += 1;
    }
    do {
        $count -= 1;
    } while ($count > 0);
    foreach ($labels as $label) {
        $count += strlen($label);
    }
    $result = match (true) {
        $count > 5 => 'high',
        $count > 2 => 'mid',
        default => 'low',
    };
    switch ($count) {
        case 1:
            $result .= '!';
            break;
        default:
            break;
    }
    try {
        $plain = "base=$base count=$count";
    } catch (RuntimeException $e) {
        $plain = 'err';
    }
    return $plain . $result;
}

interface f6Counter
{
    public function bump(int $step): self;
}

abstract class f6Saver
{
    abstract protected function store(string $k): void;
}

final class f6Service extends f6Saver implements f6Counter
{
    public function __construct(
        private readonly int $retries = 0,
        public (Countable&Stringable)|null $handler = null,
    ) {
    }

    public function bump(int $step): self
    {
        $this->handler?->count();
        return $this;
    }

    protected function store(string $k): void
    {
        unset($k);
    }
}
