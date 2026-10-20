import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password, stored) {
  const [salt, key] = stored.split(':');
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(key, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export const newToken = () => randomBytes(32).toString('hex');
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export const userFields = 'CustomerID AS id, CustomerName AS name, Email AS email, Phone AS phone, Address AS address, Role AS role';
export function publicUser(db, id) { return db.prepare(`SELECT ${userFields} FROM CUSTOMERS WHERE CustomerID = ?`).get(id); }
