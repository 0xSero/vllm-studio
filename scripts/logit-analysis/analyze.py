#!/usr/bin/env python3
"""
Analyze GLM-5.2 logprob JSONL (from collect.py) and emit a doc-style HTML report.

Reads one or more sweep-*.jsonl / monitor-*.jsonl files and computes:
  per token:  top1 prob, surprise (-log p chosen), chosen rank in top-k,
              top-5/10/20 cumulative mass, top-20 normalized entropy
  per probe:  latency, token counts, mean entropy, argmax-confidence trend,
              first-token distribution (formatting bias), refusal/tool-call flags
  stability:  cross-run output variance + top1 jitter at temperature 0.7
  monitor:    latency/status time series for vLLM (:8000) and controller (:8080)

Output: <out>.html  and a concise text summary on stdout.
Style: dense documentation/reference page (no marketing UI).
"""
from __future__ import annotations

import argparse
import glob
import html
import json
import math
import os
import statistics
from collections import Counter, defaultdict
from datetime import datetime


# ---------------------------------------------------------------------------
# Math helpers (top-k logprobs -> probabilities)
# ---------------------------------------------------------------------------
def exp(lp: float | None) -> float:
    if lp is None:
        return 0.0
    try:
        return math.exp(max(lp, -60.0))
    except OverflowError:
        return 0.0


def topk_stats(top_logprobs: list[dict] | None) -> dict:
    """top_logprobs: list of {token, logprob[, bytes]} sorted by prob desc."""
    if not top_logprobs:
        return {}
    lps = [t["logprob"] for t in top_logprobs if t.get("logprob") is not None]
    if not lps:
        return {}
    probs = [exp(x) for x in lps]
    Z = sum(probs)
    # normalized entropy over the returned top-k (bounded 0..log k)
    H = 0.0
    for p in probs:
        if p > 0:
            H -= (p / Z) * math.log(p / Z)
    k = len(lps)
    H_norm = H / math.log(k) if k > 1 else 0.0
    def mass(n):
        return sum(probs[:n]) / Z if Z else 0.0
    return {
        "top1_prob": probs[0],
        "top1_token": top_logprobs[0].get("token"),
        "top5_mass": mass(5),
        "top10_mass": mass(10),
        "top20_mass": mass(1) if False else mass(min(20, k)),
        "entropy_nats": H,
        "entropy_norm": H_norm,
        "k": k,
    }


def chosen_rank(chosen_token: str | None, top_logprobs: list[dict] | None) -> int | None:
    if not chosen_token or not top_logprobs:
        return None
    for i, t in enumerate(top_logprobs):
        if t.get("token") == chosen_token:
            return i + 1
    return None  # chosen not in top-k (rare; means it was outside top-20)


# ---------------------------------------------------------------------------
# Extract per-token rows from a sweep record
# ---------------------------------------------------------------------------
def completion_tokens(rec: dict) -> list[dict]:
    """Return list of {pos, token, chosen_lp, top} for the COMPLETION tokens only."""
    resp = rec.get("response") or {}
    choices = resp.get("choices") or []
    if not choices:
        return []
    ch = choices[0]
    lp = ch.get("logprobs") or {}
    tokens = lp.get("tokens") or []
    tlp = lp.get("token_logprobs") or []
    tops = lp.get("top_logprobs") or []
    if not tokens:
        return []
    # split prompt vs completion using usage.prompt_tokens when available
    usage = resp.get("usage") or {}
    ptok = usage.get("prompt_tokens")
    start = ptok if isinstance(ptok, int) else 0
    # vLLM sets the first prompt token's logprob to None; with echo, index 0 is
    # the first prompt token. If usage is missing, fall back to "all tokens".
    rows = []
    for i in range(start, len(tokens)):
        if i >= len(tlp):
            break
        rows.append({
            "pos": i - start,
            "token": tokens[i],
            "chosen_lp": tlp[i],
            "top": tops[i] if i < len(tops) else None,
        })
    return rows


