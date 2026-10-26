/**
 * Compatibility entry point. Authentication now lives in the `src/auth`
 * module seam so local and hosted modes can differ without leaking into
 * routes.
 */
export {
  getAuthMode,
  getCurrentUser,
  isLocalMode,
  requireDbUser,
} from "@/src/auth";
export type { AuthMode, AuthResult, DbUser } from "@/src/auth";