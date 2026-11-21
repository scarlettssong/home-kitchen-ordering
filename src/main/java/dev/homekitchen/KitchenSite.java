package dev.homekitchen;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
class KitchenSite {
    private final boolean privateMode;
    private final String language;

    KitchenSite(@Value("${kitchen.mode}") String mode, @Value("${kitchen.language}") String language) {
        this.privateMode = switch (mode) {
            case "private" -> true;
            case "public" -> false;
            default -> throw new IllegalArgumentException("KITCHEN_MODE must be public or private");
        };
        this.language = switch (language) {
            case "" -> privateMode ? "zh-CN" : "en-US";
            case "zh-CN", "en-US" -> language;
            default -> throw new IllegalArgumentException("KITCHEN_LANGUAGE must be zh-CN or en-US");
        };
    }

    boolean privateMode() {
        return privateMode;
    }

    String language() {
        return language;
    }

    String text(String chinese, String english) {
        return language.equals("en-US") ? english : chinese;
    }
}
