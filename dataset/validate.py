"""Dataset integrity validator.

Run from the repo root:
    python dataset/validate.py

Asserts:
  - All paths in items.jsonl resolve to plan files on disk
  - Every plan file conforms to LLMPlan shape
  - All gold plans have >= 5 nodes and >= 5 edges (paper §4.2 threshold)
  - target_nodes referenced in feedback exist in the corresponding p_initial
  - operation_type / subset coverage matches paper §4.2
  - math_reasoning/answers.json covers every math gold id

Exits non-zero on any failure.
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

DATA = Path(__file__).parent

REQUIRED_ITEM_FIELDS = {
    "id",
    "subset",
    "operation_type",
    "gold_path",
    "p_initial_path",
    "query",
    "feedback",
}
REQUIRED_FEEDBACK_FIELDS = {"global", "targeted", "target_nodes"}

# Paper §4.2: split_sequential only in multi_hop_computation + listed_retrieval_aggregation;
# split_parallel only in topk_retrieval_aggregation. (Note: paper text references the
# pre-rename subsets; the new names map 1:1.)
EXPECTED_COVERAGE = {
    "math_reasoning": {
        "add_node",
        "change_description",
        "change_agent",
        "merge_sequential",
        "merge_parallel",
    },
    "multi_hop_computation": {
        "add_node",
        "change_description",
        "change_agent",
        "merge_sequential",
        "merge_parallel",
        "split_sequential",
    },
    "listed_retrieval_aggregation": {
        "add_node",
        "change_description",
        "change_agent",
        "merge_sequential",
        "merge_parallel",
    },
    "topk_retrieval_aggregation": {
        "add_node",
        "change_description",
        "change_agent",
        "merge_sequential",
        "merge_parallel",
        "split_sequential",
        "split_parallel",
    },
}

PLANS_PER_OP_PER_SCENARIO = 50
GOLDS_PER_SCENARIO = 50


def is_llm_plan(d: dict) -> tuple[bool, str]:
    """Validate clean LLMPlan shape. Returns (ok, message)."""
    if not isinstance(d, dict):
        return False, "not an object"
    for key in ("query", "nodes", "edges"):
        if key not in d:
            return False, f"missing {key!r}"
    if not isinstance(d["query"], str):
        return False, "query must be string"
    if not isinstance(d["nodes"], list) or not isinstance(d["edges"], list):
        return False, "nodes / edges must be lists"
    for i, n in enumerate(d["nodes"]):
        for k in ("id", "task", "agent_name", "input", "output", "prereq"):
            if k not in n:
                return False, f"node[{i}] missing {k!r}"
        if not isinstance(n["output"], list) or not all(
            isinstance(o, str) for o in n["output"]
        ):
            return False, f"node[{i}].output must be List[str]"
        if not isinstance(n["input"], list):
            return False, f"node[{i}].input must be a list"
        for j, inp in enumerate(n["input"]):
            if not isinstance(inp, dict) or "variable" not in inp or "value" not in inp:
                return False, f"node[{i}].input[{j}] must be {{variable, value}}"
    for i, e in enumerate(d["edges"]):
        for k in ("src_node", "dest_node", "src_output", "dest_input"):
            if k not in e:
                return False, f"edge[{i}] missing {k!r}"
    return True, ""


def main() -> int:
    failures: list[str] = []

    def fail(msg: str) -> None:
        failures.append(msg)

    # 1. Top-level subset coverage
    found_scenarios = sorted(p.name for p in DATA.iterdir() if p.is_dir())
    expected = set(EXPECTED_COVERAGE.keys())
    if set(found_scenarios) != expected:
        fail(f"subsets mismatch: found {found_scenarios}, expected {sorted(expected)}")

    total_items = 0
    total_golds = 0

    for subset, expected_ops in EXPECTED_COVERAGE.items():
        s_dir = DATA / subset
        if not s_dir.is_dir():
            continue

        # 2. Operation directory coverage
        found_ops = {p.name for p in s_dir.iterdir() if p.is_dir() and p.name != "gold"}
        if found_ops != expected_ops:
            fail(
                f"{subset}: op dirs {sorted(found_ops)} != expected {sorted(expected_ops)}"
            )

        # 3. Gold count
        gold_files = sorted((s_dir / "gold").glob("*.json"))
        if len(gold_files) != GOLDS_PER_SCENARIO:
            fail(
                f"{subset}/gold: {len(gold_files)} files, expected {GOLDS_PER_SCENARIO}"
            )
        total_golds += len(gold_files)

        # 4. Each gold: shape + complexity threshold
        for gp in gold_files:
            with open(gp) as f:
                gold = json.load(f)
            ok, msg = is_llm_plan(gold)
            if not ok:
                fail(f"{gp.relative_to(DATA)}: {msg}")
                continue
            if len(gold["nodes"]) < 5:
                fail(
                    f"{gp.relative_to(DATA)}: only {len(gold['nodes'])} nodes (paper §4.2 requires ≥5)"
                )
            if len(gold["edges"]) < 5:
                fail(
                    f"{gp.relative_to(DATA)}: only {len(gold['edges'])} edges (paper §4.2 requires ≥5)"
                )

        # 5. Each op dir: count + plan shape
        for op in expected_ops:
            files = sorted((s_dir / op).glob("*.json"))
            if len(files) != PLANS_PER_OP_PER_SCENARIO:
                fail(
                    f"{subset}/{op}: {len(files)} files, expected {PLANS_PER_OP_PER_SCENARIO}"
                )
            for pp in files:
                with open(pp) as f:
                    p_init = json.load(f)
                ok, msg = is_llm_plan(p_init)
                if not ok:
                    fail(f"{pp.relative_to(DATA)}: {msg}")

        # 6. items.jsonl: well-formed lines + path resolution + target_nodes valid
        jsonl = s_dir / "items.jsonl"
        if not jsonl.is_file():
            fail(f"{subset}: items.jsonl missing")
            continue
        with open(jsonl) as f:
            for lineno, raw in enumerate(f, start=1):
                try:
                    item = json.loads(raw)
                except json.JSONDecodeError as e:
                    fail(f"{jsonl.relative_to(DATA)}:{lineno}: invalid JSON: {e}")
                    continue
                missing = REQUIRED_ITEM_FIELDS - item.keys()
                if missing:
                    fail(
                        f"{jsonl.relative_to(DATA)}:{lineno}: missing {sorted(missing)}"
                    )
                    continue
                if (
                    not isinstance(item["feedback"], dict)
                    or REQUIRED_FEEDBACK_FIELDS - item["feedback"].keys()
                ):
                    fail(f"{jsonl.relative_to(DATA)}:{lineno}: feedback malformed")
                    continue
                if item["subset"] != subset:
                    fail(
                        f"{jsonl.relative_to(DATA)}:{lineno}: subset {item['subset']!r} != dir {subset!r}"
                    )
                if item["operation_type"] not in expected_ops:
                    fail(
                        f"{jsonl.relative_to(DATA)}:{lineno}: operation_type {item['operation_type']!r} not in coverage for {subset}"
                    )
                gold_p = DATA / item["gold_path"]
                init_p = DATA / item["p_initial_path"]
                if not gold_p.is_file():
                    fail(
                        f"{jsonl.relative_to(DATA)}:{lineno}: gold_path missing on disk: {item['gold_path']}"
                    )
                    continue
                if not init_p.is_file():
                    fail(
                        f"{jsonl.relative_to(DATA)}:{lineno}: p_initial_path missing on disk: {item['p_initial_path']}"
                    )
                    continue
                # target_nodes valid against p_initial?
                with open(init_p) as f:
                    p_init = json.load(f)
                node_ids = {n["id"] for n in p_init["nodes"]}
                missing_targets = [
                    t for t in item["feedback"]["target_nodes"] if t not in node_ids
                ]
                if missing_targets:
                    fail(
                        f"{jsonl.relative_to(DATA)}:{lineno}: target_nodes {missing_targets} not in p_initial.nodes"
                    )
                total_items += 1

    # 7. math answers
    answers_path = DATA / "math_reasoning" / "answers.json"
    if not answers_path.is_file():
        fail("math_reasoning/answers.json missing")
    else:
        with open(answers_path) as f:
            answers = json.load(f)
        math_gold_ids = {
            p.stem for p in (DATA / "math_reasoning" / "gold").glob("*.json")
        }
        missing_answer = math_gold_ids - answers.keys()
        if missing_answer:
            fail(f"math answers missing for ids: {sorted(missing_answer)}")
        for k, v in answers.items():
            if not isinstance(v, dict) or not v.get("answer"):
                fail(f"math answers[{k}]: empty/invalid answer")
            if v.get("gsm8k_split") not in {"train", "test"}:
                fail(f"math answers[{k}]: gsm8k_split must be 'train' or 'test'")
            if not isinstance(v.get("gsm8k_line_index"), int):
                fail(f"math answers[{k}]: gsm8k_line_index must be an integer")

    # Summary
    print(f"subsets validated:  {len(EXPECTED_COVERAGE)}")
    print(
        f"total gold plans:     {total_golds} (expected {GOLDS_PER_SCENARIO * len(EXPECTED_COVERAGE)})"
    )
    print(f"total items.jsonl:    {total_items}")
    if failures:
        print(f"\nFAILURES ({len(failures)}):")
        for f in failures[:20]:
            print(f"  {f}")
        if len(failures) > 20:
            print(f"  ... and {len(failures) - 20} more")
        return 1
    print("\nOK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
