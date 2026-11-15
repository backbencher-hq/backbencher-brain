package com.example.base

import java.util.List
import java.util.Optional

trait Audited {
    Date createdAt
    Date updatedAt
}

interface Entity {
    String getId()
    String getName()
}

abstract class BaseService<T extends Entity> implements Repository<T> {
    protected final String prefix = "base"

    abstract String format(String value)

    List<T> findAll() {
        return findByFilter(null)
    }

    private List<T> findByFilter(String filter) {
        return List.of()
    }
}
