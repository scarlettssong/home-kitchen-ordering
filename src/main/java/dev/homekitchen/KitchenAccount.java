package dev.homekitchen;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

@Entity
class KitchenAccount {
    enum Role { GUEST, ADMIN }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    long id;
    String username;
    String nickname;
    String passwordHash;

    @Enumerated(EnumType.STRING)
    Role role;

    protected KitchenAccount() {}

    KitchenAccount(String username, String nickname, String passwordHash, Role role) {
        this.username = username;
        this.nickname = nickname;
        this.passwordHash = passwordHash;
        this.role = role;
    }
}

interface AccountRepository extends JpaRepository<KitchenAccount, Long> {
    @Query(value = """
            select * from kitchen_account
            where lower(username collate "C") = lower(:username collate "C")
            """, nativeQuery = true)
    Optional<KitchenAccount> findByLoginName(@Param("username") String username);
}
