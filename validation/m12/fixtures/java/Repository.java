package com.example.base;

import java.util.List;
import java.util.concurrent.CompletableFuture;

public interface Repository<T extends BaseService.Entity> {
    CompletableFuture<T> save(T value);
    List<T> findAll();
}
