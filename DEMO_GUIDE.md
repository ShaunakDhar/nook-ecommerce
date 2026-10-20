# Tomorrow's demonstration

## Before presenting

Open **start.cmd** and keep its server window open. Open **http://localhost:4173**. Sign out of any account left over from practice. Keep this guide open beside your slides.

For a clean baseline, sign in using **Admin demo**, choose **Restore demo data** at the bottom of the workspace sidebar, and type **RESET**. This deletes practice changes and signs you out. Never use it after adding records you want to preserve.

Baseline facts: 12 catalog products, 9 core tables, 2 sample orders, INR 1,700 successful demo payments, and stock 19 / 29 / 48 for keyboard / mouse / notebook.

## Suggested 7 to 10 minute sequence

### 1. Explain the project

“Our project is an e-commerce inventory and order processing system. The frontend has a customer storefront and an admin workspace. The Node.js backend stores all records in SQLite. It works offline on this laptop.”

Browse the collection, search for a product, change the category, and open a product detail dialog. Clear the filters before moving on.

### 2. Sign in as a customer

Open **Sign in** and choose **Customer demo**. This logs in as Asha. Her seeded bag contains one keyboard and two notebooks, totaling INR 1,400. Add or remove a product and change a quantity. Explain that carts do not reserve stock.

### 3. Demonstrate rollback

Open the bag and continue to checkout. Keep the seeded address or enter a fictional demonstration address. Select **Declined payment — demonstrate rollback**, then **Place demo order**.

Show the decline message. Explain: “The backend inserted the order and its lines inside a transaction, and the stock triggers ran. The simulated decline then caused a rollback. No order stayed in the database, stock did not change, and the cart remained.”

### 4. Complete checkout

Change the simulation to **Successful payment** and submit again. Show the saved order number, receipt, amount, address, and payment reference. Open **My orders** to show the progress timeline.

Explain that the checkout uses current prices from the database, checks stock again, commits all records together, and clears the cart only after success.

### 5. Open the admin workspace

Open the account button, sign out, then choose **Admin demo** from the sign-in dialog. The admin dashboard shows the new order and updated receipt total.

Open **Products** and show that keyboard and notebook stock fell. Edit a low-stock product to replenish inventory. Open **Orders**, mark a paid order as shipped, then delivered. Explain that pending orders cannot be shipped.

### 6. Show the database concepts

Open **Database explorer**. Select CUSTOMERS, PRODUCTS, ORDERS, ORDER_ITEMS, and PAYMENTS. Point out primary keys and foreign keys. Password hashes stay redacted. Show the view, indexes, and trigger definitions below the records.

Open **SQL laboratory** and run:

1. **Order details** for a multi-table JOIN.
2. **Customer order totals** for COUNT, SUM, GROUP BY, and LEFT JOIN.
3. **Above average prices** for a subquery using AVG.
4. **Payment summary view** for OrderSummary.
5. **LineTotal function** for the SQL function registered by the backend.
6. **Foreign key integrity** to show no violations.

Click **Demonstrate rollback**. Show the before, temporary, and final stock values. Explain that SQLite uses application routines rather than SQL stored procedures.

### 7. Optional cancellation and pending payment demonstration

As a customer, create an order using **Pending payment**, then open **My orders** and complete its demo payment. Alternatively, cancel an unshipped paid order. Show that its stock returns and the payment becomes Refunded. A repeated cancellation cannot restore stock twice.

### 8. Close with results

“We implemented the nine core entities and demonstrated real database operations through the UI. The project handles cart changes, inventory validation, order history, payment status, and transaction rollback. The 12 integration tests cover the main workflows, including persistence and competing stock requests. A real gateway and production deployment are future work.”

## Likely viva questions

**Where is the database?**  
In `data/nook.sqlite`. It is a persistent local SQLite file, created and seeded automatically.

**What is the frontend?**  
HTML, CSS, and browser JavaScript. It calls the backend through JSON HTTP endpoints.

**What is the backend?**  
Node.js with built-in HTTP, crypto, and SQLite modules. `server.mjs` defines the API. `src/database.mjs` initializes data and reporting queries.

**Why store money in paise?**  
Integer minor units avoid floating point rounding during totals. INR 1,200 is stored as 120000 paise. The UI converts it for display.

**What does the stock trigger do?**  
CheckStock rejects an order item whose quantity exceeds inventory. ReduceStock subtracts stock after insertion. RestoreCancelledStock restores the items when an order first becomes Cancelled.

**What prevents overselling?**  
Checkout starts with BEGIN IMMEDIATE, rechecks current stock, and inserts order lines within the transaction. The trigger rejects insufficient quantities. Failed transactions roll back. The integration test submits two competing requests for one remaining item and verifies that only one succeeds.

**How are passwords stored?**  
As salted scrypt hashes. Browser sessions use random tokens in HttpOnly cookies. The database stores only token hashes.

**Can one customer view another customer's order?**  
No. The backend checks the session's customer ID when loading carts or orders. An unmatched order returns 404. Admin routes separately require the admin role.

**What changed from the report?**  
The nine core entities remain. The app adds real authentication and a SESSIONS support table, a supplier-product reference, integer paise, a unique checkout key, and cancellation stock restoration. The catalog expands to 12 sample products. These refinements are documented in README.md.

**Are payments real?**  
No. The API simulates successful, pending, and declined outcomes so we can demonstrate database behavior without a payment provider.

**What happens if checkout is submitted again?**  
A unique checkout key identifies an already completed order. Retrying the same key returns that order and avoids another stock deduction.

## Quick recovery

- If the page cannot connect, check that the server window is still open, then reopen start.cmd.
- If it says the port is occupied, try the existing http://localhost:4173 tab.
- If an account session expired, use the demo sign-in buttons again.
- If a product is out of stock, replenish it in Admin → Products.
- To restore the original sample state, use Admin → Restore demo data and type RESET. This removes practice data.
- Keep a copy of the whole project folder. No internet or dependency download is needed on this laptop.
