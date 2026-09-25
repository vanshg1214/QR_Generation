import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase (and most hosted Postgres) requires TLS; local Postgres during dev usually doesn't.
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "")
    ? false
    : { rejectUnauthorized: false },
  // pg's default (10s) closes idle connections almost immediately, so most
  // requests pay a full new-connection handshake to Supabase (~1-1.5s across
  // regions) instead of reusing a warm one. Keep connections open much longer.
  idleTimeoutMillis: 10 * 60 * 1000,
  keepAlive: true,
});

// Keeps at least one connection warm so the very next request never pays a
// fresh handshake, and gives the pool a chance to notice/replace a connection
// Supabase silently dropped while idle.
setInterval(() => {
  pool.query("SELECT 1").catch(() => {});
}, 4 * 60 * 1000);

// pg emits 'error' on the pool when an idle client's connection is dropped
// (Supabase silently closing it, a network blip, etc). An EventEmitter with
// no 'error' listener throws and crashes the whole process on the next such
// event -- this just logs it and lets the pool replace the connection.
pool.on("error", (err) => {
  console.error("Postgres pool idle client error:", err.message);
});

export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      graphic_data BYTEA,
      graphic_mime TEXT
    );

    CREATE TABLE IF NOT EXISTS campaign_links (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      destination_url TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS people (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS codes (
      id SERIAL PRIMARY KEY,
      person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      campaign_link_id INTEGER NOT NULL REFERENCES campaign_links(id) ON DELETE CASCADE,
      code TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (person_id, campaign_link_id)
    );

    CREATE TABLE IF NOT EXISTS scans (
      id SERIAL PRIMARY KEY,
      code_id INTEGER NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
      scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      user_agent TEXT,
      ip_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Where a per-person QR code should be stamped inside a campaign's letter
    -- graphic, as fractions (0..1, top-left origin) of the graphic's dimensions.
    CREATE TABLE IF NOT EXISTS letter_qr_boxes (
      id SERIAL PRIMARY KEY,
      campaign_link_id INTEGER NOT NULL REFERENCES campaign_links(id) ON DELETE CASCADE,
      x DOUBLE PRECISION NOT NULL,
      y DOUBLE PRECISION NOT NULL,
      width DOUBLE PRECISION NOT NULL,
      height DOUBLE PRECISION NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_codes_person_id ON codes(person_id);
    CREATE INDEX IF NOT EXISTS idx_codes_campaign_link_id ON codes(campaign_link_id);
    CREATE INDEX IF NOT EXISTS idx_people_campaign_id ON people(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_links_campaign_id ON campaign_links(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_letter_qr_boxes_campaign_link_id ON letter_qr_boxes(campaign_link_id);
  `);

  await pool.query("ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS graphic_data BYTEA");
  await pool.query("ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS graphic_mime TEXT");
  await pool.query("ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS signature_name TEXT");
  await pool.query("ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS signature_title TEXT");

  await migrateSingleLinkSchema();

  // Only valid once code_id definitely exists on scans (fresh installs get it from the
  // CREATE TABLE above; migrated ones get it inside migrateSingleLinkSchema).
  await pool.query("CREATE INDEX IF NOT EXISTS idx_scans_code_id ON scans(code_id)");
}

async function columnExists(table, column) {
  const { rows } = await pool.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2",
    [table, column]
  );
  return rows.length > 0;
}

// Older deployments had one destination_url directly on campaigns, one code directly
// on people, and scans keyed by person_id. Move that data forward into the
// campaign_links / codes tables (one "Main Link" per campaign, reusing existing codes
// so already-printed QR images keep working), then drop the old columns.
async function migrateSingleLinkSchema() {
  const hasOldDestination = await columnExists("campaigns", "destination_url");
  const hasOldPersonCode = await columnExists("people", "code");
  const hasOldScanPersonId = await columnExists("scans", "person_id");

  if (hasOldDestination) {
    await pool.query(`
      INSERT INTO campaign_links (campaign_id, label, destination_url, position)
      SELECT c.id, 'Main Link', c.destination_url, 0
      FROM campaigns c
      WHERE NOT EXISTS (SELECT 1 FROM campaign_links cl WHERE cl.campaign_id = c.id)
    `);
  }

  if (hasOldPersonCode) {
    await pool.query(`
      INSERT INTO codes (person_id, campaign_link_id, code)
      SELECT p.id,
        (SELECT cl.id FROM campaign_links cl WHERE cl.campaign_id = p.campaign_id ORDER BY cl.position, cl.id LIMIT 1),
        p.code
      FROM people p
      WHERE p.code IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM codes c WHERE c.person_id = p.id)
    `);
  }

  if (hasOldScanPersonId) {
    await pool.query(
      "ALTER TABLE scans ADD COLUMN IF NOT EXISTS code_id INTEGER REFERENCES codes(id) ON DELETE CASCADE"
    );
    await pool.query(`
      UPDATE scans s
      SET code_id = c.id
      FROM codes c
      WHERE s.code_id IS NULL AND c.person_id = s.person_id
    `);
    // A scan with no matching code is an orphaned data anomaly; don't let it block the migration.
    await pool.query("DELETE FROM scans WHERE code_id IS NULL");
    await pool.query("ALTER TABLE scans ALTER COLUMN code_id SET NOT NULL");
    await pool.query("ALTER TABLE scans DROP COLUMN person_id");
  }

  if (hasOldPersonCode) {
    await pool.query("ALTER TABLE people DROP COLUMN code");
  }
  if (hasOldDestination) {
    await pool.query("ALTER TABLE campaigns DROP COLUMN destination_url");
  }
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
