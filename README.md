# Home Kitchen Menu

Home Kitchen Menu is a local ordering demo for a Java developer portfolio. A customer browses a menu, adds dishes and quantities to a cart, and places an order. The kitchen then prepares and completes it.

The application uses Java 21, Spring Boot, Spring Data JPA, PostgreSQL, and Flyway. Spring Boot serves a single-column Chinese menu, recipe dialog, and cart based on the original Flask app. The menu uses fictional recipes, generated food photos, and a generated kitchen avatar. The walkthrough creates a sample order.

## Run locally

Install Java 21, Maven 3.9+, and PostgreSQL. Connect to PostgreSQL as a local administrator with `psql -d postgres`, then create a role and separate databases for the app and tests. The password prompt keeps the value out of the SQL you type.

```sql
CREATE ROLE home_kitchen LOGIN;
\password home_kitchen
CREATE DATABASE home_kitchen OWNER home_kitchen;
CREATE DATABASE home_kitchen_test OWNER home_kitchen;
```

From the repository root, supply the connection settings through your shell and start the app. Use the role password you just set for `DB_PASSWORD`. Flyway creates the tables and seeds the menu on startup.

```sh
export DB_URL=jdbc:postgresql://localhost:5432/home_kitchen
export DB_USER=home_kitchen
export DB_PASSWORD='<password chosen at the prompt>'
mvn spring-boot:run
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080). The demo binds to loopback by default. The menu, recipe viewer, cart, and kitchen order flow work without accounts in this local demo. The 我的 tab is reserved for the account features in the next phase.

## Demo walkthrough

1. In **点餐**, browse the four cuisine categories. Open **姜葱香米饭** to view its photo, ingredient amounts, numbered steps, and Tips. Scroll to the end and use **返回菜单** to close the recipe.
2. Add two **姜葱香米饭** and one **芝麻蔬菜煎饺**. Open the floating cart, confirm the **$24.25** estimate, and click **确认下单**. The confirmation shows the order number and the total returned by the backend.
3. Open **订单** and find the order marked **已下单**. Click **开始制作**, then click **标记完成** when the order shows **制作中**.
4. Use **刷新** to verify that the same order still shows **已完成**, with its saved items and total.

[Desktop menu](docs/screenshots/restored-desktop-menu.png) · [Mobile menu](docs/screenshots/restored-mobile-menu.png) · [Mobile recipe at the final step and Tips](docs/screenshots/restored-mobile-recipe-end.png)

## Test with PostgreSQL

Use the separate database created above. The suite applies the Flyway migrations and rolls back its test data.

```sh
export TEST_DB_URL=jdbc:postgresql://localhost:5432/home_kitchen_test
export TEST_DB_USER=home_kitchen
export TEST_DB_PASSWORD='<password chosen at the prompt>'
mvn test
```

The integration tests exercise the HTTP endpoints against PostgreSQL. They cover menu availability and recipe data, the three-portion limit, invalid quantities, duplicate lines, unavailable dishes, order totals after menu changes, and the forward-only kitchen workflow.

## Ordering rules

- Each order line uses a distinct dish ID and a whole-number quantity from 1 to 3. Unknown and sold-out dishes are rejected.
- The server reads the current menu price, records the dish name and unit price on the order line, and calculates the order total using decimal arithmetic. Later menu edits leave the saved receipt intact.
- The kitchen accepts only `Placed → Preparing → Completed`. It serializes concurrent updates to the same order with a database row lock and rejects invalid transitions with HTTP 409.
