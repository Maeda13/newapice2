// QA-007 — express-mysql-session carrega uma versão vulnerável do mysql2
// `node_modules/express-mysql-session/node_modules/mysql2` fica travado em
// 3.10.2 (< 3.22.0), vulnerável a downgrade do plugin de autenticação para
// mysql_clear_password (GHSA-3f6p-5ww8-9rcr). O mysql2 de nível superior já
// está corrigido — o problema é a cópia isolada do session store.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SAFE_MIN = [3, 22, 0];

function parseVersion(v) {
  return v.split('.').map(Number);
}

// true se `v` >= SAFE_MIN
function isSafeVersion(v) {
  const parts = parseVersion(v);
  for (let i = 0; i < SAFE_MIN.length; i++) {
    if ((parts[i] ?? 0) > SAFE_MIN[i]) return true;
    if ((parts[i] ?? 0) < SAFE_MIN[i]) return false;
  }
  return true;
}

// express-mysql-session resolve seu próprio mysql2 numa cópia aninhada
// (node_modules/express-mysql-session/node_modules/mysql2) quando a versão
// exigida diverge da versão de nível superior; se as versões coincidem, o
// npm faz dedupe e só sobra a cópia de nível superior.
function resolveMysql2VersionForSessionStore() {
  const nestedPkg = path.join(ROOT, 'node_modules', 'express-mysql-session', 'node_modules', 'mysql2', 'package.json');
  if (fs.existsSync(nestedPkg)) {
    return JSON.parse(fs.readFileSync(nestedPkg, 'utf8')).version;
  }
  const topLevelPkg = path.join(ROOT, 'node_modules', 'mysql2', 'package.json');
  return JSON.parse(fs.readFileSync(topLevelPkg, 'utf8')).version;
}

describe('QA-007 — mysql2 usado pelo express-mysql-session não é vulnerável', () => {
  test('versão resolvida é >= 3.22.0 (GHSA-3f6p-5ww8-9rcr corrigida)', () => {
    const version = resolveMysql2VersionForSessionStore();
    expect(isSafeVersion(version)).toBe(true);
  });
});
