import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TripProvider } from "@/components/store";
import PhoneFrame from "@/components/PhoneFrame";

export const metadata: Metadata = {
  title: "같이가 — 그룹 여행 합의 도구",
  description: "각자 가고 싶은 곳과 예산·체력을 비공개로 입력하면, 아무도 무리하지 않는 일정을 만들어 드려요.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <TripProvider>
          <PhoneFrame>{children}</PhoneFrame>
        </TripProvider>
      </body>
    </html>
  );
}
