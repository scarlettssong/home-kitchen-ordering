package dev.homekitchen;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
class KitchenSite {
    private final Mode mode;
    private final String language;

    KitchenSite(@Value("${kitchen.mode}") String mode, @Value("${kitchen.language}") String language) {
        this.mode = switch (mode) {
            case "private" -> Mode.PRIVATE;
            case "public" -> Mode.PORTFOLIO;
            case "shared-menu" -> Mode.SHARED_MENU;
            default -> throw new IllegalArgumentException("KITCHEN_MODE must be public, private, or shared-menu");
        };
        this.language = switch (language) {
            case "" -> this.mode == Mode.PORTFOLIO ? "en-US" : "zh-CN";
            case "zh-CN", "en-US" -> language;
            default -> throw new IllegalArgumentException("KITCHEN_LANGUAGE must be zh-CN or en-US");
        };
    }

    boolean privateMode() {
        return mode == Mode.PRIVATE;
    }

    boolean registrationOpen() {
        return mode != Mode.PRIVATE;
    }

    boolean publicAvatar() {
        return mode == Mode.PORTFOLIO;
    }

    String language() {
        return language;
    }

    String text(String chinese, String english) {
        return language.equals("en-US") ? english : chinese;
    }

    private enum Mode { PRIVATE, PORTFOLIO, SHARED_MENU }
}
