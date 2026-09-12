"use client";

import { useState } from "react";
import { motion } from "motion/react";

import { api, ApiError } from "@/lib/api";
import type { CopilotResponse } from "@/lib/types";

/**
 * The copilot.
 *
 * Every number in an answer is computed by the decisions engine and passed to
 * the model as a fact block; the model sequences and phrases, nothing more.
 * The mode is shown next to each answer because a rule-based reply must never
 * be able to pass as a model-generated one, or the reverse.
 */

const SUGGESTIONS = [
  "What should I do in the next hour?",
  "Why is there curtailment today?",
  "What is the cheapest way to cover the shortfall?",
];

export function Copilot({ siteId, siteName }: { siteId: string; siteName: string }) {
  const [question, setQuestion] = useState("");
  const [reply, setReply] = useState<CopilotResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function ask(q: string) {
    if (!q.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      setReply(await api.ask(siteId, q));
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "The copilot didn't respond. Try again.",
      );
      setReply(null);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-panel border border-[var(--ring)] bg-surface">
      <header className="flex items-baseline justify-between border-b border-[var(--gridline)] px-4 py-3">
        <h2 className="text-14 font-semibold">Ask about this plan</h2>
        <span className="text-11 text-ink-muted">Grounded on {siteName}&rsquo;s numbers</span>
      </header>

      <div className="px-4 py-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
          className="flex gap-2"
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What should I do in the next hour?"
            aria-label="Question about this despatch plan"
            className="min-w-0 flex-1 rounded-control border border-[var(--ring)] bg-page px-3 py-2 text-14 placeholder:text-ink-muted"
          />
          <button
            type="submit"
            disabled={pending || !question.trim()}
            className="btn-primary text-13 px-4 py-2"
          >
            {pending ? "Asking" : "Ask"}
          </button>
        </form>

        <ul className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => {
                  setQuestion(s);
                  ask(s);
                }}
                className="btn-secondary rounded-pill text-11 px-3 py-1 font-normal"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>

        {error ? (
          <p className="mt-4 text-14" style={{ color: "var(--delta-neg)" }}>
            {error}
          </p>
        ) : null}

        {reply ? (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="mt-4 border-l-2 pl-3"
            style={{ borderColor: "var(--series-1)" }}
          >
            <p className="max-w-[86ch] text-14">{reply.answer}</p>
            <p className="mt-2 text-11 text-ink-muted">
              {reply.mode === "gemini"
                ? "Written by Gemini from the plan's own figures — it is not allowed to compute new ones."
                : "Rule-based narration. No API key is configured, and the numbers are identical either way."}
            </p>
          </motion.div>
        ) : null}
      </div>
    </section>
  );
}
