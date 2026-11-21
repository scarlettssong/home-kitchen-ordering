#!/usr/bin/env python3
"""Copy the reviewed menu and image bytes from the local acceptance database to the private database."""
import argparse
from collections import Counter
from getpass import getpass
import os
import sys

import psycopg
from psycopg.conninfo import conninfo_to_dict

COLUMNS = """id, name, category, description, icon, price, available, image_path,
             recipe::text, image_data, image_media_type, legacy_source_key"""
EXPECTED = {"Chinese": 10, "Western": 1, "Japanese": 2, "Dessert": 7}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dsn-stdin", action="store_true", help="read the destination DSN from a pipe")
    args = parser.parse_args()
    dsn = sys.stdin.readline().rstrip("\n") if args.dsn_stdin else getpass("New private PostgreSQL connection string: ")
    destination = conninfo_to_dict(dsn)
    if destination.get("dbname") != "kitchen_private" or not destination.get("host"):
        raise SystemExit("Select the dedicated kitchen_private database.")
    if destination["host"] not in ("127.0.0.1", "localhost", "::1"):
        destination["sslmode"] = "verify-full"

    with psycopg.connect(host="127.0.0.1", port=15439, dbname="kitchen_acceptance",
                         user=os.environ["DB_USER"], password=os.environ["DB_PASSWORD"],
                         options="-c default_transaction_read_only=on") as source:
        dishes = source.execute(f"select {COLUMNS} from menu_item order by id").fetchall()
    counts = Counter(row[2] for row in dishes)
    if counts != EXPECTED or any(row[0] < 1000 or not row[9] or not row[11] for row in dishes):
        raise SystemExit("The local source does not match the 20 reviewed recipes and their stored photos.")
    if any(row[7] != f"/api/dishes/{row[0]}/image" for row in dishes):
        raise SystemExit("Every private photo must be served by the authenticated image endpoint.")

    with psycopg.connect(**destination) as target:
        target.execute("lock table menu_item in share row exclusive mode")
        existing = target.execute(f"select {COLUMNS} from menu_item order by id").fetchall()
        if existing == dishes:
            print("Verified the same 20 recipes and original photo bytes. No rows changed.")
            return
        if any(row[0] not in range(1, 7) or row[11] for row in existing):
            raise SystemExit("The destination already has a different menu. No rows changed.")
        if target.execute("select exists (select 1 from kitchen_order)").fetchone()[0]:
            raise SystemExit("The destination already contains orders. No rows changed.")
        target.execute("delete from menu_item")
        with target.cursor() as cursor:
            cursor.executemany("""
                insert into menu_item (id, name, category, description, icon, price, available, image_path,
                                       recipe, image_data, image_media_type, legacy_source_key)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s)
                """, dishes)
        copied = target.execute(f"select {COLUMNS} from menu_item order by id").fetchall()
        if copied != dishes:
            raise SystemExit("Destination verification failed. The transaction was rolled back.")
        target.execute("select setval(pg_get_serial_sequence('menu_item', 'id'), %s)", (dishes[-1][0],))

    print(f"Verified {len(dishes)} recipes with matching photo bytes: {dict(sorted(counts.items()))}")


if __name__ == "__main__":
    main()
