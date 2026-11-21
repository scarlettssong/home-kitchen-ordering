FROM maven:3.9.11-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY src/main ./src/main
RUN mvn -B -ntp -Dmaven.test.skip=true package

FROM eclipse-temurin:21-jre-jammy
WORKDIR /app
COPY --from=build /src/target/*.jar /app/app.jar
ENV SERVER_ADDRESS=0.0.0.0 \
    SERVER_FORWARD_HEADERS_STRATEGY=framework \
    SERVER_SERVLET_SESSION_COOKIE_SECURE=true \
    SPRING_DATASOURCE_HIKARI_MINIMUM_IDLE=0 \
    SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE=4 \
    JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=55.0 -Djava.awt.headless=true"
USER 10001:10001
EXPOSE 10000
CMD ["sh", "-c", "exec java -jar /app/app.jar --server.port=\"${PORT:-10000}\""]
