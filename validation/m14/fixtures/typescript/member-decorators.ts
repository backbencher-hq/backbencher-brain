import { Column } from "typeorm";

@Injectable()
export class MyService {

    @Column("id")
    id: string;

    @Get("/users")
    list(): string {
        return this.id;
    }
}
