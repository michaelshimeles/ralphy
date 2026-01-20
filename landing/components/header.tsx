import Image from "next/image";
import Link from "next/link";

export function Header() {
  return (
    <header className="py-4 px-4">
      <div className="mx-auto max-w-xl flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-neutral-800">
          <Image
            src="/logo.png"
            alt="Ralphy"
            width={32}
            height={32}
            className="rounded"
          />
          <span className="font-medium">ralphy</span>
        </Link>

        <nav className="flex items-center gap-4 text-sm">
          <Link
            href="#engines"
            className="hidden sm:inline text-neutral-500 hover:text-neutral-800 underline"
          >
            engines
          </Link>
          <Link
            href="#usage"
            className="hidden sm:inline text-neutral-500 hover:text-neutral-800 underline"
          >
            usage
          </Link>
          <Link
            href="https://github.com/michaelshimeles/ralphy"
            target="_blank"
            className="text-neutral-500 hover:text-neutral-800 underline"
          >
            github
          </Link>
          <Link
            href="https://rasmic.link/discord"
            target="_blank"
            className="text-neutral-500 hover:text-neutral-800 underline"
          >
            discord
          </Link>
          <Link
            href="https://www.npmjs.com/package/ralphy-cli"
            target="_blank"
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700"
          >
            install
          </Link>
        </nav>
      </div>
    </header>
  );
}
