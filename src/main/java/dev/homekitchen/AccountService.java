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

    AccountService(AccountRepository accounts, PasswordEncoder passwords, JdbcTemplate jdbc) {
        this.accounts = accounts;
        this.passwords = passwords;
        this.jdbc = jdbc;
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
            throw new ResponseStatusException(HttpStatus.CONFLICT, "该用户名已注册。");
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
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "找不到该菜品。");
        }
    }

    @Bean
    ApplicationRunner provisionKitchenAdmin(
            @Value("${KITCHEN_ADMIN_USERNAME:}") String username,
            @Value("${KITCHEN_ADMIN_PASSWORD:}") String password) {
        return args -> {
            if (username.isBlank() && password.isEmpty()) return;
            String name = normalize(username);
            if (!name.matches("[a-z0-9][a-z0-9_.-]{2,39}")) {
                throw new IllegalArgumentException("KITCHEN_ADMIN_USERNAME must be a valid username");
            }
            jdbc.update("""
                    insert into kitchen_account (username, nickname, password_hash, role)
                    values (?, '小厨房店长', ?, 'ADMIN')
                    on conflict (username) do nothing
                    """, name, passwordHash(password));
            if (account(name).role != KitchenAccount.Role.ADMIN) {
                throw new IllegalStateException("KITCHEN_ADMIN_USERNAME already belongs to a guest");
            }
        };
    }

    private String passwordHash(String password) {
        int length = password.getBytes(StandardCharsets.UTF_8).length;
        if (length < 8 || length > 72) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "密码需为 8 到 72 个 UTF-8 字节。");
        }
        return passwords.encode(password);
    }

    private static String normalize(String username) {
        return username.strip().toLowerCase(Locale.ROOT);
    }

    record Profile(String username, String nickname, KitchenAccount.Role role, List<Long> favorites) {}
}
