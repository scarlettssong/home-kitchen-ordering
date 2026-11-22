package dev.homekitchen;

import java.util.UUID;

import jakarta.persistence.EntityManager;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "spring.datasource.url=${TEST_DB_URL}",
        "spring.datasource.username=${TEST_DB_USER}",
        "spring.datasource.password=${TEST_DB_PASSWORD}",
        "kitchen.mode=shared-menu"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@Transactional
class SharedMenuIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired EntityManager entities;

    @Test
    void anonymousVisitorCanReadRecipesAndPhotosInChineseMode() throws Exception {
        mvc.perform(get("/")).andExpect(status().isOk())
                .andExpect(content().string(containsString("lang=\"zh-CN\" data-private=\"false\"")))
                .andExpect(content().string(containsString("data-registration-open=\"true\"")));
        mvc.perform(get("/api/dishes")).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].recipe.steps[0]").isNotEmpty());
        mvc.perform(get("/images/ginger-rice.jpg")).andExpect(status().isOk());
        byte[] photo;
        try (var file = new ClassPathResource("static/images/ginger-rice.jpg").getInputStream()) {
            photo = file.readAllBytes();
        }
        jdbc.update("update menu_item set image_data = ?, image_media_type = 'image/jpeg' where id = 1", photo);
        mvc.perform(get("/api/dishes/1/image")).andExpect(status().isOk())
                .andExpect(content().bytes(photo));
        mvc.perform(head("/api/dishes/1/image")).andExpect(status().isOk());
        mvc.perform(get("/api/kitchen/avatar")).andExpect(status().isUnauthorized());
    }

    @Test
    void anonymousWritesAndGuestManagerActionsStayClosed() throws Exception {
        mvc.perform(post("/api/register")).andExpect(status().isForbidden());
        mvc.perform(get("/api/orders")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/orders").with(csrf())).andExpect(status().isUnauthorized());
        mvc.perform(put("/api/favorites/1").with(csrf())).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/admin/dishes").with(csrf()).with(user("guest"))).andExpect(status().isForbidden());
        mvc.perform(patch("/api/orders/1/status").with(csrf()).with(user("guest"))).andExpect(status().isForbidden());
    }

    @Test
    void registrationKeepsDisplayCaseAndRejectsASecondAccountWithDifferentCase() throws Exception {
        String password = UUID.randomUUID().toString();
        String registration = """
                {"username":"CaseFixture","password":"%s","role":"ADMIN"}
                """.formatted(password);
        mvc.perform(post("/api/register").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(registration))
                .andExpect(status().isCreated());

        var result = mvc.perform(post("/api/login").with(csrf())
                        .param("username", "casefixture").param("password", password))
                .andExpect(status().isNoContent()).andReturn();
        var session = (MockHttpSession) result.getRequest().getSession(false);
        mvc.perform(get("/api/session").session(session))
                .andExpect(jsonPath("$.user.username").value("CaseFixture"))
                .andExpect(jsonPath("$.user.role").value("GUEST"));

        mvc.perform(post("/api/register").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(registration.replace("CaseFixture", "CASEFIXTURE")))
                .andExpect(status().isConflict());
    }

    @Test
    void reservedUsernamesRejectCaseAndWhitespaceVariantsBeforeCreatingAnAccount() throws Exception {
        String password = UUID.randomUUID().toString();
        for (String name : new String[] {"  sCaRlEtT  ", " cRiS "}) {
            mvc.perform(post("/api/register").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"username":"%s","password":"%s","role":"ADMIN"}
                                    """.formatted(name, password)))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.detail").value("该用户名为店长保留，请使用其他用户名。"));
        }
    }

    @Test
    void guestCanChangeOnlyOwnPasswordAfterVerifyingCurrentPassword() throws Exception {
        String oldPassword = UUID.randomUUID().toString();
        String newPassword = UUID.randomUUID().toString();
        mvc.perform(post("/api/register").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"PasswordFixture","password":"%s"}
                                """.formatted(oldPassword)))
                .andExpect(status().isCreated());
        String change = """
                {"username":"AnotherAccount","currentPassword":"%s","newPassword":"%s","confirmPassword":"%s"}
                """;
        mvc.perform(patch("/api/profile/password").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(change.formatted(oldPassword, newPassword, newPassword)))
                .andExpect(status().isUnauthorized());

        String otherPassword = UUID.randomUUID().toString();
        mvc.perform(post("/api/register").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"AnotherAccount","password":"%s"}
                                """.formatted(otherPassword)))
                .andExpect(status().isCreated());
        var guest = mvc.perform(post("/api/login").with(csrf()).param("username", "passwordfixture")
                        .param("password", oldPassword))
                .andExpect(status().isNoContent()).andReturn();
        var session = (MockHttpSession) guest.getRequest().getSession(false);
        mvc.perform(patch("/api/profile/password").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(change.formatted(UUID.randomUUID(), newPassword, newPassword)))
                .andExpect(status().isBadRequest());
        mvc.perform(patch("/api/profile/password").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(change.formatted(oldPassword, newPassword, "different-confirmation")))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/login").with(csrf()).param("username", "passwordfixture")
                        .param("password", oldPassword)).andExpect(status().isNoContent());
        mvc.perform(patch("/api/profile/password").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(change.formatted(oldPassword, newPassword, newPassword)))
                .andExpect(status().isNoContent());

        mvc.perform(post("/api/login").with(csrf()).param("username", "passwordfixture")
                        .param("password", oldPassword)).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/login").with(csrf()).param("username", "anotheraccount")
                        .param("password", otherPassword)).andExpect(status().isNoContent());
        var renewed = mvc.perform(post("/api/login").with(csrf()).param("username", "passwordfixture")
                        .param("password", newPassword))
                .andExpect(status().isNoContent()).andReturn();
        var renewedSession = (MockHttpSession) renewed.getRequest().getSession(false);
        mvc.perform(get("/api/session").session(renewedSession))
                .andExpect(jsonPath("$.user.role").value("GUEST"));
        mvc.perform(post("/api/admin/dishes").session(renewedSession).with(csrf()))
                .andExpect(status().isForbidden());
    }

    @Test
    void managersEditSnapshotsAndDeleteOrdersWhileGuestsKeepOwnership() throws Exception {
        jdbc.update("""
                insert into kitchen_account(username,nickname,password_hash,role) values
                    ('OrderManager','Manager','fixture','ADMIN'),
                    ('OrderGuestOne','Owner nickname','fixture','GUEST'),
                    ('OrderGuestTwo','','fixture','GUEST')
                """);
        var manager = user("OrderManager").roles("ADMIN");
        var owner = user("OrderGuestOne").roles("GUEST");
        var other = user("OrderGuestTwo").roles("GUEST");
        String initial = """
                {"items":[{"dishId":1,"quantity":1},{"dishId":2,"quantity":1}]}
                """;
        var created = mvc.perform(post("/api/orders").with(owner).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(initial))
                .andExpect(status().isCreated()).andReturn();
        String order = created.getResponse().getHeader("Location");
        long id = Long.parseLong(order.substring(order.lastIndexOf('/') + 1));
        entities.flush();
        String management = "/api/admin/orders/" + id;
        var header = jdbc.queryForMap("select id, account_id, created_at from kitchen_order where id = ?", id);
        jdbc.update("update kitchen_order set status = 'COMPLETED' where id = ?", id);
        jdbc.update("update menu_item set name = 'Edited rice', price = 30.00 where id = 1");
        entities.clear();

        mvc.perform(get("/api/orders").with(manager))
                .andExpect(jsonPath("$[0].orderer").value("Owner nickname"))
                .andExpect(jsonPath("$[0].status").doesNotExist());
        mvc.perform(get(order).with(owner)).andExpect(status().isOk())
                .andExpect(jsonPath("$.orderer").doesNotExist());
        mvc.perform(get(order).with(other)).andExpect(status().isNotFound());

        String replacement = """
                {"items":[{"dishId":3,"quantity":1},{"dishId":1,"quantity":2}]}
                """;
        for (var guest : new org.springframework.test.web.servlet.request.RequestPostProcessor[] {owner, other}) {
            mvc.perform(put(management).with(guest).with(csrf())
                            .contentType(MediaType.APPLICATION_JSON).content(replacement))
                    .andExpect(status().isForbidden());
            mvc.perform(delete(management).with(guest).with(csrf())).andExpect(status().isForbidden());
        }
        mvc.perform(put(management).with(manager).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(replacement.replace(":3,", ":6,")))
                .andExpect(status().isConflict());
        mvc.perform(get(order).with(owner)).andExpect(jsonPath("$.total").value(15.75));

        mvc.perform(put(management).with(manager).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(replacement)).andExpect(status().isOk());
        mvc.perform(get(order).with(owner)).andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].name").value("Tomato Basil Toast"))
                .andExpect(jsonPath("$.items[1].name").value("Ginger Scallion Rice"))
                .andExpect(jsonPath("$.items[1].unitPrice").value(8.50))
                .andExpect(jsonPath("$.items[1].quantity").value(2))
                .andExpect(jsonPath("$.total").value(26.00));
        org.assertj.core.api.Assertions.assertThat(jdbc.queryForMap(
                "select id, account_id, created_at from kitchen_order where id = ?", id)).isEqualTo(header);
        org.assertj.core.api.Assertions.assertThat(jdbc.queryForObject(
                "select status from kitchen_order where id = ?", String.class, id)).isEqualTo("COMPLETED");
        mvc.perform(patch(order + "/status").with(manager).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"COMPLETED\"}")).andExpect(status().isNotFound());
        mvc.perform(delete(management).with(manager).with(csrf())).andExpect(status().isNoContent());
        mvc.perform(get(order).with(owner)).andExpect(status().isNotFound());
        mvc.perform(get(order).with(manager)).andExpect(status().isNotFound());
    }

    @Test
    void managerOrdererFallsBackToUsernameAndUnknownForLegacyOrder() throws Exception {
        jdbc.update("""
                insert into kitchen_account(username,nickname,password_hash,role) values
                    ('LegacyManager','Manager','fixture','ADMIN'), ('LegacyGuest','','fixture','GUEST')
                """);
        jdbc.update("insert into kitchen_order(status,total,created_at) values ('PREPARING',0,now())");
        mvc.perform(post("/api/orders").with(user("LegacyGuest")).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("""
                                {"items":[{"dishId":1,"quantity":1}]}
                                """)).andExpect(status().isCreated());
        mvc.perform(get("/api/orders").with(user("LegacyManager").roles("ADMIN")))
                .andExpect(jsonPath("$[0].orderer").value("LegacyGuest"))
                .andExpect(jsonPath("$[1].orderer").value("未知用户"));
    }
}
