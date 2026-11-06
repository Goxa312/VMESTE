import type { Metadata } from "next";
import { siteName } from "@/lib/brand";
import { cookies } from "next/headers";
import { LanguageProvider } from "@/components/language";
import { translate, type Locale } from "@/lib/i18n";
import "./theme.css";
async function language(): Promise<Locale> {
 return (await cookies()).get("tt-lang")?.value === "en" ? "en" : "ru";
}
export async function generateMetadata(): Promise<Metadata> {
 const locale = await language();
 return {
 title: translate(locale, "{0} — личный кинозал", siteName),
 description: translate(locale, "Смотрите фильмы с друзьями по приглашению. Добавьте ссылку, покажите вкладку или загрузите свой фильм."),
 icons: { icon: "/favicon.svg" },
 };
}
export default async function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
 const locale = await language();
 return <html lang={locale}><body><LanguageProvider initial={locale}>{children}</LanguageProvider></body></html>;
}
