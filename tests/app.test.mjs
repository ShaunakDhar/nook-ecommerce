import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApplication } from '../server.mjs';

async function fixture(databasePath=':memory:') {
 const app=createApplication({databasePath});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port;
 function client(){let cookie='';return async function request(url,method='GET',body,extraHeaders={}){
  const res=await fetch(base+url,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(method!=='GET'?{'Content-Type':'application/json'}:{}),...extraHeaders},body:method!=='GET'?JSON.stringify(body||{}):undefined});
  const set=res.headers.get('set-cookie');if(set)cookie=set.split(';')[0];
  const data=(res.headers.get('content-type')||'').includes('application/json')?await res.json():await res.text();
  return {status:res.status,data,headers:res.headers};
 };}
 const customer=client(),admin=client(),ravi=client();
 const login=async(c,email='asha@example.com',password='Demo@123')=>assert.equal((await c('/api/auth/login','POST',{email,password})).status,200);
 return {...app,client,customer,admin,ravi,login,base};
}
async function withFixture(fn){const f=await fixture();try{await fn(f);}finally{await f.close();}}
const key=n=>'test-checkout-key-'+n;
const checkout=(n,outcome='success',method='UPI')=>({key:key(n),address:'12 Demo Street, Chennai 600001',outcome,method});

test('public catalog and static app load without exposing protected data',()=>withFixture(async f=>{
 const c=f.client();const catalog=await c('/api/catalog');assert.equal(catalog.status,200);assert.equal(catalog.data.products.length,12);
 assert.equal((await c('/api/admin/products')).status,401);assert.equal((await c('/api/cart')).status,401);
 assert.equal((await c('/')).status,200);assert.equal((await c('/assets/headphones.svg')).status,200);assert.equal((await c('/schema.sql')).status,404);
 assert.equal((await c('/api/session')).data.user,null);
}));
test('registration hashes passwords, cannot grant admin, and login/logout manage sessions',()=>withFixture(async f=>{
 const c=f.client();assert.equal((await c('/api/auth/login','POST',{email:'asha@example.com',password:'Wrong@123'})).status,401);
 const r=await c('/api/auth/register','POST',{name:'New Student',email:'student@example.com',password:'Demo@123',role:'admin'});
 assert.equal(r.status,200);assert.equal(r.data.user.role,'customer');assert.ok(!('PasswordHash' in r.data.user));
 const stored=f.db.prepare('SELECT PasswordHash FROM CUSTOMERS WHERE Email=?').get('student@example.com').PasswordHash;
 assert.notEqual(stored,'Demo@123');assert.match(stored,/^[a-f0-9]+:[a-f0-9]+$/);
 assert.equal((await c('/api/admin/overview')).status,403);
 assert.equal((await c('/api/auth/register','POST',{name:'Duplicate',email:'student@example.com',password:'Demo@123'})).status,409);
 await c('/api/auth/logout','POST');assert.equal((await c('/api/cart')).status,401);
 await f.login(c,'student@example.com');assert.equal((await c('/api/session')).data.user.email,'student@example.com');
}));
test('cart items merge, update, delete, and stay private to their owner',()=>withFixture(async f=>{
 await f.login(f.customer);await f.login(f.ravi,'ravi@example.com');
 let r=await f.customer('/api/cart/items','POST',{productId:104,quantity:1});assert.equal(r.status,200);
 r=await f.customer('/api/cart/items','POST',{productId:104,quantity:2});const item=r.data.items.find(i=>i.productId===104);assert.equal(item.quantity,3);
 assert.equal((await f.ravi(`/api/cart/items/${item.id}`,'PUT',{quantity:2})).status,404);
 assert.equal((await f.customer(`/api/cart/items/${item.id}`,'PUT',{quantity:0})).status,400);
 assert.equal((await f.customer(`/api/cart/items/${item.id}`,'PUT',{quantity:99})).status,409);
 assert.equal((await f.customer(`/api/cart/items/${item.id}`,'PUT',{quantity:2})).status,200);
 assert.equal((await f.customer(`/api/cart/items/${item.id}`,'DELETE')).status,200);
 assert.ok(!(await f.customer('/api/cart')).data.items.some(i=>i.productId===104));
 assert.equal((await f.customer('/api/cart/items','POST',{productId:112,quantity:1})).status,409);
}));
test('successful checkout commits exact totals, stock, payment, and cart clearing with idempotent retry',()=>withFixture(async f=>{
 await f.login(f.customer);await f.login(f.ravi,'ravi@example.com');
 const before=f.db.prepare('SELECT StockQty FROM PRODUCTS WHERE ProductID=101').get().StockQty;
 const r=await f.customer('/api/checkout','POST',checkout('success'));assert.equal(r.status,200);assert.equal(r.data.order.total,140000);assert.equal(r.data.order.status,'Paid');
 assert.equal(r.data.order.payments[0].status,'Success');assert.equal((await f.customer('/api/cart')).data.count,0);
 assert.equal(f.db.prepare('SELECT StockQty FROM PRODUCTS WHERE ProductID=101').get().StockQty,before-1);
 const retry=await f.customer('/api/checkout','POST',checkout('success'));assert.equal(retry.data.order.id,r.data.order.id);assert.equal(retry.data.replayed,true);
 assert.equal(f.db.prepare('SELECT StockQty FROM PRODUCTS WHERE ProductID=101').get().StockQty,before-1);
 assert.equal((await f.ravi(`/api/orders/${r.data.order.id}`)).status,404);
 assert.equal((await f.ravi('/api/checkout','POST',checkout('success'))).status,409);
}));
test('declined payment rolls back inserted order lines, stock deductions, and all other checkout writes',()=>withFixture(async f=>{
 await f.login(f.customer);const stocks=f.db.prepare('SELECT ProductID,StockQty FROM PRODUCTS ORDER BY ProductID').all();const count=f.db.prepare('SELECT COUNT(*) AS n FROM ORDERS').get().n;const basket=(await f.customer('/api/cart')).data;
 const r=await f.customer('/api/checkout','POST',checkout('failure','failure'));assert.equal(r.status,402);
 assert.deepEqual(f.db.prepare('SELECT ProductID,StockQty FROM PRODUCTS ORDER BY ProductID').all(),stocks);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ORDERS').get().n,count);assert.deepEqual((await f.customer('/api/cart')).data,basket);
 assert.equal((await f.customer('/api/checkout','POST',checkout('failure','success'))).status,200);
}));
test('competing checkouts cannot oversell the last product',()=>withFixture(async f=>{
 await f.login(f.customer);await f.login(f.ravi,'ravi@example.com');f.db.prepare('UPDATE PRODUCTS SET StockQty=1 WHERE ProductID=109').run();
 assert.equal((await f.customer('/api/cart/items','POST',{productId:109,quantity:1})).status,200);
 assert.equal((await f.ravi('/api/cart/items','POST',{productId:109,quantity:1})).status,200);
 const results=await Promise.all([f.customer('/api/checkout','POST',checkout('compete-a')),f.ravi('/api/checkout','POST',checkout('compete-b'))]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(f.db.prepare('SELECT StockQty FROM PRODUCTS WHERE ProductID=109').get().StockQty,0);
}));
test('cancellation restores stock exactly once and marks successful payments refunded',()=>withFixture(async f=>{
 await f.login(f.customer);const before=f.db.prepare('SELECT StockQty FROM PRODUCTS WHERE ProductID=101').get().StockQty;
 const o=(await f.customer('/api/checkout','POST',checkout('cancel'))).data.order;
 const r=await f.customer(`/api/orders/${o.id}/cancel`,'POST');assert.equal(r.data.order.status,'Cancelled');assert.equal(r.data.order.payments[0].status,'Refunded');
 await f.customer(`/api/orders/${o.id}/cancel`,'POST');assert.equal(f.db.prepare('SELECT StockQty FROM PRODUCTS WHERE ProductID=101').get().StockQty,before);
 assert.equal((await f.customer(`/api/orders/${o.id}/pay`,'POST',{outcome:'success'})).status,409);
}));
test('pending payment can fail then succeed, and only paid orders advance through fulfillment',()=>withFixture(async f=>{
 await f.login(f.customer);await f.login(f.admin,'admin@nook.local','Admin@123');
 const o=(await f.customer('/api/checkout','POST',checkout('pending','pending'))).data.order;assert.equal(o.status,'Placed');
 assert.equal((await f.admin(`/api/admin/orders/${o.id}/status`,'PUT',{status:'Shipped'})).status,409);
 assert.equal((await f.customer(`/api/orders/${o.id}/pay`,'POST',{outcome:'failure'})).status,402);
 assert.equal((await f.customer(`/api/orders/${o.id}/pay`,'POST',{outcome:'success'})).data.order.status,'Paid');
 assert.equal((await f.admin(`/api/admin/orders/${o.id}/status`,'PUT',{status:'Shipped'})).data.order.status,'Shipped');
 assert.equal((await f.customer(`/api/orders/${o.id}/cancel`,'POST')).status,409);
 assert.equal((await f.admin(`/api/admin/orders/${o.id}/status`,'PUT',{status:'Delivered'})).data.order.status,'Delivered');
 assert.equal((await f.admin(`/api/admin/orders/${o.id}/status`,'PUT',{status:'Paid'})).status,409);
}));
test('admin inventory edits are validated and database labs expose only curated data',()=>withFixture(async f=>{
 await f.login(f.admin,'admin@nook.local','Admin@123');const c=f.admin;
 let d=(await c('/api/admin/products')).data;const p=d.products.find(p=>p.id===104);
 assert.equal((await c('/api/admin/products/104','PUT',{...p,stock:25,price:259900})).status,200);
 assert.equal((await c('/api/admin/products/104','PUT',{...p,stock:-1})).status,400);
 assert.equal((await c('/api/admin/products/104','PUT',{...p,price:1.5})).status,400);
 assert.equal((await c('/api/admin/products/104','PUT',{...p,categoryId:999})).status,400);
 const created=await c('/api/admin/products','POST',{...p,name:'Test Item',stock:3});assert.equal(created.status,200);
 assert.equal((await c('/api/admin/database?table=CUSTOMERS')).data.rows[0].PasswordHash,'[hidden]');
 assert.equal((await c('/api/admin/database?table=SESSIONS')).status,400);
 assert.equal((await c('/api/admin/database?table=PRODUCTS%3BDELETE')).status,400);
 assert.equal((await c('/api/admin/lab?query=integrity')).data.rows.length,0);
 assert.equal((await c('/api/admin/lab?query=function')).data.rows[0].TotalINR,500);
 const rollback=(await c('/api/admin/lab/rollback','POST')).data;assert.equal(rollback.before,rollback.after);assert.equal(rollback.during,rollback.before+10);
 assert.equal((await c('/api/admin/overview')).data.stats.revenue,170000);
}));
test('foreign keys, uniqueness, checks, stock triggers, and origin checks reject invalid writes',()=>withFixture(async f=>{
 assert.throws(()=>f.db.prepare("INSERT INTO CATEGORIES VALUES (1,'duplicate','',NULL)").run());
 assert.throws(()=>f.db.prepare("UPDATE PRODUCTS SET CategoryID=999 WHERE ProductID=101").run());
 assert.throws(()=>f.db.prepare('UPDATE PRODUCTS SET StockQty=-1 WHERE ProductID=101').run());
 assert.throws(()=>f.db.prepare('UPDATE PRODUCTS SET StockQty=1.5 WHERE ProductID=101').run());
 assert.throws(()=>f.db.prepare('UPDATE PRODUCTS SET ProductName=NULL WHERE ProductID=101').run());
 assert.throws(()=>f.db.prepare('INSERT INTO ORDER_ITEMS (OrderID,ProductID,Quantity,UnitPrice) VALUES (1002,101,99,120000)').run(),/Insufficient stock/);
 assert.equal((await f.client()('/api/auth/login','POST',{email:'asha@example.com',password:'Demo@123'},{Origin:'https://example.com'})).status,403);
 const inject=await f.client()('/api/auth/login','POST',{email:"x'or'1'='1@example.com",password:'Demo@123'});assert.equal(inject.status,401);
 assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
}));
test('database persists after closing and reopening the server',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'nook-tests-'));const filename=path.join(dir,'persistent.sqlite');let f;
 try{f=await fixture(filename);await f.login(f.customer);const id=(await f.customer('/api/checkout','POST',checkout('persistent'))).data.order.id;await f.close();f=null;
 const again=await fixture(filename);f=again;await f.login(f.customer);assert.equal((await f.customer(`/api/orders/${id}`)).data.order.total,140000);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ORDERS').get().n,3);
 }finally{if(f)await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('demo reset requires admin and exact confirmation, reseeds baseline and clears sessions',()=>withFixture(async f=>{
 await f.login(f.customer);await f.login(f.admin,'admin@nook.local','Admin@123');
 assert.equal((await f.customer('/api/admin/demo/reset','POST',{confirmation:'RESET'})).status,403);
 assert.equal((await f.admin('/api/admin/demo/reset','POST',{confirmation:'no'})).status,400);
 await f.customer('/api/checkout','POST',checkout('reset'));assert.equal((await f.admin('/api/admin/demo/reset','POST',{confirmation:'RESET'})).status,200);
 assert.equal((await f.admin('/api/admin/overview')).status,401);assert.equal((await f.customer('/api/cart')).status,401);
 await f.login(f.customer);assert.equal((await f.customer('/api/cart')).data.total,140000);assert.equal(f.db.prepare('SELECT StockQty FROM PRODUCTS WHERE ProductID=101').get().StockQty,19);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ORDERS').get().n,2);
}));
