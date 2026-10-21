// eval/labels.json holds the hand labels: for each sampled comment, the stance
// and the list of arguments a person found in it. It contains comment IDs and the
// labeler's own paraphrases only (no comment text, no names), so it is committed.

import { existsSync } from "node:fs";

export const LABELS_PATH = new URL("./labels.json", import.meta.url);

export type Stance = "support" | "oppose" | "mixed" | "unclear";

export interface Label {
  commentId: string;
  stance: Stance | null; // null = not labeled yet
  arguments: string[];
}

export interface LabelFile {
  documentId: string;
  comments: Label[];
}

export async function readLabels(): Promise<LabelFile | null> {
  if (!existsSync(LABELS_PATH)) return null;
  return Bun.file(LABELS_PATH).json();
}

export async function writeLabel(commentId: string, patch: { stance: Stance; arguments: string[] }) {
  const file = await readLabels();
  const label = file?.comments.find((c) => c.commentId === commentId);
  if (!file || !label) throw new Error(`${commentId} is not in the eval sample`);
  label.stance = patch.stance;
  label.arguments = patch.arguments.map((a) => a.trim()).filter(Boolean);
  await Bun.write(LABELS_PATH, JSON.stringify(file, null, 2) + "\n");
  return label;
}
