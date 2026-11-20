package dev.homekitchen;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "spring.datasource.url=${TEST_DB_URL}",
        "spring.datasource.username=${TEST_DB_USER}",
        "spring.datasource.password=${TEST_DB_PASSWORD}"
})
@AutoConfigureMockMvc
@Transactional
class OrderingIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired EntityManager persistence;

    @Test
    void menuShowsSyntheticDishesAndAvailability() throws Exception {
        mvc.perform(get("/api/dishes"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("姜葱香米饭"))
                .andExpect(jsonPath("$[0].available").value(true))
                .andExpect(jsonPath("$[5].available").value(false));
    }

    @Test
    void menuReturnsPicturesAndStructuredRecipes() throws Exception {
        mvc.perform(get("/api/dishes"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].imagePath").value("/images/ginger-rice.jpg"))
                .andExpect(jsonPath("$[0].recipe.ingredients[0].name").value("茉莉香米"))
                .andExpect(jsonPath("$[0].recipe.ingredients[0].amount").value("200 克"))
                .andExpect(jsonPath("$[0].recipe.steps[7]").isNotEmpty())
                .andExpect(jsonPath("$[0].recipe.tips").isNotEmpty())
                .andExpect(jsonPath("$[5].recipe.tips").isEmpty());
    }

    @Test
    void enforcesThreePortionsPerDish() throws Exception {
        mvc.perform(post("/api/orders").contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"items":[{"dishId":1,"quantity":3},{"dishId":2,"quantity":3}]}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.items[0].quantity").value(3))
                .andExpect(jsonPath("$.items[1].quantity").value(3))
                .andExpect(jsonPath("$.total").value(47.25));

        for (String items : new String[]{
                "[{\"dishId\":1,\"quantity\":4}]",
                "[{\"dishId\":1,\"quantity\":2},{\"dishId\":1,\"quantity\":2}]"
        }) {
            mvc.perform(post("/api/orders").contentType(MediaType.APPLICATION_JSON)
                            .content("{\"items\":" + items + "}"))
                    .andExpect(status().isBadRequest());
        }
    }

    @Test
    void existingOrderRetainsNamePriceAndTotalAfterMenuChange() throws Exception {
        long id = placeOrder();
        persistence.flush();
        jdbc.update("update menu_item set name = ?, price = ? where id = 1", "Special Rice", 19.75);
        persistence.clear();

        mvc.perform(get("/api/orders/{id}", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].name").value("姜葱香米饭"))
                .andExpect(jsonPath("$.items[0].unitPrice").value(8.50))
                .andExpect(jsonPath("$.items[0].quantity").value(2))
                .andExpect(jsonPath("$.total").value(17.00));

        mvc.perform(post("/api/orders").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"items\":[{\"dishId\":1,\"quantity\":2}]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.items[0].name").value("Special Rice"))
                .andExpect(jsonPath("$.total").value(39.50));
    }

    @Test
    void kitchenAcceptsOnlyTheNextStatus() throws Exception {
        long id = placeOrder();
        setStatus(id, "COMPLETED", 409);
        setStatus(id, "PREPARING", 200);
        setStatus(id, "PLACED", 409);
        setStatus(id, "PREPARING", 409);
        setStatus(id, "COMPLETED", 200);
        setStatus(id, "PREPARING", 409);

        mvc.perform(get("/api/orders"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == " + id + ")].status").value("COMPLETED"));
    }

    @Test
    void rejectsInvalidQuantitiesAndDuplicateLines() throws Exception {
        for (String items : new String[]{
                "[]",
                "[null]",
                "[{\"dishId\":1}]",
                "[{\"dishId\":1,\"quantity\":0}]",
                "[{\"dishId\":1,\"quantity\":100}]",
                "[{\"dishId\":1,\"quantity\":1.5}]",
                "[{\"dishId\":1,\"quantity\":\"2\"}]",
                "[{\"dishId\":1,\"quantity\":2},{\"dishId\":1,\"quantity\":2}]"
        }) {
            mvc.perform(post("/api/orders").contentType(MediaType.APPLICATION_JSON)
                            .content("{\"items\":" + items + "}"))
                    .andExpect(status().isBadRequest());
        }
    }

    @Test
    void rejectsUnavailableAndUnknownDishes() throws Exception {
        for (int dishId : new int[]{6, 9999}) {
            mvc.perform(post("/api/orders").contentType(MediaType.APPLICATION_JSON)
                            .content("{\"items\":[{\"dishId\":" + dishId + ",\"quantity\":1}]}"))
                    .andExpect(status().isConflict());
        }
    }

    private long placeOrder() throws Exception {
        var result = mvc.perform(post("/api/orders").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"items\":[{\"dishId\":1,\"quantity\":2,\"unitPrice\":0.01}],\"total\":0.02}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PLACED"))
                .andExpect(jsonPath("$.total").value(17.00))
                .andReturn();
        return json.readTree(result.getResponse().getContentAsString()).get("id").asLong();
    }

    private void setStatus(long id, String value, int expectedStatus) throws Exception {
        mvc.perform(patch("/api/orders/{id}/status", id).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"" + value + "\"}"))
                .andExpect(status().is(expectedStatus));
    }
}
