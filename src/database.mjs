import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export class Database {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
    this.db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
    const destinationColumns = this.db.prepare('PRAGMA table_info(destinations)').all();
    if (!destinationColumns.some(column => column.name === 'account_id')) {
      this.db.exec(`PRAGMA foreign_keys=OFF;
        BEGIN IMMEDIATE;
        CREATE TABLE destinations_new (
          id TEXT PRIMARY KEY,
          account_id TEXT REFERENCES accounts(id),
          kind TEXT NOT NULL CHECK(kind IN ('discord', 'whatsapp', 'phone')),
          config TEXT NOT NULL
        );
        INSERT INTO destinations_new (id, account_id, kind, config)
          SELECT d.id, w.account_id, d.kind, d.config
          FROM destinations d LEFT JOIN watches w ON w.id=d.watch_id;
        DROP TABLE destinations;
        ALTER TABLE destinations_new RENAME TO destinations;
        CREATE INDEX IF NOT EXISTS destinations_account ON destinations(account_id);
        COMMIT;
        PRAGMA foreign_keys=ON;`);
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS destinations_account ON destinations(account_id)');
    const deliveryColumns = this.db.prepare('PRAGMA table_info(deliveries)').all();
    if (!deliveryColumns.some(column => column.name === 'availability')) this.db.exec("ALTER TABLE deliveries ADD COLUMN availability TEXT CHECK(availability IN ('open', 'closed'))");
    this.db.exec('UPDATE deliveries SET availability=(SELECT state FROM watches WHERE watches.id=deliveries.watch_id) WHERE availability IS NULL');
  }
  prepare(sql) {
    const statement=this.db.prepare(sql);
    const make = values => ({bind:(...v)=>make(v), all:async()=>({results:statement.all(...values)}), first:async()=>statement.get(...values) || null, run:async()=>statement.run(...values)});
    return make([]);
  }
  async batch(statements) {this.db.exec('BEGIN IMMEDIATE');try {for (const s of statements) await s.run();this.db.exec('COMMIT');} catch(e) {this.db.exec('ROLLBACK');throw e;}}
}
