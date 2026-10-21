import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account", robots: { index: false, follow: false } };

export default function ResetPassword() {
  redirect("/account?tab=login&otp=1");
}
