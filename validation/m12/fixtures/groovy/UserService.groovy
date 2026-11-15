package com.example.service

import com.example.base.BaseService
import com.example.base.Entity
import com.example.repo.Repository
import java.util.HashMap
import java.util.Map
import java.util.concurrent.CompletableFuture

class UserService extends BaseService<User> implements Repository<User> {
    private final Map<String, User> store = new HashMap<>()

    UserService() {
    }

    @Override
    String format(String value) {
        return prefix + ":" + value.trim()
    }

    @Override
    CompletableFuture<User> save(User value) {
        store.put(value.getId(), value)
        return CompletableFuture.completedFuture(value)
    }

    static class User implements Entity {
        private final String id
        private final String name

        User(String id, String name) {
            this.id = id
            this.name = name
        }

        @Override
        String getId() { return id }

        @Override
        String getName() { return name }
    }
}
