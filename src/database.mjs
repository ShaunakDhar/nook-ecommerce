import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './auth.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const CORE_TABLES = ['CUSTOMERS','CATEGORIES','PRODUCTS','SUPPLIERS','SHOPPING_CART','CART_ITEMS','ORDERS','ORDER_ITEMS','PAYMENTS'];
export const today = () => new Date().toISOString();
export const SCHEMA = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const value = fn(); db.exec('COMMIT'); return value; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
export function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename, { timeout: 5000 });
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  db.function('LineTotal', { deterministic: true }, (q,p,d) => q*p-d);
  if (!db.prepare('SELECT COUNT(*) AS n FROM CUSTOMERS').get().n) transaction(db, () => seed(db));
  return db;
}

export function seed(db) {
  const insert = (sql, rows) => { const statement = db.prepare(sql); rows.forEach(row => statement.run(...row)); };
  insert('INSERT INTO CUSTOMERS (CustomerID, CustomerName, Email, PasswordHash, Phone, Address, RegistrationDate, Role) VALUES (?,?,?,?,?,?,?,?)', [
    [1,'Asha Rao','asha@example.com',hashPassword('Demo@123'),'9000000001','24 Lake View Road, Chennai, Tamil Nadu 600001',today(),'customer'],
    [2,'Ravi Shah','ravi@example.com',hashPassword('Demo@123'),'9000000002','18 Park Lane, Pune, Maharashtra 411001',today(),'customer'],
    [3,'Store Admin','admin@nook.local',hashPassword('Admin@123'),'9000000003','Nook Operations, Chennai',today(),'admin']
  ]);
  insert('INSERT INTO CATEGORIES VALUES (?,?,?,?)',[[1,'Electronics','Tools for your everyday setup',null],[2,'Stationery','Make room for your next idea',null],[3,'Lifestyle','Good things for your daily routine',null]]);
  insert('INSERT INTO SUPPLIERS VALUES (?,?,?,?,?)',[[1,'Metro Supplies','metro@example.com','9000000011','Chennai'],[2,'Paper & Form','hello@paper.example','9000000012','Pune'],[3,'Everyday Goods','supply@everyday.example','9000000013','Bengaluru']]);
  insert('INSERT INTO PRODUCTS (ProductID,ProductName,Description,Price,StockQty,ImageURL,CategoryID,SupplierID,Featured,Tag,Active) VALUES (?,?,?,?,?,?,?,?,?,?,1)',[
    [101,'Studio Keyboard','A compact mechanical keyboard with tactile keys and a comfortable layout. Your desk, a little more considered.',120000,20,'keyboard',1,1,1,'Bestseller'],
    [102,'Pebble Mouse','A quiet, lightweight wireless mouse with a smooth matte finish. Made for the way you work.',60000,30,'mouse',1,1,1,'Everyday essential'],
    [103,'Daily Notebook','A hardbound ruled notebook with 160 pages. A home for your notes, plans, and half-formed ideas.',10000,50,'notebook',2,2,1,'Good on paper'],
    [104,'Arc Headphones','Cushioned over-ear headphones with a clean, balanced sound. A little space to focus.',249900,12,'headphones',1,1,1,'Fresh find'],
    [105,'Beam Desk Lamp','An adjustable desk lamp with a warm glow and a small footprint. For late-night ideas and early starts.',149900,8,'lamp',3,3,1,'Desk favorite'],
    [106,'Weekday Backpack','A lightweight everyday backpack with a padded laptop sleeve and thoughtful compartments.',189900,15,'backpack',3,3,0,'On the move'],
    [107,'Loop Water Bottle','A reusable 750 ml stainless steel bottle with a secure lid. Keep it close, wherever the day takes you.',69900,24,'bottle',3,3,0,'Take it along'],
    [108,'Fine Point Pen Set','Five smooth-writing fine point pens in a reusable sleeve. Small tools for big ideas.',24900,35,'pens',2,2,0,'Set of five'],
    [109,'Wave Mini Speaker','A portable Bluetooth speaker for your desk or weekend bag. Compact design, easy listening.',129900,4,'speaker',1,1,0,'Low stock'],
    [110,'Desk Organizer','A simple organizer that gives your pens, notes, and small essentials a place to belong.',44900,18,'organizer',2,2,0,'A clearer desk'],
    [111,'Canvas Tote','A sturdy cotton tote with a roomy interior. Ready for class, the market, or wherever is next.',39900,21,'tote',3,3,0,'Carry less plastic'],
    [112,'Pocket Planner','A compact undated planner with weekly layouts. Make a little room for what matters.',19900,0,'planner',2,2,0,'Back soon']
  ]);
  insert('INSERT INTO SHOPPING_CART (CartID,CustomerID,CartDate,Status) VALUES (?,?,?,?)',[[1,1,today(),'Active'],[2,2,today(),'Active'],[3,3,today(),'Active']]);
  insert('INSERT INTO CART_ITEMS (CartID,ProductID,Quantity,AddedDate,UnitPrice) VALUES (?,?,?,?,?)',[[1,101,1,today(),120000],[1,103,2,today(),10000]]);
  const day = days => new Date(Date.now()-days*86400000).toISOString();
  insert('INSERT INTO ORDERS (OrderID,CustomerID,OrderDate,TotalAmount,OrderStatus,ShippingAddress,CheckoutKey) VALUES (?,?,?,?,?,?,?)',[
    [1001,1,day(2),170000,'Paid','24 Lake View Road, Chennai, Tamil Nadu 600001','seed-1001'],
    [1002,2,day(1),20000,'Placed','18 Park Lane, Pune, Maharashtra 411001','seed-1002']
  ]);
  insert('INSERT INTO ORDER_ITEMS (OrderID,ProductID,Quantity,UnitPrice,Discount) VALUES (?,?,?,?,?)',[[1001,101,1,120000,0],[1001,102,1,60000,10000],[1002,103,2,10000,0]]);
  insert('INSERT INTO PAYMENTS (OrderID,PaymentDate,Amount,PaymentMethod,PaymentStatus,TransactionID) VALUES (?,?,?,?,?,?)',[[1001,day(2),170000,'UPI','Success','DEMO-TXN-1001'],[1002,day(1),20000,'Pay later','Pending','DEMO-TXN-1002']]);
}

