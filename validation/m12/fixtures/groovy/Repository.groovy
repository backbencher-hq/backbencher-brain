package com.example.repo

import java.util.List
import java.util.Optional

interface Repository<T> {
    T save(T item)
    Optional<T> find(String id)
}
