import type { Metadata } from "next";
import "./theme.css";
export const metadata: Metadata = {
 title: "Вместе — личный кинозал",
 description: "Смотрите фильмы с друзьями по приглашению. Добавьте ссылку, покажите вкладку или загрузите свой фильм.",
 icons: { icon: "/favicon.svg" },
};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
 return <html lang="ru"><body>{children}</body></html>;
}
