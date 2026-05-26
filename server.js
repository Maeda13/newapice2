require("dotenv").config();
const express = require("express");
const session = require("express-session");
const path    = require("path");

const app = express();

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.use(express.static("public"));
app.use(express.json());

app.use(session({
  secret:            process.env.SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 },
}));

// Expõe `user` para todos os templates
app.use((req, res, next) => {
  res.locals.user = req.session?.user ?? null;
  next();
});

// ── Middlewares de auth ───────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session?.user) return res.redirect("/login");
  next();
}

function requireCompany(req, res, next) {
  if (!req.session?.user) return res.redirect("/login");
  if (req.session.user.type !== "empresa") return res.redirect("/dashboard");
  next();
}

function redirectIfAuth(req, res, next) {
  if (!req.session?.user) return next();
  if (req.session.user.type === "empresa") return res.redirect("/empresa/dashboard");
  return res.redirect("/dashboard");
}

// ── Páginas públicas ──────────────────────────────────────
app.get("/", (req, res) => res.render("index"));

app.get("/login",    redirectIfAuth, (req, res) => res.render("login"));
app.get("/cadastro", redirectIfAuth, (req, res) => res.render("cadastro"));

// Vagas — pública, mas mostra sidebar se autenticado
app.get("/vagas", (req, res) => res.render("vagas", { currentPage: "vagas" }));

// ── Área do desenvolvedor ─────────────────────────────────
app.get("/dashboard", requireAuth, (req, res) => {
  res.render("dashboard", { currentPage: "dashboard" });
});

app.get("/meu-progresso", requireAuth, (req, res) => {
  res.render("progresso", { currentPage: "progresso" });
});

app.get("/roadmap", requireAuth, (req, res) => {
  res.render("roadmap", { currentPage: "roadmap" });
});

// ── Área da empresa ───────────────────────────────────────
app.get("/empresa/dashboard", requireCompany, (req, res) => {
  res.render("empresa-dashboard", { currentPage: "empresa-dashboard" });
});

// ── API ───────────────────────────────────────────────────
app.get("/api/user", (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "Não autenticado" });
  const { accessToken, ...safeUser } = req.session.user;
  res.json(safeUser);
});

// ── Rotas modulares ───────────────────────────────────────
const authRoutes    = require("./routes/auth");
const userRoutes    = require("./routes/users");
const roadmapRoutes = require("./routes/roadmap");
const empresaRoutes = require("./routes/empresa");

app.use("/auth",        authRoutes);
app.use("/api/auth",    userRoutes);
app.use("/api",         roadmapRoutes);
app.use("/api/empresa", empresaRoutes);

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
