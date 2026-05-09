"""Evaluate revised plans produced by experiment/run.py.

For each item that has output for a given condition, computes paper §6.4 metrics:
  - **Integration** (1 / 0)  — did the revision produce a valid plan? `_integration_failure`
                                sentinels score 0; everything else scores 1.
  - **GED**         (lower)  — graph edit distance to the gold plan, via
                                `DAGPlan.calculate_graph_edit_distance`.
  - **SS**          (higher) — semantic similarity over node task descriptions, via
                                sentence-transformers (`all-MiniLM-L6-v2`), the alignment_score
                                from `experiment/_helpers/semantic.py:compute_task_level_metrics`.
  - **Stable**      (higher) — fraction of non-target nodes unchanged between p_initial and
                                the revised plan. A non-target node "stays" if its
                                (task, input variable names, output variable names) signature
                                appears unchanged in the revised plan.

Per-item results are written to `experiment/results.jsonl` (one line each, with
subset preserved). Aggregates shaped like paper Table 1 (rows = condition, columns
= operation_type × {GED, SS, Stable, Integration}, averaged across the four subsets)
are written to `experiment/summary.csv` and also pretty-printed to stdout.

Usage:
    python experiment/evaluate.py                  # evaluate everything in experiment/outputs/
    python experiment/evaluate.py --no-ss          # skip semantic similarity (no torch install needed)

Costs:
    No API calls. Sentence-transformer model is downloaded once (~100 MB) on first use.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path
from statistics import mean

DATA_DIR = Path("dataset")
OUT_DIR = Path("experiment/outputs")
RESULTS_PATH = Path("experiment/results.jsonl")
SUMMARY_PATH = Path("experiment/summary.csv")

from ambipom.plan import DAGPlan

# Make `_helpers` importable whether the user runs `python experiment/evaluate.py`
# (script-dir on sys.path) or `python -m experiment.evaluate` (repo-root on sys.path).
sys.path.insert(0, str(Path(__file__).parent))
from _helpers.graph import graph_edit_distance_strip_attrs

# ---------- helpers ----------


def load_json(path: Path) -> dict:
    with open(path) as f:
        return json.load(f)


def node_signature(node: dict) -> tuple:
    """Match the original `calculate_plan_stability` strict signature:
    task + agent_name + input variable names + output variable names."""
    inputs = frozenset(
        item["variable"] if isinstance(item, dict) else getattr(item, "variable", "")
        for item in node.get("input", [])
    )
    outputs = frozenset(
        o if isinstance(o, str) else getattr(o, "variable", "")
        for o in node.get("output", [])
    )
    return (node.get("task", ""), node.get("agent_name", ""), inputs, outputs)


# ---------- per-metric ----------


def metric_integration(revised: dict) -> int:
    return 0 if revised.get("_integration_failure") else 1


def _plan_to_nx(plan: dict):
    dag = DAGPlan(query=plan.get("query", ""))
    dag.initialize_from_llm_plan(plan)
    return dag.dag


def metric_ged(revised: dict, gold: dict) -> float:
    """Structural GED matching paper §6.4 — strips node/edge attrs before computing."""
    return graph_edit_distance_strip_attrs(_plan_to_nx(revised), _plan_to_nx(gold))


def metric_plan_stability(
    p_initial: dict, revised: dict, target_nodes: list[int]
) -> float:
    """Fraction of non-target nodes preserved unchanged.

    A non-target node "stays" if its signature is present in the revised plan.
    Stability = (# stable non-target nodes in revised) / (# non-target nodes in p_initial).
    Returns 1.0 when p_initial has no non-target nodes (degenerate; avoids division by zero).
    """
    non_target_initial = [
        n for n in p_initial["nodes"] if n["id"] not in set(target_nodes)
    ]
    if not non_target_initial:
        return 1.0
    revised_signatures = {node_signature(n) for n in revised["nodes"]}
    stable = sum(
        1 for n in non_target_initial if node_signature(n) in revised_signatures
    )
    return stable / len(non_target_initial)


def metric_semantic_similarity(revised: dict, gold: dict, _ss_fn) -> float:
    """Wrap experiment/_helpers/semantic.py:compute_task_level_metrics. Returns alignment_score."""

    # Convert plans to the dict form compute_task_level_metrics expects (it indexes node.task).
    # The helper accesses .task as attribute; we adapt with a tiny shim object.
    class _N:
        def __init__(self, t):
            self.task = t

    A = {"nodes": [_N(n["task"]) for n in revised["nodes"]]}
    B = {"nodes": [_N(n["task"]) for n in gold["nodes"]]}
    return _ss_fn(B, A)["alignment_score"]  # gold = A (recall axis), revised = B


# ---------- driver ----------


def items_index(subset: str) -> dict[tuple[str, str], dict]:
    """Index items.jsonl by (operation_type, id) for fast lookup."""
    idx: dict[tuple[str, str], dict] = {}
    with open(DATA_DIR / subset / "items.jsonl") as f:
        for line in f:
            it = json.loads(line)
            idx[(it["operation_type"], it["id"])] = it
    return idx


def walk_revised_plans():
    """Yield (subset, op, item_id, condition, plan_path) for each revised-plan file under
    OUT_DIR. Layout: outputs/<subset>/<op>/<id>__<condition>.json."""
    if not OUT_DIR.is_dir():
        return
    for plan_path in sorted(OUT_DIR.rglob("*__*.json")):
        rel = plan_path.relative_to(OUT_DIR)
        if len(rel.parts) != 3:
            continue  # only files at the expected depth count
        subset, op = rel.parts[0], rel.parts[1]
        stem = plan_path.stem  # "<id>__<condition>"
        if "__" not in stem:
            continue
        item_id, condition = stem.rsplit("__", 1)
        yield subset, op, item_id, condition, plan_path


def evaluate_one(
    revised: dict,
    gold: dict,
    p_initial: dict,
    target_nodes: list[int],
    use_ss: bool,
    ss_fn,
) -> dict:
    integ = metric_integration(revised)
    if not integ:
        return {
            "integration": 0,
            "ged": None,
            "plan_stability": None,
            "semantic_similarity": None,
        }
    return {
        "integration": 1,
        "ged": metric_ged(revised, gold),
        "plan_stability": metric_plan_stability(p_initial, revised, target_nodes),
        "semantic_similarity": metric_semantic_similarity(revised, gold, ss_fn)
        if use_ss
        else None,
    }


# Order matches paper Table 1 column order.
_OP_ORDER = [
    "add_node",
    "change_description",
    "change_agent",
    "merge_sequential",
    "merge_parallel",
    "split_sequential",
    "split_parallel",
]


def aggregate(rows: list[dict]) -> list[dict]:
    """Group by (condition, operation_type) — averages across subsets, matching paper Table 1."""
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for r in rows:
        groups[(r["condition"], r["operation_type"])].append(r)

    table = []
    for (cond, op), group in sorted(groups.items()):
        valid = [r for r in group if r["integration"]]

        def _mean(field):
            vals = [r[field] for r in valid if r[field] is not None]
            return mean(vals) if vals else None

        table.append(
            {
                "condition": cond,
                "operation_type": op,
                "n": len(group),
                "Integration": mean(r["integration"] for r in group),
                "GED": _mean("ged"),
                "SS": _mean("semantic_similarity"),
                "Stable": _mean("plan_stability"),
            }
        )
    return table


def print_paper_table(rows: list[dict]) -> None:
    """Print a paper Table 1-shaped view: rows = condition, columns = op × {GED, SS, Stable}."""
    by_cond_op = {(r["condition"], r["operation_type"]): r for r in rows}
    conditions = sorted({r["condition"] for r in rows})

    def _fmt(v):
        return "  -  " if v is None else f"{v:5.3f}"

    header_top = f"{'':<5}" + "".join(f" | {op[:18]:<18}" for op in _OP_ORDER)
    header_sub = f"{'':<5}" + "".join(
        f" | {'GED↓':>5} {'SS↑':>5} {'Stab↑':>5}  " for _ in _OP_ORDER
    )
    sep = "-" * len(header_sub)

    print()
    print("Paper §6.4 / Table 1 view (averaged across subsets):")
    print(sep)
    print(header_top)
    print(header_sub)
    print(sep)
    for cond in conditions:
        row = f"{cond.upper():<5}"
        for op in _OP_ORDER:
            r = by_cond_op.get((cond, op))
            if r is None:
                row += f" | {'  -  ':>5} {'  -  ':>5} {'  -  ':>5}  "
            else:
                row += f" | {_fmt(r['GED']):>5} {_fmt(r['SS']):>5} {_fmt(r['Stable']):>5}  "
        print(row)
    print(sep)


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Evaluate experiment/outputs/ against dataset/."
    )
    ap.add_argument(
        "--no-ss",
        action="store_true",
        help="Skip semantic similarity (no sentence-transformers needed).",
    )
    args = ap.parse_args()

    if args.no_ss:
        ss_fn = None
    else:
        try:
            from _helpers.semantic import compute_task_level_metrics

            ss_fn = compute_task_level_metrics
        except ImportError as e:
            print(
                f"WARN: sentence-transformers not installed ({e}); falling back to --no-ss",
                file=sys.stderr,
            )
            ss_fn = None
            args.no_ss = True

    if not OUT_DIR.is_dir():
        print(f"No outputs found at {OUT_DIR}. Run experiment/run.py first.")
        return 1

    # Cache items.jsonl per subset.
    lookups: dict[str, dict] = {}

    all_rows: list[dict] = []
    for subset, op, item_id, condition, plan_path in walk_revised_plans():
        if subset not in lookups:
            lookups[subset] = items_index(subset)
        item = lookups[subset].get((op, item_id))
        if not item:
            print(
                f"  WARN: no items.jsonl entry for {subset}/{op}/{item_id}; skipping",
                file=sys.stderr,
            )
            continue

        revised = load_json(plan_path)
        if revised.get("_integration_failure"):
            metrics = {
                "integration": 0,
                "ged": None,
                "plan_stability": None,
                "semantic_similarity": None,
            }
        else:
            gold = load_json(DATA_DIR / item["gold_path"])
            p_init = load_json(DATA_DIR / item["p_initial_path"])
            metrics = evaluate_one(
                revised,
                gold,
                p_init,
                item["feedback"]["target_nodes"],
                use_ss=not args.no_ss,
                ss_fn=ss_fn,
            )

        all_rows.append(
            {
                "condition": condition,
                "subset": subset,
                "operation_type": op,
                "id": item_id,
                **metrics,
            }
        )

    # Per-item: single JSONL.
    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(RESULTS_PATH, "w") as f:
        for row in all_rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    # Aggregated summary, shaped to mirror paper Table 1 (condition × operation_type).
    summary = aggregate(all_rows)
    SUMMARY_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(SUMMARY_PATH, "w", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "condition",
                "operation_type",
                "n",
                "Integration",
                "GED",
                "SS",
                "Stable",
            ],
        )
        writer.writeheader()
        for row in summary:
            writer.writerow(row)

    print(f"\nWrote per-item results to {RESULTS_PATH}")
    print(f"Wrote paper Table 1-shaped summary to {SUMMARY_PATH}")
    print(
        f"\n{len(summary)} (condition × operation_type) groups; {len(all_rows)} items evaluated."
    )
    print_paper_table(summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
