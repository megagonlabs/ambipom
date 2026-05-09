"""Shared library utilities: OpenAI/Fireworks client setup, supported-model lists,
wire-format enums (MsgType / Status / InteractionType), and small time/uuid helpers."""

import os
import time
import uuid
from enum import Enum
from graphlib import TopologicalSorter

from fireworks.client import Fireworks
from openai import OpenAI

# LLM API clients
# Placeholder when unset so the client constructs at import time (local-only
# users don't need this key); real calls still 401 without a valid key.
openai_client = OpenAI(
    api_key=os.environ.get("OPENAI_API_KEY", "no-openai-key-set"),
    organization=os.environ.get("OPENAI_ORGANIZATION"),
    timeout=60.0,
)

# fireworks-ai SDK >= 0.19 broke LLM(...) for serverless models; call the
# Fireworks client directly via its OpenAI-compatible REST endpoint.
fireworks_client = Fireworks(
    api_key=os.environ.get("FIREWORKS_API_KEY", "no-fireworks-key-set"), timeout=60
)

# Single source of truth: frontend dropdowns fetch via /api/get-model-registry,
# routing lists below are derived. Add a model here to expose it everywhere.
MODEL_REGISTRY = [
    {"value": "gpt-4o", "label": "OpenAI: GPT-4o", "backend": "openai"},
    {"value": "gpt-4o-mini", "label": "OpenAI: GPT-4o-mini", "backend": "openai"},
    {
        "value": "gpt-3.5-turbo-0125",
        "label": "OpenAI: GPT-3.5 Turbo",
        "backend": "openai",
    },
    {
        "value": "llama-v3p3-70b-instruct",
        "label": "Fireworks: Llama 3.3 70B Instruct",
        "backend": "fireworks",
    },
    {"value": "gpt-oss-20b", "label": "Fireworks: GPT-OSS 20B", "backend": "fireworks"},
    {
        "value": "gpt-oss-120b",
        "label": "Fireworks: GPT-OSS 120B",
        "backend": "fireworks",
    },
    {
        "value": "local",
        "label": "Local: configure via LOCAL_LLM_MODEL",
        "backend": "local",
    },
]

list_open_ai_model = [m["value"] for m in MODEL_REGISTRY if m["backend"] == "openai"]
list_fireworks_model = [
    m["value"] for m in MODEL_REGISTRY if m["backend"] == "fireworks"
]
# Models that don't support structured outputs (json_schema); use json_object mode instead.
list_legacy_openai_model = ["gpt-3.5-turbo-0125"]

# Optional local LLM backend (Ollama, LM Studio, vLLM — any OpenAI-compatible endpoint).
LOCAL_LLM_BASE_URL = os.environ.get("LOCAL_LLM_BASE_URL", "http://localhost:11434/v1")
LOCAL_LLM_MODEL = os.environ.get("LOCAL_LLM_MODEL", "qwen3:1.7b")

local_client = OpenAI(
    base_url=LOCAL_LLM_BASE_URL,
    api_key=os.environ.get("LOCAL_LLM_API_KEY", "local"),  # placeholder; Ollama ignores
    timeout=180.0,  # local models can be slower than hosted APIs
)


# Wire-format enums. Used as Pydantic type annotations in ambipom.types to validate
# incoming websocket messages. Keep in sync with the frontend dispatch (see
# system/frontend/src/services/useWebSocketActions.jsx).
class MsgType(str, Enum):
    STATUS = "status"
    CONNECTION = "connection"
    CHAT = "chat"
    PLAN = "plan"
    INTERACTION = "interaction"
    EXECUTE = "execute"
    RESET = "reset"


class Status(str, Enum):
    RECEIVED = "Received"
    STARTING = "Starting"
    FINISHED = "Finished"
    ERROR = "Error"


class InteractionType(str, Enum):
    ADD_NODE = "add_node"
    REMOVE_NODE = "remove_node"
    ADD_EDGE = "add_edge"
    REMOVE_EDGE = "remove_edge"
    MODIFY_NODE = "modify_node"
    MODIFY_NODE_EDGES = "modify_node_edges"
    UPDATE_EXEC = "update_exec"
    SPLIT_NODE = "split_node"
    MERGE_NODES = "merge_nodes"
    FIX_PLAN = "fix_plan"
    REPLAN = "replan"


# helper functions
def current_time() -> str:
    return time.strftime("%T")


def current_exact_time() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def create_uuid() -> str:
    return str(uuid.uuid4())[:8]


def topo_sort(graph: dict) -> list:
    sorter = TopologicalSorter(graph)
    return list(sorter.static_order())
