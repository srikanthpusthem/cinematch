import { Suspense } from "react";
import { GuestFlow } from "@/components/guest-flow";

export default function Home() {
  return (
    <Suspense
      fallback={
        <main id="main-content" tabIndex={-1} className="app-loading">
          <h1 className="text-4xl font-semibold tracking-tight">CineMatch</h1>
        </main>
      }
    >
      <GuestFlow />
    </Suspense>
  );
}
