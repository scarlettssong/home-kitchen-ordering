package dev.homekitchen;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
class SecurityConfiguration {
    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    SecurityFilterChain kitchenSecurity(HttpSecurity http) throws Exception {
        return http
                .authorizeHttpRequests(rules -> rules
                        .requestMatchers(HttpMethod.GET, "/", "/index.html", "/css/**", "/js/**",
                                "/images/**", "/api/dishes", "/api/dishes/*/image",
                                "/api/kitchen/avatar", "/api/session").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/register").permitAll()
                        .requestMatchers("/api/admin/**", "/api/orders/*/status").hasRole("ADMIN")
                        .requestMatchers("/api/orders", "/api/orders/**", "/api/profile", "/api/favorites/**")
                        .authenticated()
                        .requestMatchers("/error").permitAll()
                        .anyRequest().denyAll())
                .requestCache(cache -> cache.disable())
                .exceptionHandling(errors -> errors
                        .authenticationEntryPoint((request, response, failure) ->
                                response.setStatus(HttpServletResponse.SC_UNAUTHORIZED))
                        .accessDeniedHandler((request, response, failure) ->
                                response.setStatus(HttpServletResponse.SC_FORBIDDEN)))
                .formLogin(login -> login.loginProcessingUrl("/api/login")
                        .successHandler((request, response, authentication) ->
                                response.setStatus(HttpServletResponse.SC_NO_CONTENT))
                        .failureHandler((request, response, failure) ->
                                response.setStatus(HttpServletResponse.SC_UNAUTHORIZED))
                        .permitAll())
                .logout(logout -> logout.logoutUrl("/api/logout")
                        .logoutSuccessHandler((request, response, authentication) ->
                                response.setStatus(HttpServletResponse.SC_NO_CONTENT)))
                .build();
    }
}
