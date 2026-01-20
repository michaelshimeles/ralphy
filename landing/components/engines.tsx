const engines = [
  { name: "Claude Code", flag: "--claude", default: true },
  { name: "OpenCode", flag: "--opencode" },
  { name: "Cursor", flag: "--cursor" },
  { name: "Codex", flag: "--codex" },
  { name: "Qwen-Code", flag: "--qwen" },
  { name: "Factory Droid", flag: "--droid" },
];

export function Engines() {
  return (
    <section id="engines" className="px-4 py-8 border-t border-neutral-100">
      <div className="mx-auto max-w-xl">
        <h2 className="text-xl mb-4">Supported Engines</h2>

        <ul className="space-y-1.5 text-sm">
          {engines.map((engine) => (
            <li key={engine.name} className="flex items-baseline gap-2">
              <code className="text-neutral-500">{engine.flag}</code>
              <span className="text-neutral-600">{engine.name}</span>
              {engine.default && (
                <span className="text-neutral-400 text-xs">(default)</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
