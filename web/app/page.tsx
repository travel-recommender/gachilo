"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SPLASH_DONE_MS, Splash } from "@/components/Splash";

/** P0 — 로딩 화면을 잠깐 보여주고 방 만들기(P1)로 간다 */
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => router.replace("/create"), SPLASH_DONE_MS);
    return () => clearTimeout(t);
  }, [router]);
  return <Splash />;
}
