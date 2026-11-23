package dev.homekitchen;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.hamcrest.Matchers.containsString;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "spring.datasource.url=${TEST_DB_URL}",
        "spring.datasource.username=${TEST_DB_USER}",
        "spring.datasource.password=${TEST_DB_PASSWORD}",
        "kitchen.mode=shared-menu",
        "kitchen.registration-invite-code="
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@Transactional
class UnconfiguredInviteIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder passwords;

    @Test
    void registrationPausesWithoutConfigurationAndExistingAccountCanLogIn() throws Exception {
        String password = UUID.randomUUID().toString();
        jdbc.update("""
                insert into kitchen_account(username,nickname,password_hash,role)
                values ('ExistingInviteGuest','Existing guest',?,'GUEST')
                """, passwords.encode(password));

        mvc.perform(get("/")).andExpect(content().string(containsString("data-registration-open=\"false\"")));
        mvc.perform(post("/api/register").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("""
                                {"username":"UnconfiguredInviteGuest","password":"%s","inviteCode":"any-fixture"}
                                """.formatted(password)))
                .andExpect(status().isServiceUnavailable());
        assertEquals(0, jdbc.queryForObject(
                "select count(*) from kitchen_account where username = 'UnconfiguredInviteGuest'", Integer.class));

        mvc.perform(post("/api/login").with(csrf())
                        .param("username", "ExistingInviteGuest").param("password", password))
                .andExpect(status().isNoContent());
    }
}