def chat_tokens(rec: dict) -> list[dict]:
    resp = rec.get("response") or {}
    choices = resp.get("choices") or []
    if not choices:
        return []
    lp = choices[0].get("logprobs") or {}
    content = lp.get("content") or []
    rows = []
    for i, c in enumerate(content):
        rows.append({
            "pos": i,
            "token": c.get("token"),
            "chosen_lp": c.get("logprob"),
            "top": c.get("top_logprobs"),
        })
    return rows


def token_row_stats(row: dict) -> dict:
    s = topk_stats(row.get("top"))
    s["token"] = row.get("token")
    s["chosen_lp"] = row.get("chosen_lp")
    s["chosen_prob"] = exp(row.get("chosen_lp"))
    s["surprise"] = -row["chosen_lp"] if row.get("chosen_lp") is not None else None
    s["chosen_rank"] = chosen_rank(row.get("token"), row.get("top"))
    return s


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------
def aggregate_sweep(records: list[dict]) -> dict:
    completions = [r for r in records if r.get("kind") == "completion"]
    chats = [r for r in records if r.get("kind") == "chat"]
    probes = []

    for r in completions + chats:
        is_chat = r["kind"] == "chat"
        rows = chat_tokens(r) if is_chat else completion_tokens(r)
        stats = [token_row_stats(x) for x in rows]
        n = len(stats)
        valid = [s for s in stats if s.get("chosen_lp") is not None]
        probe = {
            "id": r.get("probe"),
            "kind": r["kind"],
            "status": r.get("status"),
            "latency_ms": r.get("latency_ms"),
            "temperature": r.get("temperature"),
            "n_tokens": n,
            "first_token": stats[0] if stats else None,
            "mean_entropy_norm": statistics.mean([s["entropy_norm"] for s in valid]) if valid else None,
            "mean_top1_prob": statistics.mean([s["top1_prob"] for s in valid]) if valid else None,
            "mean_surprise": statistics.mean([s["surprise"] for s in valid]) if valid else None,
            "mean_top5_mass": statistics.mean([s["top5_mass"] for s in valid]) if valid else None,
            "rank_counter": Counter(s["chosen_rank"] for s in valid if s["chosen_rank"] is not None),
            "stats": stats,
        }
        # generated text (best-effort)
        try:
            if is_chat:
                probe["text"] = r["response"]["choices"][0]["message"].get("content", "")
                probe["finish_reason"] = r["response"]["choices"][0].get("finish_reason")
            else:
                full = r["response"]["choices"][0].get("text", "")
                # strip prompt prefix if we know prompt token split
                probe["text"] = full
                probe["finish_reason"] = r["response"]["choices"][0].get("finish_reason")
        except Exception:
            probe["text"] = None
        probes.append(probe)

    return {"probes": probes, "n_completion": len(completions), "n_chat": len(chats)}


def stability_analysis(records: list[dict]) -> list[dict]:
    """Group stability probes (id contains '#stability') by base id."""
    groups = defaultdict(list)
    for r in records:
        pid = r.get("probe", "")
        if "#stability" in pid:
            base = pid.split("#")[0]
            groups[base].append(r)
    out = []
    for base, runs in groups.items():
        texts = []
        first_top1 = []
        for r in runs:
            try:
                texts.append(r["response"]["choices"][0].get("text", ""))
            except Exception:
                texts.append("")
            rows = completion_tokens(r)
            if rows:
                s = token_row_stats(rows[0])
                first_top1.append(s["top1_prob"])
        out.append({
            "base": base,
            "n": len(runs),
            "unique_texts": len(set(texts)),
            "first_token_top1_mean": statistics.mean(first_top1) if first_top1 else None,
            "first_token_top1_stdev": statistics.stdev(first_top1) if len(first_top1) > 1 else 0.0,
            "sample": texts[0][:120] if texts else "",
        })
    return out


