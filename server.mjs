import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openDatabase, transaction, seed, today, CORE_TABLES, LAB_QUERIES } from './src/database.mjs';
import { hashPassword, verifyPassword, newToken, tokenHash, publicUser, userFields } from './src/auth.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
class HttpError extends Error { constructor(status,message) { super(message); this.status = status; } }
const fail = (status,message) => { throw new HttpError(status,message); };
const str = (value,label,min=1,max=200) => {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(400,`${label} must contain ${min}–${max} characters.`);
  return value.trim();
};
const integer = (value,label,min=0,max=1000000) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(400,`${label} must be a whole number between ${min} and ${max}.`);
  return value;
};
const email = value => { const e = str(value,'Email',3,160).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) fail(400,'Enter a valid email address.'); return e; };
const password = value => { if (typeof value !== 'string' || value.length < 8 || value.length > 128) fail(400,'Password must contain 8–128 characters.'); return value; };
const cookie = token => `nook_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`;
const cookieToken = req => (req.headers.cookie || '').match(/(?:^|;\s*)nook_session=([a-f0-9]{64})/)?.[1];
const ASSETS = ['keyboard','mouse','notebook','headphones','lamp','backpack','bottle','pens','speaker','organizer','tote','planner'];

export function createApplication({databasePath=process.env.DB_PATH || path.join(ROOT,'data/nook.sqlite')}={}) {
  const db = openDatabase(databasePath);
  const attempts = new Map();
  const dummyHash = hashPassword('random-unusable-password');
  const all = (sql,...args) => db.prepare(sql).all(...args);
  const get = (sql,...args) => db.prepare(sql).get(...args);
  const run = (sql,...args) => db.prepare(sql).run(...args);
  const productSQL = `SELECT p.*, c.CategoryName, s.SupplierName FROM PRODUCTS p JOIN CATEGORIES c ON c.CategoryID=p.CategoryID LEFT JOIN SUPPLIERS s ON s.SupplierID=p.SupplierID`;
  const product = p => ({id:p.ProductID,name:p.ProductName,description:p.Description,price:p.Price,stock:p.StockQty,image:p.ImageURL,categoryId:p.CategoryID,category:p.CategoryName,supplierId:p.SupplierID,supplier:p.SupplierName,featured:!!p.Featured,tag:p.Tag,active:!!p.Active});
  const findProduct = id => { const p = get(`${productSQL} WHERE p.ProductID=?`,id); if (!p) fail(404,'Product not found.'); return p; };
  const cartId = uid => get('SELECT CartID FROM SHOPPING_CART WHERE CustomerID=?',uid).CartID;
  function cart(uid) {
    const items = all(`SELECT ci.CartItemID AS id, ci.Quantity AS quantity, p.ProductID AS productId, p.ProductName AS name, p.Price AS price, p.StockQty AS stock, p.ImageURL AS image, p.Active AS active FROM CART_ITEMS ci JOIN PRODUCTS p ON p.ProductID=ci.ProductID WHERE ci.CartID=? ORDER BY ci.CartItemID`,cartId(uid));
    return {items,total:items.reduce((sum,i)=>sum+i.price*i.quantity,0),count:items.reduce((sum,i)=>sum+i.quantity,0)};
  }
  function order(id, uid=null) {
    const o = get(`SELECT o.*,c.CustomerName,c.Email FROM ORDERS o JOIN CUSTOMERS c ON c.CustomerID=o.CustomerID WHERE o.OrderID=?`,id);
    if (!o || (uid !== null && o.CustomerID !== uid)) fail(404,'Order not found.');
    return {id:o.OrderID,customerId:o.CustomerID,customer:o.CustomerName,email:o.Email,date:o.OrderDate,total:o.TotalAmount,status:o.OrderStatus,address:o.ShippingAddress,
      items:all(`SELECT oi.OrderItemID AS id,oi.ProductID AS productId,p.ProductName AS name,p.ImageURL AS image,oi.Quantity AS quantity,oi.UnitPrice AS price,oi.Discount AS discount,LineTotal(oi.Quantity,oi.UnitPrice,oi.Discount) AS total FROM ORDER_ITEMS oi JOIN PRODUCTS p ON p.ProductID=oi.ProductID WHERE oi.OrderID=?`,id),
      payments:all('SELECT PaymentID AS id,PaymentDate AS date,Amount AS amount,PaymentMethod AS method,PaymentStatus AS status,TransactionID AS transactionId FROM PAYMENTS WHERE OrderID=? ORDER BY PaymentID',id)};
  }
  function user(req, admin=false) {
    const token=cookieToken(req);
    const session=token && get('SELECT CustomerID FROM SESSIONS WHERE TokenHash=? AND ExpiresAt>?',tokenHash(token),Date.now());
    if (!session) fail(401,'Please sign in to continue.');
    const u=publicUser(db,session.CustomerID);
    if (admin && u.role!=='admin') fail(403,'This area is for store administrators.');
    return u;
  }
  function signIn(res,uid) {
    const token=newToken();
    run('DELETE FROM SESSIONS WHERE ExpiresAt<=?',Date.now());
    run('INSERT INTO SESSIONS VALUES (?,?,?)',tokenHash(token),uid,Date.now()+43200000);
    res.setHeader('Set-Cookie',cookie(token));return {user:publicUser(db,uid)};
  }
  const routes=[];
  function route(method,pattern,handler){routes.push({method,pattern:new RegExp(`^${pattern}$`),handler});}
  route('GET','/api/health',()=>({ok:true,application:'Nook',database:'SQLite',mode:'local demo'}));
  route('GET','/api/catalog',()=>({products:all(`${productSQL} WHERE p.Active=1 ORDER BY p.Featured DESC,p.ProductID`).map(product),categories:all('SELECT CategoryID AS id,CategoryName AS name,Description AS description FROM CATEGORIES ORDER BY CategoryID')}));
  route('GET','/api/session',({req})=>{try{return {user:user(req)}}catch(e){if(e.status===401)return {user:null};throw e;}});
  route('POST','/api/auth/login',({req,res,body})=>{
    const e=email(body.email);const pass=password(body.password);const key=req.socket.remoteAddress;
    const previous=attempts.get(key);const a=previous && previous.until>Date.now()?previous:{count:0,until:Date.now()+60000};
    if(a.count>=20)fail(429,'Too many sign-in attempts. Please wait one minute.');
    const u=get('SELECT CustomerID,PasswordHash FROM CUSTOMERS WHERE Email=?',e);
    if(!verifyPassword(pass,u?.PasswordHash || dummyHash)){a.count++;attempts.set(key,a);fail(401,'Email or password is incorrect.');}
    attempts.delete(key);
    const old=cookieToken(req);if(old)run('DELETE FROM SESSIONS WHERE TokenHash=?',tokenHash(old));
    return signIn(res,u.CustomerID);
  });
  route('POST','/api/auth/register',({req,res,body})=>{
    const name=str(body.name,'Name',2,80),e=email(body.email),pass=password(body.password),address=str(body.address||'Not supplied','Address',1,500);
    if(get('SELECT CustomerID FROM CUSTOMERS WHERE Email=?',e))fail(409,'An account with this email already exists.');
    const id=transaction(db,()=>{
      const id=Number(run("INSERT INTO CUSTOMERS (CustomerName,Email,PasswordHash,Phone,Address,RegistrationDate,Role) VALUES (?,?,?,?,?,?,'customer')",name,e,hashPassword(pass),'',address,today()).lastInsertRowid);
      run("INSERT INTO SHOPPING_CART (CustomerID,CartDate,Status) VALUES (?,?,'Active')",id,today());return id;
    });
    const old=cookieToken(req);if(old)run('DELETE FROM SESSIONS WHERE TokenHash=?',tokenHash(old));
    return signIn(res,id);
  });
  route('POST','/api/auth/logout',({req,res})=>{const token=cookieToken(req);if(token)run('DELETE FROM SESSIONS WHERE TokenHash=?',tokenHash(token));res.setHeader('Set-Cookie','nook_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return {ok:true};});
  route('PUT','/api/profile',({req,body})=>{const u=user(req);run('UPDATE CUSTOMERS SET CustomerName=?,Phone=?,Address=? WHERE CustomerID=?',str(body.name,'Name',2,80),str(body.phone||'Not supplied','Phone',1,30),str(body.address,'Address',10,500),u.id);return {user:publicUser(db,u.id)};});
  route('GET','/api/cart',({req})=>cart(user(req).id));
  route('POST','/api/cart/items',({req,body})=>{
    const u=user(req),pid=integer(body.productId,'Product ID',1),qty=integer(body.quantity??1,'Quantity',1,99),p=findProduct(pid);
    if(!p.Active)fail(409,'This product is no longer available.');
    const cid=cartId(u.id),old=get('SELECT Quantity FROM CART_ITEMS WHERE CartID=? AND ProductID=?',cid,pid);const quantity=(old?.Quantity||0)+qty;
    if(quantity>99 || quantity>p.StockQty)fail(409,`Only ${p.StockQty} units are available.`);
    run('INSERT INTO CART_ITEMS (CartID,ProductID,Quantity,AddedDate,UnitPrice) VALUES (?,?,?,?,?) ON CONFLICT(CartID,ProductID) DO UPDATE SET Quantity=excluded.Quantity,UnitPrice=excluded.UnitPrice',cid,pid,quantity,today(),p.Price);return cart(u.id);
  });
  route('PUT','/api/cart/items/(\\d+)',({req,body,params})=>{
    const u=user(req),id=Number(params[0]),qty=integer(body.quantity,'Quantity',1,99);
    const item=get('SELECT ProductID FROM CART_ITEMS WHERE CartItemID=? AND CartID=?',id,cartId(u.id));if(!item)fail(404,'Cart item not found.');
    const p=findProduct(item.ProductID);if(!p.Active || qty>p.StockQty)fail(409,`Only ${p.StockQty} units are available.`);
    run('UPDATE CART_ITEMS SET Quantity=?,UnitPrice=? WHERE CartItemID=?',qty,p.Price,id);return cart(u.id);
  });
  route('DELETE','/api/cart/items/(\\d+)',({req,params})=>{const u=user(req);const r=run('DELETE FROM CART_ITEMS WHERE CartItemID=? AND CartID=?',Number(params[0]),cartId(u.id));if(!r.changes)fail(404,'Cart item not found.');return cart(u.id);});
  route('POST','/api/checkout',({req,body})=>{
    const u=user(req),address=str(body.address,'Shipping address',10,500),key=str(body.key,'Checkout key',16,100);
    if(!['UPI','Card','Pay later'].includes(body.method))fail(400,'Choose a payment method.');
    if(!['success','pending','failure'].includes(body.outcome))fail(400,'Choose a simulation outcome.');
    const prior=get('SELECT OrderID,CustomerID FROM ORDERS WHERE CheckoutKey=?',key);
    if(prior){if(prior.CustomerID!==u.id)fail(409,'Checkout key already used.');return {order:order(prior.OrderID,u.id),replayed:true};}
    const id=transaction(db,()=>{
      const basket=cart(u.id);if(!basket.items.length)fail(400,'Your bag is empty. Add a product first.');
      for(const item of basket.items){if(!item.active)fail(409,`${item.name} is no longer available.`);if(item.quantity>item.stock)fail(409,`Only ${item.stock} units of ${item.name} are available.`);}
      const isPending=body.method==='Pay later'||body.outcome==='pending';
      const id=Number(run('INSERT INTO ORDERS (CustomerID,OrderDate,TotalAmount,OrderStatus,ShippingAddress,CheckoutKey) VALUES (?,?,?,?,?,?)',u.id,today(),basket.total,isPending?'Placed':'Paid',address,key).lastInsertRowid);
      basket.items.forEach(i=>run('INSERT INTO ORDER_ITEMS (OrderID,ProductID,Quantity,UnitPrice,Discount) VALUES (?,?,?,?,0)',id,i.productId,i.quantity,i.price));
      // A declined simulated payment exercises rollback after stock triggers ran.
      if(body.outcome==='failure')fail(402,'Demo payment declined. The entire checkout was rolled back. Your bag and inventory are unchanged.');
      run('INSERT INTO PAYMENTS (OrderID,PaymentDate,Amount,PaymentMethod,PaymentStatus,TransactionID) VALUES (?,?,?,?,?,?)',id,today(),basket.total,body.method,isPending?'Pending':'Success',`DEMO-${randomUUID()}`);
      run('DELETE FROM CART_ITEMS WHERE CartID=?',cartId(u.id));
      run('UPDATE CUSTOMERS SET Address=? WHERE CustomerID=?',address,u.id);
      return id;
    });
    return {order:order(id,u.id),replayed:false};
  });
  route('GET','/api/orders',({req})=>{const u=user(req);return {orders:all('SELECT OrderID FROM ORDERS WHERE CustomerID=? ORDER BY OrderID DESC',u.id).map(o=>order(o.OrderID,u.id))};});
  route('GET','/api/orders/(\\d+)',({req,params})=>({order:order(Number(params[0]),user(req).id)}));
  route('POST','/api/orders/(\\d+)/cancel',({req,params})=>{
    const u=user(req),id=Number(params[0]),o=order(id,u.id);
    if(o.status==='Cancelled')return {order:o};
    if(!['Placed','Paid'].includes(o.status))fail(409,'Only orders awaiting shipment can be cancelled.');
    transaction(db,()=>{run("UPDATE ORDERS SET OrderStatus='Cancelled' WHERE OrderID=?",id);run("UPDATE PAYMENTS SET PaymentStatus=CASE WHEN PaymentStatus='Success' THEN 'Refunded' WHEN PaymentStatus='Pending' THEN 'Failed' ELSE PaymentStatus END WHERE OrderID=?",id);});
    return {order:order(id,u.id)};
  });
  route('POST','/api/orders/(\\d+)/pay',({req,params,body})=>{
    const u=user(req),id=Number(params[0]),o=order(id,u.id);if(o.status!=='Placed')fail(409,'This order is not awaiting payment.');
    if(body.outcome==='failure')fail(402,'Demo payment declined. No changes were saved.');
    if(body.outcome!=='success')fail(400,'Choose a simulation outcome.');
    transaction(db,()=>{run("UPDATE PAYMENTS SET PaymentStatus='Success',PaymentMethod='Demo UPI',PaymentDate=? WHERE OrderID=? AND PaymentStatus='Pending'",today(),id);run("UPDATE ORDERS SET OrderStatus='Paid' WHERE OrderID=?",id);});return {order:order(id,u.id)};
  });
  route('GET','/api/admin/overview',({req})=>{
    user(req,true);
    return {stats:{revenue:get("SELECT COALESCE(SUM(Amount),0) AS n FROM PAYMENTS WHERE PaymentStatus='Success'").n,orders:get("SELECT COUNT(*) AS n FROM ORDERS WHERE OrderStatus!='Cancelled'").n,customers:get("SELECT COUNT(*) AS n FROM CUSTOMERS WHERE Role='customer'").n,lowStock:get('SELECT COUNT(*) AS n FROM PRODUCTS WHERE Active=1 AND StockQty<=5').n},
      recent:all('SELECT OrderID FROM ORDERS ORDER BY OrderID DESC LIMIT 6').map(o=>order(o.OrderID)),lowStock:all(`${productSQL} WHERE p.Active=1 AND p.StockQty<=5 ORDER BY p.StockQty`).map(product),
      categorySales:all("SELECT c.CategoryName AS category, COALESCE(SUM(CASE WHEN o.OrderStatus!='Cancelled' THEN oi.Quantity*oi.UnitPrice-oi.Discount ELSE 0 END),0) AS value FROM CATEGORIES c LEFT JOIN PRODUCTS p ON p.CategoryID=c.CategoryID LEFT JOIN ORDER_ITEMS oi ON oi.ProductID=p.ProductID LEFT JOIN ORDERS o ON o.OrderID=oi.OrderID GROUP BY c.CategoryID")};
  });
  route('GET','/api/admin/products',({req})=>{user(req,true);return {products:all(`${productSQL} ORDER BY p.ProductID`).map(product),categories:all('SELECT CategoryID AS id,CategoryName AS name FROM CATEGORIES'),suppliers:all('SELECT SupplierID AS id,SupplierName AS name FROM SUPPLIERS')};});
  function productValues(b){
    const name=str(b.name,'Product name',2,80),description=str(b.description,'Description',10,1000),price=integer(b.price,'Price in paise',1,100000000),stock=integer(b.stock,'Stock',0,100000),cid=integer(b.categoryId,'Category',1),sid=integer(b.supplierId,'Supplier',1);
    if(!ASSETS.includes(b.image))fail(400,'Choose a product illustration.');
    if(!get('SELECT CategoryID FROM CATEGORIES WHERE CategoryID=?',cid)||!get('SELECT SupplierID FROM SUPPLIERS WHERE SupplierID=?',sid))fail(400,'Category or supplier does not exist.');
    return [name,description,price,stock,b.image,cid,sid,b.featured?1:0,str(b.tag||'New arrival','Tag',1,40)];
  }
  route('POST','/api/admin/products',({req,body})=>{user(req,true);const id=Number(run('INSERT INTO PRODUCTS (ProductName,Description,Price,StockQty,ImageURL,CategoryID,SupplierID,Featured,Tag) VALUES (?,?,?,?,?,?,?,?,?)',...productValues(body)).lastInsertRowid);return {product:product(findProduct(id))};});
  route('PUT','/api/admin/products/(\\d+)',({req,body,params})=>{user(req,true);const id=Number(params[0]);findProduct(id);run('UPDATE PRODUCTS SET ProductName=?,Description=?,Price=?,StockQty=?,ImageURL=?,CategoryID=?,SupplierID=?,Featured=?,Tag=?,Active=? WHERE ProductID=?',...productValues(body),body.active===false?0:1,id);return {product:product(findProduct(id))};});
  route('GET','/api/admin/orders',({req})=>{user(req,true);return {orders:all('SELECT OrderID FROM ORDERS ORDER BY OrderID DESC').map(o=>order(o.OrderID))};});
  route('PUT','/api/admin/orders/(\\d+)/status',({req,body,params})=>{
    user(req,true);const id=Number(params[0]),o=order(id);
    const transitions={Paid:['Shipped'],Shipped:['Delivered']};if(!transitions[o.status]?.includes(body.status))fail(409,'Mark a paid order as shipped, then mark a shipped order as delivered.');
    run('UPDATE ORDERS SET OrderStatus=? WHERE OrderID=?',body.status,id);return {order:order(id)};
  });
  route('GET','/api/admin/payments',({req})=>{user(req,true);return {payments:all('SELECT p.PaymentID AS id,p.OrderID AS orderId,c.CustomerName AS customer,p.Amount AS amount,p.PaymentMethod AS method,p.PaymentStatus AS status,p.TransactionID AS transactionId,p.PaymentDate AS date FROM PAYMENTS p JOIN ORDERS o ON o.OrderID=p.OrderID JOIN CUSTOMERS c ON c.CustomerID=o.CustomerID ORDER BY p.PaymentID DESC')};});
  route('GET','/api/admin/customers',({req})=>{user(req,true);return {customers:all(`SELECT ${userFields}, (SELECT COUNT(*) FROM ORDERS o WHERE o.CustomerID=CUSTOMERS.CustomerID) AS orders FROM CUSTOMERS WHERE Role='customer' ORDER BY CustomerID`)};});
  route('GET','/api/admin/suppliers',({req})=>{user(req,true);return {suppliers:all('SELECT s.*, (SELECT COUNT(*) FROM PRODUCTS p WHERE p.SupplierID=s.SupplierID) AS Products FROM SUPPLIERS s ORDER BY s.SupplierID')};});
  route('POST','/api/admin/suppliers',({req,body})=>{user(req,true);run('INSERT INTO SUPPLIERS (SupplierName,ContactEmail,Phone,Address) VALUES (?,?,?,?)',str(body.name,'Supplier name',2,80),email(body.email),str(body.phone,'Phone',5,30),str(body.address,'Address',3,300));return {ok:true};});
  route('GET','/api/admin/database',({req,url})=>{
    user(req,true);const name=url.searchParams.get('table')||'PRODUCTS';if(!CORE_TABLES.includes(name))fail(400,'Unknown project table.');
    const schema=all(`PRAGMA table_info(${name})`),foreignKeys=all(`PRAGMA foreign_key_list(${name})`);
    const columns=schema.map(c=>c.name==='PasswordHash'?"'[hidden]' AS PasswordHash":'"'+c.name+'"').join(',');
    return {tables:CORE_TABLES.map(t=>({name:t,count:get(`SELECT COUNT(*) AS n FROM ${t}`).n})),selected:name,schema,foreignKeys,createSQL:get("SELECT sql FROM sqlite_master WHERE type='table' AND name=?",name).sql,rows:all(`SELECT ${columns} FROM ${name} LIMIT 100`),objects:all("SELECT name,type,sql FROM sqlite_master WHERE type IN ('view','trigger','index') AND sql IS NOT NULL ORDER BY type,name"),moneyUnit:'All monetary columns in raw tables store integer paise. INR = paise / 100.'};
  });
  route('GET','/api/admin/lab',({req,url})=>{
    user(req,true);const q=LAB_QUERIES.find(q=>q.id===url.searchParams.get('query'))||LAB_QUERIES[0];
    return {queries:LAB_QUERIES.map(({id,title,description})=>({id,title,description})),selected:q,rows:all(q.sql).slice(0,100)};
  });
  route('POST','/api/admin/lab/rollback',({req})=>{
    user(req,true);const before=get('SELECT StockQty FROM PRODUCTS WHERE ProductID=101').StockQty;
    db.exec('SAVEPOINT demo_rollback');let during;
    try {run('UPDATE PRODUCTS SET StockQty=StockQty+10 WHERE ProductID=101');during=get('SELECT StockQty FROM PRODUCTS WHERE ProductID=101').StockQty;}
    finally{db.exec('ROLLBACK TO demo_rollback; RELEASE demo_rollback;');}
    return {before,during,after:get('SELECT StockQty FROM PRODUCTS WHERE ProductID=101').StockQty,sql:'SAVEPOINT demo_rollback;\nUPDATE PRODUCTS SET StockQty = StockQty + 10 WHERE ProductID = 101;\nROLLBACK TO demo_rollback;\nRELEASE demo_rollback;'};
  });
  route('POST','/api/admin/demo/reset',({req,res,body})=>{
    user(req,true);if(body.confirmation!=='RESET')fail(400,'Type RESET to restore demo data.');
    transaction(db,()=>{for(const name of ['SESSIONS','PAYMENTS','ORDER_ITEMS','CART_ITEMS','ORDERS','SHOPPING_CART','PRODUCTS','CATEGORIES','SUPPLIERS','CUSTOMERS'])db.exec(`DELETE FROM ${name}`);db.exec("DELETE FROM sqlite_sequence WHERE name='ORDERS'");seed(db);});
    res.setHeader('Set-Cookie','nook_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return {ok:true};
  });

  async function bodyJSON(req) {
    if(!(req.headers['content-type']||'').startsWith('application/json'))fail(415,'Use application/json.');
    const chunks=[];let n=0;for await(const chunk of req){n+=chunk.length;if(n>32768)fail(413,'Request is too large.');chunks.push(chunk);}
    try{const b=JSON.parse(Buffer.concat(chunks).toString()||'{}');if(!b||typeof b!=='object'||Array.isArray(b))fail(400,'Expected a JSON object.');return b;}catch(e){if(e.status)throw e;fail(400,'Invalid JSON.');}
  }
  const server=http.createServer(async(req,res)=>{
    const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      if(!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host||''))fail(403,'Local access only.');
      const url=new URL(req.url,'http://'+req.headers.host);
      if(url.pathname.startsWith('/api/')) {
        if(!['GET','HEAD'].includes(req.method) && req.headers.origin && req.headers.origin!==url.origin)fail(403,'Cross-origin requests are not allowed.');
        const r=routes.find(r=>r.method===req.method&&r.pattern.test(url.pathname));if(!r)fail(404,'Endpoint not found.');
        const body=['POST','PUT','PATCH','DELETE'].includes(req.method)?await bodyJSON(req):{};
        const value=r.handler({req,res,url,body,params:url.pathname.match(r.pattern).slice(1)});return send(200,value);
      }
      if(req.method!=='GET'&&req.method!=='HEAD')fail(405,'Method not allowed.');
      const name=decodeURIComponent(url.pathname);const filename=path.resolve(ROOT,'public','.'+(name==='/'?'/index.html':name));
      if(!filename.startsWith(path.join(ROOT,'public')+path.sep))fail(404,'File not found.');
      const ext=path.extname(filename);const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
      if(!types[ext]||!existsSync(filename))fail(404,'File not found.');
      const data=await readFile(filename);res.writeHead(200,{'Content-Type':types[ext],'Cache-Control':ext==='.html'?'no-store':'no-cache'});res.end(req.method==='HEAD'?undefined:data);
    }catch(e){
      let status=e.status||500,message=e.status?e.message:'Something went wrong. Please try again.';
      if(e.code?.startsWith('ERR_SQLITE')||/constraint failed|Insufficient stock/.test(e.message)){status=409;message=/Insufficient stock/.test(e.message)?'Insufficient stock. Refresh your bag and try again.':'The change conflicts with a database constraint.';}
      if(status===500)console.error(e);
      if(!res.headersSent)send(status,{error:message});else res.end();
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  return {server,db,close:()=>new Promise(resolve=>{server.close(()=>{db.close();resolve();});})};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=createApplication();const port=Number(process.env.PORT||4173);
  app.server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`Port ${port} is in use. Open http://localhost:${port}, or choose another PORT.`:e.message);app.db.close();process.exitCode=1;});
  app.server.listen(port,'127.0.0.1',()=>console.log(`\n  Nook is ready: http://localhost:${port}\n  Customer: asha@example.com / Demo@123\n  Admin: admin@nook.local / Admin@123\n  Payments are simulated. Press Ctrl+C to stop.\n`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close().then(()=>process.exit(0)));
}
