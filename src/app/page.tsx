import { Suspense } from "react";
import { GuestFlow } from "@/components/guest-flow";

export default function Home() {
  return (
    <Suspense
      fallback={
        <main className="px-6 py-16 text-center">
          <h1 className="text-4xl font-semibold tracking-tight">CineMatch</h1>
        </main>
      }
    >
      <GuestFlow />
    </Suspense>
  );
}
