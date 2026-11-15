<?php

namespace App\Orders;

use App\Core\EventDispatcher;
use App\Core\RepositoryInterface;

/**
 * Handles order lifecycle events.
 */
class OrderService implements RepositoryInterface
{
    private const DEFAULT_STATUS = 'pending';

    /** @var EventDispatcher */
    private $dispatcher;

    public static array $instances = [];

    public function __construct(EventDispatcher $dispatcher)
    {
        $this->dispatcher = $dispatcher;
    }

    public function create(array $data): Order
    {
        $order = new Order($data);
        $order->setStatus(self::DEFAULT_STATUS);
        $this->dispatcher->dispatch('order.created', $order);
        return $order;
    }

    public function find(int $id): ?Order
    {
        return Order::find($id);
    }

    public function cancel(Order $order): bool
    {
        $order->setStatus('cancelled');
        return true;
    }
}

final class Order
{
    private int $id;
    private string $status;

    public function __construct(array $data)
    {
        $this->id = $data['id'] ?? 0;
        $this->status = $data['status'] ?? 'pending';
    }

    public function setStatus(string $status): void
    {
        $this->status = $status;
    }

    public static function find(int $id): ?self
    {
        return null;
    }
}

function order_total(array $items): float
{
    $total = 0.0;
    foreach ($items as $item) {
        $total += $item['price'] * $item['qty'];
    }
    return $total;
}
