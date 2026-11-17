package audit;

@interface Entity {}
@interface Table { String name(); }
@interface Column { String name(); }
@interface Value { String value(); }
@interface Service {}

@Entity
@Table(name = "not_real")
@Service
class LocalAnnotationCollision {
    @Column(name = "not_column")
    private String id;

    @Value("${not.real}")
    private String configuration;

    @Column(name = "not_getter")
    String getId() { return id; }
}
