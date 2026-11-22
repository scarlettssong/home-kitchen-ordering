package dev.homekitchen;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.security.Principal;
import java.util.List;

@RestController
@RequestMapping("/api")
class OrderingController {
    private final OrderingService service;

    private final AccountService accounts;

    OrderingController(OrderingService service, AccountService accounts) {
        this.service = service;
        this.accounts = accounts;
    }

    @GetMapping("/dishes")
    List<OrderingService.DishView> menu() {
        return service.menu();
    }

    @PostMapping("/orders")
    ResponseEntity<OrderingService.OrderView> placeOrder(Principal principal, @Valid @RequestBody OrderRequest request) {
        var order = service.placeOrder(accounts.account(principal.getName()), request.items());
        return ResponseEntity.created(URI.create("/api/orders/" + order.id())).body(order);
    }

    @GetMapping("/orders")
    List<OrderingService.OrderView> orders(Principal principal) {
        return service.orders(accounts.account(principal.getName()));
    }

    @GetMapping("/orders/{id}")
    OrderingService.OrderView order(Principal principal, @PathVariable long id) {
        return service.order(accounts.account(principal.getName()), id);
    }

    @PatchMapping("/orders/{id}/status")
    OrderingService.OrderView updateStatus(@PathVariable long id, @Valid @RequestBody StatusRequest request) {
        return service.updateStatus(id, request.status());
    }

    @PutMapping("/admin/orders/{id}")
    OrderingService.OrderView editOrder(@PathVariable long id, @Valid @RequestBody OrderRequest request) {
        return service.editOrder(id, request.items());
    }

    @DeleteMapping("/admin/orders/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void deleteOrder(@PathVariable long id) {
        service.deleteOrder(id);
    }

    record OrderRequest(@NotNull @Size(min = 1, max = 30) List<@NotNull @Valid LineRequest> items) {}

    record LineRequest(@NotNull @Positive Long dishId, @NotNull @Min(1) @Max(3) Integer quantity) {}

    record StatusRequest(@NotNull KitchenOrder.Status status) {}
}
