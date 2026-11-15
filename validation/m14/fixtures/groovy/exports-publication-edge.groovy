package com.acme.exp

trait Audited {
  boolean isAudited() { return true }
}

enum Level {
  LOW,
  HIGH
}

class Service {
  static class Helper {}

  def help() { return new Helper() }
}

def topLevelHelper() { return 1 }
