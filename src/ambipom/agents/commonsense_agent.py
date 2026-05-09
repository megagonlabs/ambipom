import json

from ambipom.agents.base_agent import BaseAgent
from ambipom.prompts.agents import PROMPT_COMMONSENSE, PROMPT_COMMONSENSE_STRUCTURED
from ambipom.types import AgentOutput, NodeOutputKey


class CommonsenseAgent(BaseAgent):
    def __init__(
        self,
        config: dict = {"model": "gpt-4o", "temperature": 0},
    ):
        super().__init__("commonsense", config)
        # old prompt non-structured output
        self.prompt = PROMPT_COMMONSENSE

        # new prompt structured output
        self.prompt_structured = PROMPT_COMMONSENSE_STRUCTURED

    def execute(self, task: str, output_vars: NodeOutputKey) -> AgentOutput:
        dict_result = {}
        self.append_log("start_execution", "")
        self.append_log("task", task)
        self.append_log("output_vars", output_vars)

        ## generate the commonsense
        dict_result = self.generate_response(task, output_vars)
        return dict_result

    def generate_response_old(self, task: str, output_vars: NodeOutputKey) -> dict:
        try:
            prompt = self.prompt % (output_vars, task)
            self.append_log(
                "[Present]agent_level_raw_commonsense_prompt_fallback", prompt
            )
            response_content = self.send_request(prompt=prompt)
            dict_result = self.extract_json_from_response(response_content)
            self.append_log(
                "[Present]output_json_results_commonsense_fallback", str(dict_result)
            )
            return dict_result
        except Exception as e:
            self.append_log("[Present]generate_response_old Error Exception: ", str(e))
            # Return empty dict if both methods fail
            return {}

    def generate_response(self, task: str, output_vars: NodeOutputKey) -> dict:
        try:
            prompt = self.prompt_structured % (output_vars, task)
            self.append_log("[Present]agent_level_raw_commonsense_prompt", prompt)
            response_content = self.send_request_with_response_format(
                prompt=prompt,
                response_format=self.create_ambipom_output_model(output_vars),
            )
            self.append_log(
                "[Present]commonsense_raw_results",
                json.dumps(response_content.model_dump()),
            )
            dict_result = {}
            for output_var in output_vars:
                dict_result[output_var] = getattr(
                    response_content.output_results, output_var
                )

            self.append_log(
                "[Present]output_json_results_commonsense", json.dumps(dict_result)
            )
            return dict_result
        except Exception as e:
            self.append_log("[Present]generate_response Error Exception: ", str(e))
            self.append_log(
                "fallback_to_unstructured", "Using unstructured output method"
            )
            return self.generate_response_old(task, output_vars)
