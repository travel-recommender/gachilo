"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Splash } from "@/components/Splash";

/** P0 — 로딩 화면을 잠깐 보여주고 방 만들기(P1)로 간다 */
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => router.replace("/create"), 2200);
    return () => clearTimeout(t);
  }, [router]);
  return <Splash />;
}
