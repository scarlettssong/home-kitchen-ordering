# Home Kitchen Menu

Home Kitchen Menu is a local ordering demo for a Java developer portfolio. A customer browses a menu, adds dishes and quantities to a cart, and places an order. The kitchen then prepares and completes it.

The application uses Java 21, Spring Boot, Spring Data JPA, PostgreSQL, and Flyway. Spring Boot serves a Chinese ordering interface with a photo grid, top navigation, and a two-pane recipe on desktop. Phones use a single-column menu and bottom navigation. The menu uses fictional recipes, generated food photos, and a generated kitchen avatar. The walkthrough creates a sample order.

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

Open [http://127.0.0.1:8080](http://127.0.0.1:8080). The app binds to loopback by default.

## Local accounts

Use **我的 → 新食客注册** to create a guest. Guests can browse without signing in. Guests and managers both sign in with a username and password under **我的 → 登录**. The account role determines access. A signed-in guest can place orders, view their own order history, edit their nickname, and manage favorites.

To create a local manager, set the following environment variables before starting the app. Choose a new password when prompted.

```sh
export KITCHEN_ADMIN_USERNAME=demo_manager
printf 'New local manager password: '
read -rs KITCHEN_ADMIN_PASSWORD
printf '\n'
export KITCHEN_ADMIN_PASSWORD
mvn spring-boot:run
```

The first startup with these variables creates the manager with a BCrypt password hash. Later startups keep that account's existing password. The manager can manage the kitchen avatar and dishes and sees all orders. Registration always creates a guest.

To change an existing manager's password on a local database, use the same `DB_URL`, `DB_USER`, and `DB_PASSWORD` as the application. The tool prompts for the new password without displaying it and writes only its BCrypt hash. It reports the database and schema after reading the committed hash from a new connection.

```sh
python3 -m venv .venv
.venv/bin/pip install 'psycopg[binary]' bcrypt
.venv/bin/python tools/set_local_manager_password.py demo_manager
```

## Demo walkthrough

1. In **点餐**, open **姜葱香米饭** to view its photo, ingredients, numbered steps, and Tips.
2. Sign in as a guest. Add two **姜葱香米饭** and one **芝麻蔬菜煎饺**. Open the floating cart, confirm the **$24.25** estimate, and click **确认下单**. Look up the resulting order in **订单**.
3. In a separate browser session, sign in as the manager and open **订单**. Click **开始制作** and then **标记完成** on the same order.
4. In **点餐**, the manager can use **添加新菜品** or open a recipe and choose **编辑菜谱**. JPEG and PNG uploads allow a preview and removal, with a 1 MB upload limit.

[Desktop menu](docs/screenshots/rose-desktop-menu.png) · [Manager orders](docs/screenshots/rose-desktop-orders.png) · [Manager profile](docs/screenshots/rose-desktop-profile.png)

## Import a legacy menu locally

Create a separate local PostgreSQL database and start the Java app against it once so Flyway applies the schema. Use the same database URL for the import. Keep the legacy database and imported image data outside the repository.

```sh
python3 -m venv .venv
.venv/bin/pip install 'psycopg[binary]'
export LEGACY_IMPORT_DB_URL=jdbc:postgresql://127.0.0.1:5432/home_kitchen_legacy
.venv/bin/python tools/import_legacy_menu.py /path/to/legacy/kitchen.db
```

The script uses `DB_USER` and `DB_PASSWORD` from the shell, reads the SQLite `dish` table in read-only mode, and accepts a loopback PostgreSQL destination. It uses a stable category and dish-name key so reruns leave the imported records and subsequent edits intact. The script reports import counts and missing fields. A fresh application database includes the synthetic menu and creates no guest accounts.

## Test with PostgreSQL

Use the separate database created above. The suite applies the Flyway migrations and rolls back its test data.

```sh
export TEST_DB_URL=jdbc:postgresql://localhost:5432/home_kitchen_test
export TEST_DB_USER=home_kitchen
export TEST_DB_PASSWORD='<password chosen at the prompt>'
mvn verify
```

The integration tests exercise the HTTP endpoints against PostgreSQL. They cover the shared login for guests and managers, logout, CSRF, guest and manager permissions, private order history, menu changes and deletion, image limits, nickname and favorites, the three-portion limit, and price snapshots.

## Ordering rules

- Each order line uses a distinct dish ID and a whole-number quantity from 1 to 3. Unknown and sold-out dishes are rejected.
- The server reads the current menu price, records the dish name and unit price on the order line, and calculates the order total using decimal arithmetic. Later menu edits leave the saved receipt intact.
- The kitchen accepts only `Placed → Preparing → Completed`. It serializes concurrent updates to the same order with a database row lock and rejects invalid transitions with HTTP 409.
