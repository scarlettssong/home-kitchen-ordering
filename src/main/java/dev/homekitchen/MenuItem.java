package dev.homekitchen;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import org.springframework.data.jpa.repository.JpaRepository;

import java.math.BigDecimal;

@Entity
class MenuItem {
    @Id
    long id;
    String name;
    String category;
    String description;
    String icon;
    BigDecimal price;
    boolean available;

    protected MenuItem() {}
}

interface MenuRepository extends JpaRepository<MenuItem, Long> {}
