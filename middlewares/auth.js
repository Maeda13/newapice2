function requireAuth(req, res, next) {
  if (!req.session?.user) return res.redirect("/login");
  next();
}


function requireCompany(req, res, next) {
  if (!req.session?.user) return res.redirect("/login");
  if (req.session.user.type !== "empresa") return res.redirect("/dashboard");
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session?.user) return res.redirect("/login");
  if (req.session.user.type !== "admin") return res.redirect("/dashboard");
  next();
}

function redirectIfAuth(req, res, next) {
  if (!req.session?.user) return next();
  if (req.session.user.type === "admin")   return res.redirect("/admin/dashboard");
  if (req.session.user.type === "empresa") return res.redirect("/empresa/dashboard");
  return res.redirect("/dashboard");
}

function isAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: "Não autenticado." });
  next();
}

function isEmpresa(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: "Não autenticado" });
  if (req.session.user.type !== "empresa") return res.status(403).json({ error: "Acesso restrito a empresas" });
  next();
}

function isAdmin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: "Não autenticado" });
  if (req.session.user.type !== "admin") return res.status(403).json({ error: "Acesso restrito a administradores" });
  next();
}

module.exports = { requireAuth, requireCompany, requireAdmin, redirectIfAuth, isAuth, isEmpresa, isAdmin };
