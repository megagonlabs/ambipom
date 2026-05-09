import json
import subprocess

from ambipom.agents.base_agent import BaseAgent
from ambipom.prompts.agents import PROMPT_CODE
from ambipom.types import (
    AgentOutput,
    NodeOutputKey,
)


class CodeAgent(BaseAgent):
    def __init__(
        self,
        config: dict = {"model": "gpt-4o", "temperature": 0},
    ):
        super().__init__("code", config)
        self.prompt = PROMPT_CODE

    def execute(self, task: str, output_vars: NodeOutputKey) -> AgentOutput:
        dict_result = {}
        self.append_log("start_execution", "")
        self.append_log("task", task)
        self.append_log("output_vars", output_vars)

        ## generate the code
        code_clean_result = self.generate_code(task, output_vars)

        ## execute the code
        dict_result = self.call_code_tool(code_clean_result, dict_result)

        # Smaller models often print a bare value instead of `{var: value}`. Wrap so
        # downstream (plan.execute_node iterates `output_variable in dict_result`) does
        # not blow up on a scalar.
        if not isinstance(dict_result, dict):
            if isinstance(dict_result, (list, tuple)) and len(dict_result) == len(
                output_vars
            ):
                dict_result = dict(zip(output_vars, dict_result))
            elif len(output_vars) == 1:
                dict_result = {output_vars[0]: dict_result}
            else:
                self.append_log(
                    "code_result_shape_mismatch",
                    f"expected dict for {output_vars}, got {type(dict_result).__name__}: {dict_result!r}",
                )
                dict_result = {}

        self.append_log("[Present]output_json_results_final", str(dict_result))

        return dict_result

    def generate_code(self, task: str, output_vars: NodeOutputKey) -> str:
        try:
            prompt = self.prompt % (output_vars, task)
            self.append_log("[Present]agent_level_raw_code_prompt", prompt)
            code_raw_result = self.send_request(prompt=prompt)
            code_clean_result = (
                code_raw_result.strip()
                .replace("```python", "")
                .replace("```", "")
                .strip()
            )
            self.append_log("[Present]agent_level_code_clean_result", code_clean_result)

            return code_clean_result
        except Exception as e:
            self.append_log("[Present]generate_code Error Exception: ", str(e))
            # Return empty string if code generation fails
            return ""

    def call_code_tool(self, code_clean_result: str, dict_result: dict) -> dict:
        try:
            code_execution_result = subprocess.run(
                ["python", "-c", code_clean_result], capture_output=True, text=True
            )
            self.append_log("code_result_raw", str(code_execution_result))

            str_error = code_execution_result.stderr.strip()
            if str_error == "":
                code_execution_result = code_execution_result.stdout.strip()
            else:
                code_execution_result = ""
                self.append_log("[Present]code_result_error", str_error)
            self.append_log("[Present]code_execution_result", code_execution_result)
        except Exception as e:
            code_execution_result = ""
            self.append_log("[Present]code_compile_error", str(e))

        try:
            if code_execution_result == "":
                return {}
            dict_result = json.loads(code_execution_result)
        except json.JSONDecodeError as e:
            # Try to handle Python dict format (single quotes) by using ast.literal_eval
            self.append_log("[Present]code_result_json_parse_error", str(e))
            try:
                import ast

                dict_result = ast.literal_eval(code_execution_result)
                self.append_log("code_result_parsed_with_ast", str(dict_result))
            except Exception as e2:
                dict_result = {}
                self.append_log("[Present]code_result_process_error", str(e2))

        return dict_result
