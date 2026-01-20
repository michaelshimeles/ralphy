export function Footer() {
  return (
    <footer className="px-4 py-8 border-t border-neutral-100">
      <div className="mx-auto max-w-xl">
        <div className="flex items-center justify-between text-sm text-neutral-500">
          <span>MIT License</span>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/michaelshimeles/ralphy"
              target="_blank"
              className="underline hover:text-neutral-800"
            >
              github
            </a>
            <a
              href="https://www.npmjs.com/package/ralphy-cli"
              target="_blank"
              className="underline hover:text-neutral-800"
            >
              npm
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
