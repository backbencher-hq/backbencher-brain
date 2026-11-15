package com.acme.core;

class Base {
    public void speak() {}
    public void speakLoud(int volume) {}
}

class Sub extends Base {
    @Override
    public void speak() {}

    // Overload: different signature - must NOT produce an overrides edge
    public void speakLoud(String message) {}
}
