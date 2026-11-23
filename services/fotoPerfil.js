// ============================================
// services/fotoPerfil.js
// Foto de perfil de qualquer usuário: a foto do dev (/perfil) e o logo da
// empresa (Perfil e Configurações da empresa).
//
// A imagem fica no banco (tabela user_photos), não em public/uploads: o disco
// do Render é apagado a cada deploy e sempre que a instância gratuita "dorme",
// e a foto sumia — para os outros usuários e para o próprio dono. O endereço
// público (/api/fotos/<id>?v=<versão>) vai em user_dev_profiles.avatar_url ou
// em user_company_profiles.logo_url, os campos que as telas já usam.
// ============================================
const fs = require("fs");
const path = require("path");

const FOTO_MAX_BYTES = 2 * 1024 * 1024;
const TIPOS_FOTO = Object.freeze(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PUBLIC_DIR = path.join(__dirname, "..", "public");

/**
 * Tipo da imagem pelos primeiros bytes do arquivo, ou null se não for JPEG,
 * PNG, WebP nem GIF. O mimetype e o nome do arquivo vêm do navegador e podem
 * ser qualquer coisa; SVG fica de fora de propósito (pode levar script).
 */
function tipoDaImagem(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(ASSINATURA_PNG)) return "image/png";
  const inicio = buf.toString("latin1", 0, 12);
  if (inicio.startsWith("GIF87a") || inicio.startsWith("GIF89a")) return "image/gif";
  if (inicio.startsWith("RIFF") && inicio.slice(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Endereço público da foto. A versão muda a cada envio, então o navegador pode guardar a imagem por muito tempo. */
function urlDaFoto(userId, versao) {
  return `/api/fotos/${userId}?v=${versao}`;
}

/** Grava (ou troca) a foto do usuário e devolve o endereço novo; null se o arquivo não for imagem aceita. */
async function salvarFoto(db, userId, buffer) {
  const mime = tipoDaImagem(buffer);
  if (!mime) return null;
  await db.query(
    `INSERT INTO user_photos (user_id, mime, data) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE mime = VALUES(mime), data = VALUES(data)`,
    [userId, mime, buffer]
  );
  return urlDaFoto(userId, Date.now());
}

/**
 * Endereço que vale mostrar para os outros: o de uma foto antiga gravada no
 * disco (/uploads/...) só se o arquivo ainda existir — no Render ele some, e a
 * tela mostraria uma imagem quebrada em vez das iniciais.
 */
function fotoPublica(url) {
  if (!url) return null;
  const s = String(url);
  if (!s.startsWith("/uploads/")) return s;
  const arquivo = path.join(PUBLIC_DIR, s.split("?")[0]);
  return arquivo.startsWith(PUBLIC_DIR) && fs.existsSync(arquivo) ? s : null;
}

/**
 * Foto de um dev para quem o vê de fora (admin, relatórios): a que ele enviou ou a do
 * GitHub salva no perfil; e, se não há nenhuma (conta antiga, que nunca entrou de novo
 * pelo GitHub, ou foto em disco que sumiu), a foto pública do GitHub pelo github_id.
 * Sem foto nenhuma, devolve null (as telas mostram as iniciais).
 */
function avatarDoDev(avatarUrl, githubId) {
  const salva = fotoPublica(avatarUrl);
  if (salva) return salva;
  const id = Number(githubId);
  return Number.isInteger(id) && id > 0 ? `https://avatars.githubusercontent.com/u/${id}?v=4` : null;
}

module.exports = { FOTO_MAX_BYTES, TIPOS_FOTO, tipoDaImagem, urlDaFoto, salvarFoto, fotoPublica, avatarDoDev };
