#!/usr/bin/env python3
"""Read only the legacy SQLite dish table and import it into a local PostgreSQL database."""
import argparse
import base64
import binascii
from collections import Counter
from contextlib import closing
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import unicodedata
from urllib.parse import urlsplit

import psycopg
from psycopg.types.json import Jsonb


CATEGORIES = {"chinese": "Chinese", "western": "Western", "japanese": "Japanese", "dessert": "Dessert"}
PHOTO_TYPES = {"image/jpeg": b"\xff\xd8\xff", "image/png": b"\x89PNG\r\n\x1a\n"}
MAX_BYTES = 1024 * 1024


def legacy_list(value, field, missing):
    try:
        items = json.loads(value) if value else []
        if not isinstance(items, list):
            raise ValueError
    except (TypeError, ValueError):
        missing.append(field + " (unreadable)")
        return []
    if not items:
        missing.append(field)
    return items


def legacy_photo(value, missing):
    if value:
        header, separator, body = value.partition(",")
        media_type = header.removeprefix("data:").removesuffix(";base64")
        if separator and header == f"data:{media_type};base64" and media_type in PHOTO_TYPES:
            try:
                data = base64.b64decode(body, validate=True)
                if len(data) <= MAX_BYTES and data.startswith(PHOTO_TYPES[media_type]):
                    return data, media_type
            except (ValueError, binascii.Error):
                pass
    missing.append("photo" if not value else "photo (unsupported, invalid, or over 1 MB)")
    return None, None


def read_legacy_dishes(source):
    connection_uri = source.resolve(strict=True).as_uri() + "?mode=ro"
    with closing(sqlite3.connect(connection_uri, uri=True)) as legacy:
        return legacy.execute(
            "select id, name, category, price, ingredients, steps, tips, image_data from dish order by id"
        ).fetchall()


def import_dish(connection, row):
    row_id, name, legacy_category, price, ingredients, steps, tips, image = row
    category = CATEGORIES.get(str(legacy_category).strip().lower())
    name = str(name or "").strip()
    try:
        price = Decimal(str(price)).quantize(Decimal("0.01"))
        if not Decimal("0") <= price <= Decimal("99999999.99"):
            raise InvalidOperation
    except InvalidOperation:
        return category, "skipped", f"row {row_id}: missing or invalid price"
    if not category or not name or len(name) > 120:
        return category, "skipped", f"row {row_id}: missing or invalid name or category"

    missing = []
    items = legacy_list(ingredients, "ingredients", missing)
    normalized = [
        {"name": str(item["n"]), "amount": str(item.get("q") or "")}
        for item in items if isinstance(item, dict) and item.get("n")
    ]
    if len(normalized) < len(items):
        missing.append("some ingredient names")
    if any(not item["amount"] for item in normalized):
        missing.append("some ingredient amounts")
    raw_steps = legacy_list(steps, "steps", missing)
    steps = [step for step in raw_steps if isinstance(step, str) and step.strip()]
    if len(steps) < len(raw_steps):
        missing.append("some steps")
    tips = str(tips or "").strip()
    if not tips:
        missing.append("tips")

    photo, media_type = legacy_photo(image, missing)
    key_text = category + "\x00" + unicodedata.normalize("NFC", name).casefold()
    key = hashlib.sha256(key_text.encode("utf-8")).hexdigest()
    recipe = {"ingredients": normalized, "steps": steps, "tips": tips}

    result = connection.execute(
        """
        insert into menu_item (name, category, description, icon, price, available, recipe,
                               image_data, image_media_type, legacy_source_key)
        values (%s, %s, '', '', %s, true, %s, %s, %s, %s)
        on conflict (legacy_source_key) do nothing
        returning id
        """,
        (name, category, price, Jsonb(recipe), photo, media_type, key),
    ).fetchone()
    if result and photo:
        dish_id = result[0]
        connection.execute("update menu_item set image_path = %s where id = %s",
                           (f"/api/dishes/{dish_id}/image", dish_id))

    fields = f"{len(normalized)} ingredients, {len(steps)} steps, {'photo' if photo else 'no photo'}"
    if missing:
        fields += "; unavailable: " + ", ".join(missing)
    return category, "added" if result else "already imported", f"{name}: {fields}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sqlite_database", type=Path, help="a local copy of the legacy kitchen.db")
    args = parser.parse_args()
    dsn = os.environ.get("LEGACY_IMPORT_DB_URL", "").removeprefix("jdbc:")
    target = urlsplit(dsn)
    if (target.scheme not in ("postgresql", "postgres") or target.hostname not in ("127.0.0.1", "localhost", "::1")
            or not target.path.strip("/") or target.username or target.password or target.query):
        parser.error("LEGACY_IMPORT_DB_URL must identify a loopback PostgreSQL database. Use a separate local database.")
    rows = read_legacy_dishes(args.sqlite_database)
    counts = Counter()
    report = []
    with psycopg.connect(dsn, user=os.environ["DB_USER"], password=os.environ["DB_PASSWORD"]) as connection:
        for row in rows:
            category, action, detail = import_dish(connection, row)
            counts[category, action] += 1
            report.append(f"{action}: {detail}")
    for line in report:
        print(line)
    for category in CATEGORIES.values():
        print(f"{category}: {counts[category, 'added']} added, {counts[category, 'already imported']} already imported")


if __name__ == "__main__":
    main()
