package dev.homekitchen;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "spring.datasource.url=${TEST_DB_URL}",
        "spring.datasource.username=${TEST_DB_USER}",
        "spring.datasource.password=${TEST_DB_PASSWORD}"
})
@AutoConfigureMockMvc
@Transactional
class AccountIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder passwords;

    private static final String DISH = """
            {"name":"Fixture Recipe","category":"Chinese","price":9.50,"available":true,
             "ingredients":[{"name":"Rice","amount":"1 cup"}],"steps":["Cook the rice."],"tips":"Serve warm."}
            """;
    private static final String ORDER = "{\"items\":[{\"dishId\":%d,\"quantity\":2}]}";

    @BeforeEach
    void fixtureAccounts() {
        String hash = passwords.encode(UUID.randomUUID().toString());
        jdbc.update("""
                insert into kitchen_account (username, nickname, password_hash, role)
                values ('account_one', 'Guest One', ?, 'GUEST'),
                       ('account_two', 'Guest Two', ?, 'GUEST'),
                       ('account_admin', 'Store Manager', ?, 'ADMIN')
                """, hash, hash, hash);
    }

    @Test
    void registrationCannotGrantAdminAndLoginAndLogoutUseSessionCsrf() throws Exception {
        var result = mvc.perform(get("/api/session"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.user").isEmpty()).andReturn();
        var session = (MockHttpSession) result.getRequest().getSession(false);
        var initial = json.readTree(result.getResponse().getContentAsString());
        String header = initial.get("csrfHeader").asText();
        String token = initial.get("csrfToken").asText();
        String password = UUID.randomUUID().toString();

        mvc.perform(post("/api/register").session(session).header(header, token).contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("username", "visitor_fixture",
                                "nickname", "New Guest", "password", password, "role", "ADMIN"))))
                .andExpect(status().isCreated());

        String hash = jdbc.queryForObject("select password_hash from kitchen_account where username = ?",
                String.class, "visitor_fixture");
        assertThat(hash).isNotEqualTo(password);
        assertThat(passwords.matches(password, hash)).isTrue();

        mvc.perform(post("/api/login").session(session).param("username", "visitor_fixture").param("password", password))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/login").session(session).header(header, token)
                        .param("username", "visitor_fixture").param("password", password))
                .andExpect(status().isNoContent());

        var loggedIn = mvc.perform(get("/api/session").session(session))
                .andExpect(jsonPath("$.user.role").value("GUEST"))
                .andExpect(jsonPath("$.user.nickname").value("New Guest"))
                .andReturn();
        String loggedInToken = json.readTree(loggedIn.getResponse().getContentAsString()).get("csrfToken").asText();
        mvc.perform(post("/api/logout").session(session).header(header, loggedInToken)).andExpect(status().isNoContent());
        mvc.perform(get("/api/orders")).andExpect(status().isUnauthorized());
    }

    @Test
    void onlyTheOwnerOrAdminCanReadAnOrderAndOnlyAdminCanUpdateIt() throws Exception {
        long id = order(1);
        mvc.perform(get("/api/orders/{id}", id).with(guestOne())).andExpect(status().isOk());
        mvc.perform(get("/api/orders/{id}", id).with(guestTwo())).andExpect(status().isNotFound());
        mvc.perform(get("/api/orders").with(guestTwo())).andExpect(content().json("[]"));
        mvc.perform(get("/api/orders").with(admin())).andExpect(jsonPath("$[?(@.id == " + id + ")].id").isNotEmpty());

        mvc.perform(patch("/api/orders/{id}/status", id).with(guestOne()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"PREPARING\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(patch("/api/orders/{id}/status", id).with(admin()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"PREPARING\"}"))
                .andExpect(jsonPath("$.status").value("PREPARING"));
    }

    @Test
    void menuManagementRequiresAdminAndDeletionKeepsReceipt() throws Exception {
        var request = dishData(DISH);
        mvc.perform(multipart("/api/admin/dishes").file(request).with(guestOne()).with(csrf()))
                .andExpect(status().isForbidden());
        var created = mvc.perform(multipart("/api/admin/dishes").file(request).file(photo("image")).with(admin()).with(csrf()))
                .andExpect(status().isCreated()).andReturn();
        long dishId = json.readTree(created.getResponse().getContentAsString()).get("id").asLong();
        mvc.perform(get("/api/dishes/{id}/image", dishId)).andExpect(content().contentType("image/jpeg"));
        long orderId = order(dishId);

        mvc.perform(multipart(HttpMethod.PUT, "/api/admin/dishes/{id}", dishId)
                        .file(dishData(DISH.replace("Fixture Recipe", "Renamed").replace("9.50", "20.00")
                                .replace("\"available\":true", "\"available\":true,\"removeImage\":true")))
                        .with(admin()).with(csrf())).andExpect(status().isOk());
        mvc.perform(get("/api/dishes/{id}/image", dishId)).andExpect(status().isNotFound());

        mvc.perform(delete("/api/admin/dishes/{id}", dishId).with(guestOne()).with(csrf()))
                .andExpect(status().isForbidden());
        mvc.perform(delete("/api/admin/dishes/{id}", dishId).with(admin()).with(csrf())).andExpect(status().isNoContent());
        mvc.perform(get("/api/orders/{id}", orderId).with(guestOne()))
                .andExpect(jsonPath("$.items[0].name").value("Fixture Recipe"))
                .andExpect(jsonPath("$.items[0].unitPrice").value(9.50))
                .andExpect(jsonPath("$.total").value(19.00));
    }

    @Test
    void imageUploadRejectsOversizedAndFakeFilesAndAvatarRequiresAdmin() throws Exception {
        mvc.perform(multipart("/api/admin/dishes").file(dishData(DISH))
                        .file(new MockMultipartFile("image", "too-big.jpg", "image/jpeg", new byte[1024 * 1024 + 1]))
                        .with(admin()).with(csrf())).andExpect(status().isPayloadTooLarge());
        mvc.perform(multipart("/api/admin/dishes").file(dishData(DISH))
                        .file(new MockMultipartFile("image", "fake.png", "image/png", "fake".getBytes()))
                        .with(admin()).with(csrf())).andExpect(status().isBadRequest());
        mvc.perform(multipart(HttpMethod.PUT, "/api/admin/avatar").file(photo("image")).with(guestOne()).with(csrf()))
                .andExpect(status().isForbidden());
        mvc.perform(multipart(HttpMethod.PUT, "/api/admin/avatar").file(photo("image")).with(admin()).with(csrf()))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/kitchen/avatar")).andExpect(content().contentType("image/jpeg"));
        mvc.perform(delete("/api/admin/avatar").with(admin()).with(csrf())).andExpect(status().isNoContent());
        mvc.perform(get("/api/kitchen/avatar")).andExpect(status().isFound());
    }

    @Test
    void guestsCanEditNicknameAndKeepPrivateFavorites() throws Exception {
        mvc.perform(patch("/api/profile").with(guestOne()).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nickname\":\"Local Guest\"}"))
                .andExpect(jsonPath("$.nickname").value("Local Guest"));
        mvc.perform(put("/api/favorites/1").with(guestOne()).with(csrf())).andExpect(status().isNoContent());
        mvc.perform(get("/api/session").with(guestOne())).andExpect(jsonPath("$.user.favorites[0]").value(1));
        mvc.perform(get("/api/session").with(guestTwo())).andExpect(jsonPath("$.user.favorites").isEmpty());
        mvc.perform(delete("/api/favorites/1").with(guestOne()).with(csrf())).andExpect(status().isNoContent());
        mvc.perform(get("/api/session").with(guestOne())).andExpect(jsonPath("$.user.favorites").isEmpty());
    }

    private long order(long dishId) throws Exception {
        var result = mvc.perform(post("/api/orders").with(guestOne()).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(ORDER.formatted(dishId))).andExpect(status().isCreated()).andReturn();
        return json.readTree(result.getResponse().getContentAsString()).get("id").asLong();
    }

    private static MockMultipartFile dishData(String json) {
        return new MockMultipartFile("dish", "dish.json", "application/json", json.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    private static MockMultipartFile photo(String name) throws Exception {
        return new MockMultipartFile(name, "demo.jpg", "image/jpeg",
                new ClassPathResource("static/images/kitchen-avatar.jpg").getContentAsByteArray());
    }

    private static RequestPostProcessor guestOne() { return user("account_one").roles("GUEST"); }
    private static RequestPostProcessor guestTwo() { return user("account_two").roles("GUEST"); }
    private static RequestPostProcessor admin() { return user("account_admin").roles("ADMIN"); }
}
