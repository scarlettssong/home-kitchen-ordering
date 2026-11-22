package dev.homekitchen;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import javax.imageio.ImageIO;
import javax.imageio.stream.MemoryCacheImageInputStream;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.net.URI;
import java.util.Locale;
import java.util.Objects;
import java.util.Optional;

@Service
class MenuAdminService {
    private static final int MAX_IMAGE_BYTES = 1024 * 1024;
    private static final BigDecimal MAX_PRICE = new BigDecimal("99999999.99");

    private final MenuRepository menu;
    private final JdbcTemplate jdbc;
    private final KitchenSite site;

    MenuAdminService(MenuRepository menu, JdbcTemplate jdbc, KitchenSite site) {
        this.menu = menu;
        this.jdbc = jdbc;
        this.site = site;
    }

    @Transactional(readOnly = true)
    MenuAdminController.EditableDish editableDish(long id) {
        var dish = menu.findById(id).orElseThrow(this::dishNotFound);
        return new MenuAdminController.EditableDish(dish.id, dish.name, dish.category, dish.subcategory,
                dish.description, dish.icon, dish.automaticPrice ? null : dish.price, dish.price,
                dish.available, dish.imagePath, dish.recipe);
    }

    @Transactional
    long save(Long id, MenuAdminController.DishEdit edit, MultipartFile file) {
        var dish = id == null ? new MenuItem() : menu.findById(id).orElseThrow(this::dishNotFound);
        if (edit.subcategory() != null && !"Chinese".equals(edit.category())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    site.text("只有中餐可以选择分组。", "Only Chinese dishes can have a subcategory."));
        }
        var price = effectivePrice(edit);
        var image = file == null ? null : readImage(file);
        dish.name = edit.name().strip();
        dish.category = edit.category();
        dish.subcategory = edit.subcategory();
        dish.price = price;
        dish.automaticPrice = edit.price() == null;
        dish.description = edit.description() == null ? "" : edit.description().strip();
        dish.icon = "";
        dish.available = edit.available();
        dish.recipe = new MenuItem.Recipe(edit.ingredients().stream()
                .map(item -> new MenuItem.Ingredient(item.name().strip(),
                        item.amount() == null ? "" : item.amount().strip(), item.cost()))
                .toList(), edit.steps().stream().map(String::strip).toList(),
                edit.tips() == null ? "" : edit.tips().strip());
        menu.saveAndFlush(dish);

        if (image != null) {
            dish.imagePath = "/api/dishes/" + dish.id + "/image";
            jdbc.update("update menu_item set image_data = ?, image_media_type = ? where id = ?",
                    image.bytes, image.mediaType, dish.id);
        } else if (edit.removeImage()) {
            dish.imagePath = null;
            jdbc.update("update menu_item set image_data = null, image_media_type = null where id = ?", dish.id);
        }
        return dish.id;
    }

    private BigDecimal effectivePrice(MenuAdminController.DishEdit edit) {
        if (edit.price() != null) return edit.price();
        var total = edit.ingredients().stream()
                .map(MenuAdminController.IngredientEdit::cost)
                .filter(Objects::nonNull)
                .reduce(BigDecimal::add)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        site.text("请输入菜品价格或至少一项食材成本。", "Enter a dish price or at least one ingredient cost.")));
        if (total.compareTo(MAX_PRICE) > 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    site.text("食材成本合计不能超过 99999999.99。", "The total ingredient cost cannot exceed 99999999.99."));
        }
        return total;
    }

    @Transactional
    void delete(long id) {
        menu.delete(menu.findById(id).orElseThrow(this::dishNotFound));
    }

    ResponseEntity<byte[]> dishImage(long id) {
        return jdbc.query("select image_data, image_media_type from menu_item where id = ? and image_data is not null",
                rows -> rows.next() ? Optional.of(imageResponse(rows.getBytes(1), rows.getString(2))) : Optional.<ResponseEntity<byte[]>>empty(),
                id).orElseThrow(this::dishNotFound);
    }

    ResponseEntity<byte[]> avatar() {
        return jdbc.query("select image_data, media_type from kitchen_avatar where id = 1", rows ->
                rows.next() ? imageResponse(rows.getBytes(1), rows.getString(2))
                        : ResponseEntity.status(HttpStatus.FOUND)
                                .location(URI.create("/images/kitchen-avatar.jpg"))
                                .cacheControl(CacheControl.noStore()).build());
    }

    void saveAvatar(MultipartFile file) {
        var image = readImage(file);
        jdbc.update("""
                insert into kitchen_avatar (id, image_data, media_type) values (1, ?, ?)
                on conflict (id) do update set image_data = excluded.image_data, media_type = excluded.media_type
                """, image.bytes, image.mediaType);
    }

    void resetAvatar() {
        jdbc.update("delete from kitchen_avatar where id = 1");
    }

    private static ResponseEntity<byte[]> imageResponse(byte[] bytes, String mediaType) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .contentType(MediaType.parseMediaType(mediaType)).body(bytes);
    }

    private Image readImage(MultipartFile file) {
        if (file.getSize() > MAX_IMAGE_BYTES) {
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, site.text("图片不能超过 1 MB。", "Images must be 1 MB or smaller."));
        }
        try {
            byte[] bytes = file.getBytes();
            try (var stream = new MemoryCacheImageInputStream(new ByteArrayInputStream(bytes))) {
                var readers = ImageIO.getImageReaders(stream);
                if (!readers.hasNext()) throw invalidImage();
                var reader = readers.next();
                try {
                    String mediaType = switch (reader.getFormatName().toLowerCase(Locale.ROOT)) {
                        case "jpeg" -> MediaType.IMAGE_JPEG_VALUE;
                        case "png" -> MediaType.IMAGE_PNG_VALUE;
                        default -> throw invalidImage();
                    };
                    reader.setInput(stream, true, true);
                    if (reader.getWidth(0) > 4096 || reader.getHeight(0) > 4096) throw invalidImage();
                    reader.read(0);
                    return new Image(bytes, mediaType);
                } finally {
                    reader.dispose();
                }
            }
        } catch (IOException exception) {
            throw invalidImage();
        }
    }

    private ResponseStatusException invalidImage() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, site.text("请选择可读取的 JPEG 或 PNG 图片，长宽最多 4096 像素。",
                "Choose a valid JPEG or PNG image up to 4096 pixels on either side."));
    }

    private ResponseStatusException dishNotFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, site.text("找不到该菜品。", "Dish not found."));
    }

    private record Image(byte[] bytes, String mediaType) {}
}
