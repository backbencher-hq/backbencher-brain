package com.acme.pub;

public class Published {
  public int open() { return 1; }
}

interface PackagePrivate {
  int hidden();
}

public record PublishedRecord(int id, String name) { }

record PackagePrivateRecord(int id) { }

public enum PublishedEnum { ONE, TWO }

enum PackagePrivateEnum { ONE }

public @interface PublishedAnnotation { }

@interface PackagePrivateAnnotation { }

class Outer {
  public static class NestedPublic {}
  static class NestedHidden {}
}