export const LAB_QUERIES = [
  {id:'inventory',title:'Product inventory',description:'SELECT with category JOIN, filtering and sorting.',sql:`SELECT p.ProductID, p.ProductName, c.CategoryName, p.Price / 100.0 AS PriceINR, p.StockQty FROM PRODUCTS p JOIN CATEGORIES c ON c.CategoryID = p.CategoryID WHERE p.Active = 1 ORDER BY p.ProductID;`},
  {id:'orders',title:'Order details',description:'JOIN connects orders, customers, and purchased items.',sql:`SELECT o.OrderID, c.CustomerName, p.ProductName, oi.Quantity, LineTotal(oi.Quantity, oi.UnitPrice, oi.Discount) / 100.0 AS LineTotalINR FROM ORDERS o JOIN CUSTOMERS c ON c.CustomerID = o.CustomerID JOIN ORDER_ITEMS oi ON oi.OrderID = o.OrderID JOIN PRODUCTS p ON p.ProductID = oi.ProductID ORDER BY o.OrderID, oi.OrderItemID;`},
  {id:'revenue',title:'Customer order totals',description:'COUNT and SUM group orders by customer. Cancelled orders are excluded.',sql:`SELECT c.CustomerName, COUNT(o.OrderID) AS OrderCount, COALESCE(SUM(o.TotalAmount),0) / 100.0 AS OrderValueINR FROM CUSTOMERS c LEFT JOIN ORDERS o ON o.CustomerID = c.CustomerID AND o.OrderStatus != 'Cancelled' GROUP BY c.CustomerID ORDER BY OrderValueINR DESC;`},
  {id:'subquery',title:'Above average prices',description:'A subquery compares each product price with AVG.',sql:`SELECT ProductName, Price / 100.0 AS PriceINR FROM PRODUCTS WHERE Active = 1 AND Price > (SELECT AVG(Price) FROM PRODUCTS WHERE Active = 1) ORDER BY Price DESC;`},
  {id:'view',title:'Payment summary view',description:'A view aggregates successful payments for each order.',sql:'SELECT * FROM OrderSummary ORDER BY OrderID DESC;'},
  {id:'low-stock',title:'Low stock report',description:'Products with five units or fewer need replenishment.',sql:'SELECT ProductID, ProductName, StockQty FROM PRODUCTS WHERE Active = 1 AND StockQty <= 5 ORDER BY StockQty, ProductID;'},
  {id:'integrity',title:'Foreign key integrity',description:'An empty result means no foreign key violations.',sql:'PRAGMA foreign_key_check;'},
  {id:'function',title:'LineTotal function',description:'A deterministic function calculates a discounted line in integer paise.',sql:'SELECT LineTotal(1,60000,10000) AS TotalPaise, LineTotal(1,60000,10000) / 100.0 AS TotalINR;'}
];
