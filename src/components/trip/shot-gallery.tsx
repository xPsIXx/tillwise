import type { ScanShot } from "@/lib/grocery/types";
import { cn } from "@/lib/utils";

export function ShotGallery({
  shots,
  onOpen,
}: {
  shots: ScanShot[];
  onOpen: (shot: ScanShot) => void;
}) {
  if (shots.length === 0) return null;
  return (
    <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
      {shots.map((shot) => (
        <li key={shot.id}>
          <button
            type="button"
            onClick={() => onOpen(shot)}
            className="group w-full text-left"
          >
            <span className="relative block overflow-hidden rounded-lg bg-elevated">
              {shot.thumbnailData ? (
                <img src={shot.thumbnailData} alt="" className="aspect-[3/4] w-full object-cover" />
              ) : (
                <span className="grid aspect-[3/4] w-full place-items-center text-xs text-subtle">
                  No photo
                </span>
              )}
              <span
                className={cn(
                  "absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                  shot.kind === "receipt" ? "bg-fg/80 text-bg" : "bg-bg/70 text-fg",
                )}
              >
                {shot.kind === "receipt" ? "Till" : "Label"}
              </span>
            </span>
            <span className="mt-1 block truncate text-xs text-muted group-hover:text-fg">
              {shotTitle(shot)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function shotTitle(shot: ScanShot): string {
  const last = shot.lastRead;
  if (last && "name" in last && last.name) return last.name;
  if (last && "items" in last) {
    return last.storeName ?? `${last.items.length} lines`;
  }
  return shot.kind === "receipt" ? "Receipt" : "Label";
}
