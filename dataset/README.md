# AMBIPOM Plan-Revision Dataset

A dataset for evaluating how well LLM planners revise multi-agent plans in response to user feedback. Companion to *How to Steer Your Multi-Agent System: Human-LLM Collaborative Planning* (ACM CAIS 2026).

A **plan** is a directed acyclic graph (DAG) of subtasks, each assigned to one of four executable agents (`math`, `code`, `search`, `commonsense`). Edges carry typed data dependencies: an upstream node's named output becomes a downstream node's named input. The system's planner generates and revises these plans; this dataset measures revision quality.

A **gold plan** is one reference plan for a given task — a known-correct solution we hand-pick from the (possibly many) valid plans that solve it. The dataset pairs each gold with broken variants of itself plus a natural-language instruction; the evaluation task is for the planner to apply the instruction and recover the gold.

The dataset is organised into **4 subsets**, each holding **50 tasks**. Every task has **one gold plan** and **5–7 broken variants** (one per applicable revision operation), giving **200 gold plans** and **1,150 items** in total.

## 🗂️ Layout

```
dataset/
├── <subset>/
│   ├── gold/<NNNNN>.json
│   ├── <operation_type>/<NNNNN>.json
│   └── items.jsonl
└── math_reasoning/answers.json
```

- **`gold/<NNNNN>.json`** — one gold plan per file. One file per task; 50 tasks per subset.
- **`<operation_type>/<NNNNN>.json`** — one broken plan (`p_initial`) per file, paired with the same-`<NNNNN>` gold. 50 per op.
- **`items.jsonl`** — one item per line. Each line references a gold file and a `p_initial` file, plus carries the instruction text and `target_nodes`.
- **`answers.json`** — math only. Ground-truth numeric answer per task, used for execution-accuracy evaluation.

Each plan JSON conforms to the AMBIPOM library's `LLMPlan` schema and loads directly via the system's UI **Load Plan** button.

### 📎 File Schemas

**Plan file** — `gold/*.json` and `<operation_type>/*.json`:

```json
{
  "query": "...",
  "nodes": [
    {"id": 1, "task": "...", "agent_name": "math",
     "input":  [{"variable": "x", "value": "450"}],
     "output": ["y"],
     "prereq": []}
  ],
  "edges": [
    {"src_node": 1, "dest_node": 5, "src_output": "y", "dest_input": "y"}
  ]
}
```

**`items.jsonl` line** — one JSON object per line:

```json
{"id": "00001",
 "subset": "math_reasoning",
 "operation_type": "add_node",
 "gold_path": "math_reasoning/gold/00001.json",
 "p_initial_path": "math_reasoning/add_node/00001.json",
 "query": "...",
 "feedback": {
   "global":       "...",     // ID-anchored — see "How items are constructed"
   "targeted":     "...",     // deictic
   "target_nodes": [1, 5]     // selected subgraph
 }}
```

**`math_reasoning/answers.json`** — one entry per gold, keyed by id. Used for execution-accuracy evaluation:

```json
{"00001": {"answer": "97", "gsm8k_split": "train", "gsm8k_line_index": 5593}, ...}
```

## 🏷️ Subsets

Four subsets, structurally distinct:

| Directory | Structural pattern |
|---|---|
| `math_reasoning/` | multi-step arithmetic; no retrieval |
| `multi_hop_computation/` | chain of retrievals → comparative computation |
| `listed_retrieval_aggregation/` | list given in query → retrieve per item → aggregate |
| `topk_retrieval_aggregation/` | discover top-K list → retrieve per item → aggregate |

## 🔧 Operation Types

Seven operations name what the planner should do to recover the gold. Construction applied the *inverse* to produce `p_initial`:

| `operation_type` | Breaking op applied to gold |
|---|---|
| `add_node` | removed a node |
| `change_description` | replaced a description |
| `change_agent` | reassigned an agent |
| `merge_sequential` | split one node into two sequential |
| `merge_parallel` | split one node into two parallel |
| `split_sequential` | merged two sequential nodes |
| `split_parallel` | merged two parallel nodes |

### ✅ Coverage

Splits require compatible node patterns and so appear only in compatible subsets. 50 items per non-empty cell.

|  | add_node | change_description | change_agent | merge_sequential | merge_parallel | split_sequential | split_parallel |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| math_reasoning | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |
| multi_hop_computation | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |   |
| listed_retrieval_aggregation | ✓ | ✓ | ✓ | ✓ | ✓ |   |   |
| topk_retrieval_aggregation | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Totals: 200 gold plans, 1,150 items.

## 🏗️ Construction

**Source Questions.**

- `math_reasoning` — 50 problems randomly sampled from GSM8K (Cobbe et al., 2021); question text and numeric answer kept verbatim. Each `answers.json` entry records `gsm8k_split` + `gsm8k_line_index` for traceability.
- `multi_hop_computation`, `listed_retrieval_aggregation`, `topk_retrieval_aggregation` — drafted by Claude Sonnet 4.6 and manually reviewed; ambiguous, unsolvable, or off-pattern items were discarded.

**Reverse Operation.** For each source question, a gold plan is generated and verified correct. A breaking operation `f` is then applied to produce `p_initial = f(p_gold)`, and a natural-language instruction is written to describe the inverse transformation. Each item carries `p_initial`, the instruction, `target_nodes` (the subgraph the instruction refers to), and a reference to the gold.

Each instruction is rendered in two forms:

- **`global`** — references nodes by id (e.g. *"add a node between node 1 and node 5"*). Used when a system gives the LLM the whole plan.
- **`targeted`** — uses deictic phrasing (e.g. *"add a node between these two nodes"*). Used when a system gives the LLM only a selected subgraph.

Both forms describe the same recovery; experiments differ only in which portion of the plan the LLM sees.

## 📦 Loading Example

```python
import json
from pathlib import Path

DATA = Path("dataset")

with open(DATA / "math_reasoning" / "items.jsonl") as f:
    items = [json.loads(line) for line in f]

for it in items[:1]:
    with open(DATA / it["gold_path"]) as f:
        gold = json.load(f)
    with open(DATA / it["p_initial_path"]) as f:
        p_init = json.load(f)
    print(it["operation_type"], it["query"][:60], it["feedback"]["target_nodes"])
```

## 📄 License

BSD-3-Clause (root [`LICENSE`](../LICENSE)). The `math_reasoning/` subset is derivative work built on GSM8K — its directory carries a [`math_reasoning/LICENSE`](math_reasoning/LICENSE) preserving GSM8K's original MIT notice (OpenAI 2021) alongside Megagon Labs's BSD-3-Clause for the added plan structures and instructions.
