export function Quickstart() {
  return (
    <section id="usage" className="px-4 py-8 border-t border-neutral-100">
      <div className="mx-auto max-w-xl">
        <h2 className="text-xl mb-4">Usage</h2>

        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-medium text-neutral-800 mb-2">
              Single task
            </h3>
            <pre className="bg-neutral-50 border border-neutral-200 rounded p-3 text-sm overflow-x-auto">
              <code className="text-neutral-700">
                {`ralphy "add dark mode toggle"
ralphy "fix the auth bug" --cursor`}
              </code>
            </pre>
          </div>

          <div>
            <h3 className="text-sm font-medium text-neutral-800 mb-2">
              Task list
            </h3>
            <pre className="bg-neutral-50 border border-neutral-200 rounded p-3 text-sm overflow-x-auto">
              <code className="text-neutral-700">
                {`ralphy --prd PRD.md
ralphy --github owner/repo --label "ai-task"`}
              </code>
            </pre>
          </div>

          <div>
            <h3 className="text-sm font-medium text-neutral-800 mb-2">
              Parallel
            </h3>
            <pre className="bg-neutral-50 border border-neutral-200 rounded p-3 text-sm overflow-x-auto">
              <code className="text-neutral-700">
                {`ralphy --prd PRD.md --parallel --max-parallel 5`}
              </code>
            </pre>
          </div>

          <div>
            <h3 className="text-sm font-medium text-neutral-800 mb-2">
              Config
            </h3>
            <pre className="bg-neutral-50 border border-neutral-200 rounded p-3 text-sm overflow-x-auto">
              <code className="text-neutral-700">
                {`ralphy --init
ralphy --add-rule "use TypeScript strict mode"`}
              </code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
