"use client";

import { Music2 } from "lucide-react";

// Cover art slot: the real image always wins; the violet->teal gradient only
// shows while loading or when the artwork request fails (the img removes
// itself onError so the gradient underneath stays honest as a fallback).
export function Artwork({
  src,
  alt = "",
  className = "",
  rounded = "rounded-tile",
  iconSize = 20
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  rounded?: string;
  iconSize?: number;
}) {
  return (
    <div className={`artwork grid place-items-center ${rounded} ${className}`}>
      <Music2 size={iconSize} strokeWidth={1.5} className="text-white/50" aria-hidden />
      {src ? <img src={src} alt={alt} loading="lazy" decoding="async" onError={(event) => event.currentTarget.remove()} /> : null}
    </div>
  );
}
