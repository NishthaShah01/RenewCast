"""The copilot — plain-language narration of a despatch plan.

Two modes, and the API says which one produced an answer:

  gemini         — an LLM writes the prose, grounded in a compact fact block
                   assembled here. It is never given the raw payload and never
                   asked to compute anything.
  deterministic  — templates over the same facts. Not a degraded fallback: it
                   is what runs when no key is set, and it is correct.

The division matters. Every number in the answer is computed by the decisions
engine and interpolated; the model's only job is to sequence and phrase them.
An LLM that is allowed to do the arithmetic will eventually get it wrong in a
way that reads perfectly fluently.
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request

from app.config import settings
from app.core.timeblocks import block_label
from app.schemas import CopilotResponse, DecisionResponse

# The default model is a flash-lite, chosen because it answers in ~1-4 s where
# the full flash models take 12-30 s on the same task.
_TIMEOUT_S = 30

# The budget is pinned as low as the API permits — it rejects 0, and treats the
# number as a hint rather than a cap. A 128 budget still buys ~1,100 tokens of
# deliberation on this prompt: it is a nudge toward brevity, not a limit.
#
# Reasoning and prose share the output ceiling, so it has to cover both.
# Measured: ~1,100 tokens thinking about a despatch question and ~50 writing the
# answer. At a 1,200 cap that tripped MAX_TOKENS on half the calls — which this
# module correctly discards, so the copilot fell back to templates at random.
# The headroom is for the reasoning, not the answer.
_THINKING_BUDGET = 128
_MAX_OUTPUT_TOKENS = 3000

# Set when the API reports a spent quota; until then every call short-circuits
# to the deterministic explainer. Process-local and deliberately not persisted —
# a restart should re-test rather than inherit a stale verdict.
_quota_block_until = 0.0
_QUOTA_COOLDOWN_S = 900
_DAILY_COOLDOWN_S = 6 * 60 * 60


def _retry_after(exc: urllib.error.HTTPError) -> float:
    """Seconds to wait before trying Gemini again, read from the 429 body.

    The same 429 covers a per-minute burst and the daily free-tier cap, and the
    advertised retryDelay does not distinguish them — a day-exhausted key still
    reports "retry in 28s", which would have us retrying every half minute until
    midnight Pacific. So the quotaId decides: anything naming PerDay parks the
    LLM path for the rest of the session, and only a genuine per-minute window
    is honoured at its stated delay.
    """
    try:
        body = json.loads(exc.read())
    except (json.JSONDecodeError, ValueError, OSError):
        return _QUOTA_COOLDOWN_S

    details = body.get("error", {}).get("details", [])
    daily = any(
        "PerDay" in v.get("quotaId", "")
        for d in details
        for v in d.get("violations", [])
    )
    if daily:
        return _DAILY_COOLDOWN_S

    for detail in details:
        delay = detail.get("retryDelay")  # e.g. "28s"
        if delay:
            try:
                return max(float(str(delay).rstrip("s")), 1.0)
            except ValueError:
                break
    return _QUOTA_COOLDOWN_S

SYSTEM = """You are a despatch assistant for an Indian renewable generator.

You are talking to a control-room operator who has the numbers on screen already.
Your job is to tell them what to do and why, in the vernacular they use:
despatch, block, declaration of capability, evacuation, DSM.

Grounding, absolute:
- Every number you write must appear in the FACTS block. Never compute a new one.
- Never invent a cause. If the FACTS do not say why, state the number without a
  because-clause. Never guess which side of a limit a value falls on.
- Never write an identifier like battery_charge. Use the words the FACTS use.
- Each action says what it remedies. Only offer an action whose remedy matches
  what was asked: a question about curtailment or surplus is answered by a
  surplus remedy, never by one that adds generation. If no listed action
  remedies what was asked, say so instead of offering the nearest one.

Shape:
- Answer the question that was asked, in its own terms. "Should I…" gets yes or
  no as the first word. "What is…" or "how much…" gets the number first. Never
  open with yes or no on a question that cannot be answered with yes or no.
- Yes or no must match what follows. If you go on to name an action the operator
  should take, the answer was yes. Only say no when your next sentence explains
  why nothing needs doing.
- Lead with the highest-ranked action that actually answers the question. When
  the question is general ("what should I do today?"), that is action 1, which
  carries the most money. Mention later actions only if they bear on the
  question.
