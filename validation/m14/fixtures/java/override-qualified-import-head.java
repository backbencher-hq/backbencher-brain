import java.util.Map;

class Decoy {
    static class Map {
        interface Entry<K, V> {
            void marker();
        }
    }

    static class LocalChild implements Map.Entry<String, String> {
        public void marker() {}
    }
}

class ExternalChild implements Map.Entry<String, String> {
    public String getKey() { return "key"; }
    public String getValue() { return "value"; }
    public String setValue(String value) { return value; }
    public void marker() {}
}
