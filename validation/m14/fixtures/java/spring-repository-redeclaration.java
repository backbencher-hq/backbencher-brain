package audit;

import org.springframework.data.repository.CrudRepository;

class Ledger {}
interface LedgerRepository extends CrudRepository<Ledger, Long> {
    // Real redeclaration, not an additional compiler-generated method.
    long count();
}
