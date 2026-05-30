// Conversão de "wall clock" (timestamp sem timezone) num fuso IANA → UTC real.
//
// Vários IPNs mandam a hora local da plataforma sem offset (ex: BuyGoods em
// America/New_York, Digistore em Europe/Berlin). Tratar isso como UTC desloca
// todo orderedAt pelo offset do fuso (e quebra o bucket por dia perto da
// meia-noite). Esta função resolve o instante UTC correto, com DST tratado
// via Intl — sem hardcodar offset fixo.

const WALL_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})[T\s]+(\d{2}):(\d{2}):(\d{2})/;

/**
 * Interpreta `raw` ("YYYY-MM-DD HH:mm:ss", sem timezone) como wall clock no
 * fuso `timeZone` e devolve o Date UTC equivalente. Retorna null se não casar
 * o formato esperado.
 */
export function wallClockToUtc(raw: string, timeZone: string): Date | null {
  const m = raw.trim().match(WALL_CLOCK_RE);
  if (!m) return null;
  const [, Y, M, D, h, mi, s] = m.map(Number);

  // Chute: trata a wall clock como se fosse UTC. O offset real do fuso nesse
  // instante diz quanto corrigir. Recalcula 1x caso o chute caia do outro lado
  // de uma borda de DST (offset muda).
  const guess = Date.UTC(Y, M - 1, D, h, mi, s);
  const off1 = tzOffsetMinutes(timeZone, guess);
  let utc = guess - off1 * 60_000;
  const off2 = tzOffsetMinutes(timeZone, utc);
  if (off2 !== off1) utc = guess - off2 * 60_000;

  return new Date(utc);
}

/**
 * Offset do `timeZone` em minutos no instante `utcMs` (positivo a leste de
 * UTC; New_York EDT = -240, EST = -300). Calculado comparando a wall clock
 * formatada no fuso contra o próprio instante UTC — robusto a DST e a viradas
 * de data (usa todos os componentes, não só hora/minuto).
 */
function tzOffsetMinutes(timeZone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let hour = g('hour');
  if (hour === 24) hour = 0; // alguns engines emitem '24' pra meia-noite
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), hour, g('minute'), g('second'));
  return (asUtc - utcMs) / 60_000;
}
