import type { ModuleVideo } from "@/lib/content";

/**
 * Embeds an official Tesla (@tesla) YouTube video. Every id in content.ts was
 * verified official via YouTube oEmbed, so there is intentionally NO
 * non-official / link-card fallback — a module either has a verified official
 * video or shows none.
 */
export function VideoEmbed({ video }: { video: ModuleVideo }) {
  return (
    <figure>
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-ink">
        <iframe
          className="absolute inset-0 h-full w-full"
          src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}`}
          title={video.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
      <figcaption className="mt-2 text-xs text-muted">
        Official Tesla video · {video.title}
      </figcaption>
    </figure>
  );
}
