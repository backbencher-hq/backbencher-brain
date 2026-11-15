package com.acme.data;

@javax.persistence.Entity
@javax.persistence.Table(name = "customer_records")
public class Customer {

    @javax.persistence.Id
    private Long id;

    private String name;
}
