package com.example.base;

import java.util.List;
import java.util.Optional;

public abstract class BaseService<T extends BaseService.Entity> implements Repository<T> {
    protected final String prefix = "base";

    public abstract String format(String value);

    public List<T> findAll() {
        return findByFilter(null);
    }

    private List<T> findByFilter(String filter) {
        return List.of();
    }

    public interface Entity {
        String getId();
        String getName();
    }
}
