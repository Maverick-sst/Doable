import { redirect } from "next/navigation";

/** Local-first mode has one profile; there is nothing to sign up for. */
export default function LocalSignUpPage() {
  redirect("/dashboard");
}