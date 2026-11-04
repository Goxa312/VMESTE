import type { Metadata } from "next";
import "./theme.css";
export const metadata: Metadata = {
 title: "вместе — ваш маленький кинозал",
 description: "Смотрите фильмы, сериалы и аниме вместе с друзьями. Общий плеер, синхронная пауза, комнаты по приглашению и живой чат.",
 icons: { icon: "/favicon.svg" },
};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
 return <html lang="ru"><body>{children}</body></html>;
}