def monitor_summary(records: list[dict]) -> dict:
    by_kind = defaultdict(list)
    for r in records:
        by_kind[r["kind"]].append(r)
    out = {}
    for kind, rs in by_kind.items():
        lats = [x["latency_ms"] for x in rs if x.get("latency_ms") is not None]
        statuses = Counter(x.get("status") for x in rs)
        out[kind] = {
            "n": len(rs),
            "status_counts": dict(statuses),
            "latency_mean": round(statistics.mean(lats), 1) if lats else None,
            "latency_min": round(min(lats), 1) if lats else None,
            "latency_max": round(max(lats), 1) if lats else None,
            "first_ts": rs[0].get("ts"),
            "last_ts": rs[-1].get("ts"),
        }
    return out


# ---------------------------------------------------------------------------
# HTML report (doc-style, dense, minimal ornament)
# ---------------------------------------------------------------------------
CSS = """
:root{--bd:#d4d4d4;--tx:#222;--mut:#666;--ac:#036;}
body{font:13px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe,Roboto,sans-serif;
  color:var(--tx);max-width:1080px;margin:2em auto;padding:0 1.5em;background:#fff;}
h1{font-size:1.5em;border-bottom:2px solid var(--bd);padding-bottom:.3em;margin:0 0 .2em;}
h2{font-size:1.15em;margin:1.6em 0 .5em;border-bottom:1px solid var(--bd);padding-bottom:.2em;}
h3{font-size:1em;margin:1.2em 0 .4em;color:var(--mut);}
.sub{color:var(--mut);font-size:.85em;margin-bottom:1.5em;}
table{border-collapse:collapse;width:100%;font-size:12px;margin:.5em 0 1em;}
th,td{border:1px solid var(--bd);padding:3px 6px;text-align:left;vertical-align:top;}
th{background:#f4f4f4;font-weight:600;}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;}
code,pre,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;}
.cell{text-overflow:ellipsis;white-space:nowrap;max-width:34em;overflow:hidden;}
.ok{color:#060}.bad{color:#a30}.warn{color:#960}
.bar{height:10px;background:#eee;border:1px solid #ccc;position:relative}
.bar>i{display:block;height:100%;background:#bcd}
.legend{color:var(--mut);font-size:11px;margin:.2em 0 1em;}
ul.tight{margin:0;padding-left:1.3em;} ul.tight li{margin:.15em 0;}
.kvs{display:flex;gap:1.5em;flex-wrap:wrap;margin:.5em 0 1em;}
.kv{font-size:12px;} .kv b{display:block;color:var(--mut);font-weight:600;font-size:10px;text-transform:uppercase;}
svg{display:block;margin:.5em 0;}
"""

def esc(s) -> str:
    if s is None:
        return ""
    return html.escape(str(s))


def fmt_pct(x) -> str:
    if x is None:
        return "—"
    return f"{x*100:.1f}"


def fmt_n(x, n=3) -> str:
    if x is None:
        return "—"
    return f"{x:.{n}f}"


