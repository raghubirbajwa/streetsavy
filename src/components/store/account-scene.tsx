import type { ReactNode } from "react";
import "./account-auth.css";

export function AccountScene({ children }: { children: ReactNode }) {
  return <main id="main" className="store-account-scene"><div className="store-account-card">{children}</div></main>;
}
