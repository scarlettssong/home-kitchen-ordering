package dev.homekitchen;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Embeddable;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.LockModeType;
import jakarta.persistence.OrderColumn;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Entity
class KitchenOrder {
    enum Status {
        PLACED,
        PREPARING,
        COMPLETED
    }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    long id;

    @Enumerated(EnumType.STRING)
    Status status;

    Long accountId;
    BigDecimal total;
    Instant createdAt;

    @ElementCollection
    @CollectionTable(name = "order_item", joinColumns = @JoinColumn(name = "order_id"))
    @OrderColumn(name = "position")
    List<Line> items = new ArrayList<>();

    protected KitchenOrder() {}

    KitchenOrder(long accountId, List<Line> items) {
        this.accountId = accountId;
        this.status = Status.PLACED;
        this.createdAt = Instant.now();
        addItems(items);
    }

    void addItems(List<Line> items) {
        this.items.addAll(items);
        this.total = this.items.stream()
                .map(line -> line.unitPrice.multiply(BigDecimal.valueOf(line.quantity)))
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    boolean canTransitionTo(Status target) {
        return switch (status) {
            case PLACED -> target == Status.PREPARING;
            case PREPARING -> target == Status.COMPLETED;
            case COMPLETED -> false;
        };
    }

    @Embeddable
    static class Line {
        long dishId;
        String dishName;
        BigDecimal unitPrice;
        int quantity;

        protected Line() {}

        Line(MenuItem dish, int quantity) {
            this(dish.id, dish.name, dish.price, quantity);
        }

        Line(Line snapshot, int quantity) {
            this(snapshot.dishId, snapshot.dishName, snapshot.unitPrice, quantity);
        }

        private Line(long dishId, String dishName, BigDecimal unitPrice, int quantity) {
            this.dishId = dishId;
            this.dishName = dishName;
            this.unitPrice = unitPrice;
            this.quantity = quantity;
        }
    }
}

interface OrderRepository extends JpaRepository<KitchenOrder, Long> {
    @EntityGraph(attributePaths = "items")
    List<KitchenOrder> findAllByOrderByIdDesc();

    @EntityGraph(attributePaths = "items")
    List<KitchenOrder> findAllByAccountIdOrderByIdDesc(long accountId);

    Optional<KitchenOrder> findByIdAndAccountId(long id, long accountId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select o from KitchenOrder o where o.id = :id")
    Optional<KitchenOrder> findForUpdate(long id);
}
