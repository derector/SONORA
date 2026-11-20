"use client";

import { useEffect, useMemo, useState } from "react";

// A pure CSS/DOM particle overlay. Everything that depends on the browser
// (calendar, stored setting, motion preference) is read inside useEffect so the
// server render and the first client render stay identical.
type Season = "winter" | "spring" | "autumn" | "none";

type Particle = {
  left: number;
  size: number;
  delay: number;
  duration: number;
  drift: number;
  spin: number;
  opacity: number;
};

const PARTICLE_COUNT = 24;

function seasonForMonth(month: number): Season {
  if (month === 11 || month === 0 || month === 1) return "winter";
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 9 && month <= 10) return "autumn";
  return "none";
}

function buildParticles(season: Season): Particle[] {
  if (season === "none") return [];
  return Array.from({ length: PARTICLE_COUNT }, (_, index) => {
    const spread = (index + 0.5) / PARTICLE_COUNT;
    if (season === "spring") {
      return {
        left: spread * 100,
        size: 1,
        delay: -(index % 8) * 0.24 - Math.random() * 0.2,
        duration: 1.1 + Math.random() * 0.9,
        drift: -18 - Math.random() * 26,
        spin: 0,
        opacity: 0.35 + Math.random() * 0.35
      };
    }
    if (season === "autumn") {
      return {
        left: spread * 100,
        size: 9 + Math.round(Math.random() * 9),
        delay: -(index % 10) * 0.7 - Math.random() * 0.6,
        duration: 9 + Math.random() * 8,
        drift: 40 + Math.random() * 90,
        spin: 220 + Math.round(Math.random() * 420),
        opacity: 0.55 + Math.random() * 0.35
      };
    }
    return {
      left: spread * 100,
      size: 3 + Math.round(Math.random() * 5),
      delay: -(index % 12) * 0.9 - Math.random() * 0.8,
      duration: 11 + Math.random() * 10,
      drift: -30 + Math.random() * 60,
      spin: 0,
      opacity: 0.35 + Math.random() * 0.45
    };
  });
}

export function SeasonalEffects() {
  const [season, setSeason] = useState<Season>("none");
  const [enabled, setEnabled] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    try { setEnabled(window.localStorage.getItem("sonora-seasonal-effects") !== "off"); } catch {}
    setSeason(seasonForMonth(new Date().getMonth()));
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    setReducedMotion(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Other tabs on the same device flip the switch through the storage event.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== "sonora-seasonal-effects") return;
      setEnabled(event.newValue !== "off");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const particles = useMemo(() => buildParticles(season), [season]);
  if (reducedMotion || !enabled || season === "none" || particles.length === 0) return null;

  return (
    <div aria-hidden className="season-overlay">
      {particles.map((particle, index) => (
        <span
          key={`${season}-${index}`}
          className={`season-particle season-${season}`}
          style={{
            left: `${particle.left}%`,
            width: season === "spring" ? "1.5px" : `${particle.size}px`,
            height: season === "spring" ? "26px" : `${season === "winter" ? particle.size : particle.size * 0.72}px`,
            opacity: particle.opacity,
            animationDelay: `${particle.delay}s`,
            animationDuration: `${particle.duration}s`,
            "--season-drift": `${particle.drift}px`,
            "--season-spin": `${particle.spin}deg`
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
