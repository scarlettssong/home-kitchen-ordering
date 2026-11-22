package dev.homekitchen;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.math.BigDecimal;
import java.util.List;

@RestController
@RequestMapping("/api")
class MenuAdminController {
    private final MenuAdminService menu;

    MenuAdminController(MenuAdminService menu) {
        this.menu = menu;
    }

    @GetMapping("/admin/dishes/{id}")
    ResponseEntity<EditableDish> dish(@PathVariable long id) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(menu.editableDish(id));
    }

    @PostMapping(path = "/admin/dishes", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    SavedDish add(@Valid @RequestPart("dish") DishEdit edit,
                  @RequestPart(value = "image", required = false) MultipartFile file) {
        return new SavedDish(menu.save(null, edit, file));
    }

    @PutMapping(path = "/admin/dishes/{id}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    SavedDish edit(@PathVariable long id, @Valid @RequestPart("dish") DishEdit edit,
                   @RequestPart(value = "image", required = false) MultipartFile file) {
        return new SavedDish(menu.save(id, edit, file));
    }

    @DeleteMapping("/admin/dishes/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(@PathVariable long id) {
        menu.delete(id);
    }

    @GetMapping("/dishes/{id}/image")
    ResponseEntity<byte[]> dishImage(@PathVariable long id) {
        return menu.dishImage(id);
    }

    @GetMapping("/kitchen/avatar")
    ResponseEntity<byte[]> avatar() {
        return menu.avatar();
    }

    @PutMapping(path = "/admin/avatar", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void uploadAvatar(@RequestPart("image") MultipartFile file) {
        menu.saveAvatar(file);
    }

    @DeleteMapping("/admin/avatar")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void resetAvatar() {
        menu.resetAvatar();
    }

    record SavedDish(long id) {}

    record EditableDish(long id, String name, String category, String subcategory, String description, String icon,
                        BigDecimal price, BigDecimal effectivePrice, boolean available, String imagePath,
                        MenuItem.Recipe recipe) {}

    record IngredientEdit(
            @NotBlank @Size(max = 120) String name,
            @Size(max = 80) String amount,
            @DecimalMin("0") @DecimalMax("99999999.99") @Digits(integer = 8, fraction = 2) BigDecimal cost) {}

    record DishEdit(
            @NotBlank @Size(max = 120) String name,
            @NotNull @Pattern(regexp = "Chinese|Western|Japanese|Thai|Dessert") String category,
            @Pattern(regexp = "Staple|Vegetables|Beef|Chicken|Pork") String subcategory,
            @DecimalMin("0") @DecimalMax("99999999.99") @Digits(integer = 8, fraction = 2) BigDecimal price,
            @Size(max = 240) String description,
            boolean available,
            @NotNull @Size(max = 100) List<@NotNull @Valid IngredientEdit> ingredients,
            @NotNull @Size(max = 100) List<@NotBlank @Size(max = 2000) String> steps,
            @Size(max = 4000) String tips,
            boolean removeImage) {}
}