def probe_table(agg: dict) -> str:
    rows = ""
    for p in agg["probes"]:
        ft = p.get("first_token") or {}
        ranks = p.get("rank_counter") or Counter()
        rank1 = ranks.get(1, 0)
        rank_gt1 = sum(v for k, v in ranks.items() if k and k > 1)
        finish = p.get("finish_reason") or ""
        text = (p.get("text") or "").replace("\n", "⏎ ")
        if len(text) > 160:
            text = text[:160] + "…"
        first_top = ""
        if ft.get("top"):
            alts = ", ".join(f"{esc(t.get('token'))}:{fmt_n(exp(t.get('logprob')),2)}"
                             for t in ft["top"][:5])
            first_top = f'<span class="mono">{alts}</span>'
        rows += (
            f"<tr>"
            f'<td class="mono">{esc(p["id"])}</td>'
            f'<td class="num">{p["latency_ms"]}</td>'
            f'<td class="num">{p["n_tokens"]}</td>'
            f'<td class="num">{fmt_n(p.get("mean_entropy_norm"))}</td>'
            f'<td class="num">{fmt_pct(p.get("mean_top1_prob"))}</td>'
            f'<td class="num">{fmt_n(p.get("mean_surprise"))}</td>'
            f'<td class="num">{fmt_pct(p.get("mean_top5_mass"))}</td>'
            f'<td class="num">{rank1}/{rank_gt1}</td>'
            f'<td class="mono">{esc(finish)}</td>'
            f'<td class="cell">{esc(text)}</td>'
            f'<td>{first_top}</td>'
            f"</tr>"
        )
    return (
        "<table><thead><tr>"
        "<th>probe</th><th class=num>lat<br>ms</th><th class=num>tok</th>"
        "<th class=num>mean H<sub>n</sub><br>(top20)</th>"
        "<th class=num>mean p<sub>top1</sub></th>"
        "<th class=num>mean<br>surprise</th>"
        "<th class=num>mean<br>top5 mass</th>"
        "<th class=num>rank<br>1/&gt;1</th>"
        "<th>finish</th><th>generated text</th><th>first-token top-5</th>"
        "</tr></thead><tbody>" + rows + "</tbody></table>"
    )


def entropy_trajectory_svg(agg: dict, probe_id: str, width=760, height=120) -> str:
    p = next((x for x in agg["probes"] if x["id"] == probe_id), None)
    if not p or not p["stats"]:
        return ""
    stats = [s for s in p["stats"] if s.get("entropy_norm") is not None]
    if len(stats) < 2:
        return ""
    n = len(stats)
    pts = []
    for i, s in enumerate(stats):
        x = (i / (n - 1)) * (width - 20) + 10
        y = height - 10 - s["entropy_norm"] * (height - 20)
        pts.append(f"{x:.1f},{y:.1f}")
    return (
        f'<svg width={width} height={height} viewBox="0 0 {width} {height}">'
        f'<rect x=9 y=9 width={width-18} height={height-18} fill="#fafafa" stroke="#ddd"/>'
        f'<polyline fill="none" stroke="#345" stroke-width=1.2 points="{" ".join(pts)}"/>'
        f'<text x=10 y={height-1} class=mono font-size=9 fill="#666">pos0</text>'
        f'<text x={width-40} y={height-1} class=mono font-size=9 fill="#666">pos{n-1}</text>'
        f'<text x=10 y=15 class=mono font-size=9 fill="#666">H_n=1.0</text>'
        f'<text x=10 y={height-2} class=mono font-size=9 fill="#666" dy=-2>H_n=0.0</text>'
        f'</svg>'
    )


def bias_section(agg: dict) -> str:
    """Formatting-bias & first-token analysis for the instruction-following probes."""
    ids = ["fmt_one_word", "fmt_three_words", "precision_repeat", "ambig_instruction"]
    out = ""
    for pid in ids:
        p = next((x for x in agg["probes"] if x["id"] == pid), None)
        if not p:
            continue
        ft = p.get("first_token") or {}
        top = ft.get("top") or []
        rows = ""
        for t in top[:10]:
            rows += (
                f"<tr><td class=mono>{esc(t.get('token'))}</td>"
                f'<td class=num>{fmt_n(t.get("logprob"))}</td>'
                f'<td class=num>{fmt_pct(exp(t.get("logprob")))}</td></tr>'
            )
        out += (
            f"<h3>{esc(pid)} — generated: <span class=mono>{esc((p.get('text') or '')[:80])}</span></h3>"
            "<table><thead><tr><th>first-token alt</th><th class=nat>logprob</th><th class=num>prob</th>"
            "</tr></thead><tbody>" + rows + "</tbody></table>"
        )
    return out


