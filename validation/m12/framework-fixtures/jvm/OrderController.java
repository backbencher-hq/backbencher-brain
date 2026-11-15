package app;

import org.springframework.web.bind.annotation.*;
import org.springframework.beans.factory.annotation.Autowired;
import javax.persistence.*;

@RestController
@RequestMapping("/orders")
public class OrderController {

    @Autowired
    private OrderService svc;

    @Entity
    @Table(name = "orders")
    public static class Order {
        @Id
        private Long id;
        @Column(name = "total")
        private Double total;
    }

    @GetMapping("/{id}")
    public Order get(@PathVariable Long id) {
        return svc.find(id);
    }
}
