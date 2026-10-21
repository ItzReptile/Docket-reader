import { reactive } from "vue";

// Small shared state: which document/model is open, which tab is showing, and
// which comment the side sheet is showing. Any component can change it.
export const ui = reactive({
  doc: "",
  model: "",
  tab: "overview",
  /** Set to jump to an argument on the Arguments tab. */
  focusArgumentId: null as number | null,
  /** Set to pre-filter the Arguments tab. */
  argumentFilter: "all" as "all" | "pending" | "approved" | "rejected",
  commentId: null as string | null,
  focusClaimId: null as number | null,
  /** Bumped after edits so views refetch. */
  version: 0,
});

export function openComment(id: string, focusClaimId: number | null = null) {
  ui.commentId = id;
  ui.focusClaimId = focusClaimId;
}

export function openArgument(id: number) {
  ui.argumentFilter = "all";
  ui.focusArgumentId = id;
  ui.tab = "arguments";
}

export function refresh() {
  ui.version++;
}
