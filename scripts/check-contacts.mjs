import { createConnection } from 'mariadb';
const c = await createConnection({ host: 'localhost', user: 'root', database: 'wacrm' });
const contacts = await c.query("SELECT id, name, phone FROM contacts");
console.log("Contacts count:", contacts.length);
for (const ct of contacts) {
  console.log(" -", ct.id, ct.name, ct.phone);
}
await c.end();
