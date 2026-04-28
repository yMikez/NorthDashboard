// Cria ou promove a ADMIN um usuário do dashboard. Idempotente:
// se o e-mail já existe, atualiza role pra ADMIN, allowedTabs pra
// todas as tabs e (se senha foi passada) reseta o hash.
//
// Uso:
//   npx tsx scripts/createAdmin.ts <email> <senha>
//
// Em produção (container), rodar uma única vez:
//   docker exec <container> sh -c 'node_modules/.bin/tsx scripts/createAdmin.ts admin@x.com sua_senha_forte'

import { db } from '../lib/db';
import { hashPassword, validatePasswordStrength } from '../lib/auth/password';
import { AVAILABLE_TABS } from '../lib/auth/tabs';

async function main() {
  const [, , email, password] = process.argv;
  if (!email || !password) {
    console.error('Uso: tsx scripts/createAdmin.ts <email> <senha>');
    process.exit(2);
  }
  const normalized = email.trim().toLowerCase();
  const err = validatePasswordStrength(password);
  if (err) {
    console.error('[createAdmin] senha inválida:', err);
    process.exit(2);
  }
  const passwordHash = await hashPassword(password);
  const allTabs = AVAILABLE_TABS.map((t) => t.id);

  const existing = await db.user.findUnique({ where: { email: normalized } });
  if (existing) {
    await db.user.update({
      where: { id: existing.id },
      data: {
        role: 'ADMIN',
        allowedTabs: allTabs,
        passwordHash,
        active: true,
      },
    });
    console.log(`[createAdmin] usuário existente atualizado: ${normalized} → ADMIN, senha resetada.`);
  } else {
    await db.user.create({
      data: {
        email: normalized,
        passwordHash,
        role: 'ADMIN',
        allowedTabs: allTabs,
        active: true,
      },
    });
    console.log(`[createAdmin] criado: ${normalized} (ADMIN, todas as ${allTabs.length} tabs).`);
  }
}

main()
  .catch((err) => {
    console.error('[createAdmin] falhou:', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
