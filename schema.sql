-- Nine core entities from the BCSE302L report, plus a session support table.
-- Money uses integer paise throughout to keep checkout calculations exact.
CREATE TABLE IF NOT EXISTS CUSTOMERS (
 CustomerID INTEGER PRIMARY KEY,
 CustomerName TEXT NOT NULL,
 Email TEXT NOT NULL COLLATE NOCASE UNIQUE,
 PasswordHash TEXT NOT NULL,
 Phone TEXT, Address TEXT,
 RegistrationDate TEXT NOT NULL,
 Role TEXT NOT NULL DEFAULT 'customer' CHECK (Role IN ('customer','admin'))
);
CREATE TABLE IF NOT EXISTS CATEGORIES (
 CategoryID INTEGER PRIMARY KEY, CategoryName TEXT NOT NULL UNIQUE,
 Description TEXT, ParentCategoryID INTEGER REFERENCES CATEGORIES(CategoryID)
);
CREATE TABLE IF NOT EXISTS SUPPLIERS (
 SupplierID INTEGER PRIMARY KEY, SupplierName TEXT NOT NULL,
 ContactEmail TEXT, Phone TEXT, Address TEXT
);
CREATE TABLE IF NOT EXISTS PRODUCTS (
 ProductID INTEGER PRIMARY KEY,
 ProductName TEXT NOT NULL, Description TEXT NOT NULL,
 Price INTEGER NOT NULL CHECK (typeof(Price) = 'integer' AND Price >= 0),
 StockQty INTEGER NOT NULL CHECK (typeof(StockQty) = 'integer' AND StockQty >= 0),
 ImageURL TEXT NOT NULL,
 CategoryID INTEGER NOT NULL REFERENCES CATEGORIES(CategoryID),
 SupplierID INTEGER REFERENCES SUPPLIERS(SupplierID),
 Featured INTEGER NOT NULL DEFAULT 0 CHECK (Featured IN (0,1)),
 Tag TEXT NOT NULL DEFAULT 'New arrival',
 Active INTEGER NOT NULL DEFAULT 1 CHECK (Active IN (0,1))
);
CREATE TABLE IF NOT EXISTS SHOPPING_CART (
 CartID INTEGER PRIMARY KEY,
 CustomerID INTEGER NOT NULL UNIQUE REFERENCES CUSTOMERS(CustomerID),
 CartDate TEXT NOT NULL, Status TEXT NOT NULL DEFAULT 'Active'
 CHECK (Status IN ('Active','CheckedOut'))
);
CREATE TABLE IF NOT EXISTS CART_ITEMS (
 CartItemID INTEGER PRIMARY KEY,
 CartID INTEGER NOT NULL REFERENCES SHOPPING_CART(CartID),
 ProductID INTEGER NOT NULL REFERENCES PRODUCTS(ProductID),
 Quantity INTEGER NOT NULL CHECK (typeof(Quantity) = 'integer' AND Quantity > 0),
 AddedDate TEXT NOT NULL,
 UnitPrice INTEGER NOT NULL CHECK (typeof(UnitPrice) = 'integer' AND UnitPrice >= 0),
 UNIQUE (CartID,ProductID)
);
CREATE TABLE IF NOT EXISTS ORDERS (
 OrderID INTEGER PRIMARY KEY AUTOINCREMENT,
 CustomerID INTEGER NOT NULL REFERENCES CUSTOMERS(CustomerID),
 OrderDate TEXT NOT NULL,
 TotalAmount INTEGER NOT NULL CHECK (typeof(TotalAmount) = 'integer' AND TotalAmount >= 0),
 OrderStatus TEXT NOT NULL CHECK (OrderStatus IN ('Placed','Paid','Shipped','Delivered','Cancelled')),
 ShippingAddress TEXT NOT NULL,
 CheckoutKey TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS ORDER_ITEMS (
 OrderItemID INTEGER PRIMARY KEY,
 OrderID INTEGER NOT NULL REFERENCES ORDERS(OrderID),
 ProductID INTEGER NOT NULL REFERENCES PRODUCTS(ProductID),
 Quantity INTEGER NOT NULL CHECK (typeof(Quantity) = 'integer' AND Quantity > 0),
 UnitPrice INTEGER NOT NULL CHECK (typeof(UnitPrice) = 'integer' AND UnitPrice >= 0),
 Discount INTEGER NOT NULL DEFAULT 0
 CHECK (typeof(Discount) = 'integer' AND Discount >= 0 AND Discount <= Quantity * UnitPrice),
 UNIQUE (OrderID,ProductID)
);
CREATE TABLE IF NOT EXISTS PAYMENTS (
 PaymentID INTEGER PRIMARY KEY,
 OrderID INTEGER NOT NULL REFERENCES ORDERS(OrderID),
 PaymentDate TEXT NOT NULL,
 Amount INTEGER NOT NULL CHECK (typeof(Amount) = 'integer' AND Amount > 0),
 PaymentMethod TEXT NOT NULL,
 PaymentStatus TEXT NOT NULL CHECK (PaymentStatus IN ('Pending','Success','Failed','Refunded')),
 TransactionID TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS SESSIONS (
 TokenHash TEXT PRIMARY KEY,
 CustomerID INTEGER NOT NULL REFERENCES CUSTOMERS(CustomerID),
 ExpiresAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_category ON PRODUCTS(CategoryID);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON ORDERS(CustomerID);
CREATE INDEX IF NOT EXISTS idx_payments_order ON PAYMENTS(OrderID);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON SESSIONS(ExpiresAt);

CREATE VIEW IF NOT EXISTS OrderSummary AS
 SELECT o.OrderID, c.CustomerName, o.OrderStatus,
 o.TotalAmount / 100.0 AS TotalINR,
 COALESCE(SUM(CASE WHEN p.PaymentStatus = 'Success' THEN p.Amount ELSE 0 END),0) / 100.0 AS AmountPaidINR
 FROM ORDERS o JOIN CUSTOMERS c ON c.CustomerID = o.CustomerID
 LEFT JOIN PAYMENTS p ON p.OrderID = o.OrderID
 GROUP BY o.OrderID,c.CustomerName,o.OrderStatus,o.TotalAmount;

CREATE TRIGGER IF NOT EXISTS CheckStock
 BEFORE INSERT ON ORDER_ITEMS FOR EACH ROW
 WHEN NEW.Quantity > (SELECT StockQty FROM PRODUCTS WHERE ProductID = NEW.ProductID)
 BEGIN SELECT RAISE(ABORT,'Insufficient stock'); END;
CREATE TRIGGER IF NOT EXISTS ReduceStock
 AFTER INSERT ON ORDER_ITEMS FOR EACH ROW
 BEGIN
 UPDATE PRODUCTS SET StockQty = StockQty - NEW.Quantity WHERE ProductID = NEW.ProductID;
 END;
CREATE TRIGGER IF NOT EXISTS RestoreCancelledStock
 AFTER UPDATE OF OrderStatus ON ORDERS FOR EACH ROW
 WHEN NEW.OrderStatus = 'Cancelled' AND OLD.OrderStatus != 'Cancelled'
 BEGIN
 UPDATE PRODUCTS SET StockQty = StockQty +
 (SELECT Quantity FROM ORDER_ITEMS WHERE OrderID = NEW.OrderID AND ProductID = PRODUCTS.ProductID)
 WHERE ProductID IN (SELECT ProductID FROM ORDER_ITEMS WHERE OrderID = NEW.OrderID);
 END;
