import type { Metadata } from "next"


import "./globals.css"
import { Geist, Geist_Mono } from "next/font/google"

const geistSans = Geist({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-geist-sans",
})
const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-geist-mono",
})

export const metadata: Metadata = {
  title: "RVC Voicechanger — Real-time RVC Voice Conversion",
  description:
    "A modern, monochrome real-time voice changer. Drop in a .pth + .index and go live with AI voice conversion.",
  generator: "v0.app",
}
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="font-sans antialiased bg-background text-foreground">
        {children}
      </body>
    </html>
  )
}
