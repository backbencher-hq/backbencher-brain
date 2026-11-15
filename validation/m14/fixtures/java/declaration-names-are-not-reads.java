package com.acme.reads;

public class DeclarationNamesAreNotReads {
  record R(int x) {
    R {
      System.out.println(x);
    }
  }

  @interface Ann {
    java.util.List<String> list();

    String value();
  }
}
