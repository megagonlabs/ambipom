"""Registry of the four executable agents (math, code, commonsense, search) the
planner can assign to nodes. Seeds each with its default model/temperature config."""

from ambipom.agents import CodeAgent, CommonsenseAgent, MathAgent, SearchAgent


class AgentRegistry:
    def __init__(self):
        self.agent_registry = {
            "math": {
                "name": "math",
                "description": "Math agent",
                "instance": MathAgent(),
                "config": {"model": "gpt-4o-mini", "temperature": 0},
            },
            "code": {
                "name": "code",
                "description": "Code agent",
                "instance": CodeAgent(),
                "config": {"model": "gpt-4o-mini", "temperature": 0},
            },
            "commonsense": {
                "name": "commonsense",
                "description": "Commonsense agent",
                "instance": CommonsenseAgent(),
                "config": {"model": "gpt-4o-mini", "temperature": 0},
            },
            "search": {
                "name": "search",
                "description": "Search agent",
                "instance": SearchAgent(),
                "config": {"model": "gpt-4o-mini", "temperature": 0},
            },
        }

    def get_agent_list(self):
        agents = []
        for agent_name in self.agent_registry:
            agents.append(
                {
                    "name": self.agent_registry[agent_name]["name"],
                    "description": self.agent_registry[agent_name]["description"],
                    "config": self.agent_registry[agent_name]["config"],
                }
            )
        return agents
