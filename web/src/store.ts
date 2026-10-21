import { reactive } from "vue";

// Small shared state: which document/model is open, and which comment the
// side drawer is showing. Any component can call openComment().
export const ui = reactive({
  doc: "",
  model: "",
  commentId: null as string | null,
  focusClaimId: null as number | null,
  /** Bumped after edits so views refetch. */
  version: 0,
});

export function openComment(id: string, focusClaimId: number | null = null) {
  ui.commentId = id;
  ui.focusClaimId = focusClaimId;
}

export function refresh() {
  ui.version++;
}
