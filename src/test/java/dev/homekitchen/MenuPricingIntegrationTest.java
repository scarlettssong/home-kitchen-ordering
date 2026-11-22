package dev.homekitchen;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.empty;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
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
class MenuPricingIntegrationTest {
    private static final String DISH = """
            {"name":"Ingredient cost fixture","category":"Chinese","subcategory":"Chicken","price":null,
             "available":true,"ingredients":[{"name":"Garlic","amount":"2 cloves","cost":0.10},
             {"name":"Salt","amount":"a pinch"},{"name":"Ginger","cost":0.20}],"steps":["Chop"],"tips":"Serve warm"}
            """;
    private static final String ADMIN_DISH = "/api/admin/dishes/{id}";

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired EntityManager entities;

    @Test
    void automaticPriceUsesExactCostsAndKeepsThemInManagerResponses() throws Exception {
        long id = createDish(DISH);
        entities.clear();

        mvc.perform(get(ADMIN_DISH, id)).andExpect(status().isUnauthorized());
        mvc.perform(get(ADMIN_DISH, id).with(user("Guest").roles("GUEST"))).andExpect(status().isForbidden());
        mvc.perform(get(ADMIN_DISH, id).with(user("Manager").roles("ADMIN")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.price").doesNotExist())
                .andExpect(jsonPath("$.effectivePrice").value(0.30))
                .andExpect(jsonPath("$.subcategory").value("Chicken"))
                .andExpect(jsonPath("$.recipe.ingredients[0].cost").value(0.10))
                .andExpect(jsonPath("$.recipe.ingredients[1].cost").doesNotHaveJsonPath())
                .andExpect(jsonPath("$.recipe.ingredients[2].cost").value(0.20));
        String dish = "$[?(@.id == " + id + ")]";
        mvc.perform(get("/api/dishes"))
                .andExpect(status().isOk())
                .andExpect(jsonPath(dish + ".price").value(contains(0.30)))
                .andExpect(jsonPath(dish + ".subcategory").value(contains("Chicken")))
                .andExpect(jsonPath(dish + ".recipe.ingredients[*].cost").value(empty()))
                .andExpect(jsonPath("$[0].recipe.ingredients[0].name").value("Jasmine rice"));
    }

    @Test
    void explicitZeroWinsAndThaiIsAccepted() throws Exception {
        long id = createDish(DISH);
        String thai = DISH.replace("\"price\":null", "\"price\":0.00")
                .replace("\"category\":\"Chinese\",\"subcategory\":\"Chicken\"", "\"category\":\"Thai\"");
        mvc.perform(multipart(HttpMethod.PUT, ADMIN_DISH, id).file(dishPart(thai))
                        .with(user("Manager").roles("ADMIN")).with(csrf()))
                .andExpect(status().isOk());
        entities.clear();
        mvc.perform(get(ADMIN_DISH, id).with(user("Manager").roles("ADMIN")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.category").value("Thai"))
                .andExpect(jsonPath("$.subcategory").doesNotExist())
                .andExpect(jsonPath("$.price").value(0.00))
                .andExpect(jsonPath("$.effectivePrice").value(0.00))
                .andExpect(jsonPath("$.recipe.ingredients[0].cost").value(0.10));
    }

    @Test
    void zeroIngredientCostIsEnoughForAutomaticPrice() throws Exception {
        long id = createDish(DISH.replace("0.10", "0.00").replace(",\"cost\":0.20", ""));
        mvc.perform(get(ADMIN_DISH, id).with(user("Manager").roles("ADMIN")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.effectivePrice").value(0.00));
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "\"category\":\"Thai\"", "\"subcategory\":\"Fish\"", "\"cost\":0.101", "\"cost\":-0.01",
            "\"cost\":99999999.99", "\"ingredients\":[]"
    })
    void rejectsInvalidSubcategoriesCostsAndMissingPrice(String invalidField) throws Exception {
        String invalid = switch (invalidField) {
            case "\"category\":\"Thai\"" -> DISH.replace("\"category\":\"Chinese\"", invalidField);
            case "\"subcategory\":\"Fish\"" -> DISH.replace("\"subcategory\":\"Chicken\"", invalidField);
            case "\"ingredients\":[]" -> DISH.replaceFirst("(?s)\"ingredients\":\\[.*?\\]", invalidField);
            default -> DISH.replace("\"cost\":0.10", invalidField);
        };
        mvc.perform(multipart("/api/admin/dishes").file(dishPart(invalid))
                        .with(user("Manager").roles("ADMIN")).with(csrf()))
                .andExpect(status().isBadRequest());
    }

    private long createDish(String payload) throws Exception {
        var created = mvc.perform(multipart("/api/admin/dishes").file(dishPart(payload))
                        .with(user("Manager").roles("ADMIN")).with(csrf()))
                .andExpect(status().isCreated()).andReturn();
        return json.readTree(created.getResponse().getContentAsByteArray()).get("id").asLong();
    }

    private static MockMultipartFile dishPart(String payload) {
        return new MockMultipartFile("dish", "dish.json", MediaType.APPLICATION_JSON_VALUE,
                payload.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
}
