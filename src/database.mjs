import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

// Migrações idempotentes: mantém o arquivo SQLite existente e os registros históricos.
export class Database {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
    this.db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
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
        COMMIT;
        PRAGMA foreign_keys=ON;`);
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS destinations_account ON destinations(account_id)');
    const deliveryColumns = this.db.prepare('PRAGMA table_info(deliveries)').all();
    if (!deliveryColumns.some(column => column.name === 'availability')) this.db.exec("ALTER TABLE deliveries ADD COLUMN availability TEXT CHECK(availability IN ('open', 'closed'))");
    if (!deliveryColumns.some(column => column.name === 'next_attempt_at')) this.db.exec('ALTER TABLE deliveries ADD COLUMN next_attempt_at TEXT');
    this.db.exec(`UPDATE deliveries SET availability=(SELECT state FROM watches WHERE watches.id=deliveries.watch_id)
      WHERE availability IS NULL;
      UPDATE deliveries SET next_attempt_at=created_at WHERE next_attempt_at IS NULL;
      UPDATE deliveries SET status='obsolete', last_error='Estado superado'
      WHERE status='pending' AND (availability IS NOT 'open' OR NOT EXISTS (
        SELECT 1 FROM watches w WHERE w.id=deliveries.watch_id AND w.state='open'))`);

    // Normalização histórica antes de criar a restrição: conserva o registro mais recente
    // e associa seu histórico de entregas ao acompanhamento sobrevivente.
    const entries = this.db.prepare(`SELECT * FROM watches
      ORDER BY COALESCE(checked_at, '') DESC, id`).all();
    const seen = new Map();
    const canonical = code => /^\d+$/.test(code) ? BigInt(code).toString() : code;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const watch of entries) {
        const key = JSON.stringify([watch.account_id, watch.subject_code.toUpperCase(), canonical(watch.class_code)]);
        const winner = seen.get(key);
        if (winner) {
          this.db.prepare('UPDATE deliveries SET watch_id=? WHERE watch_id=?').run(winner, watch.id);
          this.db.prepare('DELETE FROM watches WHERE id=?').run(watch.id);
        } else {
          seen.set(key, watch.id);
        }
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS watches_unique_turma
      ON watches(account_id, UPPER(subject_code), COALESCE(NULLIF(LTRIM(class_code, '0'), ''), '0'));
      CREATE INDEX IF NOT EXISTS deliveries_due ON deliveries(status, next_attempt_at, created_at);
      CREATE INDEX IF NOT EXISTS deliveries_watch ON deliveries(watch_id);
      CREATE INDEX IF NOT EXISTS deliveries_destination ON deliveries(destination_id);`);
  }
  prepare(sql) {
    const statement = this.db.prepare(sql);
    const make = values => ({
      bind: (...v) => make(v),
      all: async () => ({results:statement.all(...values)}),
      first: async () => statement.get(...values) || null,
      run: async () => statement.run(...values)
    });
    return make([]);
  }
  async batch(statements) {
    this.db.exec('BEGIN IMMEDIATE');
    try { for (const statement of statements) await statement.run(); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
