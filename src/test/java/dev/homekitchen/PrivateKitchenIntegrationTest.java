package dev.homekitchen;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "spring.datasource.url=${TEST_DB_URL}",
        "spring.datasource.username=${TEST_DB_USER}",
        "spring.datasource.password=${TEST_DB_PASSWORD}",
        "kitchen.mode=private"
})
@AutoConfigureMockMvc
class PrivateKitchenIntegrationTest {
    @Autowired MockMvc mvc;

    @Test
    void privateRecipesAndImagesRequireLoginAndRegistrationIsDisabled() throws Exception {
        mvc.perform(get("/api/dishes")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/dishes/1")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/dishes/1/image")).andExpect(status().isUnauthorized());
        mvc.perform(head("/api/dishes/1/image")).andExpect(status().isUnauthorized());
        mvc.perform(get("/images/ginger-rice.jpg")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/kitchen/avatar")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/register").with(csrf())).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/register").with(csrf()).with(user("guest"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/dishes").with(user("guest"))).andExpect(status().isOk());
        mvc.perform(get("/api/session")).andExpect(status().isOk());
        mvc.perform(get("/healthz")).andExpect(status().isOk());
        mvc.perform(get("/")).andExpect(status().isOk())
                .andExpect(content().string(containsString("lang=\"zh-CN\" data-private=\"true\"")));
    }
}
