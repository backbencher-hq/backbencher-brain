package proof;

import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.Column;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Value;

@Entity
@Table(name = "verified_rows")
class VerifiedRow {
    @Column(name = "db_id")
    private long id;

    @Value("${real.key}")
    private String configuration;

    @Column(name = "accessor_db")
    long getId() { return id; }
}

@Service
class VerifiedService {}
