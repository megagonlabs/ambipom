# AMBIPOM Experiment Pipeline

Reproduces the two anchor conditions of paper §6 on the [shipped dataset](../dataset/) — **GF** (Global Feedback) and **TF** (Targeted Feedback, frozen-boundary) — spanning the global ↔ targeted scope axis (§3).

| Condition | Mechanism |
|---|---|
| **GF** | `Planner.replan_prompt` + full plan + ID-anchored instruction → revised plan |
| **TF** | `Planner.subplan_replan` + selected subgraph + deictic instruction → revised plan |

## 📥 Install

```bash
pip install -e ".[experiment]"
```

The `[experiment]` extra adds `sentence-transformers` (for the SS metric — local model, ~100 MB downloaded once on first run, no API).

Set `OPENAI_API_KEY` (and optionally `OPENAI_ORGANIZATION`) before running.

## ▶️ Running

```bash
# Sanity check: 5 items per operation_type per subset, both conditions (~230 items, ~$2.50, ~20 min)
python experiment/run.py --all --n 5 --seed 0
python experiment/evaluate.py

# Full run (all 1,150 items × 2 conditions, ~$23, ~2 hours)
python experiment/run.py --all
python experiment/evaluate.py
```

Single-condition / single-subset:

```bash
python experiment/run.py --condition gf --subset math_reasoning
```

Outputs are written incrementally; re-running skips items that already have output (idempotent). Add `--overwrite` to re-run existing items (e.g., to re-sample with LLM nondeterminism).

## 📦 Pre-Computed Sample (No API Key Needed for Reviewers)

The artifact ships pre-computed revisions for the `--n 10 --seed 0` sanity sample (~460 plans, both conditions × all subsets) under `experiment/sample_outputs/`. Reviewers without an OpenAI key — or who don't want to spend the ~$5 of API budget — can reproduce the paper §6.5 plan-revision results by replaying these:

```bash
cp -r experiment/sample_outputs/. experiment/outputs/
python experiment/evaluate.py
```

`evaluate.py` makes no API calls. To re-run from scratch instead, delete `experiment/outputs/` and call `experiment/run.py` as below.

## 📝 What Gets Written

```
experiment/
├── outputs/<subset>/<operation_type>/<NNNNN>__<condition>.json
├── results.jsonl
└── summary.csv
```

- **`outputs/<subset>/<operation_type>/<NNNNN>__<condition>.json`** — revised plans. Layout mirrors `dataset/<subset>/<operation_type>/<NNNNN>.json` so revisions sit alongside their gold and `p_initial` counterparts; the `__<condition>` suffix keeps GF/TF revisions of the same item adjacent.
- **`results.jsonl`** — per-item metrics, one line each. Columns: `condition`, `subset`, `operation_type`, `id`, `integration`, `ged`, `plan_stability`, `semantic_similarity`.
- **`summary.csv`** — aggregate, averaged across subsets per condition × operation_type, mirroring paper §6.5. Columns: `condition`, `operation_type`, `n`, `Integration`, `GED`, `SS`, `Stable`. GED, SS, and Stable map to paper Table 1 (refinement performance); Integration maps to Tables 7–8 (integration performance). Lower GED is better; higher SS / Stable / Integration are better. `evaluate.py` also pretty-prints this table to stdout.

## ⏱️ Resource Expectations

- Per item: ~1 OpenAI call (planner-side), ~3 s wall, ~$0.01 at `gpt-4o`. TF additionally hits the planner's subgraph-replan path (still 1 call).
- Full dataset per condition: ~1,150 calls, ~$12, ~1 hour. Both conditions together: ~$23, ~2 hours.

## ⚠️ Reproducibility Caveats

1. **LLM nondeterminism.** Even at temperature 0, OpenAI may produce slightly different outputs across runs. Statistical close-match to paper §6 numbers is achievable; bit-exact is not.
2. **Model drift.** The default planner model is `gpt-4o`. OpenAI updates this name over time, which can shift behavior — results may diverge from paper numbers if you run the artifact long after the paper's publication date.
