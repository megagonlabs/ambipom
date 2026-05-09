"""AMBIPOM — human-LLM collaborative planning for orchestrated multi-agent systems.

Companion library for *How to Steer Your Multi-Agent System: Human-LLM Collaborative
Planning* (ACM CAIS 2026). Exposes the DAG plan runtime, the LLM-backed planner, and
the agent registry used by both the interactive system and the plan-revision dataset.
"""

from ambipom.plan import DAGPlan
from ambipom.planner import Planner
from ambipom.registry import AgentRegistry

__all__ = ["DAGPlan", "Planner", "AgentRegistry"]
