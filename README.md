# AMBIPOM

[![Conference](https://img.shields.io/badge/ACM_CAIS-2026-cornflowerblue)](TBA)
[![arXiv](https://img.shields.io/badge/arxiv-XXXX.XXXXX-firebrick)](https://arxiv.org/abs/TBA)

**A**gent-aware **M**ixed-initiative **B**lock-level **I**nteractive **P**lanning for **O**rchestrated **M**ulti-agent systems — a prototype that demonstrates the interaction design space introduced in *How to Steer Your Multi-Agent System: Human-LLM Collaborative Planning* (ACM CAIS 2026). A user describes a task; an LLM-backed planner breaks it into a directed graph of sub-tasks, each assigned to one of four executable agents — `math`, `code`, `search`, or `commonsense` — connected by typed data flows. The system instantiates the paper's three interaction axes: **mode** (semantic ↔ structural), **scope** (global ↔ targeted), and **level** (low-level ↔ high-level).

This repository contains the prototype, the dataset, and the reproduction pipeline:

- the **interactive prototype** (`system/`) — the multi-agent planning UI from the paper; a FastAPI backend with a pre-built React frontend that you can launch as a single process;
- the **Python library** (`src/ambipom/`) — the planner, agents, runtime DAG, and on-disk plan format extracted from the prototype as an importable package; the same code backs both `system/` and `experiment/`;
- the **1,150-item plan-revision dataset** (`dataset/`) — the dataset constructed and described in the paper, with 200 reference plans across four task subsets and ground-truth answers for the math subset;
- the **reproduction pipeline** (`experiment/`) — `run.py` produces revised plans and `evaluate.py` computes the paper's §6.5 plan-revision results (GED, semantic similarity, plan stability, integration success rate) for the GF (global feedback) and TF (targeted feedback) conditions.

## 🚀 Quickstart

```bash
# 1. Install (Python 3.10–3.13)
pip install -e .

# 2. Configure (OPENAI_API_KEY is required by default; see "API Keys" below.
#    To run without any API key, see "Local LM Mode" below.)
export OPENAI_API_KEY="sk-..."

# 3. Run
cd system && python server.py
```

Open <http://localhost:8000> in your browser to start planning.

Type a task in the chat panel — for example, *"Compute the average chapter count of three Booker Prize winners' debut novels."* — and click **Generate Plan**. The planner returns a graph of sub-tasks, which you can edit two ways: by typing **natural-language feedback** in the chat panel, or by **directly manipulating** the graph.

**Natural-language feedback:**

- **Entire Replan** *(global feedback)* — feedback revises the whole plan. *e.g., "Add a final node that formats the output as a single dollar value."*
- **Target Replan** *(targeted feedback)* — select a subgraph first; the planner revises only the selected nodes with frozen boundaries. *e.g., "Rephrase this node to specify the year."*

**Direct manipulation:**

- **Low-level edits** — add/remove nodes and edges, change task descriptions, reassign agents, edit input/output variable bindings.
- **High-level compositional ops** — split a node into two, or merge selected nodes; both have manual and LLM-assisted variants (Auto Split, Auto Merge).

Other toolbar features: **Load Plan** accepts any plan JSON (including dataset plans like `dataset/math_reasoning/gold/00001.json`); **Save Plan** exports the current plan; **Execute** runs nodes individually or the whole plan and emits per-node logs; **Undo/Redo** (⌘Z / ⌘⇧Z) reverts and replays edits. Plans containing `search` nodes need a Brave API key (see below).

## 🔑 API Keys

Set as environment variables before launching.

**LLM backend for planning and execution** — choose one:
- **`OPENAI_API_KEY`** — hosted via OpenAI
- **`FIREWORKS_API_KEY`** — hosted via Fireworks (alternative)
- **Local LM Mode** — no commercial key (see below)

**Web search tool for `search` agent** — required to execute search nodes:
- **`BRAVE_API_KEY`**

`experiment/evaluate.py` is local-only and needs no key. Get keys at <https://platform.openai.com/api-keys> and <https://brave.com/search/api/>.

## 🖥️ Local LM Mode (no API key)

To use AMBIPOM without a commercial API key, point it at any OpenAI-compatible LLM server. Tested with [Ollama](https://ollama.com/download); other backends (LM Studio, vLLM, etc.) should work but are not validated.

Replace step 2 (`export OPENAI_API_KEY`) of the Quickstart with:

```bash
ollama pull qwen3:1.7b                                # ~1.4 GB; runs on a laptop, no GPU
export LOCAL_LLM_BASE_URL="http://localhost:11434/v1" # default
export LOCAL_LLM_MODEL="qwen3:1.7b"                   # default
# export LOCAL_LLM_API_KEY="..."                      # only if your backend requires auth
```

Then run as in Quickstart step 3. Select **Local (LOCAL_LLM_MODEL)** from the model dropdown in the UI. We have validated `qwen3:1.7b` as the default (~1.4 GB on disk, ~2 GB RAM, ~17 s per plan with the model pre-loaded). Override `LOCAL_LLM_MODEL` to try any other model available on your local server.

## ⚠️ Caveats

- **Responsible use.** Tasks typed in the UI become LLM prompts, and the `code` agent runs the resulting Python via `subprocess` with no sandboxing. Don't execute plans built from prompts you don't trust, and review outputs before acting on them — standard LLM-tool caveats apply.
- **First-run download.** `experiment/evaluate.py` downloads a sentence-transformer model (~100 MB) on first run.
- **LLM nondeterminism.** Outputs vary across runs even at `temperature=0`; affects both the UI and the experiment pipeline.
- **Rate limits.** A full experiment run (`python experiment/run.py --all`) issues roughly 2,300 OpenAI calls. Lower-tier accounts may hit rate limits; use `--all --n 5` for a tiny sample, or split runs by `--condition` / `--subset`.
- **Verbose stdout.** Backend and frontend both log progress to stdout / the browser console during use. That's intentional and informational, not an error.

## 🗂️ Repository Layout

```
ambipom-release/
├── README.md
├── LICENSE                            BSD-3-Clause; see also dataset/math_reasoning/LICENSE
├── pyproject.toml                     pip install -e . (or [experiment] for SS metric)
├── src/ambipom/                       library: planner, agents, runtime DAG, plan history
├── system/
│   ├── server.py
│   ├── controller.py
│   ├── action_logger.py
│   └── frontend/
│       ├── src/                       React source (xyflow + Blueprint UI)
│       └── dist/                      pre-built bundle served by the backend
├── dataset/                           1,150-item plan-revision dataset
└── experiment/                        reproduction pipeline
```

## 💻 Tested Environment

macOS 15 (Darwin 24.4) on Apple Silicon (arm64) with Python 3.13 and Node.js 24. No GPU required; runs on a commodity x86_64 or arm64 laptop with ~8 GB RAM and ~1 GB free disk (covers the sentence-transformer model, frontend build artifacts, and experiment outputs). Internet access is required for LLM calls.

## 🛠️ Development

The shipped `system/frontend/dist/` bundle is what the backend serves; reviewers don't need Node.js. To modify the frontend:

```bash
cd system/frontend
npm install
npm run build      # writes frontend/dist/, picked up by the backend
# or, hot-reload during development:
npm run dev        # serves at :5173, proxies /api to the backend at :8000
```

## 📄 License

This project is licensed under the BSD 3-Clause License - see the [LICENSE](LICENSE) file for details.

## Disclosures:

This software may include, incorporate, or access open source software (OSS) components, datasets and other third party components, including those identified below. The license terms respectively governing the datasets and third-party components continue to govern those portions, and you agree to those license terms may limit any distribution, use, and copying. You may use any OSS components under the terms of their respective licenses, which may include BSD 3, Apache 2.0, and other licenses. In the event of conflicts between Megagon Labs, Inc. ("Megagon") license conditions and the OSS license conditions, the applicable OSS conditions governing the corresponding OSS components shall prevail. You agree not to, and are not permitted to, distribute actual datasets used with the OSS components listed below. You agree and are limited to distribute only links to datasets from known sources by listing them in the datasets overview table below. You agree that any right to modify datasets originating from parties other than Megagon are governed by the respective third party's license conditions. You agree that Megagon grants no license as to any of its intellectual property and patent rights. THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS (INCLUDING MEGAGON) "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. You agree to cease using, incorporating, and distributing any part of the provided materials if you do not agree with the terms or the lack of any warranty herein. While Megagon makes commercially reasonable efforts to ensure that citations in this document are complete and accurate, errors may occur. If you see any error or omission, please help us improve this document by sending information to contact_oss@megagon.ai.

### Datasets

All datasets used within the product are listed below (including their copyright holders and the license information).

For Datasets having different portions released under different licenses, please refer to the included source link specified for each of the respective datasets for identifications of dataset files released under the identified licenses.

</br>


| ID  | OSS Component Name | Modified | Copyright Holder | Upstream Link | License  |
|-----|----------------------------------|----------|------------------|-----------------------------------------------------------------------------------------------------------|--------------------|
| 1 | Grade School Math GSM8K | No | Copyright (c) 2021 OpenAI | [link](https://github.com/openai/grade-school-math) | MIT License

The `math_reasoning/` subset is derivative work built on GSM8K; see [`dataset/math_reasoning/LICENSE`](dataset/math_reasoning/LICENSE) for the dual-license file preserving GSM8K's MIT notice alongside the BSD-3-Clause for our additions.

## 📚 Citation

```bibtex
@inproceedings{he-etal-2026-ambipom,
  title     = {How to Steer Your Multi-Agent System: Human-LLM Collaborative Planning},
  author    = {He, Zeyu and Kim, Hannah and Zhang, Dan and Hruschka, Estevam},
  booktitle = {Proceedings of the ACM Conference on AI and Agentic Systems (CAIS)},
  year      = {2026}
}
```
