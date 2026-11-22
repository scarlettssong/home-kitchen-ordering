package dev.homekitchen;

import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
class SecurityConfiguration {
    private static final Logger LOG = LoggerFactory.getLogger(SecurityConfiguration.class);

    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    SecurityFilterChain kitchenSecurity(HttpSecurity http, KitchenSite site,
            @Value("${kitchen.session-idle-seconds:86400}") int sessionIdleSeconds) throws Exception {
        return http
                .authorizeHttpRequests(rules -> {
                    rules.requestMatchers(HttpMethod.GET, "/", "/index.html", "/css/**", "/js/**",
                            "/api/session", "/healthz").permitAll()
                            .requestMatchers(HttpMethod.HEAD, "/healthz").permitAll();
                    if (site.registrationOpen()) {
                        rules.requestMatchers(HttpMethod.POST, "/api/register").permitAll();
                    } else {
                        rules.requestMatchers(HttpMethod.POST, "/api/register").denyAll();
                    }
                    if (site.sharedMenu()) {
                        rules.requestMatchers(HttpMethod.PATCH, "/api/profile/password").authenticated();
                    }
                    if (site.publicAvatar()) {
                        rules.requestMatchers(HttpMethod.GET, "/api/kitchen/avatar").permitAll()
                                .requestMatchers(HttpMethod.HEAD, "/api/kitchen/avatar").permitAll();
                    } else {
                        rules.requestMatchers("/api/kitchen/avatar").authenticated();
                    }
                    if (site.privateMode()) {
                        rules.requestMatchers("/api/dishes", "/api/dishes/**", "/images/**").authenticated();
                    } else {
                        rules.requestMatchers(HttpMethod.GET, "/api/dishes", "/api/dishes/**", "/images/**").permitAll()
                                .requestMatchers(HttpMethod.HEAD, "/api/dishes", "/api/dishes/**", "/images/**").permitAll();
                    }
                    if (!site.sharedMenu()) rules.requestMatchers("/api/admin/edit-session").denyAll();
                    rules.requestMatchers("/api/admin/**", "/api/orders/*/status").hasRole("ADMIN")
                            .requestMatchers("/api/orders", "/api/orders/**", "/api/profile", "/api/favorites/**")
                            .authenticated()
                            .requestMatchers("/error").permitAll()
                            .anyRequest().denyAll();
                })
                .requestCache(cache -> cache.disable())
                .exceptionHandling(errors -> errors
                        .authenticationEntryPoint((request, response, failure) ->
                                response.setStatus(HttpServletResponse.SC_UNAUTHORIZED))
                        .accessDeniedHandler((request, response, failure) ->
                                response.setStatus(HttpServletResponse.SC_FORBIDDEN)))
                .formLogin(login -> login.loginProcessingUrl("/api/login")
                        .successHandler((request, response, authentication) -> {
                            if (site.sharedMenu()) request.getSession().setMaxInactiveInterval(sessionIdleSeconds);
                            LOG.debug("POST /api/login authenticated; returning 204");
                            response.setStatus(HttpServletResponse.SC_NO_CONTENT);
                        })
                        .failureHandler((request, response, failure) -> {
                            LOG.debug("POST /api/login rejected ({}); returning 401", failure.getClass().getSimpleName());
                            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                        })
                        .permitAll())
                .logout(logout -> logout.logoutUrl("/api/logout")
                        .logoutSuccessHandler((request, response, authentication) ->
                                response.setStatus(HttpServletResponse.SC_NO_CONTENT)))
                .build();
    }
}
