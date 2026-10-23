import Link from "next/link";
import { signOut } from "../auth/sign-out";

export function PilotNav({ current }: { current: "dashboard" | "projects" }) {
  return (
    <nav className="account-nav" aria-label="Account">
      <Link href="/dashboard" aria-current={current === "dashboard" ? "page" : undefined}>
        Dashboard
      </Link>
      <Link href="/projects" aria-current={current === "projects" ? "page" : undefined}>
        Projects
      </Link>
      <form action={signOut}>
        <button type="submit">Sign out</button>
      </form>
    </nav>
  );
}
