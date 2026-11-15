package com.acme.cfg;

import org.springframework.beans.factory.annotation.Value;

public class PriceConfig {

    private final String appName;

    public PriceConfig(@Value("${app.name:default}") String appName) {
        this.appName = appName;
    }
}
