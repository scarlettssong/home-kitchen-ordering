package dev.homekitchen;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.List;

@RestController
@RequestMapping("/api")
class OrderingController {
    private final OrderingService service;

    OrderingController(OrderingService service) {
        this.service = service;
    }

    @GetMapping("/dishes")
    List<OrderingService.DishView> menu() {
        return service.menu();
    }

    @PostMapping("/orders")
    ResponseEntity<OrderingService.OrderView> placeOrder(@Valid @RequestBody OrderRequest request) {
        var order = service.placeOrder(request.items());
        return ResponseEntity.created(URI.create("/api/orders/" + order.id())).body(order);
    }

    @GetMapping("/orders")
    List<OrderingService.OrderView> orders() {
        return service.orders();
    }

    @GetMapping("/orders/{id}")
    OrderingService.OrderView order(@PathVariable long id) {
        return service.order(id);
    }

    @PatchMapping("/orders/{id}/status")
    OrderingService.OrderView updateStatus(@PathVariable long id, @Valid @RequestBody StatusRequest request) {
        return service.updateStatus(id, request.status());
    }

    record OrderRequest(@NotNull @Size(min = 1, max = 30) List<@NotNull @Valid LineRequest> items) {}

    record LineRequest(@NotNull @Positive Long dishId, @NotNull @Min(1) @Max(99) Integer quantity) {}

    record StatusRequest(@NotNull KitchenOrder.Status status) {}
}
