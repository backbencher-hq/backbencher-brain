package com.acme.bounds;

import java.io.Serializable;

public class TypeParameterBounds<T extends Number & Comparable<T>, U extends Serializable> {
  <V extends Exception> void bounded(V value) {
  }

  record Pair<A extends CharSequence, B extends Number>(A left, B right) {
  }

  interface Listener<E extends java.io.IOException> {
    void on(E error);
  }
}
