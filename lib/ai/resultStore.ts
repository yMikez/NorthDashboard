// Guarda, por turno, o resultado COMPLETO de cada tool (antes do
// fitToolResult encolher pro modelo) e o de cada conta do calc.
//
// Serve a três coisas:
//   - tools de cálculo/agregação referenciam valores por `$rN.caminho`
//     (sem o modelo redigitar número — fonte nº 1 de erro);
//   - agregação sobre a lista inteira mesmo quando o modelo viu a lista
//     truncada;
//   - a checagem de números dos blocos (grounding) compara com tudo que as
//     tools devolveram de fato.

export interface StoredResult {
  ref: string;
  tool: string;
  input: unknown;
  value: unknown;
  round: number;
}

export class ResultStore {
  private items: StoredResult[] = [];
  private calcs = new Map<string, number | null>();
  private round = 0;

  /** Começa uma rodada nova (as refs de rodadas anteriores continuam válidas). */
  nextRound(): void {
    this.round += 1;
  }

  currentRound(): number {
    return this.round;
  }

  put(tool: string, input: unknown, value: unknown): string {
    const ref = `r${this.items.length + 1}`;
    this.items.push({ ref, tool, input, value, round: this.round });
    return ref;
  }

  get(ref: string): StoredResult | undefined {
    return this.items.find((i) => i.ref === ref);
  }

  all(): readonly StoredResult[] {
    return this.items;
  }

  /** Resultados de rodadas ANTERIORES à atual (o que o modelo já leu). */
  readable(): readonly StoredResult[] {
    return this.items.filter((i) => i.round < this.round);
  }

  putCalc(name: string, value: number | null): void {
    this.calcs.set(name, value);
  }

  calcValues(): ReadonlyMap<string, number | null> {
    return this.calcs;
  }
}
