"""Run revision conditions on the AMBIPOM plan-revision dataset.

Conditions:
  - **gf**  Global Feedback. Whole plan + ID-anchored instruction -> LLM produces a revised plan.
  - **tf**  Targeted Feedback. Subgraph + deictic instruction -> LLM produces a revised subgraph,
            which is reintegrated into the plan with frozen boundary interfaces.

Output layout:
    experiment/outputs/<subset>/<operation_type>/<NNNNN>__<condition>.json

This mirrors `dataset/<subset>/<operation_type>/<NNNNN>.json` so revisions sit next
to their gold / p_initial counterparts. Each output is a clean LLMPlan (the revised
plan) or a `{"_integration_failure": true}` sentinel when targeted reintegration fails.

Usage:
    # Run both conditions on all subsets (full dataset)
    python experiment/run.py --all

    # Run a single condition on a single subset
    python experiment/run.py --condition gf --subset math_reasoning

    # Sample N items per operation type (for quick sanity checks)
    python experiment/run.py --all --n 5 --seed 0

Cost / time (gpt-4o, default config):
    ~$0.01 and ~3 s per item. Full dataset (1,150 items) per condition
    is roughly $12 and 1 hour of wall time. Use `--n` for a tiny sample run.

Environment:
    OPENAI_API_KEY    required
    OPENAI_ORGANIZATION   optional
    FIREWORKS_API_KEY     optional, only needed if you switch the planner to a Fireworks model

Adding a new condition:
    1. Define `def run_<name>(planner, item) -> dict | None` returning a clean LLMPlan dict
       (or None on integration failure).
    2. Register it in CONDITIONS below.
    3. Re-run with `--condition <name>`. evaluate.py picks it up automatically.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

# Repo-root-relative paths; assume invocation from repo root.
DATA_DIR = Path("dataset")
OUT_DIR = Path("experiment/outputs")

from ambipom.plan import DAGPlan
from ambipom.planner import Planner
from ambipom.types import IOVariableOrigin, LLMPlan

SUBSETS = [
    "math_reasoning",
    "multi_hop_computation",
    "listed_retrieval_aggregation",
    "topk_retrieval_aggregation",
]


def load_items(subset: str) -> list[dict]:
    with open(DATA_DIR / subset / "items.jsonl") as f:
        return [json.loads(line) for line in f]


def load_plan_file(path: Path) -> dict:
    with open(path) as f:
        return json.load(f)


def init_dag_from_p_initial(p_initial: dict) -> DAGPlan:
    """Build a fresh DAGPlan from the dataset's clean p_initial LLMPlan."""
    dag = DAGPlan(query=p_initial["query"])
    dag.initialize_from_llm_plan(p_initial)
    return dag


def reconstruct_assistant_response(p_initial: dict) -> str:
    """The original conversation_history embedded a UI-status string of the form
    "✅ Plan generated with N nodes and M connections." — deterministic from the plan.
    Reconstruct it here so the prompt context matches what the original orchestrator
    fed `entire_replan_G` (which received `conversation_history` from the dataset)."""
    return f"✅ Plan generated with {len(p_initial['nodes'])} nodes and {len(p_initial['edges'])} connections."


def dag_to_clean_dict(dag: DAGPlan, query: str) -> dict:
    """Serialize the DAG's current state as a clean LLMPlan dict."""
    llm_plan = dag.get_llm_plan()
    return {
        "query": query,
        "nodes": [
            n.model_dump() if hasattr(n, "model_dump") else n for n in llm_plan["nodes"]
        ],
        "edges": [
            e.model_dump() if hasattr(e, "model_dump") else e for e in llm_plan["edges"]
        ],
    }


# -------------------- conditions --------------------
# Each runner mirrors the corresponding function in the original
# experiment/RQ3/generate_data/2-dataset_operation.py:
#   run_gf  ←→  entire_replan_G
#   run_tf  ←→  target_replan_S1


_TF_MAX_ATTEMPTS = 5  # matches original orchestrator's retry count for S1


def run_gf(planner: Planner, item: dict) -> dict:
    """Global Feedback (paper §6, condition GF). Mirrors `entire_replan_G`."""
    p_initial = load_plan_file(DATA_DIR / item["p_initial_path"])
    dag = init_dag_from_p_initial(p_initial)
    current_plan = dag.get_llm_plan()

    conversation_history = [
        {"type": "user", "message": p_initial["query"]},
        {"type": "assistant", "message": reconstruct_assistant_response(p_initial)},
    ]
    feedback = item["feedback"]["global"]
    message = [
        {"role": "system", "content": planner.planning_prompt},
        {
            "role": "user",
            "content": planner.replan_prompt
            % (conversation_history, current_plan, feedback),
        },
    ]
    dict_result = planner.generate_plan_call(message, LLMPlan)
    revised_dag = DAGPlan(query="G")
    revised_dag.initialize_from_llm_plan(dict_result)
    return dag_to_clean_dict(revised_dag, p_initial["query"])


