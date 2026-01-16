"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import LoginForm from "./LoginForm";

const HERO_VIDEO = { width: 3840, height: 2876 };
const HERO_BOX = { x: 703, y: 1455, width: 2048, height: 1421 };
const HERO_TUNE = { shiftX: -0.012, shiftY: -0.004, scaleW: 0.02, scaleH: -0.165, inset: 0 };

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export default function LoginHero() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const heroTextRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [boxStyle, setBoxStyle] = useState<React.CSSProperties>({
    "--box-x": "0px",
    "--box-y": "0px",
    "--box-w": "0px",
    "--box-h": "0px",
    "--ui-scale": "1",
    "--hero-text-scale": "1",
    "--hero-text-y": "0px",
  });

  useEffect(() => {
    const updatePosition = () => {
      const container = containerRef.current;
      if (!container) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;

      const video = videoRef.current;
      const videoWidth = video?.videoWidth || HERO_VIDEO.width;
      const videoHeight = video?.videoHeight || HERO_VIDEO.height;

      const scale = Math.max(width / videoWidth, height / videoHeight);
      const renderWidth = videoWidth * scale;
      const renderHeight = videoHeight * scale;
      const offsetX = (renderWidth - width) / 2;
      const offsetY = (renderHeight - height) / 2;
      const visibleX = offsetX / scale;
      const visibleY = offsetY / scale;

      let boxX = (HERO_BOX.x - visibleX) * scale;
      let boxY = (HERO_BOX.y - visibleY) * scale;
      let boxW = HERO_BOX.width * scale;
      let boxH = HERO_BOX.height * scale;

      const shiftX = boxW * HERO_TUNE.shiftX;
      const shiftY = boxH * HERO_TUNE.shiftY;
      const scaleW = boxW * HERO_TUNE.scaleW;
      const scaleH = boxH * HERO_TUNE.scaleH;

      boxX += shiftX;
      boxY += shiftY;
      boxW += scaleW;
      boxH += scaleH;

      const inset = clamp(Math.min(boxW, boxH) * HERO_TUNE.inset, 10, 28);
      boxX += inset;
      boxY += inset;
      boxW -= inset * 2;
      boxH -= inset * 2;

      boxX = Math.max(0, boxX);
      boxY = Math.max(0, boxY);
      boxW = Math.max(0, Math.min(boxW, width - boxX));
      boxH = Math.max(0, Math.min(boxH, height - boxY));

      const cover = clamp(Math.min(boxW, boxH) * 0.01, 0, 8);
      const nudgeY = -5;
      const safeX = Math.max(0, boxX - cover);
      const safeY = Math.max(0, boxY - cover + nudgeY);
      const safeW = Math.max(0, Math.min(boxW + cover * 2, width - safeX));
      const safeH = Math.max(0, Math.min(boxH + cover * 2, height - safeY));

      const uiScale = clamp(Math.min(safeW / 760, safeH / 420), 0.72, 1.05);
      let heroTextScale = clamp(Math.min(width / 1440, height / 900), 0.6, 1.05);
      const heroTextBaseHeight =
        heroTextRef.current?.offsetHeight ?? clamp(height * 0.18, 120, 240);
      const heroTextGap = clamp(height * 0.045, 32, 64);
      const heroTextMinTop = 80;
      const heroTextMaxSpace = safeY - heroTextGap - heroTextMinTop;
      if (heroTextBaseHeight > 0 && heroTextMaxSpace > 0) {
        const fitScale = clamp(heroTextMaxSpace / heroTextBaseHeight, 0.5, 1.05);
        heroTextScale = Math.min(heroTextScale, fitScale);
      }
      const heroTextHeight = heroTextBaseHeight * heroTextScale;
      const heroTextY = Math.max(
        heroTextMinTop,
        safeY - heroTextHeight - heroTextGap
      );

      setBoxStyle({
        "--box-x": `${safeX}px`,
        "--box-y": `${safeY}px`,
        "--box-w": `${safeW}px`,
        "--box-h": `${safeH}px`,
        "--ui-scale": uiScale.toFixed(3),
        "--hero-text-scale": heroTextScale.toFixed(3),
        "--hero-text-y": `${heroTextY}px`,
      } as React.CSSProperties);
      setReady(true);
    };

    updatePosition();

    const container = containerRef.current;
    if (!container) return;
    const resizeObserver = new ResizeObserver(updatePosition);
    resizeObserver.observe(container);

    const video = videoRef.current;
    video?.addEventListener("loadedmetadata", updatePosition);
    window.addEventListener("orientationchange", updatePosition);

    return () => {
      resizeObserver.disconnect();
      video?.removeEventListener("loadedmetadata", updatePosition);
      window.removeEventListener("orientationchange", updatePosition);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative min-h-screen overflow-hidden bg-black text-white"
      style={boxStyle}
      data-hero="login"
    >
      {/* Video background */}
      <div className="absolute inset-0">
        <video
          ref={videoRef}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover object-[center_center]"
          style={{
            objectPosition: "center center",
          }}
        >
          <source src="/hero.mp4" type="video/mp4" />
        </video>
      </div>

      {/* Top nav */}
      <header className="relative z-10 border-b border-white/10 bg-black/20 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Basel Medical CRM
          </Link>
          <Link
            href="/signup"
            className="text-sm text-white/80 transition hover:text-white"
          >
            Create account
          </Link>
        </div>
      </header>

      {/* Hero text */}
      <div
        ref={heroTextRef}
        className="absolute left-4 z-20 space-y-4 sm:left-6 sm:space-y-6 md:left-8 lg:left-12"
        style={{
          maxWidth: "350px",
          width: "clamp(260px, 30vw, 350px)",
          top: "var(--hero-text-y)",
          transform: "scale(var(--hero-text-scale))",
          transformOrigin: "left top",
        }}
      >
        <div className="text-[clamp(0.6rem,0.85vw,0.8rem)] font-medium tracking-[0.22em] text-white/70">
          TIFFANY EDITION
        </div>
        <h1 className="text-[clamp(1.9rem,3.8vw,3.6rem)] font-semibold leading-[1.05] tracking-tight">
          Basel Medical CRM
        </h1>
      </div>

      <div
        className={`absolute z-30 flex transition-opacity ${
          ready ? "opacity-100" : "opacity-0"
        }`}
        style={{
          left: "var(--box-x)",
          top: "var(--box-y)",
          width: "var(--box-w)",
          height: "var(--box-h)",
        }}
        data-login-card
      >
        <div className="relative flex h-full w-full flex-col justify-center overflow-y-auto rounded-lg border border-white/15 bg-black/30 shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-xl">
          <div className="flex h-full w-full items-center justify-center">
            <div
              className="w-full"
              style={{ transform: "scale(var(--ui-scale))", transformOrigin: "center" }}
            >
              <div className="px-6 py-6 sm:px-8 sm:py-8 md:px-10 md:py-10">
                {/* Content layer */}
                <div className="relative z-10">
                  <div className="text-xs font-medium text-white/70 sm:text-sm">
                    Welcome back
                  </div>
                  <h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl md:text-3xl">
                    Login
                  </h2>
                  <p className="mt-2 text-xs text-white/70 sm:text-sm md:text-base">
                    Sign in to continue to your workspace.
                  </p>

                  <LoginForm />

                  <div className="mt-4 text-xs text-white/70 sm:mt-6 sm:text-sm">
                    New here?{" "}
                    <Link
                      href="/signup"
                      className="font-medium text-white hover:underline"
                    >
                      Create an account
                    </Link>
                    .
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
