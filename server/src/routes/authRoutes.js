import { Router } from "express";
import { checkPassword } from "../auth.js";

export const authRoutes = Router();

authRoutes.post("/login", (req, res) => {
  const { password } = req.body || {};
  if (!checkPassword(password)) {
    return res.status(401).json({ error: "Incorrect password" });
  }
  req.session.authenticated = true;
  res.json({ ok: true });
});

authRoutes.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

authRoutes.get("/session", (req, res) => {
  if (process.env.DISABLE_AUTH === "true") {
    return res.json({ authenticated: true });
  }
  res.json({ authenticated: Boolean(req.session?.authenticated) });
});
