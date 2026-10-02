/** Per-request context carried through async calls (no need to thread it through every service). */
import { AsyncLocalStorage } from "async_hooks";

export interface ReqCtx {
  userBranchId?: string | null; // the member's home branch (memberships.branch_id)
  bodyBranchId?: string | null; // branch chosen explicitly on the document / voucher being saved
}
export const reqCtx = new AsyncLocalStorage<ReqCtx>();
export const currentCtx = (): ReqCtx => reqCtx.getStore() || {};
