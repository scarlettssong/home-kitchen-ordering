#!/usr/bin/env python3
"""Set a new BCrypt password for an existing manager in a loopback PostgreSQL database."""
import argparse
from getpass import getpass
from hmac import compare_digest
import os
import re
import sys
from urllib.parse import urlsplit

import bcrypt
import psycopg


def username(value):
    name = value.strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_.-]{2,39}", name):
        raise argparse.ArgumentTypeError("use a valid 3–40 character account name")
    return name


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("username", type=username, help="current manager username")
    parser.add_argument("--rename-to", type=username, help="optionally rename the same manager account")
    parser.add_argument("--password-stdin", action="store_true", help="read the new password from a pipe")
    args = parser.parse_args()

    dsn = os.environ.get("DB_URL", "").removeprefix("jdbc:")
    target = urlsplit(dsn)
    if (target.scheme not in ("postgresql", "postgres") or target.hostname not in ("127.0.0.1", "localhost", "::1")
            or not target.path.strip("/") or target.username or target.password or target.query):
        parser.error("DB_URL must identify a loopback PostgreSQL database without embedded credentials")

    if args.password_stdin:
        password = sys.stdin.readline().removesuffix("\n")
    else:
        if not sys.stdin.isatty():
            parser.error("use an interactive terminal or supply --password-stdin")
        password = getpass("New manager password: ")
        if password != getpass("Confirm new password: "):
            parser.error("passwords do not match")

    encoded = password.encode("utf-8")
    if not 8 <= len(encoded) <= 72 or not password.strip():
        parser.error("use a nonblank password of 8 to 72 UTF-8 bytes")

    new_name = args.rename_to or args.username
    digest = bcrypt.hashpw(encoded, bcrypt.gensalt(rounds=10)).decode("ascii")
    credentials = {
        "user": os.environ["DB_USER"],
        "password": os.environ["DB_PASSWORD"],
        "options": "-c search_path=public",
    }
    try:
        with psycopg.connect(dsn, **credentials) as connection:
            updated = connection.execute(
                """
                update public.kitchen_account
                set username = %s, password_hash = %s
                where username = %s and role = 'ADMIN'
                returning id
                """,
                (new_name, digest, args.username),
            ).fetchone()
            if not updated:
                parser.exit(1, "No manager account matched that username.\n")

        # A new connection can only see the saved hash after the write commits.
        with psycopg.connect(dsn, **credentials) as connection:
            saved = connection.execute(
                """
                select current_database(), current_schema(), password_hash
                from public.kitchen_account
                where id = %s and username = %s and role = 'ADMIN'
                """,
                (updated[0], new_name),
            ).fetchone()
            if not saved or not compare_digest(saved[2], digest):
                parser.exit(1, "Could not verify the committed manager password.\n")
    except psycopg.errors.UniqueViolation:
        parser.exit(1, "The requested username is already in use.\n")
    except psycopg.OperationalError:
        parser.exit(1, "Could not connect to local PostgreSQL to confirm the password reset.\n")
    print(f"Password saved and verified for {new_name} in {saved[0]}.{saved[1]}.")


if __name__ == "__main__":
    main()
