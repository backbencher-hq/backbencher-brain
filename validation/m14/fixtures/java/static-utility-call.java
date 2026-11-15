package com.acme.core;

public class OrderService {
    public boolean validate(String input) {
        ValidationUtils.checkNotNull(input);
        return DateUtils.now() != null;
    }
}
