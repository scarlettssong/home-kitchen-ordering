package dev.homekitchen;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;

@Service
class AccountService implements UserDetailsService {
    private final AccountRepository accounts;
    private final PasswordEncoder passwords;
    private final JdbcTemplate jdbc;
    private final KitchenSite site;

    AccountService(AccountRepository accounts, PasswordEncoder passwords, JdbcTemplate jdbc, KitchenSite site) {
        this.accounts = accounts;
        this.passwords = passwords;
        this.jdbc = jdbc;
        this.site = site;
    }

    @Override
    public UserDetails loadUserByUsername(String username) {
        var account = accounts.findByUsername(normalize(username))
                .orElseThrow(() -> new UsernameNotFoundException("Account not found"));
        return User.withUsername(account.username).password(account.passwordHash)
                .roles(account.role.name()).build();
    }

    KitchenAccount account(String username) {
        return accounts.findByUsername(username).orElseThrow();
    }

    void register(String username, String nickname, String password) {
        String name = normalize(username);
        var account = new KitchenAccount(name, nickname == null || nickname.isBlank() ? name : nickname.strip(),
                passwordHash(password), KitchenAccount.Role.GUEST);
        try {
            accounts.saveAndFlush(account);
        } catch (DataIntegrityViolationException conflict) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, site.text("该用户名已注册。", "That username is already registered."));
        }
    }

    @Transactional
    Profile updateNickname(String username, String nickname) {
        var account = account(username);
        account.nickname = nickname.strip();
        return profile(account);
    }

    Profile profile(KitchenAccount account) {
        List<Long> favorites = jdbc.queryForList(
                "select dish_id from favorite_dish where account_id = ? order by dish_id", Long.class, account.id);
        return new Profile(account.username, account.nickname, account.role, favorites);
    }

    void favorite(KitchenAccount account, long dishId, boolean selected) {
        if (!selected) {
            jdbc.update("delete from favorite_dish where account_id = ? and dish_id = ?", account.id, dishId);
            return;
        }
        int changed = jdbc.update("""
                insert into favorite_dish (account_id, dish_id)
                select ?, id from menu_item where id = ?
                on conflict do nothing
                """, account.id, dishId);
        if (changed == 0 && Boolean.FALSE.equals(jdbc.queryForObject(
                "select exists(select 1 from menu_item where id = ?)", Boolean.class, dishId))) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, site.text("找不到该菜品。", "Dish not found."));
        }
    }

    @Bean
    ApplicationRunner provisionKitchenAccounts(
            @Value("${KITCHEN_ADMIN_USERNAME:}") String adminName,
            @Value("${KITCHEN_ADMIN_PASSWORD:}") String adminPassword,
            @Value("${KITCHEN_GUEST_USERNAME:}") String guestName,
            @Value("${KITCHEN_GUEST_PASSWORD:}") String guestPassword) {
        return args -> {
            provision(adminName, adminPassword, KitchenAccount.Role.ADMIN,
                    site.text("小厨房店长", "Kitchen Manager"));
            if (site.privateMode()) {
                provision(guestName, guestPassword, KitchenAccount.Role.GUEST, guestName.strip());
            }
        };
    }

    private void provision(String username, String password, KitchenAccount.Role role, String nickname) {
        if (username.isBlank() && password.isEmpty()) return;
        String name = normalize(username);
        if (!name.matches("[a-z0-9][a-z0-9_.-]{2,39}")) {
            throw new IllegalArgumentException("Use a valid username for the " + role + " account");
        }
        jdbc.update("""
                insert into kitchen_account (username, nickname, password_hash, role)
                values (?, ?, ?, ?)
                on conflict (username) do nothing
                """, name, nickname, passwordHash(password), role.name());
        if (account(name).role != role) {
            throw new IllegalStateException("The configured username already belongs to a different role");
        }
    }

    private String passwordHash(String password) {
        int length = password.getBytes(StandardCharsets.UTF_8).length;
        if (length < 8 || length > 72) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, site.text("密码需为 8 到 72 个 UTF-8 字节。", "Use a password between 8 and 72 UTF-8 bytes."));
        }
        return passwords.encode(password);
    }

    private static String normalize(String username) {
        return username.strip().toLowerCase(Locale.ROOT);
    }

    record Profile(String username, String nickname, KitchenAccount.Role role, List<Long> favorites) {}
}
