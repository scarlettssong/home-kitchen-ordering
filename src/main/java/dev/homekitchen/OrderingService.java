package dev.homekitchen;

import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@Transactional(readOnly = true)
class OrderingService {
    private final MenuRepository menu;
    private final OrderRepository orders;

    OrderingService(MenuRepository menu, OrderRepository orders) {
        this.menu = menu;
        this.orders = orders;
    }

    List<DishView> menu() {
        return menu.findAll(Sort.by("id")).stream()
                .map(item -> new DishView(item.id, item.name, item.category, item.description,
                        item.icon, item.price, item.available, item.imagePath, item.recipe))
                .toList();
    }

    @Transactional
    OrderView placeOrder(List<OrderingController.LineRequest> items) {
        Map<Long, Integer> quantities = new LinkedHashMap<>();
        for (var item : items) {
            if (quantities.putIfAbsent(item.dishId(), item.quantity()) != null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Each dish can appear only once.");
            }
        }

        var dishes = menu.findAllById(quantities.keySet()).stream()
                .collect(Collectors.toMap(dish -> dish.id, Function.identity()));
        List<KitchenOrder.Line> lines = new ArrayList<>();
        for (var entry : quantities.entrySet()) {
            MenuItem dish = dishes.get(entry.getKey());
            if (dish == null || !dish.available) {
                String name = dish == null ? "Dish #" + entry.getKey() : dish.name;
                throw new ResponseStatusException(HttpStatus.CONFLICT, name + " is unavailable.");
            }
            lines.add(new KitchenOrder.Line(dish, entry.getValue()));
        }
        return OrderView.from(orders.save(new KitchenOrder(lines)));
    }

    List<OrderView> orders() {
        return orders.findAllByOrderByIdDesc().stream().map(OrderView::from).toList();
    }

    OrderView order(long id) {
        return OrderView.from(orders.findById(id).orElseThrow(OrderingService::orderNotFound));
    }

    @Transactional
    OrderView updateStatus(long id, KitchenOrder.Status target) {
        var order = orders.findForStatusUpdate(id).orElseThrow(OrderingService::orderNotFound);
        if (!order.canTransitionTo(target)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "This status change is unavailable. Refresh the kitchen list and try again.");
        }
        order.status = target;
        return OrderView.from(order);
    }

    private static ResponseStatusException orderNotFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Order not found.");
    }

    record DishView(long id, String name, String category, String description, String icon,
                    BigDecimal price, boolean available, String imagePath, MenuItem.Recipe recipe) {}

    record LineView(long dishId, String name, BigDecimal unitPrice, int quantity) {}

    record OrderView(long id, KitchenOrder.Status status, BigDecimal total, Instant createdAt, List<LineView> items) {
        static OrderView from(KitchenOrder order) {
            var items = order.items.stream()
                    .map(line -> new LineView(line.dishId, line.dishName, line.unitPrice, line.quantity))
                    .toList();
            return new OrderView(order.id, order.status, order.total, order.createdAt, items);
        }
    }
}
