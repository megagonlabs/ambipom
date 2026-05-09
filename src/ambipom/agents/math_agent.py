from sympy import sympify

from ambipom.agents.base_agent import BaseAgent
from ambipom.prompts.agents import (
    PROMPT_MATH,
    PROMPT_MATH_FALLBACK,
    PROMPT_MATH_FALLBACK_STRUCTURE_OUTPUT,
    PROMPT_MATH_STRUCTURE_OUTPUT,
)
from ambipom.types import (
    AgentOutput,
    NodeOutputKey,
)


class MathAgent(BaseAgent):
    def __init__(
        self,
        config: dict = {"model": "gpt-4o", "temperature": 0},
    ):
        super().__init__("math", config)
        # old prompt non-structured output
        self.prompt_old = PROMPT_MATH
        self.propmt_fallback_old = PROMPT_MATH_FALLBACK

        # new prompt structured output
        self.prompt = PROMPT_MATH_STRUCTURE_OUTPUT
        self.prompt_fallback = PROMPT_MATH_FALLBACK_STRUCTURE_OUTPUT

    def execute(self, task: str, output_vars: NodeOutputKey) -> AgentOutput:
        """
        Executes the math agent.
        1. Generate the calculator arguments
        2. Call the calculator tool
        3. Record any variables that cannot be evaluated by calculator tool.
        4. Process the fallback on the recorded variables.
        5. Return the result

        Args:
            task (str): The task to execute.
            output_vars (NodeOutputKey): The output variables.

        Returns:
            AgentOutput: The output of the math agent.
        """
        dict_result = {}
        self.append_log("start_execution", "")
        self.append_log("task", task)
        self.append_log("output_vars", output_vars)

        ## process the calculator extraction
        dict_result = self.generate_calculator_args(task, output_vars)

        ## process the calculator eval
        list_llm_precess_pool, dict_result = self.call_calculator_tool(
            dict_result, output_vars
        )

        ## process the llm_process_pool fallback
        if len(list_llm_precess_pool) > 0:
            dict_result = self.process_fallback(
                task, list_llm_precess_pool, dict_result
            )

        self.append_log("[Present]output_json_results_final", str(dict_result))

        return dict_result

    def generate_calculator_args(self, task: str, output_vars: NodeOutputKey) -> dict:
        """
        Generates the calculator arguments. (Structured output)

        Args:
            task (str): The task to execute.
            output_vars (NodeOutputKey): The output variables.

        Returns:
            dict: The calculator arguments.
        """
        try:
            prompt = self.prompt % (task, output_vars)
            self.append_log("[Present]agent_level_raw_math_prompt", prompt)
            response_content = self.send_request_with_response_format(
                prompt=prompt,
                response_format=self.create_ambipom_output_model(output_vars),
            )
            self.append_log("clean_response_content_raw", response_content)
            dict_result = {}
            for key in output_vars:
                expr_value = getattr(response_content.output_results, key)
                dict_result[key] = {"expr": expr_value}

            self.append_log("[Present]output_json_results_calculator", str(dict_result))

            return dict_result
        except Exception as e:
            self.append_log(
                "[Present]generate_calculator_args Error Exception: ", str(e)
            )
            self.append_log(
                "fallback_to_unstructured", "Using unstructured output method"
            )
            return self.generate_calculator_args_old(task, output_vars)

    def generate_calculator_args_old(
        self, task: str, output_vars: NodeOutputKey
    ) -> dict:
        """
        Generates the calculator arguments. (Unstructured output)

        Args:
            task (str): The task to execute.
            output_vars (NodeOutputKey): The output variables.

        Returns:
            dict: The calculator arguments.
        """
        try:
            prompt = self.prompt_old % (task, output_vars)
            self.append_log("[Present]agent_level_raw_math_prompt_fallback", prompt)
            response_content = self.send_request(prompt=prompt)

            self.append_log("clean_response_content_raw", response_content)

            dict_result = self.extract_json_from_response(response_content)
            self.append_log(
                "[Present]output_json_results_calculator_fallback", str(dict_result)
            )

            return dict_result
        except Exception as e:
            self.append_log(
                "[Present]generate_calculator_args_old Error Exception: ", str(e)
            )
            # Return empty dict if both methods fail
            return {}

    def call_calculator_tool(
        self, dict_result: dict, output_vars: NodeOutputKey
    ) -> (list, dict):
        """
        Calls the calculator tool.

        Args:
            dict_result (dict): The calculator arguments.
            output_vars (NodeOutputKey): The output variables.

        Returns:
            list: The list of variables that cannot be evaluated by calculator tool.
            dict: The calculator results.
        """
        list_llm_precess_pool = []
        for key in output_vars:
            if key not in dict_result:
                dict_result[key] = None
                list_llm_precess_pool.append(key)
                continue
            expression = dict_result[key]["expr"]

            try:
                if expression is not None:
                    value = sympify(expression, rational=False)
                    dict_result[key] = value
                else:
                    list_llm_precess_pool.append(key)
            except Exception:
                dict_result[key] = None
                list_llm_precess_pool.append(key)

        self.append_log("[Present]calculator_eval_results", str(dict_result))
        self.append_log("list_llm_precess_pool", list_llm_precess_pool)

        return list_llm_precess_pool, dict_result

    def process_fallback(
        self, task: str, list_llm_precess_pool: list, dict_result: dict
    ) -> dict:
        """
        Processes the fallback. (Structured output)

        Args:
            task (str): The task to execute.
            list_llm_precess_pool (list): The list of variables that cannot be evaluated by calculator tool.
            dict_result (dict): The calculator results.

        Returns:
            dict: The calculator results.
        """
        try:
            prompt_fallback = self.prompt_fallback % (task, list_llm_precess_pool)
            self.append_log("agent_level_raw_fallback_prompt", prompt_fallback)
            response_content_fallback = self.send_request_with_response_format(
                prompt=prompt_fallback,
                response_format=self.create_ambipom_output_model(list_llm_precess_pool),
            )
            self.append_log("fallback_results", response_content_fallback)
            dict_result_fallback = {}

            for key in list_llm_precess_pool:
                dict_result_fallback[key] = getattr(
                    response_content_fallback.output_results, key
                )

            dict_result.update(dict_result_fallback)
            self.append_log(
                "[Present]output_json_results_after_fallback", str(dict_result)
            )

            return dict_result
        except Exception as e:
            self.append_log("[Present]process_fallback Error Exception: ", str(e))
            self.append_log(
                "fallback_to_unstructured", "Using unstructured fallback method"
            )
            return self.process_fallback_old(task, list_llm_precess_pool, dict_result)

    def process_fallback_old(
        self, task: str, list_llm_precess_pool: list, dict_result: dict
    ) -> dict:
        """
        Processes the fallback. (Unstructured output)

        Args:
            task (str): The task to execute.
            list_llm_precess_pool (list): The list of variables that cannot be evaluated by calculator tool.
            dict_result (dict): The calculator results.

        Returns:
            dict: The calculator results.
        """
        try:
            prompt_fallback = self.propmt_fallback_old % (task, list_llm_precess_pool)
            self.append_log(
                "[Present]agent_level_raw_fallback_prompt_fallback", prompt_fallback
            )
            response_content_fallback = self.send_request(prompt=prompt_fallback)
            self.append_log("fallback_results", response_content_fallback)
            dict_result_fallback = self.extract_json_from_response(
                response_content_fallback
            )

            dict_result.update(dict_result_fallback)
            self.append_log(
                "[Present]output_json_results_after_fallback_fallback", str(dict_result)
            )

            return dict_result
        except Exception as e:
            self.append_log("[Present]process_fallback_old Error Exception: ", str(e))
            # Return dict_result as-is if all fallbacks fail
            return dict_result
