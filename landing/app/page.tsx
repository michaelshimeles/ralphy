import { Header } from "@/components/header";
import { Hero } from "@/components/hero";
import { Features } from "@/components/features";
import { Engines } from "@/components/engines";
import { Quickstart } from "@/components/quickstart";
import { Footer } from "@/components/footer";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Ralphy",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "macOS, Linux, Windows",
  description:
    "Run AI agents on your tasks until done. Supports Claude Code, OpenCode, Codex, Cursor, Qwen-Code and Factory Droid.",
  url: "https://ralphy.goshen.fyi",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  author: {
    "@type": "Organization",
    name: "Ralphy",
  },
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main>
        <Header />
        <Hero />
        <Features />
        <Engines />
        <Quickstart />
        <Footer />
      </main>
    </>
  );
}
