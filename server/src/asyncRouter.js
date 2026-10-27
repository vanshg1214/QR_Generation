import { Router } from "express";

// An Express router whose async handlers pass their errors on to the error handler. Plain
// Express 4 doesn't catch a rejected promise, and an unhandled rejection stops the whole
// server; with this, a failing request gets an error response and everything else keeps
// working.
export function asyncRouter() {
  const router = Router();
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    const original = router[method].bind(router);
    router[method] = (path, ...handlers) =>
      original(
        path,
        ...handlers.map((h) =>
          typeof h === "function" && h.length < 4
            ? (req, res, next) => {
                try {
                  const result = h(req, res, next);
                  if (result && typeof result.catch === "function") result.catch(next);
                } catch (err) {
                  next(err);
                }
              }
            : h
        )
      );
  }
  return router;
}
