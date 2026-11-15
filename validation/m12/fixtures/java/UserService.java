package com.example.service;

import com.example.base.BaseService;
import com.example.base.Repository;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

@org.springframework.stereotype.Service
public class UserService extends BaseService<UserService.User> implements Repository<UserService.User> {
    private final Map<String, User> store = new HashMap<>();

    public UserService() {
    }

    @Override
    public String format(String value) {
        return prefix + ":" + value.trim();
    }

    @Override
    public CompletableFuture<User> save(User value) {
        store.put(value.getId(), value);
        return CompletableFuture.completedFuture(value);
    }

    public static class User implements BaseService.Entity {
        private final String id;
        private final String name;

        public User(String id, String name) {
            this.id = id;
            this.name = name;
        }

        @Override
        public String getId() { return id; }

        @Override
        public String getName() { return name; }
    }
}
