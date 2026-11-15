package com.acme.core;

public class Outer {
    private Inner inner;
    public class Inner {
        public void ping() {}
    }
    public enum Mode { ON, OFF }
}
