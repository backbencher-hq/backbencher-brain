package app;

// These are real local annotation declarations, NOT lombok.* annotations.
@interface Data {}
@interface Getter {}
@interface Setter {}

@Data
class LocalData {
    private int count;
}

@Getter
class LocalGetter {
    private String title;
}

@Setter
class LocalSetter {
    private long id;
}

// A same-named repository ancestor is not a Spring Data repository.
interface JpaRepository<T, I> {}
interface LocalRepository extends JpaRepository<LocalData, Long> {
    LocalData findById(Long key);
}
