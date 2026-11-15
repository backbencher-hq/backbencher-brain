package com.acme.mixin

trait Service
trait Logging

object App extends Service with Logging

enum Color extends Service with Logging:
  case Red, Green
