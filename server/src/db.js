import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase (and most hosted Postgres) requires TLS; local Postgres during dev usually doesn't.
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "")
    ? false
    : { rejectUnauthorized: false },
});

export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      destination_url TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS people (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Safety net for a database created before campaigns existed.
    ALTER TABLE people ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE;

    CREATE TABLE IF NOT EXISTS scans (
      id SERIAL PRIMARY KEY,
      person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      user_agent TEXT,
      ip_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_scans_person_id ON scans(person_id);
    CREATE INDEX IF NOT EXISTS idx_people_campaign_id ON people(campaign_id);
  `);

  // Migrate any people that predate campaigns into a single catch-all campaign,
  // reusing the old global destination link if one was set, so no data is lost.
  const { rows: orphanRows } = await pool.query(
    "SELECT COUNT(*)::int AS c FROM people WHERE campaign_id IS NULL"
  );
  if (orphanRows[0].c > 0) {
    const oldDestination = await getSetting("destination_url");
    const { rows: campaignRows } = await pool.query(
      "INSERT INTO campaigns (name, destination_url) VALUES ($1, $2) RETURNING id",
      ["Migrated Data", oldDestination || "https://example.com"]
    );
    await pool.query("UPDATE people SET campaign_id = $1 WHERE campaign_id IS NULL", [
      campaignRows[0].id,
    ]);
  }
  await pool.query("ALTER TABLE people ALTER COLUMN campaign_id SET NOT NULL");
}

export async function getSetting(key) {
  const { rows } = await pool.query("SELECT value FROM settings WHERE key = $1", [key]);
  return rows[0]?.value ?? null;
}

export async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

// Runs fn with a single dedicated client wrapped in BEGIN/COMMIT, rolling back on error.
// fn receives that client so its queries share the same transaction.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
