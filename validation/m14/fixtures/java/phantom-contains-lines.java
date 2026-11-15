package p;

import lombok.Data;
import org.springframework.data.jpa.repository.JpaRepository;

@Data
class Account {
    private String owner;
    private long balance;
}

interface AccountRepository extends JpaRepository<Account, Long> {
    Account findByOwner(String owner);
}
