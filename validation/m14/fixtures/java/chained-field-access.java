package com.acme.core;

public class Report {
    private Config config;
    public String render() {
        return config.output().format().name();
    }
}
