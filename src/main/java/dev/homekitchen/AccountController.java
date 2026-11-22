package dev.homekitchen;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.security.web.csrf.CsrfToken;
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

import java.security.Principal;

@RestController
@RequestMapping("/api")
class AccountController {
    private final AccountService accounts;

    AccountController(AccountService accounts) {
        this.accounts = accounts;
    }

    @GetMapping("/session")
    Session session(Principal principal, CsrfToken csrf) {
        var profile = principal == null ? null : accounts.profile(accounts.account(principal.getName()));
        return new Session(profile, csrf.getHeaderName(), csrf.getToken());
    }

    @GetMapping("/admin/edit-session")
    EditorAccount editSession(Principal principal) {
        var account = accounts.account(principal.getName());
        return new EditorAccount(account.id, account.username);
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    void register(@Valid @RequestBody Registration request) {
        accounts.register(request.username(), request.nickname(), request.password());
    }

    @PatchMapping("/profile")
    AccountService.Profile profile(Principal principal, @Valid @RequestBody Nickname request) {
        return accounts.updateNickname(principal.getName(), request.nickname());
    }

    @PatchMapping("/profile/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void changePassword(Principal principal, @RequestBody PasswordChange request) {
        accounts.changePassword(principal.getName(), request.currentPassword(), request.newPassword(),
                request.confirmPassword());
    }

    @PutMapping("/favorites/{dishId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void favorite(Principal principal, @PathVariable long dishId) {
        accounts.favorite(accounts.account(principal.getName()), dishId, true);
    }

    @DeleteMapping("/favorites/{dishId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void unfavorite(Principal principal, @PathVariable long dishId) {
        accounts.favorite(accounts.account(principal.getName()), dishId, false);
    }

    record Session(AccountService.Profile user, String csrfHeader, String csrfToken) {}
    record EditorAccount(long id, String username) {}
    record Registration(@NotBlank String username, @Size(max = 60) String nickname, String password) {}
    record PasswordChange(String currentPassword, String newPassword, String confirmPassword) {}
    record Nickname(@NotBlank @Size(max = 60) String nickname) {}
}
