"use client";

import { useState } from "react";
import { Check, Copy, ChevronRight } from "lucide-react";

export function Hero() {
  const [copied, setCopied] = useState(false);
  const installCommand = "npm install -g ralphy-cli";

  const copyToClipboard = () => {
    navigator.clipboard.writeText(installCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="px-4 pt-12 pb-8">
      <div className="mx-auto max-w-xl">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-sm text-neutral-600">
          <span>v4.1.0 available on npm</span>
          <ChevronRight className="h-3 w-3" />
        </div>

        <h1 className="text-2xl leading-tight mb-4">
          The Autonomous AI Coding Loop
        </h1>

        <p className="text-neutral-600 mb-3">
          Run AI agents on your tasks until done. Give it a PRD, a task list, or
          GitHub issues. Ralphy works through them one by one—or in parallel
          using git worktrees.
        </p>

        <p className="text-neutral-500 mb-6">
          Supports Claude Code, OpenCode, Codex, Cursor, Qwen-Code, and Factory
          Droid. Configure project rules so the AI follows your conventions.
        </p>

        <button
          onClick={copyToClipboard}
          className="group flex w-full items-center justify-between rounded-md bg-blue-600 px-4 py-2.5 text-white hover:bg-blue-700 transition-colors"
        >
          <span className="flex items-center gap-2">
            <code className="text-sm">{installCommand}</code>
          </span>
          {copied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4 opacity-70 group-hover:opacity-100" />
          )}
        </button>

        <p className="mt-2 text-xs text-neutral-400">
          *Or clone from{" "}
          <a
            href="https://github.com/michaelshimeles/ralphy"
            className="underline hover:text-neutral-600"
          >
            GitHub
          </a>{" "}
          to use the bash script.
        </p>
      </div>
    </section>
  );
}
