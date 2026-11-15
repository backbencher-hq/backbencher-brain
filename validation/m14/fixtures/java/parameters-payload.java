package com.acme.core;

import java.util.List;

public class PaymentService {
  public double applyDiscount(double amount, int percent) {
    return amount * (1 - percent / 100.0);
  }

  public String join(String... parts) {
    return String.join(",", parts);
  }

  public List<String> batch(List<String> ids, int limit) {
    return ids.subList(0, limit);
  }
}
