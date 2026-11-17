package audit;

class ImplicitObjectMethods implements Runnable {
    @Override public String toString() { return "ok"; }
    @Override public int hashCode() { return 41; }
    public void toString(int value) {}
    @Override public void run() {}
}
