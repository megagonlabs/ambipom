import json

from ambipom.agents.base_agent import BaseAgent
from ambipom.agents.search_tool import WebSearchTool
from ambipom.prompts.agents import (
    PROMPT_REWRITE_SEARCH,
    PROMPT_REWRITE_SEARCH_STRUCTURED,
    PROMPT_WEBSEARCH,
    PROMPT_WEBSEARCH_STRUCTURED,
)
from ambipom.types import (
    AgentOutput,
    NodeOutputKey,
)


class SearchAgent(BaseAgent):
    def __init__(
        self,
        config: dict = {"model": "gpt-4o", "temperature": 0},
    ):
        super().__init__("search", config)

        # old prompt non-structured output
        self.prompt = PROMPT_WEBSEARCH
        self.prompt_rewrite = PROMPT_REWRITE_SEARCH

        # new prompt structured output
        self.prompt_structured = PROMPT_WEBSEARCH_STRUCTURED
        self.prompt_rewrite_structured = PROMPT_REWRITE_SEARCH_STRUCTURED

    def execute(self, task: str, output_vars: NodeOutputKey) -> AgentOutput:
        """
        Executes the search agent.

        1. Generate the search query
        2. Execute the search
        3. Rewrite the search result into the output variables

        Args:
            task (str): The task to execute.
            output_vars (NodeOutputKey): The output variables.

        Returns:
            AgentOutput: The agent output.
        """
        dict_result = {}
        self.append_log("start_execution", "")
        self.append_log("task", task)
        self.append_log("output_vars", output_vars)

        ## generate the search query
        search_query = self.generate_search_query(task)

        ## execute the search
        str_result = self.call_search_tool(search_query)

        ## rewrite the search result
        dict_result = self.process_search_results(task, output_vars, str_result)
        self.append_log("[Present]output_json_results_final", str(dict_result))

        return dict_result

    def generate_search_query_old(self, task: str) -> str:
        """
        Generates the search query. (Old prompt non-structured output)
        Args:
            task (str): The task to execute.

        Returns:
            str: The search query.
        """
        try:
            prompt = self.prompt % (task)
            self.append_log(
                "[Present]agent_level_raw_search_query_prompt_fallback", prompt
            )
            response_content = self.send_request(prompt=prompt)
            self.append_log("[Present]search_query_fallback", response_content)
            return response_content
        except Exception as e:
            self.append_log(
                "[Present]generate_search_query_old Error Exception: ", str(e)
            )
            # Return empty string if both methods fail
            return ""

    def generate_search_query(self, task: str) -> str:
        """
        Generates the search query. (New prompt structured output)
        Args:
            task (str): The task to execute.

        Returns:
            str: The search query.
        """
        try:
            prompt = self.prompt_structured % (task)
            self.append_log("[Present]agent_level_raw_search_query_prompt", prompt)
            response = self.send_request_with_response_format(
                prompt=prompt,
                response_format=self.create_ambipom_output_model(["search_query"]),
            )
            response_content = response.output_results.search_query
            self.append_log("[Present]search_query", response_content)
            return response_content
        except Exception as e:
            self.append_log("[Present]generate_search_query Error Exception: ", str(e))
            self.append_log(
                "fallback_to_unstructured", "Using unstructured output method"
            )
            return self.generate_search_query_old(task)

    def call_search_tool(self, search_query: str) -> str:
        """
        Calls the search tool.
        Args:
            search_query (str): The search query to execute.

        Returns:
            str: The search result.
        """
        try:
            web_search_tool = WebSearchTool()
            str_result, dict_display_results, dict_raw_search_results = (
                web_search_tool.execute(search_query)
            )
            self.append_log("[Present]search_snippet_results", str_result)
            self.append_log(
                "[Present]display_results", json.dumps(dict_display_results)
            )
            self.append_log("raw_search_results", str(dict_raw_search_results))
            return str_result
        except Exception as e:
            self.append_log("[Present]call_search_tool Error Exception: ", str(e))
            # Return empty string if search fails
            return ""

    def process_search_results_old(
        self, task: str, output_vars: NodeOutputKey, str_result: str
    ) -> dict:
        """
        Processes the search results. (Old prompt non-structured output)
        Args:
            task (str): The task to execute.
            output_vars (NodeOutputKey): The output variables.
            str_result (str): The search result.

        Returns:
            dict: The search result.
        """
        try:
            prompt_rewrite = self.prompt_rewrite % (output_vars, task, str_result)
            self.append_log("agent_level_raw_search_rewrite_prompt", prompt_rewrite)
            response_content_rewrite = self.send_request(prompt=prompt_rewrite)

            self.append_log("search_rewrite_results", response_content_rewrite)

            dict_result = self.extract_json_from_response(response_content_rewrite)

            return dict_result
        except Exception as e:
            self.append_log("process_search_results_old Error Exception: ", str(e))
            # Return empty dict if all methods fail
            return {}

    def process_search_results(
        self, task: str, output_vars: NodeOutputKey, str_result: str
    ) -> dict:
        """
        Processes the search results. (New prompt structured output)
        Args:
            task (str): The task to execute.
            output_vars (NodeOutputKey): The output variables.
            str_result (str): The search result.

        Returns:
            dict: The search result.
        """
        try:
            prompt_rewrite = self.prompt_rewrite_structured % (
                output_vars,
                task,
                str_result,
            )
            self.append_log("agent_level_raw_search_rewrite_prompt", prompt_rewrite)
            response_content_rewrite = self.send_request_with_response_format(
                prompt=prompt_rewrite,
                response_format=self.create_ambipom_output_model(output_vars),
            )
            self.append_log(
                "[Present]search_rewrite_results",
                json.dumps(response_content_rewrite.model_dump()),
            )

            dict_result = {}
            for output_var in output_vars:
                dict_result[output_var] = getattr(
                    response_content_rewrite.output_results, output_var
                )

            return dict_result
        except Exception as e:
            self.append_log("process_search_results Error Exception: ", str(e))
            self.append_log(
                "fallback_to_unstructured", "Using unstructured output method"
            )
            return self.process_search_results_old(task, output_vars, str_result)
