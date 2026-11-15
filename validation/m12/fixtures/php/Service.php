<?php
namespace App\Service;

use App\Base\BaseService;
use App\Contracts\Auditable as Audited;
require_once 'helpers.php';

interface Auditable {
    public function audit(string $event): void;
}

trait Loggable {
    protected function log(string $message): void {
        $this->write($message);
    }
}

enum Status: string {
    case Active = 'active';
    case Paused = 'paused';
}

class UserService extends BaseService implements Auditable {
    use Loggable;

    public const API_PREFIX = '/v1';
    protected string $store;
    public static int $count = 0;

    public function __construct(string $store, private Logger $logger, ?int $limit = 10, string ...$tags) {}

    public function save(User $record): ?User {
        $local = $record->name;
        $obj = new User($record->id);
        $obj->persist();
        self::flush();
        echo $local;
        return $obj;
    }

    final protected function validate(int $value): bool {
        return $value > 0;
    }
}
