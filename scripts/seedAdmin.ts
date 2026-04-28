// Seed do admin inicial via env vars. Roda automaticamente no startup
// do container (Dockerfile CMD chain) e é idempotente:
//
//   - Se ADMIN_SEED_EMAIL ou ADMIN_SEED_PASSWORD não estão setadas, no-op
//     (não falha o boot — log informativo e segue).
//   - Se já existe um usuário com aquele email, NÃO sobrescreve. Pode ser
//     que o admin tenha trocado a senha via UI (Fase 2) e não queremos
//     resetar a cada deploy. Quem precisa resetar usa scripts/createAdmin.ts
//     manualmente.
//   - Se não existe, cria como ADMIN com todas as abas.
//
// Senha NUNCA fica no código — vem só de env. Setar no .env do servidor:
//   ADMIN_SEED_EMAIL=alguem@dominio.com
//   ADMIN_SEED_PASSWORD=senha_forte_aqui

import { db } from '../lib/db';
import { hashPassword, validatePasswordStrength } from '../lib/auth/password';
import { AVAILABLE_TABS } from '../lib/auth/tabs';

async function main() {
  const emailRaw = process.env.ADMIN_SEED_EMAIL;
  const password = process.env.ADMIN_SEED_PASSWORD;
  if (!emailRaw || !password) {
    console.log('[seedAdmin] ADMIN_SEED_EMAIL/PASSWORD não setados — pulando seed.');
    return;
  }
  const email = emailRaw.trim().toLowerCase();
  const err = validatePasswordStrength(password);
  if (err) {
    console.warn(`[seedAdmin] senha inválida em ADMIN_SEED_PASSWORD: ${err} — pulando.`);
    return;
  }

  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  });
  if (existing) {
    console.log(`[seedAdmin] usuário ${email} já existe (role=${existing.role}) — não tocando.`);
    return;
  }

  const passwordHash = await hashPassword(password);
  const allTabs = AVAILABLE_TABS.map((t) => t.id);
  await db.user.create({
    data: {
      email,
      passwordHash,
      role: 'ADMIN',
      allowedTabs: allTabs,
      active: true,
    },
  });
  console.log(`[seedAdmin] criado ${email} (ADMIN, ${allTabs.length} abas).`);
}

main()
  .catch((err) => {
    console.error('[seedAdmin] falhou:', err);
    // Não derruba o container — login via createAdmin.ts manual ainda
    // pode rodar depois.
    process.exit(0);
  })
  .finally(async () => {
    await db.$disconnect();
  });
