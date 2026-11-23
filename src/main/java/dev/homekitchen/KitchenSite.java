package dev.homekitchen;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

@Component
class KitchenSite {
    private final Mode mode;
    private final String language;
    private final byte[] registrationInvite;

    KitchenSite(@Value("${kitchen.mode}") String mode, @Value("${kitchen.language}") String language,
                @Value("${kitchen.registration-invite-code}") String registrationInvite) {
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
        this.registrationInvite = registrationInvite.isBlank() ? null : registrationInvite.getBytes(StandardCharsets.UTF_8);
    }

    boolean privateMode() {
        return mode == Mode.PRIVATE;
    }

    boolean sharedMenu() {
        return mode == Mode.SHARED_MENU;
    }

    boolean registrationOpen() {
        return mode != Mode.PRIVATE;
    }

    boolean registrationAvailable() {
        return registrationOpen() && (!sharedMenu() || registrationInvite != null);
    }

    boolean matchesRegistrationInvite(String supplied) {
        return registrationInvite != null &&
                MessageDigest.isEqual(registrationInvite, supplied.getBytes(StandardCharsets.UTF_8));
    }

    boolean publicAvatar() {
        return !privateMode();
    }

    String language() {
        return language;
    }

    String text(String chinese, String english) {
        return language.equals("en-US") ? english : chinese;
    }

    private enum Mode { PRIVATE, PORTFOLIO, SHARED_MENU }
}
