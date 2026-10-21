import { sql } from "./db.ts";

// Embeddings are stored as Postgres real[] and come back as Float32Array.
export type Vector = ArrayLike<number>;

/** Bind a vector as a real[] query parameter. */
export const toPg = (v: Vector) => sql.array(Array.from(v), "float4");

export function cosine(a: Vector, b: Vector): number {
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

export function mean(vectors: Vector[]): number[] {
  const out = new Array<number>(vectors[0]!.length).fill(0);
  for (const v of vectors) for (let i = 0; i < v.length; i++) out[i]! += v[i]! / vectors.length;
  return out;
}
