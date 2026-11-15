package com.acme.core;

public class Client {
    private Service service;
    public String run() {
        return service.execute("x");
    }
}
