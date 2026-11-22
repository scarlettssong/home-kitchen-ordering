package dev.homekitchen;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.springframework.data.jpa.repository.JpaRepository;

import java.math.BigDecimal;
import java.util.List;

@Entity
class MenuItem {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    long id;
    String name;
    String category;
    String subcategory;
    String description;
    String icon;
    BigDecimal price;
    boolean automaticPrice;
    boolean available;
    String imagePath;

    @JdbcTypeCode(SqlTypes.JSON)
    Recipe recipe;

    record Recipe(List<Ingredient> ingredients, List<String> steps, String tips) {}

    record Ingredient(String name, String amount,
                      @JsonInclude(JsonInclude.Include.NON_NULL) BigDecimal cost) {}

    protected MenuItem() {}
}

interface MenuRepository extends JpaRepository<MenuItem, Long> {}
