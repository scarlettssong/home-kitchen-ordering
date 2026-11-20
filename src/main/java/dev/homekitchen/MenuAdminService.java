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
import java.net.URI;
import java.util.Locale;
import java.util.Optional;

@Service
class MenuAdminService {
    private static final int MAX_IMAGE_BYTES = 1024 * 1024;

    private final MenuRepository menu;
    private final JdbcTemplate jdbc;

    MenuAdminService(MenuRepository menu, JdbcTemplate jdbc) {
        this.menu = menu;
        this.jdbc = jdbc;
    }

    @Transactional
    long save(Long id, MenuAdminController.DishEdit edit, MultipartFile file) {
        var image = file == null ? null : readImage(file);
        var dish = id == null ? new MenuItem() : menu.findById(id).orElseThrow(MenuAdminService::dishNotFound);
        dish.name = edit.name().strip();
        dish.category = edit.category();
        dish.price = edit.price();
        dish.description = edit.description() == null ? "" : edit.description().strip();
        dish.icon = "";
        dish.available = edit.available();
        dish.recipe = new MenuItem.Recipe(edit.ingredients().stream()
                .map(item -> new MenuItem.Ingredient(item.name().strip(),
                        item.amount() == null ? "" : item.amount().strip()))
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

    @Transactional
    void delete(long id) {
        menu.delete(menu.findById(id).orElseThrow(MenuAdminService::dishNotFound));
    }

    ResponseEntity<byte[]> dishImage(long id) {
        return jdbc.query("select image_data, image_media_type from menu_item where id = ? and image_data is not null",
                rows -> rows.next() ? Optional.of(imageResponse(rows.getBytes(1), rows.getString(2))) : Optional.<ResponseEntity<byte[]>>empty(),
                id).orElseThrow(MenuAdminService::dishNotFound);
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

    private static Image readImage(MultipartFile file) {
        if (file.getSize() > MAX_IMAGE_BYTES) {
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "图片不能超过 1 MB。");
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

    private static ResponseStatusException invalidImage() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "请选择可读取的 JPEG 或 PNG 图片，长宽最多 4096 像素。");
    }

    private static ResponseStatusException dishNotFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "找不到该菜品。");
    }

    private record Image(byte[] bytes, String mediaType) {}
}
