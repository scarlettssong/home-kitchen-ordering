CREATE UNIQUE INDEX kitchen_account_username_lower_idx
    ON kitchen_account (lower(username COLLATE "C"));
