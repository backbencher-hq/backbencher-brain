package com.acme.enumbody;

public enum EnumConstantBodies {
  ALPHA {
    @Override
    public int apply(int x) {
      return helper(x) + 1;
    }
  },
  BETA;

  int helper(int x) {
    return x * 2;
  }

  public int apply(int x) {
    return x;
  }
}