def refusal_section(agg: dict) -> str:
    ids = ["refusal_jb_system", "refusal_sensitive"]
    out = ""
    for pid in ids:
        p = next((x for x in agg["probes"] if x["id"] == pid), None)
        if not p:
            continue
        text = (p.get("text") or "").replace("\n", "⏎ ")
        # heuristic: did it comply or refuse?
        low = text.lower()
        complied = not any(k in low for k in ("i can't", "i cannot", "i'm not able",
                                              "as an ai", "i won't", "cannot assist"))
        flag = "complied?" if complied else "refused?"
        stats = p["stats"]
        # probability mass on the first few tokens being refusal-ish: just show top1 trend
        out += (
            f"<h3>{esc(pid)} — <span class=mono>{flag}</span> — {p['n_tokens']} tokens, "
            f"mean p_top1={fmt_pct(p.get('mean_top1_prob'))}, mean H_n={fmt_n(p.get('mean_entropy_norm'))}</h3>"
            f'<pre style="white-space:pre-wrap;border:1px solid #ddd;padding:.5em">{esc(text[:500])}</pre>'
        )
    return out


def tool_section(agg: dict) -> str:
    out = ""
    for p in agg["probes"]:
        if p["kind"] != "chat":
            continue
        finish = p.get("finish_reason") or ""
        text = (p.get("text") or "").replace("\n", "⏎ ")
        cls = "ok" if finish == "tool_calls" else "warn"
        out += (
            f"<h3>{esc(p['id'])} — finish=<span class={cls} mono>{esc(finish)}</span> "
            f"— {p['n_tokens']} tokens, mean H_n={fmt_n(p.get('mean_entropy_norm'))}</h3>"
            f'<pre style="white-space:pre-wrap;border:1px solid #ddd;padding:.5em;max-height:8em;overflow:auto">{esc(text[:600])}</pre>'
        )
    return out


def stability_section(stab: list[dict]) -> str:
    if not stab:
        return "<p>No stability runs.</p>"
    rows = ""
    for s in stab:
        jitter = "no" if s["unique_texts"] == 1 else f"{s['unique_texts']} unique"
        cls = "ok" if s["unique_texts"] == 1 else "warn"
        rows += (
            f"<tr><td class=mono>{esc(s['base'])}</td><td class=num>{s['n']}</td>"
            f'<td class="num {cls}">{jitter}</td>'
            f'<td class=num>{fmt_pct(s.get("first_token_top1_mean"))}</td>'
            f'<td class=num>{fmt_n(s.get("first_token_top1_stdev"),4)}</td>'
            f'<td class=mono>{esc(s["sample"])}</td></tr>'
        )
    return (
        "<p>Repeated sampling at temperature 0.7. 'unique' counts distinct outputs across runs — "
        "high unique / low top1 std means the distribution is genuinely multimodal; "
        "unique=1 means greedy-equivalent behavior even under sampling.</p>"
        "<table><thead><tr><th>probe</th><th class=num>runs</th><th>outputs</th>"
        "<th class=num>mean p_top1<br>(first tok)</th>"
        "<th class=num>std p_top1<br>(first tok)</th><th>sample output</th>"
        "</tr></thead><tbody>" + rows + "</tbody></table>"
    )


def monitor_section(mon: dict) -> str:
    if not mon:
        return "<p>No monitor data.</p>"
    rows = ""
    for kind, m in mon.items():
        sc = ", ".join(f"{k}:{v}" for k, v in m["status_counts"].items())
        rows += (
            f"<tr><td class=mono>{esc(kind)}</td><td class=num>{m['n']}</td>"
            f"<td class=mono>{esc(sc)}</td>"
            f"<td class=num>{m['latency_mean']}</td><td class=num>{m['latency_min']}</td>"
            f"<td class=num>{m['latency_max']}</td>"
            f"<td class=mono>{esc(m['first_ts'])}</td><td class=mono>{esc(m['last_ts'])}</td></tr>"
        )
    return (
        "<table><thead><tr><th>endpoint</th><th class=num>samples</th><th>statuses</th>"
        "<th class=num>lat mean</th><th class=num>min</th><th class=num>max</th>"
        "<th>first</th><th>last</th></tr></thead><tbody>" + rows + "</tbody></table>"
    )


