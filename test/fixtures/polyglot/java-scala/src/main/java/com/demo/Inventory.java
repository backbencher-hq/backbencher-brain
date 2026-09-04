package com.demo;

/** Java inventory service — the cross-language target. */
public class Inventory {
    private int stock = 42;

    public int getStock() {
        return stock;
    }

    public void restock(int amount) {
        stock += amount;
    }
}
