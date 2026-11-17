package proof;

class EqualityExample {
    @Override public boolean equals(Object value) { return value == this; }
    public boolean equals(String value) { return false; }
}
