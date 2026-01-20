export function Features() {
  return (
    <section id="features" className="px-4 py-8 border-t border-neutral-100">
      <div className="mx-auto max-w-xl">
        <h2 className="text-xl mb-4">How it works</h2>

        <div className="space-y-4 text-sm text-neutral-600">
          <p>
            <strong className="text-neutral-800">Task sources.</strong> Define
            tasks in Markdown PRDs, YAML files, or pull directly from GitHub
            Issues. Ralphy works through each task sequentially or in parallel.
          </p>

          <p>
            <strong className="text-neutral-800">Branch per task.</strong> Each
            task runs on its own git branch. Changes are auto-committed, and PRs
            are created when complete.
          </p>

          <p>
            <strong className="text-neutral-800">Parallel worktrees.</strong>{" "}
            Run multiple AI agents simultaneously using git worktrees. Each
            agent works in isolation—no conflicts.
          </p>

          <p>
            <strong className="text-neutral-800">Project rules.</strong> Define
            rules and boundaries in <code>.ralphy/</code>. The AI follows your
            conventions: "use TypeScript", "never modify migrations", etc.
          </p>

          <p>
            <strong className="text-neutral-800">Tests and linting.</strong>{" "}
            Tests are written and run by default. Linting runs before completing
            tasks. Skip with <code>--skip-tests</code>, <code>--skip-lint</code>,
            or <code>--fast</code>.
          </p>

          <p>
            <strong className="text-neutral-800">Retry until done.</strong>{" "}
            Automatic retries with exponential backoff. Tasks keep running until
            they succeed or hit the retry limit.
          </p>
        </div>
      </div>
    </section>
  );
}
