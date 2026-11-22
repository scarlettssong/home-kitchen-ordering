ALTER TABLE menu_item
    ADD COLUMN subcategory varchar(30),
    ADD COLUMN automatic_price boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT menu_chinese_subcategory CHECK (
        subcategory IS NULL OR
        (category = 'Chinese' AND subcategory IN ('Staple', 'Vegetables', 'Beef', 'Chicken', 'Pork'))
    );

UPDATE menu_item
SET category = 'Thai'
WHERE category = 'Chinese'
  AND name = '泰式打抛饭'
  AND (SELECT count(*) FROM menu_item WHERE name = '泰式打抛饭') = 1;