def run_tf(planner: Planner, item: dict) -> dict | None:
    """Targeted Feedback with frozen boundaries (paper §6, condition TF).
    Mirrors `target_replan_S1`, including up-to-5 retries on integration failure.
    Returns None if all attempts fail."""
    p_initial = load_plan_file(DATA_DIR / item["p_initial_path"])
    target_nodes = item["feedback"]["target_nodes"]
    feedback = item["feedback"]["targeted"]

    for attempt in range(_TF_MAX_ATTEMPTS):
        # Fresh DAG each attempt — DAGPlan.subplan_replan mutates state on success.
        dag = init_dag_from_p_initial(p_initial)

        node_info = [dag.get_llm_node(node_id) for node_id in target_nodes]
        temp_edge_info = [dag.get_llm_edge(node_id) for node_id in target_nodes]
        edge_info = dag.unique_edges_from_list_edges(temp_edge_info)

        message = [
            {"role": "system", "content": planner.subgraph_replan_system_prompt},
            {
                "role": "user",
                "content": planner.subplan_replan_prompt
                % (f"Node: {node_info}\nEdge: {edge_info}", feedback),
            },
        ]
        try:
            dict_result = planner.generate_plan_call(message, LLMPlan)
        except Exception as e:
            print(
                f"  TF LLM call failed for {item['id']} (attempt {attempt + 1}): {e}",
                file=sys.stderr,
            )
            continue

        list_node = [dag.convert_llm_node_to_dag(n) for n in dict_result.nodes]
        list_edge = [dag.convert_llm_edge_to_dag(e) for e in dict_result.edges]

        # Mirrors `bool_success = plan_initial_dag.subplan_replan(...)` from S1.
        # Returns True on success, None on integration failure.
        bool_success = dag.subplan_replan(
            target_nodes, list_node, list_edge, IOVariableOrigin.PLANNER
        )
        if bool_success:
            return dag_to_clean_dict(dag, p_initial["query"])

    return None


CONDITIONS = {
    "gf": run_gf,
    "tf": run_tf,
}


# -------------------- driver --------------------


def output_path(condition: str, subset: str, op: str, item_id: str) -> Path:
    """Layout: outputs/<subset>/<op>/<id>__<condition>.json — mirrors dataset/<subset>/<op>/
    so revised plans live next to their gold/p_initial counterparts."""
    return OUT_DIR / subset / op / f"{item_id}__{condition}.json"


def select_items(items: list[dict], n: int | None, seed: int) -> list[dict]:
    """If --n given, sample N items per operation_type (deterministic with --seed)."""
    if n is None:
        return items
    rng = random.Random(seed)
    by_op: dict[str, list[dict]] = {}
    for it in items:
        by_op.setdefault(it["operation_type"], []).append(it)
    sampled = []
    for op in sorted(by_op):
        group = list(by_op[op])
        rng.shuffle(group)
        sampled.extend(group[:n])
    return sampled


def run_one(
    condition: str, subset: str, n: int | None, seed: int, overwrite: bool
) -> None:
    items = select_items(load_items(subset), n, seed)
    fn = CONDITIONS[condition]
    print(f"[{condition}/{subset}] {len(items)} items")

    planner = Planner()

    for i, item in enumerate(items, 1):
        out = output_path(condition, subset, item["operation_type"], item["id"])
        if out.exists() and not overwrite:
            print(
                f"  [{i}/{len(items)}] {item['operation_type']}/{item['id']} — skip (exists)"
            )
            continue

        try:
            revised = fn(planner, item)
        except Exception as e:
            print(
                f"  [{i}/{len(items)}] {item['operation_type']}/{item['id']} — FAILED: {e}",
                file=sys.stderr,
            )
            continue

        out.parent.mkdir(parents=True, exist_ok=True)
        if revised is None:
            with open(out, "w") as f:
                json.dump({"_integration_failure": True}, f)
            print(
                f"  [{i}/{len(items)}] {item['operation_type']}/{item['id']} — INTEGRATION FAILURE"
            )
        else:
            with open(out, "w") as f:
                json.dump(revised, f, indent=2, ensure_ascii=False)
            print(f"  [{i}/{len(items)}] {item['operation_type']}/{item['id']} — ok")


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Run revision conditions on the AMBIPOM dataset."
    )
    ap.add_argument("--condition", choices=sorted(CONDITIONS.keys()))
    ap.add_argument("--subset", choices=SUBSETS)
    ap.add_argument(
        "--all", action="store_true", help="Run every (condition × subset) combination."
    )
    ap.add_argument(
        "--n",
        type=int,
        default=None,
        help="Sample N items per operation_type per subset.",
    )
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument(
        "--overwrite",
        action="store_true",
        help="Re-run items even if their output already exists (default: skip existing).",
    )
    args = ap.parse_args()

    if args.all:
        for cond in sorted(CONDITIONS):
            for sub in SUBSETS:
                run_one(cond, sub, args.n, args.seed, args.overwrite)
    else:
        if not (args.condition and args.subset):
            ap.error("Specify --all OR both --condition and --subset")
        run_one(args.condition, args.subset, args.n, args.seed, args.overwrite)
    return 0


if __name__ == "__main__":
    sys.exit(main())
