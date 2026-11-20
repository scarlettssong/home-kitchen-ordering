CREATE TABLE menu_item (
    id bigint PRIMARY KEY,
    name varchar(120) NOT NULL,
    category varchar(30) NOT NULL,
    description varchar(240) NOT NULL,
    icon varchar(16) NOT NULL,
    price numeric(10, 2) NOT NULL CHECK (price >= 0),
    available boolean NOT NULL
);

CREATE TABLE kitchen_order (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    status varchar(16) NOT NULL CHECK (status IN ('PLACED', 'PREPARING', 'COMPLETED')),
    total numeric(16, 2) NOT NULL CHECK (total >= 0),
    created_at timestamptz NOT NULL
);

CREATE TABLE order_item (
    order_id bigint NOT NULL REFERENCES kitchen_order (id),
    position integer NOT NULL,
    dish_id bigint NOT NULL,
    dish_name varchar(120) NOT NULL,
    unit_price numeric(10, 2) NOT NULL CHECK (unit_price >= 0),
    quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
    PRIMARY KEY (order_id, position),
    UNIQUE (order_id, dish_id)
);
