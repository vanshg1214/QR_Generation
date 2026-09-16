import { Router } from "express";
import crypto from "node:crypto";
import { pool, getSetting } from "../db.js";

export const redirectRoutes = Router();

function hashIp(ip) {
  const salt = process.env.IP_HASH_SALT || "";
  return crypto.createHash("sha256").update(salt + ip).digest("hex");
}

// Public, unauthenticated: this is the link encoded in each person's QR code.
redirectRoutes.get("/r/:code", async (req, res) => {
  const destination = await getSetting("destination_url");
  const fallback = destination || "https://example.com";

  const { rows } = await pool.query("SELECT id FROM people WHERE code = $1", [req.params.code]);
  const person = rows[0];

  if (person) {
    await pool.query(
      "INSERT INTO scans (person_id, user_agent, ip_hash) VALUES ($1, $2, $3)",
      [person.id, req.headers["user-agent"] || null, hashIp(req.ip || "")]
    );
  }

  // Fail open: even an unknown/mistyped code still lands the visitor on the
  // destination content instead of showing them an error.
  res.redirect(302, fallback);
});
