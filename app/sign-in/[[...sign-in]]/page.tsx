import { redirect } from "next/navigation";

/** Local-first mode has one profile; there is nothing to sign in to. */
export default function LocalSignInPage() {
  redirect("/dashboard");
}