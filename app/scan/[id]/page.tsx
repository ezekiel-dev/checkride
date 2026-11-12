import { Suspense } from "react";
import { ScanStatus } from "@/components/scan-status";
import { Skeleton } from "@/components/ui/skeleton";

async function ScanParams({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScanStatus scanId={id} />;
}

export default function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col px-6 py-16">
      <Suspense
        fallback={
          <div className="flex flex-col gap-4" aria-busy="true">
            <span className="sr-only">Loading scan</span>
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-6 w-96" />
          </div>
        }
      >
        <ScanParams params={params} />
      </Suspense>
    </main>
  );
}
