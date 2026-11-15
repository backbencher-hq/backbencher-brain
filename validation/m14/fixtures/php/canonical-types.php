<?php
namespace {
    class Shared {}
    interface Contract {}
}
namespace Fixture\Canonical {
    use Shared as ParentAlias;
    class Builder extends ParentAlias implements \Contract {
        public function make(): static { return new static(); }
        public function relative(): Local { return new namespace\Local(); }
        public function parentType(parent $value): parent { return $value; }
    }
    class Local {}
    class Shared extends \Shared {}
    interface Contract extends \Contract {}
}
