import { NextResponse } from "next/server";

/**
 * Local-first mode does not use a hosted identity provider. The app is
 * expected to bind to loopback and uses a single local profile.
 *
 * Hosted mode is an explicit future adapter; it must not be enabled by
 * accident. When it returns, keep the Clerk middleware in a separate module
 * and branch on AUTH_MODE here.
 */
export default function proxy() {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};