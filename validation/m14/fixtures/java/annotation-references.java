package com.acme.ann;

import java.util.List;

public class AnnotationReferences {
  @interface Audited {
  }

  @Audited
  public static class Service {
    @Deprecated
    int count;

    @Deprecated
    int first, second;

    List<@Deprecated String> names;

    @Override
    public String toString() { return "s"; }

    public void take(@Deprecated int p, int q) {
      @Deprecated int local = p;
      System.out.println(local + q);
    }

    @SuppressWarnings("unchecked")
    public void args() {
    }

    @java.lang.Deprecated
    public void fq() {
    }

    @Audited
    @Deprecated
    public void repeated() {
    }
  }

  enum Mode {
    @Deprecated ONE, TWO
  }

  record Pair(@Deprecated int left, int right) {
  }
}
