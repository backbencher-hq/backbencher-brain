package com.acme.pub

class Publisher {
  String label

  String describe() { return label }
}

trait Greeter {
  String greet(String who) { return "hi " + who }
}

enum Shade { RED, GREEN }

def scriptHelper(String s) { return s }

def otherHelper(int n) { return n }

private class Hidden {
  String secret
}

protected class Shielded {
  String guard
}