package dev.homekitchen;

import org.springframework.core.io.ClassPathResource;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ResponseBody;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.ResourceBundle;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Controller
class KitchenPage {
    private static final Pattern MESSAGE = Pattern.compile("\\{\\{([a-zA-Z0-9]+)}}");
    private final String page;

    KitchenPage(KitchenSite site) throws IOException {
        var messages = ResourceBundle.getBundle("kitchen", Locale.forLanguageTag(site.language()));
        var source = new ClassPathResource("kitchen.html").getContentAsString(StandardCharsets.UTF_8);
        page = MESSAGE.matcher(source).replaceAll(match -> Matcher.quoteReplacement(switch (match.group(1)) {
            case "language" -> site.language();
            case "privateMode" -> Boolean.toString(site.privateMode());
            case "registrationOpen" -> Boolean.toString(site.registrationOpen());
            default -> messages.getString(match.group(1));
        }));
    }

    @GetMapping(value = {"/", "/index.html"}, produces = MediaType.TEXT_HTML_VALUE)
    @ResponseBody
    String page() {
        return page;
    }
}
