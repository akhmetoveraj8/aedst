/**
 * Role names as apps/server's `AEDST_ROLE_POLICY` spells them
 * (`/aedst.admin.v1.AdminService/*=admin`). The web app only uses them to
 * decide what to render and which pages to route to; the server enforces
 * them on every RPC.
 */
export const ADMIN_ROLE = "admin";
