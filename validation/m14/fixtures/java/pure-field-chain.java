package com.acme.core;

public class Render {
    private Config config;
    public String label() {
        return config.server.host;
    }
}
