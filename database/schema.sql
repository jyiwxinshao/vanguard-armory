-- Non-destructive initialization. All dates use the connection's UTC session.
-- MySQL DDL implicitly commits; seed data is inserted in a separate transaction.
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(20) NOT NULL,
  email VARCHAR(50) NOT NULL,
  password_hash VARCHAR(60) NOT NULL,
  avatar VARCHAR(500) NULL,
  role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
  status ENUM('active', 'frozen') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email),
  CONSTRAINT ck_users_username_length CHECK (CHAR_LENGTH(username) BETWEEN 2 AND 20)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS equipments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(50) NOT NULL,
  price INT UNSIGNED NOT NULL,
  rarity ENUM('SSR', 'SR', 'R', 'N') NOT NULL,
  category ENUM('weapon', 'armor', 'accessory', 'consumable') NOT NULL,
  image VARCHAR(500) NOT NULL,
  attack INT UNSIGNED NOT NULL DEFAULT 0,
  defense INT UNSIGNED NOT NULL DEFAULT 0,
  new_until DATETIME NULL,
  description VARCHAR(500) NULL,
  stock INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('on_sale', 'off_sale', 'deleted') NOT NULL DEFAULT 'off_sale',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_equipments_status_created (status, created_at, id),
  KEY idx_equipments_status_category_rarity (status, category, rarity),
  CONSTRAINT ck_equipments_price CHECK (price BETWEEN 1 AND 1000000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS carts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_carts_user (user_id),
  CONSTRAINT fk_carts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cart_items (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  cart_id INT UNSIGNED NOT NULL,
  equipment_id INT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cart_items_equipment (cart_id, equipment_id),
  KEY idx_cart_items_equipment (equipment_id),
  CONSTRAINT fk_cart_items_cart FOREIGN KEY (cart_id) REFERENCES carts (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cart_items_equipment FOREIGN KEY (equipment_id) REFERENCES equipments (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_cart_items_quantity CHECK (quantity BETWEEN 1 AND 9999)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_no VARCHAR(24) NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  total INT UNSIGNED NOT NULL,
  discount INT UNSIGNED NOT NULL DEFAULT 0,
  actual_total INT UNSIGNED NOT NULL,
  character_name VARCHAR(10) NOT NULL,
  server VARCHAR(20) NOT NULL,
  remark VARCHAR(200) NULL,
  status ENUM('pending', 'paid', 'cancelled', 'completed') NOT NULL DEFAULT 'pending',
  payment_time DATETIME NULL,
  cancelled_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_order_no (order_no),
  KEY idx_orders_user_created (user_id, created_at, id),
  KEY idx_orders_status_created (status, created_at, id),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_orders_amount CHECK (total <= 100000000 AND discount <= total AND actual_total + discount = total),
  CONSTRAINT ck_orders_character CHECK (CHAR_LENGTH(character_name) BETWEEN 2 AND 10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id INT UNSIGNED NOT NULL,
  equipment_id INT UNSIGNED NOT NULL,
  equipment_name VARCHAR(50) NOT NULL,
  equipment_image VARCHAR(500) NOT NULL,
  rarity ENUM('SSR', 'SR', 'R', 'N') NOT NULL,
  price INT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_items_equipment (order_id, equipment_id),
  KEY idx_order_items_equipment (equipment_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_order_items_equipment FOREIGN KEY (equipment_id) REFERENCES equipments (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_order_items_price CHECK (price BETWEEN 1 AND 1000000),
  CONSTRAINT ck_order_items_quantity CHECK (quantity BETWEEN 1 AND 9999)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Durable merge receipts: retained so a delayed client retry never adds twice.
CREATE TABLE IF NOT EXISTS cart_merge_receipts (
  merge_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  adjustments JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (merge_id),
  KEY idx_cart_merge_user (user_id),
  CONSTRAINT fk_cart_merge_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One durable submission receipt per checkout. Existing order tables are preserved.
CREATE TABLE IF NOT EXISTS order_requests (
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (request_id),
  UNIQUE KEY uq_order_requests_order (order_id),
  KEY idx_order_requests_user (user_id),
  CONSTRAINT fk_order_requests_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_order_requests_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
