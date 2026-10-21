export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export function mean(vectors: number[][]): number[] {
  const out = new Array<number>(vectors[0]!.length).fill(0);
  for (const v of vectors) for (let i = 0; i < v.length; i++) out[i]! += v[i]! / vectors.length;
  return out;
}