def build_html(agg: dict, stab: list, mon: dict, meta: dict) -> str:
    probes = agg["probes"]
    ok = sum(1 for p in probes if p["status"] == 200)
    mean_lat = statistics.mean([p["latency_ms"] for p in probes if p["latency_ms"] is not None]) if probes else 0
    mean_H = statistics.mean([p["mean_entropy_norm"] for p in probes if p["mean_entropy_norm"] is not None])
    mean_top1 = statistics.mean([p["mean_top1_prob"] for p in probes if p["mean_top1_prob"] is not None])
    return (
        "<!DOCTYPE html><html><head><meta charset=utf-8>"
        f"<title>GLM-5.2 logprob report</title><style>{CSS}</style></head><body>"
        f"<h1>GLM-5.2 — logprob analysis report</h1>"
        f"<div class=sub>{esc(meta.get('generated'))} &middot; source: vLLM {esc(meta.get('base'))} "
        f"&middot; model: {esc(meta.get('model'))} &middot; probes: {len(probes)} ({ok} ok) "
        f"&middot; files: {esc(meta.get('files'))}</div>"

        "<h2>Overview</h2>"
        f'<div class=kvs>'
        f'<div class=kv><b>probes</b>{len(probes)} ({ok} ok)</div>'
        f'<div class=kv><b>mean latency</b>{fmt_n(mean_lat,0)} ms</div>'
        f'<div class=kv><b>mean H_norm</b>{fmt_n(mean_H)}</div>'
        f'<div class=kv><b>mean p_top1</b>{fmt_pct(mean_top1)}</div>'
        f'<div class=kv><b>completion probes</b>{agg["n_completion"]}</div>'
        f'<div class=kv><b>chat+tool probes</b>{agg["n_chat"]}</div>'
        f'</div>'
        "<p>Columns: <b>H_n</b> = normalized entropy over the returned top-20 "
        "(0 = argmax-only, 1 = uniform across top-20). <b>p_top1</b> = probability of the "
        "argmax token. <b>surprise</b> = −ln p(chosen). <b>rank 1/&gt;1</b> = how often the "
        "sampled token was the argmax vs. a lower-ranked token (at temperature 0 this is "
        "always N/0). <b>top5 mass</b> = cumulative probability of the top-5 alternatives.</p>"

        "<h2>Health &amp; monitor (vLLM :8000 and controller :8080)</h2>"
        + monitor_section(mon) +

        "<h2>Per-probe logprob summary</h2>"
        + probe_table(agg) +

        "<h2>Formatting-bias / instruction-following (first-token distribution)</h2>"
        "<p>Where the model should output a tiny exact string. The first-token top-10 shows "
        "what the model actually wanted to emit first — divergence from the requested token is "
        "the bias signal.</p>"
        + bias_section(agg) +

        "<h2>Refusal edges</h2>"
        + refusal_section(agg) +

        "<h2>Tool-call boundary (chat + tools)</h2>"
        "<p>finish_reason=tool_calls means the glm47 parser captured a tool call. "
        "We watch the entropy of the tool-call opening tokens.</p>"
        + tool_section(agg) +

        "<h2>Sampling stability (temperature 0.7, repeated)</h2>"
        + stability_section(stab) +

        "<h2>Entropy trajectories (selected probes)</h2>"
        "<p>Normalized entropy (top-20) across generation position. Spikes = decision points "
        "where the model is less committed.</p>"
        + "".join(
            f"<h3>{esc(pid)}</h3>" + entropy_trajectory_svg(agg, pid)
            for pid in ["math_step", "reasoning_syllog", "longform_science", "refusal_jb_system"]
            if next((x for x in agg["probes"] if x["id"] == pid), None)
        ) +

        "<h2>Notes &amp; caveats</h2>"
        "<ul class=tight>"
        "<li>Entropy is computed over the returned <b>top-20</b> only (vLLM caps "
        "<code>top_logprobs</code> at 20). It is a lower bound on true vocab entropy and is "
        "reported as <i>normalized</i> (divided by ln 20) so it is comparable across positions.</li>"
        "<li>At temperature 0 the sampler is greedy, so chosen=argmax and rank&gt;1 is always 0. "
        "Rank dispersion only appears under the stability (temperature 0.7) runs.</li>"
        "<li>Prompt-side logprobs use <code>echo=true</code> on /v1/completions; per-token stats "
        "here cover <i>completion</i> tokens only (split via <code>usage.prompt_tokens</code>).</li>"
        "<li>Full-vocab logits (logit-lens, layer attribution) are not available without a second "
        "model load; all GPUs are pinned by the serving process, so this is API-tier only.</li>"
        "</ul>"

        "</body></html>"
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def load_records(paths: list[str]) -> list[dict]:
    recs = []
    for p in paths:
        with open(p) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        recs.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
    return recs


def main() -> int:
    ap = argparse.ArgumentParser(description="Analyze GLM-5.2 logprob JSONL")
    ap.add_argument("files", nargs="+", help="sweep-*.jsonl and/or monitor-*.jsonl")
    ap.add_argument("-o", "--out", default="glm52-logprobs.html")
    ap.add_argument("--base-url", default="http://127.0.0.1:8000")
    ap.add_argument("--model", default="glm-5.2")
    args = ap.parse_args()

    records = load_records(args.files)
    sweep_recs = [r for r in records if r.get("kind") in ("completion", "chat")]
    monitor_recs = [r for r in records if r.get("kind", "").startswith("health") or r.get("kind") in ("models", "ping_completion")]
    agg = aggregate_sweep(sweep_recs)
    stab = stability_analysis(sweep_recs)
    mon = monitor_summary(monitor_recs)
    meta = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "base": args.base_url,
        "model": args.model,
        "files": ", ".join(os.path.basename(f) for f in args.files),
    }
    html_doc = build_html(agg, stab, mon, meta)
    with open(args.out, "w") as f:
        f.write(html_doc)

    # concise stdout summary
    probes = agg["probes"]
    ok = sum(1 for p in probes if p["status"] == 200)
    print(f"\n=== GLM-5.2 logprob summary ({ok}/{len(probes)} probes ok) ===")
    print(f"{'probe':28} {'lat':>6} {'tok':>4} {'H_norm':>7} {'p_top1':>7} {'surp':>6} {'top5':>6}  finish")
    for p in probes:
        print(f"{str(p['id']):28} {p['latency_ms'] or 0:>6} {p['n_tokens']:>4} "
              f"{fmt_n(p.get('mean_entropy_norm')):>7} {fmt_pct(p.get('mean_top1_prob')):>7} "
              f"{fmt_n(p.get('mean_surprise')):>6} {fmt_pct(p.get('mean_top5_mass')):>6}  {p.get('finish_reason') or ''}")
    if stab:
        print("\n=== stability (temp 0.7) ===")
        for s in stab:
            print(f"  {s['base']:18} runs={s['n']} unique={s['unique_texts']} "
                  f"top1_mean={fmt_pct(s.get('first_token_top1_mean'))} "
                  f"top1_std={fmt_n(s.get('first_token_top1_stdev'),4)}")
    if mon:
        print("\n=== monitor ===")
        for k, m in mon.items():
            print(f"  {k:22} n={m['n']} status={m['status_counts']} "
                  f"lat(mean/min/max)={m['latency_mean']}/{m['latency_min']}/{m['latency_max']}")
    print(f"\nreport: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
