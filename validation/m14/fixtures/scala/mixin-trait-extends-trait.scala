package com.acme.mixin

trait Base
trait Mixed
trait Derived extends Base with Mixed

class Impl extends Derived
