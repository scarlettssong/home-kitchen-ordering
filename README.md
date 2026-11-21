# Home Kitchen

[Open the live portfolio app](https://home-kitchen-ordering-demo.onrender.com/)

Home Kitchen is a Java 21 ordering app. Guests browse a photo menu, read recipes, save favorites, and place orders. Managers edit dishes and take orders from Placed to Preparing to Completed.

Spring Boot serves the responsive interface and API from the same origin. Spring Security handles sessions and roles. Spring Data JPA, PostgreSQL, and Flyway handle data and migrations. The public site uses fictional recipes and generated photos.

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
export KITCHEN_MODE=public
export DB_URL=jdbc:postgresql://localhost:5432/home_kitchen
export DB_USER=home_kitchen
export DB_PASSWORD='<password chosen at the prompt>'
mvn spring-boot:run
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080). The app binds to loopback by default.

## Local accounts

Use **My Account → Create an account** to create a guest. Anyone can browse the public menu. Guests and managers both use **My Account → Sign in**. The account role determines access. A signed-in guest can place orders, view their own order history, edit their nickname, and manage favorites.

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

1. In **Menu**, open **Ginger Scallion Rice** to view its photo, ingredients, steps, and tips.
2. Sign in as a guest. Add two **Ginger Scallion Rice** and one **Sesame Garden Dumplings**. Open **Cart**, confirm the **$24.25** estimate, and click **Place order**. Look up the order in **Orders**.
3. In a separate browser session, sign in as the manager and open **Orders**. Click **Start preparing** and then **Mark completed** on the same order.
4. Managers can choose **Add dish** in the menu or **Edit recipe** in a dish's detail view. JPEG and PNG uploads allow a preview and removal, with a 1 MB upload limit.

![English portfolio menu](docs/screenshots/portfolio-menu.jpg)

## Import a legacy menu locally

Create a separate local PostgreSQL database and start the Java app against it once so Flyway applies the schema. Use the same database URL for the import. Keep the legacy database and imported image data outside the repository.

```sh
python3 -m venv .venv
.venv/bin/pip install 'psycopg[binary]'
export LEGACY_IMPORT_DB_URL=jdbc:postgresql://127.0.0.1:5432/home_kitchen_legacy
.venv/bin/python tools/import_legacy_menu.py /path/to/legacy/kitchen.db
```

The script uses `DB_USER` and `DB_PASSWORD` from the shell, reads the SQLite `dish` table in read-only mode, and accepts a loopback PostgreSQL destination. It uses a stable category and dish-name key so reruns leave the imported records and subsequent edits intact. The script reports import counts and missing fields. A fresh application database includes the synthetic menu and creates no guest accounts.

## Deploy on Render

Use the Docker runtime and set the health check path to `/healthz`. The same image serves both deployment modes. Each service needs its own PostgreSQL database.

| Variable | Public portfolio | Private kitchen |
| --- | --- | --- |
| `KITCHEN_MODE` | `public` | `private` (default) |
| `KITCHEN_LANGUAGE` | `en-US` (public default) | `zh-CN` (private default) |
| `DB_URL`, `DB_USER`, `DB_PASSWORD` | Synthetic-data database | Separate private database |
| `KITCHEN_ADMIN_USERNAME`, `KITCHEN_ADMIN_PASSWORD` | Optional manager bootstrap | Optional manager bootstrap |
| `KITCHEN_GUEST_USERNAME`, `KITCHEN_GUEST_PASSWORD` | Guest self-registration | Optional second account bootstrap |

Use a direct Neon JDBC URL with certificate validation, for example
`jdbc:postgresql://<endpoint>/<database>?sslmode=verify-full&sslfactory=org.postgresql.ssl.DefaultJavaSSLFactory`.
Supply credentials as deployment secrets. Bootstrap variables create accounts with BCrypt hashes on first use and can be removed after provisioning.

In private mode the server disables registration and requires authentication for the menu API, recipe images, and avatar. To replace Flyway's sample rows in an empty private instance with a reviewed local menu, use `tools/copy_private_menu.py`. It prompts for the dedicated destination connection and copies rows and images directly between databases. Verify private access controls before importing a private menu.

The public [health endpoint](https://home-kitchen-ordering-demo.onrender.com/healthz) accepts a read-only GET and returns HTTP 200 with `ok` when the application is running. It needs neither a session nor a database query. Render Free services can take time to respond after idling.

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