- Two or three sentences. One is too few: a number with no consequence is what
  the operator was already looking at. Say what it means or what to do about it.
- Give the reason in your own words. A recommendation with no reason is a number
  the operator already had. Do not quote the FACTS labels back; they name the
  arithmetic, they are not an explanation.
- No preamble, no bullets, no markdown.
- If nothing needs action, say so plainly and stop.

Example of the register — "what should I do about the evening peak?" at a site
whose first action is a battery:
"Charge the battery at 73 MW across blocks 32-42, storing 201 MWh for ₹4.6 lakh.
That is cheaper than curtailing the same energy, which would forgo ₹5.0 lakh at
the PPA tariff. Nothing else needs revision before block 33."
"""


_ACTION_WORDS = {
    "battery_charge": "charge the battery",
    "battery_discharge": "discharge the battery",
    "curtail": "curtail output",
    "gas_peaker": "start the gas peaker",
    "diesel": "start diesel backup",
}

# What each action is a remedy for. The split is structural, not incidental:
# charging and curtailing dispose of surplus, everything else covers a shortfall.
# Without this the model treats merit order as relevance and answers "what should
# I do about curtailment?" with the peaker at rank 1 — which adds generation to a
# site that already has too much.
_ACTION_REMEDIES = {
    "battery_charge": "surplus",
    "curtail": "surplus",
    "battery_discharge": "shortfall",
    "gas_peaker": "shortfall",
    "diesel": "shortfall",
}

# "Yes — your shortfall risk is 476 MWh" answers a question nobody asked. The
# model opens with an affirmation on anything that mentions risk, and two rounds
# of telling it not to did not stick, so the rule is enforced here instead: the
# condition is decidable from the question text, which makes it code, not a hint.
_WH_QUESTION = re.compile(r"^\s*(what|how|which|when|where|who|why)\b", re.I)

# Punctuation is required. Without it this would eat the "No" in "No curtailment
# is expected today" and invert the answer.
_YESNO_OPENER = re.compile(r"^(yes|no)\s*[—–,:.-]\s+", re.I)


def _strip_false_opener(question: str, answer: str) -> str:
    """Drop a yes/no opener from an answer to a question that asked neither."""
    if not _WH_QUESTION.match(question):
        return answer
    stripped = _YESNO_OPENER.sub("", answer, count=1)
    if stripped == answer:
        return answer
    return stripped[:1].upper() + stripped[1:]


def _rupees(amount: float) -> str:
    """₹ in the convention an Indian operator reads without converting.

    Below a lakh the exact figure is the useful one; above it, digit-grouped
    rupees stop being legible at a glance and lakh/crore is what the commercial
    team actually says out loud. Magnitude only — the caller supplies the verb
    that carries the sign, because "costs -₹4.6 lakh" is a puzzle.
    """
    value = abs(amount)
    if value >= 1e7:
        return f"₹{value / 1e7:.2f} crore"
    if value >= 1e5:
        return f"₹{value / 1e5:.1f} lakh"
    return f"₹{value:,.0f}"


def _facts(d: DecisionResponse) -> str:
    """The grounding block. Compact, unambiguous, and entirely pre-computed.

    Every line has to survive being read as a bare assertion. An earlier version
    wrote "curtailment: 0 MWh (P90 above evacuation limit)" — intended as the
    definition of the metric, but it reads as a claim that P90 *is* above the
    limit, and the model dutifully repeated that back. Parentheticals here state
    what was compared, never a relationship that may not hold.
    """
    # Three, not four. The model deliberates in proportion to how much it is
    # given, and the fourth-ranked action is never the headline anyway.
    ranked = [a for a in d.actions if a.actionable]
    actionable = ranked[:3]

    # …except that merit order is by money, so on a day whose largest costs are
    # all shortfall cover, the one action that answers a curtailment question can
    # rank fourth and vanish. If the day has curtailment and the trim left no
    # surplus remedy, put the best one back.
    if d.curtailment_energy_mwh >= 1 and not any(
        _ACTION_REMEDIES.get(a.action) == "surplus" for a in actionable
    ):
        rescued = next(
            (a for a in ranked if _ACTION_REMEDIES.get(a.action) == "surplus"), None
        )
        if rescued:
            actionable.append(rescued)

    # Each line has to be unmistakable on its own. The deficit, surplus and
    # curtailment figures are all P90/P10 comparisons stated one after another,
    # and a model reading quickly will attribute one line's number to the next:
    # it called the 2557 MWh surplus "the excess over the evacuation limit",
    # which was the line below. So each line names the two quantities compared.
    #
    # Stated as comparisons, not definitions. A glossed line ("shortfall risk
    # (declared schedule that may not materialise)") gets recited back word for
    # word as though it were an explanation, and the operator is handed our
    # documentation instead of an answer.
    curtailment = (
        f"curtailment, generation over the evacuation limit: "
        f"{d.curtailment_energy_mwh:.0f} MWh"
        if d.curtailment_energy_mwh >= 1
        else "curtailment, generation over the evacuation limit: none today"
    )

    # Derived, not hardcoded to 96: a shortened horizon returns fewer blocks, and
    # a range that claims blocks the plan does not cover is a new kind of wrong.
    last_block = d.blocks[-1].block if d.blocks else d.revision_horizon_block

    lines = [
        f"site: {d.site.name}, {d.site.technology}, {d.site.capacity_mw:.0f} MW",
        f"evacuation limit: {d.site.evacuation_limit_mw:.0f} MW",
        f"despatch date: {d.despatch_date}",
        f"current block: {d.current_block}",
        # Stated as a range, not a threshold. "first revisable block: 35" was
        # read three separate ways as a ceiling — "the revision window only
        # reaches block 35" — and a prohibition in the system prompt did not
        # undo it. A span has no wrong end to read.
        f"revisable blocks: {d.revision_horizon_block} to {last_block} "
        f"(blocks 1 to {d.revision_horizon_block - 1} are locked and cannot be changed)",
        # The standing assessment, already decided by the decisions engine. Without
        # it the model has to infer whether the day is in trouble, and a cautious
        # model infers "no action needed" beside a 648 MWh shortfall.
        f"assessment: {d.headline}",
        f"shortfall risk, declared schedule over the P10 floor: "
        f"{d.deficit_energy_mwh:.0f} MWh",
        f"surplus, P90 ceiling over the declared schedule: "
        f"{d.surplus_energy_mwh:.0f} MWh",
        curtailment,
        f"net cost of the plan: INR {d.net_cost_inr:,.0f} (negative is a saving)",
        f"net CO2: {d.net_co2_tonnes:.1f} t",
    ]
    if d.worst_block:
        lines.append(f"worst block: {d.worst_block} ({block_label(d.worst_block)})")
    if actionable:
        lines.append(
            "recommended actions, in merit order — the FIRST is the headline, "
            "and any others are secondary. Each one can still be filed, though a "
            "run that began before the horizon is only revisable from the block "
            "noted on it:"
        )
        for rank, a in enumerate(actionable, start=1):
            # Human words, not the enum. The model echoes whatever it is handed,
            # and "battery_charge at 73 MW" on an operator's screen is a leak of
            # our internal vocabulary into their despatch instruction.
            verb = _ACTION_WORDS.get(a.action, a.action.replace("_", " "))
            # A run of one is a block, not a range. "blocks 96-96" is the kind of
            # seam an operator reads as a bug in the tool.
            span = (
                f"block {a.block_start}"
                if a.block_start == a.block_end
                else f"blocks {a.block_start}-{a.block_end}"
            )
            # The rationale goes on its own labelled line. Trailing it after a
            # colon reads as a sentence fragment to complete, and the model
            # grafts it onto a because-clause: "because store 73 MW instead of
            # curtailing it."
            # A run that starts before the horizon and ends after it is actionable
            # — the engine tests b_end >= horizon — but only its tail can still be
            # filed. Saying "every action here is revisable" while listing blocks
            # 32-42 against a horizon of 35 is a contradiction, and the model spent
            # five answers trying to reconcile it.
            if a.block_start < d.revision_horizon_block:
                span += f", revisable from block {d.revision_horizon_block}"
            lines.append(
                f"  {rank}. {verb} at {a.magnitude_mw:.0f} MW, {span}"
                f" ({a.label}), {a.energy_mwh:.0f} MWh, INR {a.cost_inr:,.0f}"
                f" — remedies {_ACTION_REMEDIES.get(a.action, 'the deviation')}"
            )
            lines.append(f"     why: {a.rationale}")
    else:
        lines.append("no actionable recommendations remain today")
    return "\n".join(lines)


def _gemini(question: str, facts: str) -> str | None:
    """One call, no SDK. Returns None on any failure so the caller falls back."""
    global _quota_block_until

    # A spent quota stays spent. Re-asking costs a round trip to be told the
    # same thing, and during a demo that is dead air before every answer.
    if time.monotonic() < _quota_block_until:
        return None

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{settings.gemini_model}:generateContent?key={settings.gemini_api_key}"
    )

    def _body(thinking: bool) -> bytes:
        config: dict = {"temperature": 0.2, "maxOutputTokens": _MAX_OUTPUT_TOKENS}
        if thinking:
            config["thinkingConfig"] = {"thinkingBudget": _THINKING_BUDGET}
        return json.dumps(
            {
                "system_instruction": {"parts": [{"text": SYSTEM}]},
                "contents": [
                    {"parts": [{"text": f"FACTS:\n{facts}\n\nQUESTION: {question}"}]}
                ],
                "generationConfig": config,
            }
        ).encode()

    # Two attempts at most: with the thinking budget pinned low, then without it
    # at all. A model that rejects thinkingConfig as an unknown argument should
    # cost us fluency, not the LLM path entirely.
    for thinking in (True, False):
        req = urllib.request.Request(
            url, data=_body(thinking), headers={"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as resp:
                payload = json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            if exc.code == 400 and thinking:
                continue  # Probably the thinking budget. Try plain.
            if exc.code == 429:
                # Quota spent. Park the LLM path so every later question goes
                # straight to the deterministic explainer instead of paying a
                # round trip to be refused again.
                _quota_block_until = time.monotonic() + _retry_after(exc)
            # Not an error in any useful sense: the deterministic explainer
            # answers the question correctly, so the user sees prose either way.
            return None
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError):
            return None

        try:
            candidate = payload["candidates"][0]
            # A cut-off answer is worse than a template one: it states half a
            # recommendation, and half of "do not curtail" is dangerous.
            if candidate.get("finishReason") not in (None, "STOP"):
                return None
            # Join every non-thought text part rather than trusting parts[0] — a
            # reasoning model can put a thought first and the prose second.
            parts = candidate["content"].get("parts") or []
            text = " ".join(
                p["text"].strip()
                for p in parts
                if p.get("text") and not p.get("thought")
            ).strip()
        except (KeyError, IndexError):
            return None

        return text or None

    return None


def _deterministic(d: DecisionResponse) -> str:
    """Templates over the same facts. Correct, if less fluent."""
    actionable = [a for a in d.actions if a.actionable]

    if not actionable:
        return (
            f"{d.site.name} is on plan for the rest of {d.despatch_date} — no revision "
            f"is worth filing. Blocks before {d.revision_horizon_block} are locked and "
            f"cannot be changed now."
        )

    first = actionable[0]
    verb = _ACTION_WORDS.get(first.action, first.action.replace("_", " "))

    money = f"{'saves' if first.cost_inr < 0 else 'costs'} {_rupees(first.cost_inr)}"

    tail = ""
    if d.curtailment_energy_mwh > 1:
        tail = (
            f" Separately, {d.curtailment_energy_mwh:.0f} MWh sits above the "
            f"{d.site.evacuation_limit_mw:.0f} MW evacuation limit and cannot be exported."
        )
    elif d.deficit_energy_mwh > 1:
        tail = (
            f" Shortfall risk across the day is {d.deficit_energy_mwh:.0f} MWh "
            f"measured against the P10 floor."
        )

    # The rationale already ends in a period, so appending one yields "..".
    rationale = first.rationale.rstrip(".")

    span = (
        f"in block {first.block_start}"
        if first.block_start == first.block_end
        else f"across blocks {first.block_start}–{first.block_end}"
    )

    return (
        f"At {d.site.name}, {verb} at {first.magnitude_mw:.0f} MW {span} "
        f"({first.label}); this {money}. "
        f"{rationale}.{tail}"
    )


def answer(question: str, d: DecisionResponse) -> CopilotResponse:
    facts = _facts(d)

    if settings.gemini_api_key:
        text = _gemini(question, facts)
        if text:
            return CopilotResponse(
                answer=_strip_false_opener(question, text),
                mode="gemini",
                grounded_on=facts,
            )

    return CopilotResponse(answer=_deterministic(d), mode="deterministic", grounded_on=facts)
