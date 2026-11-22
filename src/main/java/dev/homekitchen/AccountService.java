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

@Service
class AccountService implements UserDetailsService {
    private static final String USERNAME_PATTERN = "[a-zA-Z0-9][a-zA-Z0-9_.-]{2,39}";

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
        var account = accounts.findByLoginName(username.strip())
                .orElseThrow(() -> new UsernameNotFoundException("Account not found"));
        return User.withUsername(account.username).password(account.passwordHash)
                .roles(account.role.name()).build();
    }

    KitchenAccount account(String username) {
        return accounts.findByLoginName(username).orElseThrow();
    }

    void register(String username, String nickname, String password) {
        String name = username.strip();
        if (site.sharedMenu() && (name.equalsIgnoreCase("Scarlett") || name.equalsIgnoreCase("Cris"))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    site.text("该用户名为店长保留，请使用其他用户名。", "That username is reserved. Choose a different username."));
        }
        if (!name.matches(USERNAME_PATTERN)) {
            throw badRequest("用户名需为 3 到 40 个字符，可使用英文字母、数字、点、下划线和连字符，首字符须为字母或数字。",
                    "Use 3 to 40 letters, numbers, dots, underscores, or hyphens. Start with a letter or number.");
        }
        var account = new KitchenAccount(name, nickname == null || nickname.isBlank() ? name : nickname.strip(),
                passwordHash(password), KitchenAccount.Role.GUEST);
        try {
            accounts.saveAndFlush(account);
        } catch (DataIntegrityViolationException conflict) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, site.text("该用户名已注册。", "That username is already registered."));
        }
    }

    @Transactional
    void changePassword(String username, String current, String replacement, String confirmation) {
        var account = account(username);
        if (!validPassword(current) || !passwords.matches(current, account.passwordHash)) {
            throw badRequest("当前密码不正确。", "The current password is incorrect.");
        }
        if (replacement == null || !replacement.equals(confirmation)) {
            throw badRequest("两次输入的新密码不一致。", "The new passwords do not match.");
        }

        if (replacement.equals(current)) {
            throw badRequest("新密码不能与当前密码相同。", "The new password must differ from the current password.");
        }

        int updated = accounts.replacePassword(account.id, account.passwordHash, passwordHash(replacement));
        if (updated == 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    site.text("密码已被更改，请重新确认当前密码。", "The password changed. Check your current password and try again."));
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
        return new Profile(account.id, account.username, account.nickname, account.role, favorites);
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
            if (!site.sharedMenu()) {
                provision(adminName, adminPassword, KitchenAccount.Role.ADMIN,
                        site.text("小厨房店长", "Kitchen Manager"));
            }
            if (site.privateMode()) {
                provision(guestName, guestPassword, KitchenAccount.Role.GUEST, guestName.strip());
            }
        };
    }

    private void provision(String username, String password, KitchenAccount.Role role, String nickname) {
        if (username.isBlank() && password.isEmpty()) return;
        String name = username.strip();
        if (!name.matches(USERNAME_PATTERN)) {
            throw new IllegalArgumentException("Use a valid username for the " + role + " account");
        }
        jdbc.update("""
                insert into kitchen_account (username, nickname, password_hash, role)
                values (?, ?, ?, ?)
                on conflict do nothing
                """, name, nickname, passwordHash(password), role.name());
        if (account(name).role != role) {
            throw new IllegalStateException("The configured username already belongs to a different role");
        }
    }

    private String passwordHash(String password) {
        if (!validPassword(password)) {
            throw badRequest("密码需为 8 到 72 个 UTF-8 字节。", "Use a password between 8 and 72 UTF-8 bytes.");
        }
        return passwords.encode(password);
    }

    private static boolean validPassword(String password) {
        if (password == null || password.isBlank() || password.length() > 72) return false;
        int length = password.getBytes(StandardCharsets.UTF_8).length;
        return length >= 8 && length <= 72;
    }

    private ResponseStatusException badRequest(String chinese, String english) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, site.text(chinese, english));
    }

    record Profile(long id, String username, String nickname, KitchenAccount.Role role, List<Long> favorites) {}
}
