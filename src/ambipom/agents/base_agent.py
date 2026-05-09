import json
import os
import re
from abc import ABC, abstractmethod
from typing import Any

from pydantic import BaseModel, ConfigDict, create_model

from ambipom.types import AgentOutput, LogInfo, NodeOutputKey, PydanticJSONEncoder
from ambipom.utils import (
    LOCAL_LLM_MODEL,
    current_exact_time,
    fireworks_client,
    list_fireworks_model,
    list_open_ai_model,
    local_client,
    openai_client,
)


class BaseAgent(ABC):
    def __init__(
        self,
        agent_name: str,
        config: dict = {"model": "gpt-4o", "temperature": 0},
    ):
        self.agent_name = agent_name
        self.config = config
        self.list_fireworks_model = list_fireworks_model
        self.list_open_ai_model = list_open_ai_model
        self.openai_client = openai_client
        self.agent_log = {}

    @abstractmethod
    def execute(self, task: str, output_vars: NodeOutputKey) -> AgentOutput:
        """
        Execute the agent's task.
        """
        pass

    def update_config(self, config: dict):
        self.config.update(config)

    def get_config(self) -> dict:
        return self.config

    def extract_json_from_response(self, response_content: str) -> dict:
        json_match = re.search(r"```json\s*\n(.*?)\n```", response_content, re.DOTALL)
        if json_match:
            clean_response_content = json_match.group(1).strip()
        else:
            # Fallback: remove all code block markers
            clean_response_content = (
                response_content.replace("```json", "").replace("```", "").strip()
            )
        self.append_log(log_name="clean_response_content", log_data=response_content)
        try:
            dict_result = json.loads(clean_response_content)
        except Exception as e:
            dict_result = {}
            self.append_log(log_name="response_content_process_error", log_data=str(e))
        return dict_result

    def send_request(self, system_prompt: str = "", prompt: str = "") -> Any:
        if system_prompt != "":
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ]
        else:
            messages = [{"role": "user", "content": prompt}]

        model_name = self.config["model"]
        if model_name == "local":
            params = {
                "model": LOCAL_LLM_MODEL,
                "messages": messages,
                "temperature": self.config["temperature"],
            }
            return self.send_request_with_local(params)

        if model_name in self.list_fireworks_model:
            params = {"messages": messages, "temperature": self.config["temperature"]}
            response_content = self.send_request_with_fireworks(model_name, params)
            return response_content
        else:
            if model_name not in self.list_open_ai_model:
                model_name = "gpt-4o-mini"
            params = {
                "model": model_name,
                "messages": messages,
                "temperature": self.config["temperature"],
            }
            response_content = self.send_request_with_openai(params)
            return response_content

    def send_request_with_openai(self, params: dict) -> Any:
        try:
            self.append_log(
                log_name="send_request_with_openai_params", log_data=str(params)
            )
            response_openai = self.openai_client.chat.completions.create(
                **params,
            )
            self.append_log(
                log_name="send_request_with_openai_response",
                log_data=str(response_openai),
            )
            response_content = response_openai.choices[0].message.content
        except Exception as e:
            self.append_log(log_name="send_request_with_openai_error", log_data=str(e))
            return None
        return response_content

    def send_request_with_response_format(
        self,
        system_prompt: str = "",
        prompt: str = "",
        response_format: BaseModel = None,
    ) -> Any:
        if response_format is None:
            return "Request Error: Response format is missing!"

        if system_prompt != "":
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ]
        else:
            messages = [{"role": "user", "content": prompt}]

        model_name = self.config["model"]

        if model_name == "local":
            params = {
                "model": LOCAL_LLM_MODEL,
                "messages": messages,
                "temperature": self.config["temperature"],
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {
                        "name": "Result",
                        "schema": response_format.model_json_schema(),
                    },
                },
            }
            response_content = self.send_request_with_local(params)
            self.append_log("agent_level_raw_results", str(response_content))
            return response_format.parse_raw(response_content)

        if model_name in self.list_fireworks_model:
            params = {
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {
                        "name": "Result",
                        "schema": response_format.model_json_schema(),
                    },
                },
                "messages": messages,
                "temperature": self.config["temperature"],
            }
            response_content = self.send_request_with_fireworks(model_name, params)
            self.append_log("agent_level_raw_results", str(response_content))
            return response_format.parse_raw(response_content)

        else:
            if model_name not in self.list_open_ai_model:
                model_name = "gpt-4o-mini"
            params = {
                "input": messages,
                "model": model_name,
                "temperature": self.config["temperature"],
                "text_format": response_format,
            }
            response_content = self.send_request_with_response_format_openai(params)
            self.append_log("agent_level_raw_results", str(response_content))
            return response_content.output_parsed

    def send_request_with_local(self, params: dict) -> Any:
        try:
            self.append_log(
                log_name="send_request_with_local_params", log_data=str(params)
            )
            response = local_client.chat.completions.create(**params)
            self.append_log(
                log_name="send_request_with_local_response", log_data=str(response)
            )
            return response.choices[0].message.content
        except Exception as e:
            self.append_log(log_name="send_request_with_local_error", log_data=str(e))
            return None

    def send_request_with_fireworks(self, model_name: str, params: dict) -> Any:
        try:
            if not model_name.startswith("accounts/") and not model_name.startswith(
                "fireworks/"
            ):
                model_name = f"fireworks/{model_name}"
            self.append_log(
                log_name="send_request_with_fireworks_params",
                log_data=str({"model": model_name, **params}),
            )
            response = fireworks_client.chat.completions.create(
                model=model_name,
                **params,
            )
            self.append_log(
                log_name="send_request_with_fireworks_response", log_data=str(response)
            )
            response_content = response.choices[0].message.content
        except Exception as e:
            self.append_log(
                log_name="send_request_with_fireworks_error", log_data=str(e)
            )
            return None
        return response_content

    def send_request_with_response_format_openai(self, params: dict) -> Any:
        response_openai = self.openai_client.responses.parse(
            **params,
        )
        return response_openai

    def append_log(self, log_name: str, log_data: Any):
        index = len(self.agent_log) + 1
        log_info = LogInfo(
            agent_name=self.agent_name,
            timestamp=current_exact_time(),
            log_name=log_name,
            log_data=log_data,
        )
        self.agent_log[index] = log_info

    def get_latest_log(self, start_word: str = "start_execution"):
        list_log = []
        adding_index = 0
        for i in self.agent_log:
            if start_word in self.agent_log[i].log_name:
                adding_index = i

        while adding_index in self.agent_log:
            list_log.append(self.agent_log[adding_index])
            adding_index += 1
        return list_log

    def save_log(self, log_file_path: str):
        log_dir = os.path.dirname(log_file_path)
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)
        with open(log_file_path, "w", encoding="utf-8") as f:
            json.dump(self.agent_log, f, cls=PydanticJSONEncoder, indent=2)

    def create_ambipom_output_model(self, keys: list[str]) -> BaseModel:
        fields = {}
        for key in keys:
            fields[key] = (str, ...)
        OutputResultsModel = create_model("OutputResultsModel", **fields)

        class AgentOutputSchema(BaseModel):
            model_config = ConfigDict(extra="forbid")
            thought: str
            output_results: OutputResultsModel

        return AgentOutputSchema
