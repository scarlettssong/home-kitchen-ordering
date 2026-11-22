package dev.homekitchen;

import com.fasterxml.jackson.annotation.JsonInclude;

import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@Transactional(readOnly = true)
class OrderingService {
    private final MenuRepository menu;
    private final OrderRepository orders;

    private final AccountRepository accounts;
    private final KitchenSite site;

    OrderingService(MenuRepository menu, OrderRepository orders, AccountRepository accounts, KitchenSite site) {
        this.menu = menu;
        this.orders = orders;
        this.accounts = accounts;
        this.site = site;
    }

    List<DishView> menu() {
        return menu.findAll(Sort.by("id")).stream()
                .map(item -> new DishView(item.id, item.name, item.category, item.subcategory, item.description,
                        item.icon, item.price, item.available, item.imagePath, publicRecipe(item.recipe)))
                .toList();
    }

    private static RecipeView publicRecipe(MenuItem.Recipe recipe) {
        if (recipe == null) return null;
        var ingredients = recipe.ingredients() == null ? null : recipe.ingredients().stream()
                .map(item -> item == null ? null : new IngredientView(item.name(), item.amount()))
                .toList();
        return new RecipeView(ingredients, recipe.steps(), recipe.tips());
    }

    @Transactional
    OrderView placeOrder(KitchenAccount account, List<OrderingController.LineRequest> items) {
        var lines = orderLines(items, Map.of());
        var order = orders.save(new KitchenOrder(account.id, lines));
        return orderView(order, displayNumber(order), null);
    }

    private List<KitchenOrder.Line> orderLines(List<OrderingController.LineRequest> items,
                                              Map<Long, KitchenOrder.Line> snapshots) {
        Map<Long, Integer> quantities = new LinkedHashMap<>();
        for (var item : items) {
            if (quantities.putIfAbsent(item.dishId(), item.quantity()) != null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        site.text("同一道菜只能出现一次。", "Each dish can appear only once."));
            }
        }

        var addedIds = quantities.keySet().stream().filter(id -> !snapshots.containsKey(id)).toList();
        var dishes = menu.findAllById(addedIds).stream()
                .collect(Collectors.toMap(dish -> dish.id, Function.identity()));
        List<KitchenOrder.Line> lines = new ArrayList<>();
        for (var entry : quantities.entrySet()) {
            var snapshot = snapshots.get(entry.getKey());
            if (snapshot != null) {
                lines.add(new KitchenOrder.Line(snapshot, entry.getValue()));
                continue;
            }
            MenuItem dish = dishes.get(entry.getKey());
            if (dish == null || !dish.available) {
                String name = dish == null ? site.text("菜品 #", "Dish #") + entry.getKey() : dish.name;
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        site.text(name + "当前不可售。", name + " is unavailable."));
            }
            lines.add(new KitchenOrder.Line(dish, entry.getValue()));
        }
        return lines;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    List<OrderView> orders(KitchenAccount account) {
        Map<Long, Long> displayNumbers = new HashMap<>();
        if (site.sharedMenu()) {
            long number = 1;
            for (long id : orders.findIdsInCreationOrder()) displayNumbers.put(id, number++);
        }
        if (account.role != KitchenAccount.Role.ADMIN) {
            return orders.findAllByAccountIdOrderByIdDesc(account.id).stream()
                    .map(order -> orderView(order, displayNumbers.get(order.id), null)).toList();
        }
        var visible = orders.findAllByOrderByIdDesc();
        if (!site.sharedMenu()) return visible.stream().map(order -> orderView(order, null, null)).toList();
        var ownerIds = visible.stream().map(order -> order.accountId).filter(Objects::nonNull).distinct().toList();
        var names = accounts.findAllById(ownerIds).stream().collect(Collectors.toMap(owner -> owner.id,
                owner -> owner.nickname == null || owner.nickname.isBlank() ? owner.username : owner.nickname));
        String unknown = site.text("未知用户", "Unknown user");
        return visible.stream().map(order -> orderView(order, displayNumbers.get(order.id),
                order.accountId == null ? unknown : names.getOrDefault(order.accountId, unknown))).toList();
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    OrderView order(KitchenAccount account, long id) {
        var visible = account.role == KitchenAccount.Role.ADMIN
                ? orders.findById(id)
                : orders.findByIdAndAccountId(id, account.id);
        var order = visible.orElseThrow(this::orderNotFound);
        return orderView(order, displayNumber(order), null);
    }

    @Transactional
    OrderView updateStatus(long id, KitchenOrder.Status target) {
        if (site.sharedMenu()) throw orderNotFound();
        var order = orders.findForUpdate(id).orElseThrow(this::orderNotFound);
        if (!order.canTransitionTo(target)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "This status change is unavailable. Refresh the kitchen list and try again.");
        }
        order.status = target;
        return orderView(order, null, null);
    }

    @Transactional
    OrderView editOrder(long id, List<OrderingController.LineRequest> items) {
        if (!site.sharedMenu()) throw orderNotFound();
        var order = orders.findForUpdate(id).orElseThrow(this::orderNotFound);
        var snapshots = order.items.stream().collect(Collectors.toMap(line -> line.dishId, Function.identity()));
        var replacement = orderLines(items, snapshots);

        // Clear the ordered collection first so reordering cannot conflict with its unique dish IDs.
        order.items.clear();
        orders.flush();
        order.addItems(replacement);
        orders.flush();
        return orderView(order, displayNumber(order), null);
    }

    @Transactional
    void deleteOrder(long id) {
        if (!site.sharedMenu()) throw orderNotFound();
        orders.delete(orders.findForUpdate(id).orElseThrow(this::orderNotFound));
        orders.flush();
    }

    private ResponseStatusException orderNotFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, site.text("找不到该订单。", "Order not found."));
    }

    private Long displayNumber(KitchenOrder order) {
        return site.sharedMenu() ? orders.countByIdLessThanEqual(order.id) : null;
    }

    private OrderView orderView(KitchenOrder order, Long displayNumber, String orderer) {
        var items = order.items.stream()
                .map(line -> new LineView(line.dishId, line.dishName, line.unitPrice, line.quantity))
                .toList();
        return new OrderView(order.id, displayNumber, site.sharedMenu() ? null : order.status,
                order.total, order.createdAt, items, orderer);
    }

    record DishView(long id, String name, String category, String subcategory, String description, String icon,
                    BigDecimal price, boolean available, String imagePath, RecipeView recipe) {}

    record RecipeView(List<IngredientView> ingredients, List<String> steps, String tips) {}

    record IngredientView(String name, String amount) {}

    record LineView(long dishId, String name, BigDecimal unitPrice, int quantity) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record OrderView(long id, Long displayNumber, KitchenOrder.Status status, BigDecimal total, Instant createdAt,
                     List<LineView> items, String orderer) {}
}
