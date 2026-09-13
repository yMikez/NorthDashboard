// Configuração de integrações editável pela UI, com env var como override.
//
// Por que no banco: a chave da API da Logicall e as comissões dos parceiros
// de call center mudam por acordo comercial, e mexer no .env da VPS +
// restart pra isso é atrito desnecessário. Ordem de precedência:
//   1. env var (LOGICALL_API_KEY, LOGICALL_COMMISSION_PCT, TAUK_COMMISSION_PCT)
//   2. IntegrationSetting no banco (PUT /api/admin/integration-settings)
//   3. default
// Cache in-process de 60s — settings mudam raramente e são lidas em toda
// request da aba/lucro. Escrever invalida também o responseCache das
// métricas (a comissão entra na aba e no lucro BACK do overview).
//
// UNIDADES — sem ambiguidade (achado da revisão: "1" virava 100%):
//   - setting no banco (vem da UI, campo rotulado em %): SEMPRE percentual
//     0..100 ("35" = 35%, "1" = 1%, "0.5" = 0,5%).
//   - env var: SEMPRE fração 0..1 ("0.35"), como o TAUK_COMMISSION_PCT
//     histórico. Valor > 1 na env é rejeitado (cai pro próximo nível).

import { db } from '../db';
import { clearResponseCache } from '../cache/responseCache';

export const SETTING_KEYS = {
  logicallApiKey: 'logicall.apiKey',
  logicallCommissionPct: 'logicall.commissionPct',
  taukCommissionPct: 'tauk.commissionPct',
  // Integração NorthScale Afiliados (integration-dashboard.md §2/§3):
  //   apiUrl            base da API de afiliados (GET …/mapping)
  //   integrationApiKey chave que o DASHBOARD ENVIA no X-Api-Key do mapping
  //                     (= INTEGRATION_API_KEY do lado deles)
  //   dashboardApiKey   chave que o dashboard ACEITA no webhook e no metrics
  //                     (= DASHBOARD_API_KEY do lado deles)
  affiliatesApiUrl: 'affiliates.apiUrl',
  affiliatesIntegrationApiKey: 'affiliates.integrationApiKey',
  affiliatesDashboardApiKey: 'affiliates.dashboardApiKey',
} as const;

// Chaves INTERNAS (não editáveis pela UI): marcador incremental do mapping.
export const INTERNAL_SETTING_KEYS = {
  affiliatesSyncSince: 'affiliates.sync.since',
} as const;
export type InternalSettingKey = (typeof INTERNAL_SETTING_KEYS)[keyof typeof INTERNAL_SETTING_KEYS];

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];
const ALLOWED = new Set<string>(Object.values(SETTING_KEYS));

const TTL_MS = 60_000;
let cache: { at: number; map: Map<string, string> } | null = null;

async function load(): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  const rows = await db.integrationSetting.findMany();
  cache = { at: Date.now(), map: new Map(rows.map((r) => [r.key, r.value])) };
  return cache.map;
}

export function invalidateIntegrationSettings(): void {
  cache = null;
}

export function isAllowedSettingKey(key: string): key is SettingKey {
  return ALLOWED.has(key);
}

export async function getSetting(key: SettingKey | InternalSettingKey): Promise<string | null> {
  const map = await load();
  return map.get(key) ?? null;
}

export async function setSetting(key: SettingKey | InternalSettingKey, value: string): Promise<void> {
  await db.integrationSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
  invalidateIntegrationSettings();
  clearResponseCache();
}

export async function deleteSetting(key: SettingKey | InternalSettingKey): Promise<void> {
  await db.integrationSetting.deleteMany({ where: { key } });
  invalidateIntegrationSettings();
  clearResponseCache();
}

export function maskSecret(v: string): string {
  if (v.length <= 4) return '••••';
  return `${'•'.repeat(Math.max(4, v.length - 4))}${v.slice(-4)}`;
}

export async function listSettingsMasked(): Promise<
  Array<{ key: string; value: string; masked: boolean; updatedAt: string }>
> {
  const rows = await db.integrationSetting.findMany({ orderBy: { key: 'asc' } });
  return rows.map((r) => {
    const secret = /apikey|secret|token/i.test(r.key);
    return {
      key: r.key,
      value: secret ? maskSecret(r.value) : r.value,
      masked: secret,
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

// ── NorthScale Afiliados ─────────────────────────────────────────────
export const DEFAULT_AFFILIATES_API_URL = 'https://api.thenorthscales.com';

/** Base da API de afiliados (sem barra final): env AFFILIATES_API_URL > banco > default. */
export async function getAffiliatesApiUrl(): Promise<string> {
  const env = process.env.AFFILIATES_API_URL?.trim();
  const raw = env || (await getSetting(SETTING_KEYS.affiliatesApiUrl)) || DEFAULT_AFFILIATES_API_URL;
  return raw.replace(/\/+$/, '');
}

/** Chave que ENVIAMOS no mapping (X-Api-Key): env INTEGRATION_API_KEY > banco > null. */
export async function getAffiliatesOutboundKey(): Promise<string | null> {
  const env = process.env.INTEGRATION_API_KEY?.trim();
  if (env) return env;
  const v = await getSetting(SETTING_KEYS.affiliatesIntegrationApiKey);
  return v?.trim() || null;
}

/** Chave que ACEITAMOS no webhook/metrics: env DASHBOARD_API_KEY > banco > null (503). */
export async function getAffiliatesInboundKey(): Promise<string | null> {
  const env = process.env.DASHBOARD_API_KEY?.trim();
  if (env) return env;
  const v = await getSetting(SETTING_KEYS.affiliatesDashboardApiKey);
  return v?.trim() || null;
}

/** Chave da API Logicall: env > banco > null (integração desligada). */
export async function getLogicallApiKey(): Promise<string | null> {
  const env = process.env.LOGICALL_API_KEY?.trim();
  if (env) return env;
  return getSetting(SETTING_KEYS.logicallApiKey);
}

/** Env var: fração 0..1. Fora disso → null. */
export function parseEnvFraction(raw: string | null | undefined): number | null {
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

/** Setting (UI): percentual 0..100 → fração. Fora disso → null. */
export function parseSettingPercent(raw: string | null | undefined): number | null {
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n / 100 : null;
}

export type CallCenterProvider = 'tauk' | 'logicall';

export const DEFAULT_COMMISSION_PCT = 0.35;

/**
 * Comissão (fração 0..1) que o parceiro leva sobre CADA venda recuperada.
 * `assumed` = veio do default, não de acordo configurado — a UI avisa.
 */
export async function getProviderCommission(
  provider: CallCenterProvider,
): Promise<{ pct: number; assumed: boolean; source: 'env' | 'setting' | 'default' }> {
  const envKey = provider === 'tauk' ? 'TAUK_COMMISSION_PCT' : 'LOGICALL_COMMISSION_PCT';
  const fromEnv = parseEnvFraction(process.env[envKey]);
  if (fromEnv != null) return { pct: fromEnv, assumed: false, source: 'env' };
  const settingKey = provider === 'tauk' ? SETTING_KEYS.taukCommissionPct : SETTING_KEYS.logicallCommissionPct;
  const fromDb = parseSettingPercent(await getSetting(settingKey));
  if (fromDb != null) return { pct: fromDb, assumed: false, source: 'setting' };
  // Tauk: 35% é o acordo real (memória do projeto). Logicall: ainda não
  // informado — assume o mesmo e marca como ASSUMIDO.
  return { pct: DEFAULT_COMMISSION_PCT, assumed: provider !== 'tauk', source: 'default' };
}
