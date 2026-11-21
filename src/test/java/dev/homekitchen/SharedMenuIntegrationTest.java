package dev.homekitchen;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
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
@AutoConfigureMockMvc
@Transactional
class SharedMenuIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    @Test
    void anonymousVisitorCanReadRecipesAndPhotosInChineseMode() throws Exception {
        mvc.perform(get("/")).andExpect(status().isOk())
                .andExpect(content().string(containsString("lang=\"zh-CN\" data-private=\"false\"")))
                .andExpect(content().string(containsString("data-registration-open=\"false\"")));
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
    void registrationAndAnonymousWritesStayClosed() throws Exception {
        mvc.perform(post("/api/register").with(csrf())).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/register").with(csrf()).with(user("guest"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/orders")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/orders").with(csrf())).andExpect(status().isUnauthorized());
        mvc.perform(put("/api/favorites/1").with(csrf())).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/admin/dishes").with(csrf()).with(user("guest"))).andExpect(status().isForbidden());
        mvc.perform(patch("/api/orders/1/status").with(csrf()).with(user("guest"))).andExpect(status().isForbidden());
    }
}
