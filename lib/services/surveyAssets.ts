// Fotos das pesquisas (aba Pesquisas → Configurar → Foto). Enviadas pelo dash
// ficam no banco (SurveyAsset); as do código ficam em public/survey-assets.

import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db';
import { SURVEY_ASSET_MAX_BYTES, sniffImage, surveyAssetUrl } from '../surveys/assets';

export interface SurveyImageOut {
  /** O que vai em config.image. */
  url: string;
  name: string;
  /** upload = enviada pelo dash (dá pra apagar se ninguém usa); code = veio com o código. */
  source: 'upload' | 'code';
  id: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  createdAt: string | null;
  /** Pesquisas (e versões de teste A/B) que usam a foto. */
  usedBy: string[];
}

type Result<T> = ({ ok: true } & T) | { ok: false; status: 400 | 404 | 409; error: string };

/** Onde cada foto está em uso: config da pesquisa e as versões dos testes A/B. */
async function imageUsage(): Promise<Map<string, string[]>> {
  const variants = await db.surveyVariant.findMany({ include: { experiments: true } });
  const out = new Map<string, string[]>();
  const add = (url: unknown, who: string) => {
    if (typeof url !== 'string' || !url) return;
    out.set(url, [...(out.get(url) ?? []), who]);
  };
  for (const v of variants) {
    add((v.config as { image?: unknown }).image, v.name);
    for (const e of v.experiments) {
      for (const a of Array.isArray(e.arms) ? (e.arms as { key?: string; config?: { image?: unknown } }[]) : []) {
        if (a.config) add(a.config.image, `${v.name} · teste "${e.name}" versão ${a.key}`);
      }
    }
  }
  return out;
}

function staticImages(): { url: string; name: string }[] {
  try {
    const dir = path.join(process.cwd(), 'public', 'survey-assets');
    return fs.readdirSync(dir)
      .filter((f) => /^[\w.-]+\.(webp|png|jpe?g)$/i.test(f))
      .map((f) => ({ url: `/survey-assets/${f}`, name: f }));
  } catch {
    return [];
  }
}

export async function listSurveyImages(): Promise<SurveyImageOut[]> {
  const [assets, usage] = await Promise.all([
    db.surveyAsset.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, size: true, width: true, height: true, createdAt: true },
    }),
    imageUsage(),
  ]);
  return [
    ...assets.map((a) => {
      const url = surveyAssetUrl(a.id);
      return {
        url, name: a.name, source: 'upload' as const, id: a.id, size: a.size, width: a.width, height: a.height,
        createdAt: a.createdAt.toISOString(), usedBy: usage.get(url) ?? [],
      };
    }),
    ...staticImages().map((s) => ({
      ...s, source: 'code' as const, id: null, size: null, width: null, height: null, createdAt: null, usedBy: usage.get(s.url) ?? [],
    })),
  ];
}

export async function saveSurveyImage(input: {
  name?: unknown; dataBase64?: unknown; width?: unknown; height?: unknown; by?: string | null;
}): Promise<Result<{ image: SurveyImageOut }>> {
  if (typeof input.dataBase64 !== 'string' || !input.dataBase64) return { ok: false, status: 400, error: 'Foto: arquivo vazio' };
  const bytes = Buffer.from(input.dataBase64, 'base64');
  if (!bytes.length) return { ok: false, status: 400, error: 'Foto: arquivo vazio' };
  if (bytes.length > SURVEY_ASSET_MAX_BYTES) {
    return { ok: false, status: 400, error: `Foto: até ${Math.round(SURVEY_ASSET_MAX_BYTES / 1000)} KB depois de reduzida` };
  }
  const mime = sniffImage(bytes);
  if (!mime) return { ok: false, status: 400, error: 'Foto: só WebP, PNG ou JPEG' };
  const dim = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 10000 ? v : null);
  const name = (typeof input.name === 'string' && input.name.trim() ? input.name.trim() : 'foto').slice(0, 120);
  const a = await db.surveyAsset.create({
    data: { name, mime, bytes, size: bytes.length, width: dim(input.width), height: dim(input.height), createdBy: input.by ?? null },
    select: { id: true, name: true, size: true, width: true, height: true, createdAt: true },
  });
  return {
    ok: true,
    image: {
      url: surveyAssetUrl(a.id), name: a.name, source: 'upload', id: a.id, size: a.size, width: a.width, height: a.height,
      createdAt: a.createdAt.toISOString(), usedBy: [],
    },
  };
}

/** Apaga uma foto enviada — recusa se alguma pesquisa ou versão de teste usa. */
export async function deleteSurveyImage(id: string): Promise<Result<Record<never, never>>> {
  const asset = await db.surveyAsset.findUnique({ where: { id }, select: { id: true } });
  if (!asset) return { ok: false, status: 404, error: 'foto não encontrada' };
  const used = (await imageUsage()).get(surveyAssetUrl(id)) ?? [];
  if (used.length) return { ok: false, status: 409, error: `Foto em uso: ${used.join(', ')}` };
  await db.surveyAsset.delete({ where: { id } });
  return { ok: true };
}

/** A foto em si, pra página pública. */
export async function getSurveyAssetBytes(id: string): Promise<{ mime: string; bytes: Buffer } | null> {
  const a = await db.surveyAsset.findUnique({ where: { id }, select: { mime: true, bytes: true } });
  return a ? { mime: a.mime, bytes: Buffer.from(a.bytes) } : null;
}
