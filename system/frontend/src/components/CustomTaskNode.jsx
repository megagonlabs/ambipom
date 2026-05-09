import {
  Button,
  HTMLSelect,
  InputGroup,
  Spinner,
  TextArea,
} from "@blueprintjs/core";
import { Handle, Position, useUpdateNodeInternals } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import JsonView from "react18-json-view";
import "react18-json-view/src/style.css";
import {
  addConversationMessage,
  sendUpdateNodePositions,
} from "../services/backendApi";
import {
  addInputVariableKey,
  addOutputVariableKey,
  autoSplitNode,
  executeTask,
  modifyInputVariableKey,
  modifyOutputVariableKey,
  removeInputVariableKey,
  removeNode,
  removeOutputVariableKey,
  sequentialSplitNode,
  updateNodeAgentName,
  updateNodeConfig,
  updateNodeTaskDescription,
  updateVariableValue,
} from "../services/uiInteraction";
import { logButtonClick } from "../utils/buttonLogger";
import { addUserInteractionToConversation } from "../utils/interactionMessages";
import "./CustomTaskNode.css";

const CustomTaskNode = ({ data, id }) => {
  const updateNodeInternals = useUpdateNodeInternals();
  // Get sessionId from data
  const sessionId = data.sessionId;
  // Available agent types
  const AGENT_TYPES = [
    { value: "code", label: "Code - Programming & Implementation" },
    { value: "math", label: "Math - Mathematical Reasoning" },
    { value: "search", label: "Search - Web Knowledge Retrieval" },
    { value: "commonsense", label: "Commonsense - General Reasoning" },
  ];

  // Input structure: { name: string, value: string, isValid: boolean, isEditing: boolean }
  const [inputs, setInputs] = useState(data.input || []);
  const [outputs, setOutputs] = useState(data.output || []);
  const [selectedAgent, setSelectedAgent] = useState(
    data.agent_name || "commonsense",
  );

  // Sync inputs/outputs when data changes (for undo/redo)
  useEffect(() => {
    if (data.input) {
      setInputs(data.input);
    }
    if (data.output) {
      setOutputs(data.output);
    }
  }, [data.input, data.output]);
  // Task description state
  const [taskDescription, setTaskDescription] = useState(
    data.task || data.description || "",
  );
  const [originalTaskDescription, setOriginalTaskDescription] = useState(
    data.task || data.description || "",
  );
  const [hasUnsavedTaskChanges, setHasUnsavedTaskChanges] = useState(false);
  const [isEditingTaskDescription, setIsEditingTaskDescription] =
    useState(false);
  // Store backup when editing starts
  const [inputBackup, setInputBackup] = useState(null);
  const [outputBackup, setOutputBackup] = useState(null);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editingOutputIndex, setEditingOutputIndex] = useState(null);
  // Store backup when editing variable values
  const [inputValueBackup, setInputValueBackup] = useState(null);
  const [outputValueBackup, setOutputValueBackup] = useState(null);
  const [editingInputValueIndex, setEditingInputValueIndex] = useState(null);
  const [editingOutputValueIndex, setEditingOutputValueIndex] = useState(null);
  // Collapse state for variables section - persist in node data
  const [isVariablesCollapsed, setIsVariablesCollapsed] = useState(
    data.isVariablesCollapsed || false,
  );
  // Collapse state for log section - default to collapsed
  const [isLogCollapsed, setIsLogCollapsed] = useState(
    data.isLogCollapsed !== undefined ? data.isLogCollapsed : true,
  );
  // Log content state
  const [logContent, setLogContent] = useState(data.execution_log || "");
  // Code section state (for code agent)
  const [isCodeCollapsed, setIsCodeCollapsed] = useState(
    data.isCodeCollapsed !== undefined ? data.isCodeCollapsed : true,
  );
  const [codeContent, setCodeContent] = useState("");
  const [executionResult, setExecutionResult] = useState("");
  const [executionError, setExecutionError] = useState("");
  // Intermediate status section state (for math agent)
  const [isIntermediateStatusCollapsed, setIsIntermediateStatusCollapsed] =
    useState(
      data.isIntermediateStatusCollapsed !== undefined
        ? data.isIntermediateStatusCollapsed
        : true,
    );
  const [mathExpressionData, setMathExpressionData] = useState([]);
  const [fallbackData, setFallbackData] = useState([]);
  // Search intermediate status section state (for search agent)
  const [
    isSearchIntermediateStatusCollapsed,
    setIsSearchIntermediateStatusCollapsed,
  ] = useState(
    data.isSearchIntermediateStatusCollapsed !== undefined
      ? data.isSearchIntermediateStatusCollapsed
      : true,
  );
  const [searchQueryData, setSearchQueryData] = useState("");
  const [searchResultsData, setSearchResultsData] = useState({});
  const [searchRewriteData, setSearchRewriteData] = useState({
    thought: "",
    output_results: {},
  });
  const [isSearchRewriteCollapsed, setIsSearchRewriteCollapsed] = useState(
    data.isSearchRewriteCollapsed !== undefined
      ? data.isSearchRewriteCollapsed
      : true,
  );
  // Commonsense intermediate status section state (for commonsense agent)
  const [
    isCommonsenseIntermediateStatusCollapsed,
    setIsCommonsenseIntermediateStatusCollapsed,
  ] = useState(
    data.isCommonsenseIntermediateStatusCollapsed !== undefined
      ? data.isCommonsenseIntermediateStatusCollapsed
      : true,
  );
  const [commonsenseRawResults, setCommonsenseRawResults] = useState({
    thought: "",
    output_results: {},
  });
  // 3-dot menu state
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  // Selection state (for merge operations)
  const [isSelected, setIsSelected] = useState(data.isSelected || false);
  // Agent settings state
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [agentSettings, setAgentSettings] = useState({
    modelName: data.modelName || "gpt-4o-mini",
    temperature: data.temperature || 0.0,
  });

  // Custom fields state (additional settings beyond model and temperature)
  const [customFields, setCustomFields] = useState(data.customFields || []);

  // Split/merge loading states
  const [isSplitting, setIsSplitting] = useState(false);

  // Pulled from backend via /api/get-model-registry; PlanDisplay injects it into node `data`.
  const MODEL_OPTIONS =
    data.modelRegistry && data.modelRegistry.length > 0
      ? data.modelRegistry
      : [{ value: "gpt-4o-mini", label: "OpenAI: GPT-4o-mini" }]; // safety fallback

  useEffect(() => {
    const incomingDescription = data.task || data.description || "";

    if (!isEditingTaskDescription) {
      setTaskDescription(incomingDescription);
      setHasUnsavedTaskChanges(false);
    }

    setOriginalTaskDescription(incomingDescription);
  }, [data.task, data.description, id, isEditingTaskDescription]);

  // Sync local state with global data changes (important for cross-node updates)
  useEffect(() => {
    setInputs(data.input || []);
  }, [JSON.stringify(data.input), id]);

  useEffect(() => {
    setOutputs(data.output || []);
  }, [JSON.stringify(data.output), id]);

  // When handle lists (names or counts) or collapsed state change, update internals so edges can attach
  const inputHandleKey = useMemo(
    () => (inputs || []).map((i) => i?.name || "").join("|"),
    [inputs],
  );
  const outputHandleKey = useMemo(
    () => (outputs || []).map((o) => o?.name || "").join("|"),
    [outputs],
  );
  useEffect(() => {
    // Defer to next frame to ensure DOM is updated
    const raf = requestAnimationFrame(() => updateNodeInternals(id));
    return () => cancelAnimationFrame(raf);
  }, [
    id,
    inputHandleKey,
    outputHandleKey,
    isVariablesCollapsed,
    updateNodeInternals,
  ]);

  // Store previous agent name to detect changes
  const prevAgentRef = useRef(data.agent_name);

  useEffect(() => {
    const agentName = data.agent_name || "commonsense";
    const prevAgent = prevAgentRef.current;

    // If agent type changed, clear all log-related state
    if (prevAgent && prevAgent !== agentName) {
      // console.log(`Agent changed from ${prevAgent} to ${agentName}, clearing logs`);
      setLogContent("");
      setCodeContent("");
      setExecutionResult("");
      setExecutionError("");
      setMathExpressionData([]);
      setFallbackData([]);
      setSearchQueryData("");
      setSearchResultsData({});
      setSearchRewriteData({ thought: "", output_results: {} });
      setCommonsenseRawResults({ thought: "", output_results: {} });
    }

    setSelectedAgent(agentName);
    prevAgentRef.current = agentName;
  }, [data.agent_name, id]);

  // Sync collapse state with node data
  useEffect(() => {
    setIsVariablesCollapsed(data.isVariablesCollapsed || false);
  }, [data.isVariablesCollapsed, id]);

  // Sync log collapse state with node data
  useEffect(() => {
    setIsLogCollapsed(
      data.isLogCollapsed !== undefined ? data.isLogCollapsed : true,
    );
  }, [data.isLogCollapsed, id]);

  // Sync log content with node data
  useEffect(() => {
    setLogContent(data.execution_log || "");
  }, [data.execution_log, id]);

  // Sync code collapse state with node data
  useEffect(() => {
    setIsCodeCollapsed(
      data.isCodeCollapsed !== undefined ? data.isCodeCollapsed : true,
    );
  }, [data.isCodeCollapsed, id]);

  // Sync search intermediate status collapse state with node data
  useEffect(() => {
    setIsSearchIntermediateStatusCollapsed(
      data.isSearchIntermediateStatusCollapsed !== undefined
        ? data.isSearchIntermediateStatusCollapsed
        : true,
    );
  }, [data.isSearchIntermediateStatusCollapsed, id]);

  // Sync search rewrite collapse state with node data
  useEffect(() => {
    setIsSearchRewriteCollapsed(
      data.isSearchRewriteCollapsed !== undefined
        ? data.isSearchRewriteCollapsed
        : true,
    );
  }, [data.isSearchRewriteCollapsed, id]);

  // Sync commonsense intermediate status collapse state with node data
  useEffect(() => {
    setIsCommonsenseIntermediateStatusCollapsed(
      data.isCommonsenseIntermediateStatusCollapsed !== undefined
        ? data.isCommonsenseIntermediateStatusCollapsed
        : true,
    );
  }, [data.isCommonsenseIntermediateStatusCollapsed, id]);

  // Extract code content from execution log when log changes
  useEffect(() => {
    if (selectedAgent === "code" && logContent) {
      try {
        const logData =
          typeof logContent === "string" ? JSON.parse(logContent) : logContent;
        // console.log('Parsed log data:', logData);

        // logData is a list of dictionaries with log_name and log_data fields
        // Find the entry where log_name matches '[Present]agent_level_code_clean_result'
        let foundCode = "";
        if (Array.isArray(logData)) {
          for (const entry of logData) {
            if (entry.log_name === "[Present]agent_level_code_clean_result") {
              foundCode = entry.log_data || "";
              break;
            }
          }
        }

        setCodeContent(foundCode);
        if (foundCode) {
          // console.log('Code extracted successfully, length:', foundCode.length);
        }
      } catch (error) {
        console.error("Error parsing log content for code extraction:", error);
        setCodeContent("");
      }
    } else {
      setCodeContent("");
    }
  }, [logContent, selectedAgent, id]);

  // Extract execution result and error from execution log when log changes
  useEffect(() => {
    if (selectedAgent === "code" && logContent) {
      try {
        const logData =
          typeof logContent === "string" ? JSON.parse(logContent) : logContent;

        // logData is a list of dictionaries with log_name and log_data fields
        let foundResult = "";
        let foundError = "";
        if (Array.isArray(logData)) {
          for (const entry of logData) {
            if (entry.log_name === "[Present]code_execution_result") {
              foundResult = entry.log_data || "";
            }
            if (entry.log_name === "[Present]code_result_error") {
              foundError = entry.log_data || "";
            }
          }
        }

        setExecutionResult(foundResult);
        setExecutionError(foundError);
      } catch (error) {
        console.error(
          "Error parsing log content for execution result extraction:",
          error,
        );
        setExecutionResult("");
        setExecutionError("");
      }
    } else {
      setExecutionResult("");
      setExecutionError("");
    }
  }, [logContent, selectedAgent, id]);

  // Extract math expression data from execution log when log changes
  useEffect(() => {
    if (selectedAgent === "math" && logContent) {
      try {
        const logData =
          typeof logContent === "string" ? JSON.parse(logContent) : logContent;
        // console.log('Parsed log data for math:', logData);

        // logData is a list of dictionaries with log_name and log_data fields
        // Find the entry where log_name matches '[Present]output_json_results_calculator'
        let mathData = null;
        let calculatorResults = null;
        let fallbackResults = null;
        if (Array.isArray(logData)) {
          for (const entry of logData) {
            if (entry.log_name === "[Present]output_json_results_calculator") {
              mathData = entry.log_data;
            }
            if (entry.log_name === "[Present]calculator_eval_results") {
              calculatorResults = entry.log_data;
            }
            if (
              entry.log_name === "[Present]output_json_results_after_fallback"
            ) {
              fallbackResults = entry.log_data;
            }
          }
        }

        // Helper function to convert Python format to JSON format
        const pythonToJson = (pythonStr) => {
          return pythonStr
            .replace(/'/g, '"') // Replace single quotes with double quotes
            .replace(/\bNone\b/g, "null") // Replace Python None with JSON null
            .replace(/\bTrue\b/g, "true") // Replace Python True with JSON true
            .replace(/\bFalse\b/g, "false"); // Replace Python False with JSON false
        };

        // Parse calculator results if available (needed for both math expressions and fallback)
        let parsedCalculatorResults = {};
        if (calculatorResults) {
          try {
            let jsonString =
              typeof calculatorResults === "string"
                ? pythonToJson(calculatorResults)
                : JSON.stringify(calculatorResults);

            // Handle cases where values might be unquoted (like sqrt(2), numbers, expressions)
            // Quote all unquoted values to treat them as strings
            // Match pattern: ": value" where value is not already quoted and not null/true/false/number
            jsonString = jsonString.replace(
              /:\s*([^",{\[\s][^,}\]]*)/g,
              (match, value) => {
                // Check if it's already a valid JSON value (null, true, false, number)
                if (
                  value === "null" ||
                  value === "true" ||
                  value === "false" ||
                  !isNaN(value.trim())
                ) {
                  return match; // Keep as is
                }
                // Quote the value to make it a string
                return `: "${value.trim()}"`;
              },
            );

            parsedCalculatorResults = JSON.parse(jsonString);
            // console.log('Parsed calculator results:', parsedCalculatorResults);
          } catch (error) {
            console.error("Error parsing calculator results:", error);
            // console.log('Raw calculator results:', calculatorResults);
            // Continue with empty object if parsing fails
            parsedCalculatorResults = {};
          }
        }

        if (mathData) {
          // Parse mathData if it's a string
          // console.log('Math data:', mathData);
          // console.log('Math data:', typeof mathData);

          // Handle Python dictionary format by converting to JSON format
          let parsedMathData;
          try {
            let jsonString =
              typeof mathData === "string"
                ? pythonToJson(mathData)
                : JSON.stringify(mathData);

            // Handle unquoted values - treat them as strings
            jsonString = jsonString.replace(
              /:\s*([^",{\[\s][^,}\]]*)/g,
              (match, value) => {
                if (
                  value === "null" ||
                  value === "true" ||
                  value === "false" ||
                  !isNaN(value.trim())
                ) {
                  return match;
                }
                return `: "${value.trim()}"`;
              },
            );

            parsedMathData = JSON.parse(jsonString);
          } catch (error) {
            console.error("Error parsing math data:", error);
            parsedMathData = {};
          }
          // console.log('Parsed math data:', parsedMathData);

          // Convert to array format for table display
          // Format: {output_key: {'expr': "math_expression"}, output_key2: {'expr': "..."}}
          const mathExpressions = [];

          // parsedMathData is a dictionary, iterate over its entries
          for (const [outputKey, value] of Object.entries(parsedMathData)) {
            // Check if 'expr' property exists (even if it's null/None)
            if (value && typeof value === "object" && "expr" in value) {
              // Get the result from calculator results, or fall back to outputs state
              const result =
                parsedCalculatorResults[outputKey] !== undefined
                  ? parsedCalculatorResults[outputKey]
                  : outputs.find((o) => o.name === outputKey)?.value || "";
              mathExpressions.push({
                outputName: outputKey,
                expression: value.expr || "", // Convert null to empty string
                result: result,
              });
            }
          }

          setMathExpressionData(mathExpressions);
          if (mathExpressions.length > 0) {
            // console.log('Math expressions extracted successfully:', mathExpressions.length);
          }
        } else {
          setMathExpressionData([]);
        }
        // console.log('Math expression data:', mathExpressionData);
        // console.log('Math calculator results:', parsedCalculatorResults);
        // console.log('Fallback results:', fallbackResults);
        // Parse fallback results if available
        if (fallbackResults) {
          let parsedFallbackResults;
          try {
            let jsonString =
              typeof fallbackResults === "string"
                ? pythonToJson(fallbackResults)
                : JSON.stringify(fallbackResults);

            // Handle unquoted values - treat them as strings
            jsonString = jsonString.replace(
              /:\s*([^",{\[\s][^,}\]]*)/g,
              (match, value) => {
                if (
                  value === "null" ||
                  value === "true" ||
                  value === "false" ||
                  !isNaN(value.trim())
                ) {
                  return match;
                }
                return `: "${value.trim()}"`;
              },
            );

            parsedFallbackResults = JSON.parse(jsonString);
          } catch (error) {
            console.error("Error parsing fallback results:", error);
            parsedFallbackResults = {};
          }
          // console.log('Parsed fallback results:', parsedFallbackResults);

          // Convert to array format for table display
          // Only include entries where calculator result was empty/null
          // Format: {key: value}
          const fallbackArray = [];
          for (const [outputKey, value] of Object.entries(
            parsedFallbackResults,
          )) {
            // Check if this key has empty calculator result
            const calculatorResult = parsedCalculatorResults[outputKey];
            const hasEmptyCalculatorResult =
              calculatorResult === null ||
              calculatorResult === undefined ||
              calculatorResult === "";

            // Only include in fallback table if calculator result was empty
            if (hasEmptyCalculatorResult) {
              fallbackArray.push({
                outputName: outputKey,
                result: value,
              });
            }
          }

          setFallbackData(fallbackArray);
          if (fallbackArray.length > 0) {
            // console.log('Fallback results extracted successfully:', fallbackArray.length);
          }
        } else {
          setFallbackData([]);
        }
      } catch (error) {
        console.error(
          "Error parsing log content for math expression extraction:",
          error,
        );
        setMathExpressionData([]);
        setFallbackData([]);
      }
    } else {
      setMathExpressionData([]);
      setFallbackData([]);
    }
  }, [logContent, selectedAgent, id, outputs]);

  // Extract search query, results, and rewrite from execution log when log changes (for search agent)
  useEffect(() => {
    if (selectedAgent === "search" && logContent) {
      try {
        const logData =
          typeof logContent === "string" ? JSON.parse(logContent) : logContent;
        // console.log('Parsed log data for search:', logData);

        // logData is a list of dictionaries with log_name and log_data fields
        let foundSearchQuery = "";
        let foundSearchResults = {};
        let foundSearchRewrite = { thought: "", output_results: {} };

        if (Array.isArray(logData)) {
          for (const entry of logData) {
            if (entry.log_name === "[Present]search_query") {
              foundSearchQuery = entry.log_data || "";
            }
            if (entry.log_name === "[Present]display_results") {
              // Parse the search results dictionary (now stored as JSON string via json.dumps)
              const resultsData = entry.log_data;
              // console.log('Raw search results data:', resultsData);
              // console.log('Type:', typeof resultsData);

              if (typeof resultsData === "object" && resultsData !== null) {
                // Data is already an object
                foundSearchResults = resultsData;
              } else if (typeof resultsData === "string") {
                try {
                  // Parse the JSON string (backend uses json.dumps)
                  foundSearchResults = JSON.parse(resultsData);
                  // console.log('Parsed search results successfully:', foundSearchResults);
                } catch (parseError) {
                  console.error(
                    "Error parsing search results JSON:",
                    parseError,
                  );
                  // console.log('Original data:', resultsData);
                  foundSearchResults = {};
                }
              } else {
                foundSearchResults = {};
              }
            }
            if (entry.log_name === "[Present]search_rewrite_results") {
              // Parse the search rewrite results
              const rewriteData = entry.log_data;
              // console.log('Raw search rewrite data:', rewriteData);
              // console.log('Type:', typeof rewriteData);

              if (typeof rewriteData === "object" && rewriteData !== null) {
                // Data is already an object
                foundSearchRewrite = {
                  thought: rewriteData.thought || "",
                  output_results: rewriteData.output_results || {},
                };
              } else if (typeof rewriteData === "string") {
                try {
                  // Parse the JSON string
                  const parsed = JSON.parse(rewriteData);
                  foundSearchRewrite = {
                    thought: parsed.thought || "",
                    output_results: parsed.output_results || {},
                  };
                  // console.log('Parsed search rewrite successfully:', foundSearchRewrite);
                } catch (parseError) {
                  console.error(
                    "Error parsing search rewrite JSON:",
                    parseError,
                  );
                  // console.log('Original data:', rewriteData);
                  foundSearchRewrite = { thought: "", output_results: {} };
                }
              }
            }
          }
        }

        setSearchQueryData(foundSearchQuery);
        setSearchResultsData(foundSearchResults);
        setSearchRewriteData(foundSearchRewrite);

        if (foundSearchQuery) {
          // console.log('Search query extracted successfully:', foundSearchQuery);
        }
        if (Object.keys(foundSearchResults).length > 0) {
          // console.log('Search results extracted successfully:', Object.keys(foundSearchResults).length, 'results');
        }
        if (
          foundSearchRewrite.thought ||
          Object.keys(foundSearchRewrite.output_results).length > 0
        ) {
          // console.log('Search rewrite extracted successfully');
        }
      } catch (error) {
        console.error(
          "Error parsing log content for search data extraction:",
          error,
        );
        setSearchQueryData("");
        setSearchResultsData({});
        setSearchRewriteData({ thought: "", output_results: {} });
      }
    } else {
      setSearchQueryData("");
      setSearchResultsData({});
      setSearchRewriteData({ thought: "", output_results: {} });
    }
  }, [logContent, selectedAgent, id]);

  // Extract commonsense raw results from execution log when log changes (for commonsense agent)
  useEffect(() => {
    if (selectedAgent === "commonsense" && logContent) {
      try {
        const logData =
          typeof logContent === "string" ? JSON.parse(logContent) : logContent;
        // console.log('Parsed log data for commonsense:', logData);

        // logData is a list of dictionaries with log_name and log_data fields
        let foundCommonsenseResults = { thought: "", output_results: {} };

        if (Array.isArray(logData)) {
          for (const entry of logData) {
            if (entry.log_name === "[Present]commonsense_raw_results") {
              // Parse the commonsense raw results
              const rawData = entry.log_data;
              // console.log('Raw commonsense results data:', rawData);
              // console.log('Type:', typeof rawData);

              if (typeof rawData === "object" && rawData !== null) {
                // Data is already an object
                foundCommonsenseResults = {
                  thought: rawData.thought || "",
                  output_results: rawData.output_results || {},
                };
              } else if (typeof rawData === "string") {
                try {
                  // Parse the JSON string
                  const parsed = JSON.parse(rawData);
                  foundCommonsenseResults = {
                    thought: parsed.thought || "",
                    output_results: parsed.output_results || {},
                  };
                  // console.log('Parsed commonsense results successfully:', foundCommonsenseResults);
                } catch (parseError) {
                  console.error(
                    "Error parsing commonsense results JSON:",
                    parseError,
                  );
                  // console.log('Original data:', rawData);
                  foundCommonsenseResults = { thought: "", output_results: {} };
                }
              }
              break;
            }
          }
        }

        setCommonsenseRawResults(foundCommonsenseResults);

        if (
          foundCommonsenseResults.thought ||
          Object.keys(foundCommonsenseResults.output_results).length > 0
        ) {
          // console.log('Commonsense results extracted successfully');
        }
      } catch (error) {
        console.error(
          "Error parsing log content for commonsense data extraction:",
          error,
        );
        setCommonsenseRawResults({ thought: "", output_results: {} });
      }
    } else {
      setCommonsenseRawResults({ thought: "", output_results: {} });
    }
  }, [logContent, selectedAgent, id]);

  // Sync selection state with node data
  useEffect(() => {
    setIsSelected(data.isSelected || false);
  }, [data.isSelected, id]);

  // Sync agent settings with node data
  useEffect(() => {
    setAgentSettings({
      modelName: data.modelName || "gpt-4o-mini",
      temperature: data.temperature || 0.0,
    });
  }, [data.modelName, data.temperature, id]);

  // Sync custom fields with node data
  useEffect(() => {
    setCustomFields(data.customFields || []);
  }, [data.customFields, id]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isMenuOpen) {
        setIsMenuOpen(false);
      }
      if (isSettingsMenuOpen) {
        setIsSettingsMenuOpen(false);
      }
    };

    if (isMenuOpen || isSettingsMenuOpen) {
      document.addEventListener("click", handleClickOutside);
    }

    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, [isMenuOpen, isSettingsMenuOpen]);

  const addInputField = () => {
    const newInput = {
      name: "",
      value: "",
      isValid: null,
      isEditing: true,
    };
    const newInputs = [...inputs, newInput];
    setInputs(newInputs);
  };

  const removeInputField = async (index) => {
    const removedInput = inputs[index];
    const removedName = removedInput.name;

    // If no name exists, just remove locally without backend call
    if (!removedName || removedName.trim() === "") {
      const newInputs = inputs.filter((_, i) => i !== index);
      setInputs(newInputs);

      // Update global state when removing
      if (data.onUpdateNode) {
        data.onUpdateNode(id, { ...data, input: newInputs });
      }
      return;
    }

    // If name exists, call backend to remove
    try {
      const result = await removeInputVariableKey(
        sessionId,
        id,
        removedName,
        data.setConversationHistory,
      );
      // console.log(result)
      if (result == "success") {
        const newInputs = inputs.filter((_, i) => i !== index);
        setInputs(newInputs);

        // Update global state when removing
        if (data.onUpdateNode) {
          data.onUpdateNode(id, { ...data, input: newInputs });
        }

        // Remove edges connected to this input variable
        if (data.onRemoveEdges) {
          data.onRemoveEdges(id, removedName, "input");
        }
        // Update positions in the latest snapshot after removing input variable
        try {
          const currentPositions = {};
          if (data.nodes) {
            data.nodes.forEach((node) => {
              currentPositions[node.id] = { x: node.x || 0, y: node.y || 0 };
            });
            await sendUpdateNodePositions(sessionId, currentPositions);
            // console.log(`Updated positions after removing input variable "${removedName}" for node ${id}`);
          }
        } catch (error) {
          console.error(
            "Failed to update positions after input variable removal:",
            error,
          );
        }
      } else {
        alert(`Failed to remove input variable:\n${removedName}`);
      }
    } catch (error) {
      alert(`Failed to remove input variable:\n${removedName}`);
    }
  };

  const updateInputName = (index, name) => {
    const newInputs = [...inputs];
    newInputs[index] = { ...newInputs[index], name };
    setInputs(newInputs);
  };

  const updateInputValue = (index, value) => {
    const newInputs = [...inputs];
    newInputs[index] = { ...newInputs[index], value };
    setInputs(newInputs);
  };

  const validateInput = async (index) => {
    const input = inputs[index];
    if (!input.name.trim()) {
      alert("Please enter a variable name");
      return;
    }

    try {
      let result = null;
      let oldInputName = null;
      let newInputName = null;
      if (inputBackup) {
        // The input is existing
        oldInputName = inputBackup?.name;
        newInputName = input.name;
        result = await modifyInputVariableKey(
          sessionId,
          id,
          oldInputName,
          newInputName,
          data.setConversationHistory,
        );
      } else {
        // Call backend to add the input variable
        result = await addInputVariableKey(
          sessionId,
          id,
          input.name,
          data.setConversationHistory,
        );
      }

      if (result == "success") {
        const newInputs = [...inputs];
        newInputs[index] = {
          ...newInputs[index],
          isValid: result.valid,
          isEditing: false,
        };
        setInputs(newInputs);

        // Update global state after validation
        if (data.onUpdateNode) {
          data.onUpdateNode(id, { ...data, input: newInputs });
        }

        // Update edges in frontend if input name changed
        if (
          oldInputName &&
          oldInputName !== newInputName &&
          data.onUpdateEdges
        ) {
          data.onUpdateEdges(id, oldInputName, newInputName, "input");
        }

        // Clear backup on successful validation
        setInputBackup(null);
        setEditingIndex(null);

        // Update positions in the latest snapshot after adding/modifying input variable
        try {
          const currentPositions = {};
          if (data.nodes) {
            data.nodes.forEach((node) => {
              currentPositions[node.id] = { x: node.x || 0, y: node.y || 0 };
            });
            await sendUpdateNodePositions(sessionId, currentPositions);
            // console.log(`Updated positions after ${oldInputName ? 'modifying' : 'adding'} input variable for node ${id}`);
          }
        } catch (error) {
          console.error(
            "Failed to update positions after input variable operation:",
            error,
          );
        }
      } else {
        alert(`Failed to validate input:\n${result}`);
      }

      // console.log('Input validation result:', result);
    } catch (error) {
      console.error("Failed to validate input:", error);
    }
  };

  const editInput = (index) => {
    // Store backup of the input before editing
    setInputBackup({ ...inputs[index] });
    setEditingIndex(index);

    const newInputs = [...inputs];
    newInputs[index] = { ...newInputs[index], isEditing: true };
    setInputs(newInputs);
  };

  const cancelEditInput = (index) => {
    // Restore from backup
    if (inputBackup && editingIndex === index) {
      const newInputs = [...inputs];
      newInputs[index] = { ...inputBackup, isEditing: false };
      setInputs(newInputs);
    }

    // Clear backup
    setInputBackup(null);
    setEditingIndex(null);
  };

  // Output variable functions
  const addOutputField = () => {
    const newOutput = {
      name: "",
      value: "",
      isValid: null,
      isEditing: true,
    };
    const newOutputs = [...outputs, newOutput];
    setOutputs(newOutputs);
  };

  const removeOutputField = async (index) => {
    const removedOutput = outputs[index];
    const removedName = removedOutput.name;

    // If no name exists, just remove locally without backend call
    if (!removedName || removedName.trim() === "") {
      const newOutputs = outputs.filter((_, i) => i !== index);
      setOutputs(newOutputs);

      // Update global state when removing
      if (data.onUpdateNode) {
        data.onUpdateNode(id, { ...data, output: newOutputs });
      }
      return;
    }

    // If name exists, call backend to remove
    try {
      const result = await removeOutputVariableKey(
        sessionId,
        id,
        removedName,
        data.setConversationHistory,
      );
      if (result == "success") {
        const newOutputs = outputs.filter((_, i) => i !== index);
        setOutputs(newOutputs);

        // Update global state when removing
        if (data.onUpdateNode) {
          data.onUpdateNode(id, { ...data, output: newOutputs });
        }

        // Remove edges connected to this output variable
        if (data.onRemoveEdges) {
          data.onRemoveEdges(id, removedName, "output");
        }
        // Update positions in the latest snapshot after removing output variable
        try {
          const currentPositions = {};
          if (data.nodes) {
            data.nodes.forEach((node) => {
              currentPositions[node.id] = { x: node.x || 0, y: node.y || 0 };
            });
            await sendUpdateNodePositions(sessionId, currentPositions);
            // console.log(`Updated positions after removing output variable "${removedName}" for node ${id}`);
          }
        } catch (error) {
          console.error(
            "Failed to update positions after output variable removal:",
            error,
          );
        }
      } else {
        alert(`Failed to remove output variable:\nReason: ${result}`);
      }
    } catch (error) {
      console.error("Error removing output variable:", error);
      alert(`Failed to remove output variable:\nReason: ${error}`);
    }
  };

  const updateOutputName = (index, name) => {
    const newOutputs = [...outputs];
    newOutputs[index] = { ...newOutputs[index], name };
    setOutputs(newOutputs);
  };

  const updateOutputValue = (index, value) => {
    const newOutputs = [...outputs];
    newOutputs[index] = { ...newOutputs[index], value };
    setOutputs(newOutputs);
  };

  // Function to start editing input variable value
  const startEditInputValue = (index) => {
    setInputValueBackup(inputs[index].value);
    setEditingInputValueIndex(index);
  };

  // Function to cancel editing input variable value
  const cancelEditInputValue = (index) => {
    if (inputValueBackup !== null && editingInputValueIndex === index) {
      const newInputs = [...inputs];
      newInputs[index] = { ...newInputs[index], value: inputValueBackup };
      setInputs(newInputs);
    }
    setInputValueBackup(null);
    setEditingInputValueIndex(null);
  };

  // Handle input variable value update button
  const handleUpdateInputValue = async (index) => {
    const input = inputs[index];
    const variableName = input.name || `input_${index}`;
    const variableValue = input.value || "";

    // Get the old value from the backup (what it was before editing started)
    const oldValue =
      inputValueBackup !== null
        ? inputValueBackup
        : data.input && data.input[index]
          ? data.input[index].value
          : "";

    try {
      const result = await updateVariableValue(
        sessionId,
        id,
        variableName,
        variableValue,
        "input",
        data.setConversationHistory,
        oldValue,
      );
      if (result === "success") {
        // console.log(`✅ Input variable "${variableName}" updated successfully!`);

        // Update the node data in planData
        if (data.onUpdateNode) {
          const updatedInputs = inputs.map((inp, idx) =>
            idx === index
              ? { ...inp, value: variableValue, isValid: true }
              : inp,
          );
          data.onUpdateNode(id, { ...data, input: updatedInputs });
        }

        // Update positions in the latest snapshot after variable value update
        try {
          const currentPositions = {};
          if (data.nodes) {
            data.nodes.forEach((node) => {
              currentPositions[node.id] = { x: node.x || 0, y: node.y || 0 };
            });
            await sendUpdateNodePositions(sessionId, currentPositions);
            // console.log(`Updated positions after input variable update for node ${id}`);
          }
        } catch (error) {
          console.error(
            "Failed to update positions after input variable update:",
            error,
          );
        }

        // Clear backup after successful update
        setInputValueBackup(null);
        setEditingInputValueIndex(null);
      } else {
        alert(`❌ Failed to update input variable: ${result}`);
      }
    } catch (error) {
      console.error("Error updating input variable:", error);
      alert(`❌ Error updating input variable: ${error.message}`);
    }
  };

  // Function to start editing output variable value
  const startEditOutputValue = (index) => {
    setOutputValueBackup(outputs[index].value);
    setEditingOutputValueIndex(index);
  };

  // Function to cancel editing output variable value
  const cancelEditOutputValue = (index) => {
    if (outputValueBackup !== null && editingOutputValueIndex === index) {
      const newOutputs = [...outputs];
      newOutputs[index] = { ...newOutputs[index], value: outputValueBackup };
      setOutputs(newOutputs);
    }
    setOutputValueBackup(null);
    setEditingOutputValueIndex(null);
  };

  // Handle output variable value update button
  const handleUpdateOutputValue = async (index) => {
    const output = outputs[index];
    const variableName = output.name || `output_${index}`;
    const variableValue = output.value || "";

    // Get the old value from the backup (what it was before editing started)
    const oldValue =
      outputValueBackup !== null
        ? outputValueBackup
        : data.output && data.output[index]
          ? data.output[index].value
          : "";

    try {
      const result = await updateVariableValue(
        sessionId,
        id,
        variableName,
        variableValue,
        "output",
        data.setConversationHistory,
        oldValue,
      );
      if (result === "success") {
        // console.log(`✅ Output variable "${variableName}" updated successfully!`);

        // Update the node data in planData
        if (data.onUpdateNode) {
          const updatedOutputs = outputs.map((out, idx) =>
            idx === index
              ? { ...out, value: variableValue, isValid: true }
              : out,
          );
          data.onUpdateNode(id, { ...data, output: updatedOutputs });
        }

        // Propagate the output value to all connected downstream input variables
        if (data.edges && data.onUpdateOtherNodeInputs) {
          // Find all edges where this node's output is the source
          const connectedEdges = data.edges.filter(
            (edge) =>
              String(edge.source) === String(id) &&
              edge.sourceHandle === variableName,
          );

          // console.log(`Found ${connectedEdges.length} downstream connections for output "${variableName}"`);

          // Update each connected downstream input
          connectedEdges.forEach((edge) => {
            const targetNodeId = edge.target;
            const targetInputName = edge.targetHandle;

            // console.log(`Propagating value "${variableValue}" to node ${targetNodeId}, input "${targetInputName}"`);
            data.onUpdateOtherNodeInputs(
              targetNodeId,
              targetInputName,
              variableValue,
            );
          });
        }

        // Update positions in the latest snapshot after variable value update
        try {
          const currentPositions = {};
          if (data.nodes) {
            data.nodes.forEach((node) => {
              currentPositions[node.id] = { x: node.x || 0, y: node.y || 0 };
            });
            await sendUpdateNodePositions(sessionId, currentPositions);
            // console.log(`Updated positions after output variable update for node ${id}`);
          }
        } catch (error) {
          console.error(
            "Failed to update positions after output variable update:",
            error,
          );
        }

        // Clear backup after successful update
        setOutputValueBackup(null);
        setEditingOutputValueIndex(null);
      } else {
        alert(`❌ Failed to update output variable: ${result}`);
      }
    } catch (error) {
      console.error("Error updating output variable:", error);
      alert(`❌ Error updating output variable: ${error.message}`);
    }
  };

  const editOutput = (index) => {
    // Store backup of the output before editing
    setOutputBackup({ ...outputs[index] });
    setEditingOutputIndex(index);

    const newOutputs = [...outputs];
    newOutputs[index] = { ...newOutputs[index], isEditing: true };
    setOutputs(newOutputs);
  };

  const cancelEditOutput = (index) => {
    // Restore from backup
    if (outputBackup && editingOutputIndex === index) {
      const newOutputs = [...outputs];
      newOutputs[index] = { ...outputBackup, isEditing: false };
      setOutputs(newOutputs);
    }

    // Clear backup
    setOutputBackup(null);
    setEditingOutputIndex(null);
  };

  const validateOutput = async (index) => {
    const output = outputs[index];
    if (!output.name.trim()) {
      alert("Please enter a variable name");
      return;
    }

    try {
      let result = null;
      let oldOutputName = null;
      let newOutputName = null;
      if (outputBackup) {
        // the output is updating
        oldOutputName = outputBackup?.name;
        newOutputName = output.name;
        result = await modifyOutputVariableKey(
          sessionId,
          id,
          oldOutputName,
          newOutputName,
          data.setConversationHistory,
        );
      } else {
        // the output is adding
        result = await addOutputVariableKey(
          sessionId,
          id,
          output.name,
          data.setConversationHistory,
        );
      }

      // For now, just mark as valid and exit editing
      if (result == "success") {
        const newOutputs = [...outputs];
        newOutputs[index] = {
          ...newOutputs[index],
          isValid: true,
          isEditing: false,
        };
        setOutputs(newOutputs);

        // Update global state after validation
        if (data.onUpdateNode) {
          data.onUpdateNode(id, { ...data, output: newOutputs });
        }

        // Update edges in frontend if output name changed
        if (
          oldOutputName &&
          oldOutputName !== newOutputName &&
          data.onUpdateEdges
        ) {
          data.onUpdateEdges(id, oldOutputName, newOutputName, "output");
        }

        // Clear backup on successful validation
        setOutputBackup(null);
        setEditingOutputIndex(null);

        // Update positions in the latest snapshot after adding/modifying output variable
        try {
          const currentPositions = {};
          if (data.nodes) {
            data.nodes.forEach((node) => {
              currentPositions[node.id] = { x: node.x || 0, y: node.y || 0 };
            });
            await sendUpdateNodePositions(sessionId, currentPositions);
            // console.log(`Updated positions after ${oldOutputName ? 'modifying' : 'adding'} output variable for node ${id}`);
          }
        } catch (error) {
          console.error(
            "Failed to update positions after output variable operation:",
            error,
          );
        }
      } else {
        alert(`Failed to validate output:\n${result}`);
      }
    } catch (error) {
      console.error("Failed to validate output:", error);
    }
  };

  // Function for handling agent tool name selection
  const handleAgentSelection = async (newAgentName) => {
    // console.log('Agent selection changed:', {
    //   nodeId: id,
    //   oldAgent: selectedAgent,
    //   newAgent: newAgentName
    // });

    // Log the agent selection change
    logButtonClick(sessionId, "change_agent_type", {
      nodeId: id,
      oldAgentType: selectedAgent,
      newAgentType: newAgentName,
    });

    try {
      // Call backend to update agent name
      const result = await updateNodeAgentName(
        sessionId,
        id,
        newAgentName,
        data.setConversationHistory,
        selectedAgent,
      );

      if (result === "success") {
        // Update local state
        setSelectedAgent(newAgentName);

        // Update global state/planData if needed
        if (data.onUpdateNode) {
          data.onUpdateNode(id, { ...data, agent_name: newAgentName });
        }

        // console.log('Agent selection updated successfully');

        // Update positions in the latest snapshot after agent name update
        try {
          const currentPositions = {};
          if (data.nodes) {
            data.nodes.forEach((node) => {
              currentPositions[node.id] = { x: node.x || 0, y: node.y || 0 };
            });
            await sendUpdateNodePositions(sessionId, currentPositions);
            // console.log(`Updated positions after agent name update for node ${id}`);
          }
        } catch (error) {
          console.error(
            "Failed to update positions after agent name update:",
            error,
          );
        }
      } else {
        console.error("Backend failed to update agent:", result);
        alert(`Failed to update agent: ${result}`);
      }
    } catch (error) {
      console.error("Failed to update agent selection:", error);
      alert(`Error updating agent: ${error.message}`);
    }
  };

  // Function for handling task description changes
  const handleTaskDescriptionChange = (newDescription) => {
    setTaskDescription(newDescription);
    // Check if there are unsaved changes
    const hasChanges = newDescription !== originalTaskDescription;
    setHasUnsavedTaskChanges(hasChanges);
  };

  // Function for saving task description
  const handleSaveTaskDescription = async () => {
    // console.log('Saving task description:', { nodeId: id, description: taskDescription });

    try {
      // Call backend to update task description
      const result = await updateNodeTaskDescription(
        sessionId,
        id,
        taskDescription,
        data.setConversationHistory,
        originalTaskDescription,
      );

      if (result === "success") {
        // Update the original description and clear unsaved changes flag
        setOriginalTaskDescription(taskDescription);
        setHasUnsavedTaskChanges(false);

        // Update global state if needed
        if (data.onUpdateNode) {
          data.onUpdateNode(id, { ...data, task: taskDescription });
        }

        // console.log('Task description saved successfully');

        // Update positions in the latest snapshot after task description update
        try {
          const currentPositions = {};
          if (data.nodes) {
            data.nodes.forEach((node) => {
              currentPositions[node.id] = { x: node.x || 0, y: node.y || 0 };
            });
            await sendUpdateNodePositions(sessionId, currentPositions);
            // console.log(`Updated positions after task description update for node ${id}`);
          }
        } catch (error) {
          console.error(
            "Failed to update positions after task description update:",
            error,
          );
        }
      } else {
        console.error("Backend failed to update task description:", result);
        alert(`Failed to save task description: ${result}`);
      }
    } catch (error) {
      console.error("Failed to save task description:", error);
      alert(`Error saving task description: ${error.message}`);
    }
  };

  // Function to enter edit mode for task description
  const startEditingTaskDescription = () => {
    setIsEditingTaskDescription(true);
  };

  // Function to cancel editing task description
  const cancelEditingTaskDescription = () => {
    setTaskDescription(originalTaskDescription);
    setHasUnsavedTaskChanges(false);
    setIsEditingTaskDescription(false);
  };

  // Function to save and exit edit mode
  const saveAndExitTaskEdit = async () => {
    await handleSaveTaskDescription();
    setIsEditingTaskDescription(false);
  };

  // Function for duplicating the node
  const handleDuplicateNode = () => {
    // console.log('Duplicating node:', { nodeId: id, data });

    setIsSplitting(true);
    try {
      if (data.onDuplicateNode) {
        data.onDuplicateNode(id);
      } else {
        console.warn("onDuplicateNode callback not provided");
        alert("Duplicate functionality not available");
      }
    } finally {
      // Set a small delay before clearing the spinner so it's visible
      setTimeout(() => setIsSplitting(false), 300);
    }
  };

  // Function for splitting the node (Auto Split - current behavior)
  const handleAutoSplitNode = async () => {
    // console.log('Auto Splitting node:', { nodeId: id, data });

    setIsSplitting(true);
    try {
      // Get all edges connected to this node
      const connectedEdges =
        data.edges?.filter(
          (edge) =>
            String(edge.source) === String(id) ||
            String(edge.target) === String(id),
        ) || [];
      // console.log('Connected edges:', connectedEdges);

      const execution_result = await autoSplitNode(
        sessionId,
        id,
        connectedEdges,
      );

      if (execution_result?.status === "completed") {
        // Extract new node IDs from the plan
        const newNodeIds = (execution_result.plan.nodes || [])
          .map((node) => String(node.id))
          .filter((nodeId) => !data.nodes.some((n) => String(n.id) === nodeId));

        // Log user interaction
        if (data.setConversationHistory) {
          await addUserInteractionToConversation(
            "auto_split_node",
            { nodeId: id, newNodeIds },
            data.setConversationHistory,
            sessionId,
            addConversationMessage,
          );
        }

        if (data.onSplitNode) {
          data.onSplitNode(id, execution_result.plan);
        }
      } else {
        console.warn("Split node failed:", execution_result);
        alert(
          "Split functionality failed: " +
            (execution_result || "Unknown error"),
        );
      }
    } finally {
      setIsSplitting(false);
    }
  };

  // Function for Sequential Split (placeholder for future backend support)
  const handleSequentialSplitNode = async () => {
    setIsSplitting(true);
    try {
      // Collect connected edges similar to smart split to support future wiring
      const connectedEdges =
        data.edges?.filter(
          (edge) =>
            String(edge.source) === String(id) ||
            String(edge.target) === String(id),
        ) || [];
      // console.log('Sequential split requested:', { nodeId: id, connectedEdges });

      const execution_result = await sequentialSplitNode(
        sessionId,
        id,
        connectedEdges,
      );

      if (execution_result?.status === "completed") {
        // Extract new node IDs from the plan
        const newNodeIds = (execution_result.plan.nodes || [])
          .map((node) => String(node.id))
          .filter((nodeId) => !data.nodes.some((n) => String(n.id) === nodeId));

        // Log user interaction
        if (data.setConversationHistory) {
          await addUserInteractionToConversation(
            "sequential_split_node",
            { nodeId: id, newNodeIds },
            data.setConversationHistory,
            sessionId,
            addConversationMessage,
          );
        }

        if (data.onSplitNode) {
          data.onSplitNode(id, execution_result.plan);
        }
      } else {
        console.warn("Split node failed:", execution_result);
        alert(
          "Split functionality failed: " +
            (execution_result || "Unknown error"),
        );
      }
    } finally {
      setIsSplitting(false);
    }
  };

  const handleDeleteNode = async () => {
    try {
      const result = await removeNode(
        sessionId,
        parseInt(id),
        data.setConversationHistory,
      );
      if (result.status === "success") {
        if (data.onRemoveNode) {
          data.onRemoveNode(id);
        }
      } else {
        console.error("Failed to delete node:", result);
        alert(`Failed to delete node: ${result.message || "Unknown error"}`);
      }
    } catch (error) {
      console.error("Error deleting node:", error);
      alert(`Error deleting node: ${error.message}`);
    }
  };

  // Function for executing the task
  const handleExecuteTask = async () => {
    // console.log('Executing task:', { nodeId: id, agent: selectedAgent, description: taskDescription });

    // Set loading state
    if (data.onUpdateNode) {
      data.onUpdateNode(id, { executionStatus: "loading" });
    }

    // Prepare input variables (convert to the expected format)
    const inputVariables = {};
    inputs.forEach((input, index) => {
      const key = input.name || `input_${index}`;
      inputVariables[key] = input.value || "";
    });

    // Prepare output variables (convert to the expected format)
    const outputVariables = {};
    outputs.forEach((output, index) => {
      const key = output.name || `output_${index}`;
      outputVariables[key] = output.value || "";
    });

    const executionData = {
      agent_name: selectedAgent,
      task_description: taskDescription,
      input_variables: inputVariables,
      output_variables: outputVariables,
    };

    let execution_result = null;
    try {
      // console.log('Sending execution request with data:', executionData);

      // Call backend to execute task
      execution_result = await executeTask(
        sessionId,
        id,
        executionData,
        data.setConversationHistory,
      );
      // console.log(execution_result)
      if (execution_result.status === "completed") {
        // Handle successful execution
        // console.log('Task execution completed:', execution_result);

        let boolInvalidValue = false;

        // Update output variables with results if available
        if (execution_result.output_values) {
          const output_variables = execution_result.output_values;
          // console.log('Backend output_variables:', output_variables);

          // Check for None values
          for (let value of Object.values(output_variables)) {
            if (value === "None" || value === null || value === "") {
              boolInvalidValue = true;
              break;
            }
          }

          // Update all output variables with results from backend
          const newOutputs = outputs.map((output, index) => {
            const variableName = output.name;

            // Check if backend provided a result for this variable name
            if (output_variables.hasOwnProperty(variableName)) {
              // console.log(`Updating output variable "${variableName}" with value: "${output_variables[variableName]}"`);
              return {
                ...output,
                value: output_variables[variableName],
              };
            }

            // Keep existing output unchanged if no result provided
            return output;
          });

          setOutputs(newOutputs);
          // console.log('Updated outputs state:', newOutputs);
        }

        // Set success or none state based on output values
        if (data.onUpdateNode) {
          data.onUpdateNode(id, {
            executionStatus: boolInvalidValue ? "none" : "success",
          });
        }

        if (execution_result.input_values) {
          const input_values_by_node = execution_result.input_values;
          // console.log('Backend input_values:', input_values_by_node);

          // input_values format: {node_id: {key: value, key2: value2}, another_node_id: {...}}

          // Update input values for ALL OTHER nodes returned by the backend
          // These are different nodes that should receive new input values from this execution
          Object.keys(input_values_by_node).forEach((targetNodeId) => {
            const nodeInputValues = input_values_by_node[targetNodeId];
            // console.log(`Updating inputs for node ${targetNodeId} (different from current executing node ${id}):`, nodeInputValues);

            // Loop through each input variable for this target node
            Object.keys(nodeInputValues).forEach((inputVariableName) => {
              const inputVariableValue = nodeInputValues[inputVariableName];
              // console.log(`Updating node ${targetNodeId}, variable "${inputVariableName}" with value: "${inputVariableValue}"`);

              // All nodes in input_values are OTHER nodes that need updates
              if (data.onUpdateOtherNodeInputs) {
                data.onUpdateOtherNodeInputs(
                  targetNodeId,
                  inputVariableName,
                  inputVariableValue,
                );
              } else {
                // console.log(`Need to update node ${targetNodeId}, variable ${inputVariableName} with value ${inputVariableValue}`);
                // console.log('Parent callback onUpdateOtherNodeInputs not provided');
              }
            });
          });
        }

        if (execution_result.execution_log) {
          // Update log content with execution log from backend
          setLogContent(execution_result.execution_log);

          // Persist log content to node data
          if (data.onUpdateNode) {
            data.onUpdateNode(id, {
              execution_log: execution_result.execution_log,
            });
          }
        }

        // Expand the variables section after successful execution
        setIsVariablesCollapsed(false);

        // Update the node data to persist the expanded state
        if (data.onUpdateNode) {
          data.onUpdateNode(id, { isVariablesCollapsed: false });
        }

        // Show success message
        // console.log(`✅ Task Execution Completed!\n\n${execution_result.message}\n\nOutput results have been updated.`);

        // After execution, update positions in the latest snapshot
        try {
          // Get all nodes with their positions from parent component
          const currentPositions = {};
          if (data.nodes) {
            data.nodes.forEach((node) => {
              currentPositions[node.id] = {
                x: node.x || 0,
                y: node.y || 0,
              };
            });

            // Send positions to backend to update latest snapshot
            await sendUpdateNodePositions(sessionId, currentPositions);
            // console.log(`Updated positions in latest snapshot after node ${id} execution from CustomTaskNode`);
          }
        } catch (error) {
          console.error("Failed to update positions after execution:", error);
        }
      } else {
        // Handle execution error - set error state
        console.error("Task execution failed:", execution_result);
        if (data.onUpdateNode) {
          data.onUpdateNode(id, { executionStatus: "error" });
        }
        alert(
          `❌ Task Execution Failed!\n\n${typeof execution_result === "string" ? execution_result : "Unknown error occurred"}`,
        );
      }
    } catch (error) {
      console.error("Failed to execute task:", error);
      // Set error state on exception
      if (data.onUpdateNode) {
        data.onUpdateNode(id, { executionStatus: "error" });
      }
      alert(`❌ Error executing task:\n\n${error.message}`);
    }
  };

  const handleNodeClick = () => {
    // Allow click to bubble up to React Flow for node elevation
    // Checkbox selection remains independent
  };

  // Function to handle collapse state changes and persist to node data
  const handleVariablesCollapseToggle = () => {
    const newCollapsedState = !isVariablesCollapsed;
    setIsVariablesCollapsed(newCollapsedState);

    // Update global state to persist collapse state
    if (data.onUpdateNode) {
      data.onUpdateNode(id, {
        ...data,
        isVariablesCollapsed: newCollapsedState,
      });
    }

    // Force edge re-render after collapse/expand animation completes
    // Use a longer timeout to ensure the node has fully resized
    setTimeout(() => {
      // Trigger a small position change to force React Flow to recalculate edge paths
      // This is handled by the parent component's forceEdgeRerender function
      if (data.onForceEdgeRerender) {
        data.onForceEdgeRerender();
      }
    }, 500); // Wait for animation (300ms) plus a small buffer
  };

  // Function to handle log collapse state changes and persist to node data
  const handleLogCollapseToggle = () => {
    const newCollapsedState = !isLogCollapsed;
    setIsLogCollapsed(newCollapsedState);

    // Update global state to persist collapse state
    if (data.onUpdateNode) {
      data.onUpdateNode(id, { ...data, isLogCollapsed: newCollapsedState });
    }
  };

  // Function to handle code collapse state changes and persist to node data
  const handleCodeCollapseToggle = () => {
    const newCollapsedState = !isCodeCollapsed;
    setIsCodeCollapsed(newCollapsedState);

    // Update global state to persist collapse state
    if (data.onUpdateNode) {
      data.onUpdateNode(id, { ...data, isCodeCollapsed: newCollapsedState });
    }
  };

  // Function to handle intermediate status collapse state changes and persist to node data
  const handleIntermediateStatusCollapseToggle = () => {
    const newCollapsedState = !isIntermediateStatusCollapsed;
    setIsIntermediateStatusCollapsed(newCollapsedState);

    // Update global state to persist collapse state
    if (data.onUpdateNode) {
      data.onUpdateNode(id, {
        ...data,
        isIntermediateStatusCollapsed: newCollapsedState,
      });
    }
  };

  // Function to handle search intermediate status collapse state changes and persist to node data
  const handleSearchIntermediateStatusCollapseToggle = () => {
    const newCollapsedState = !isSearchIntermediateStatusCollapsed;
    setIsSearchIntermediateStatusCollapsed(newCollapsedState);

    // Update global state to persist collapse state
    if (data.onUpdateNode) {
      data.onUpdateNode(id, {
        ...data,
        isSearchIntermediateStatusCollapsed: newCollapsedState,
      });
    }
  };

  // Function to handle search rewrite collapse state changes and persist to node data
  const handleSearchRewriteCollapseToggle = () => {
    const newCollapsedState = !isSearchRewriteCollapsed;
    setIsSearchRewriteCollapsed(newCollapsedState);

    // Update global state to persist collapse state
    if (data.onUpdateNode) {
      data.onUpdateNode(id, {
        ...data,
        isSearchRewriteCollapsed: newCollapsedState,
      });
    }
  };

  // Function to handle commonsense intermediate status collapse state changes and persist to node data
  const handleCommonsenseIntermediateStatusCollapseToggle = () => {
    const newCollapsedState = !isCommonsenseIntermediateStatusCollapsed;
    setIsCommonsenseIntermediateStatusCollapsed(newCollapsedState);

    // Update global state to persist collapse state
    if (data.onUpdateNode) {
      data.onUpdateNode(id, {
        ...data,
        isCommonsenseIntermediateStatusCollapsed: newCollapsedState,
      });
    }
  };

  // Function to handle selection checkbox toggle
  const handleSelectionToggle = (e) => {
    e.stopPropagation(); // Prevent node selection when clicking checkbox
    const newSelectionState = !isSelected;
    setIsSelected(newSelectionState);

    // Update global state to persist selection state
    if (data.onUpdateNode) {
      data.onUpdateNode(id, { isSelected: newSelectionState });
    }
  };

  // Function to handle agent settings changes
  const handleAgentSettingsChange = (setting, value) => {
    const newSettings = { ...agentSettings, [setting]: value };
    setAgentSettings(newSettings);
  };

  // Function to add a custom field
  const handleAddCustomField = () => {
    const newField = {
      id: Date.now(),
      name: "",
      value: "",
    };
    setCustomFields([...customFields, newField]);
  };

  // Function to remove a custom field
  const handleRemoveCustomField = (fieldId) => {
    setCustomFields(customFields.filter((field) => field.id !== fieldId));
  };

  // Function to update custom field name
  const handleUpdateCustomFieldName = (fieldId, name) => {
    setCustomFields(
      customFields.map((field) =>
        field.id === fieldId ? { ...field, name } : field,
      ),
    );
  };

  // Function to update custom field value
  const handleUpdateCustomFieldValue = (fieldId, value) => {
    setCustomFields(
      customFields.map((field) =>
        field.id === fieldId ? { ...field, value } : field,
      ),
    );
  };

  // Function to save agent settings
  const handleSaveAgentSettings = async () => {
    // console.log('Saving agent settings:', { nodeId: id, settings: agentSettings, customFields });

    try {
      // Send config update to backend
      const result = await updateNodeConfig(
        sessionId,
        id,
        agentSettings.modelName,
        agentSettings.temperature,
      );

      if (result === "success") {
        // Update global state to persist settings in frontend
        if (data.onUpdateNode) {
          data.onUpdateNode(id, {
            modelName: agentSettings.modelName,
            temperature: agentSettings.temperature,
            customFields: customFields,
          });
        }

        setIsSettingsMenuOpen(false);
        // console.log('Agent settings saved successfully');

        // Update positions in the latest snapshot after config update
        try {
          const currentPositions = {};
          if (data.nodes) {
            data.nodes.forEach((node) => {
              currentPositions[node.id] = { x: node.x || 0, y: node.y || 0 };
            });
            await sendUpdateNodePositions(sessionId, currentPositions);
            // console.log(`Updated positions after config update for node ${id}`);
          }
        } catch (error) {
          console.error(
            "Failed to update positions after config update:",
            error,
          );
        }

        // Log user interaction after snapshot is captured
        if (data.setConversationHistory) {
          await addUserInteractionToConversation(
            "update_node_config",
            {
              nodeId: id,
              modelName: agentSettings.modelName,
              temperature: agentSettings.temperature,
            },
            data.setConversationHistory,
            sessionId,
            addConversationMessage,
          );
        }
      } else {
        console.error("Failed to save agent settings:", result);
        alert(`Failed to save agent settings: ${result}`);
      }
    } catch (error) {
      console.error("Error saving agent settings:", error);
      alert(`Error saving agent settings: ${error.message}`);
    }
  };

  return (
    <div
      className={`custom-task-node ${isSelected ? "checkbox-selected" : ""}`}
      onClick={handleNodeClick}
    >
      {/* Node Header */}
      <div className="node-header">
        <div className="node-header-content">
          <div
            style={{
              display: "flex",
              gap: "var(--sp-sm)",
              alignItems: "center",
            }}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={handleSelectionToggle}
              onClick={(e) => {
                e.stopPropagation();
                logButtonClick(sessionId, "toggle_node_selection", {
                  nodeId: id,
                  currentState: isSelected ? "selected" : "deselected",
                  newState: !isSelected ? "selected" : "deselected",
                  agentType: selectedAgent,
                });
              }}
              title="Select"
              className="nodrag"
              style={{ cursor: "pointer" }}
            />
            <strong>{data.label}</strong>
          </div>
          <div
            style={{
              display: "flex",
              gap: "var(--sp-xs)",
              alignItems: "center",
            }}
          >
            {isSplitting && (
              <Spinner size={16} intent="primary" title="Splitting node..." />
            )}
            {data.executionStatus === "success" && (
              <span
                className="status-mark intent-text-success"
                title="Execution successful"
              >
                ✓
              </span>
            )}
            {data.executionStatus === "none" && (
              <span
                className="status-mark intent-text-warning"
                title="Execution completed with None output"
              >
                !
              </span>
            )}
            {data.executionStatus === "error" && (
              <span
                className="status-mark intent-text-danger"
                title="Execution failed"
              >
                ✗
              </span>
            )}
            <Button
              icon={data.executionStatus === "loading" ? "refresh" : "play"}
              minimal
              small
              intent="primary"
              onClick={() => {
                logButtonClick(sessionId, "execute_task", {
                  nodeId: id,
                  agentType: selectedAgent,
                  hasInputs: inputs,
                  hasOutputs: outputs,
                  taskDescriptionLength: taskDescription?.length || 0,
                });
                handleExecuteTask();
              }}
              title="Execute Task"
              className={`execute-button fade-button ${data.executionStatus === "loading" ? "loading" : ""}`}
              disabled={data.executionStatus === "loading"}
            />
            <div
              style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              <Button
                icon="cog"
                minimal
                small
                onClick={(e) => {
                  e.stopPropagation();
                  logButtonClick(sessionId, "open_agent_settings", {
                    nodeId: id,
                    agentType: selectedAgent,
                    currentModel: agentSettings.modelName,
                    currentTemperature: agentSettings.temperature,
                  });
                  setIsSettingsMenuOpen(!isSettingsMenuOpen);
                }}
                title="Agent Settings"
                className="settings-button fade-button"
              />
              {isSettingsMenuOpen && (
                <div
                  className="settings-menu"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="settings-menu-header">Agent Settings</div>

                  <table className="settings-table">
                    <tbody>
                      <tr>
                        <td className="settings-label">Model Name</td>
                        <td className="settings-value">
                          <HTMLSelect
                            value={agentSettings.modelName}
                            onChange={(e) =>
                              handleAgentSettingsChange(
                                "modelName",
                                e.target.value,
                              )
                            }
                            options={MODEL_OPTIONS}
                            fill
                            className="nodrag"
                          />
                        </td>
                      </tr>
                      <tr>
                        <td className="settings-label">Temperature</td>
                        <td className="settings-value">
                          <InputGroup
                            type="number"
                            value={agentSettings.temperature}
                            onChange={(e) =>
                              handleAgentSettingsChange(
                                "temperature",
                                parseFloat(e.target.value),
                              )
                            }
                            min="0"
                            max="1"
                            step="0.1"
                            small
                            className="nodrag"
                          />
                        </td>
                      </tr>
                      {/* Custom fields */}
                      {customFields.map((field) => (
                        <tr key={field.id}>
                          <td className="settings-label">
                            <InputGroup
                              value={field.name}
                              onChange={(e) =>
                                handleUpdateCustomFieldName(
                                  field.id,
                                  e.target.value,
                                )
                              }
                              placeholder="Field name"
                              size="medium"
                              className="nodrag"
                            />
                          </td>
                          <td className="settings-value">
                            <div
                              style={{
                                display: "flex",
                                gap: "var(--sp-xs)",
                                alignItems: "center",
                              }}
                            >
                              <InputGroup
                                value={field.value}
                                onChange={(e) =>
                                  handleUpdateCustomFieldValue(
                                    field.id,
                                    e.target.value,
                                  )
                                }
                                placeholder="Value"
                                size="medium"
                                className="nodrag"
                                style={{ flex: 1 }}
                              />
                              <Button
                                icon="cross"
                                minimal
                                small
                                intent="danger"
                                onClick={() => {
                                  logButtonClick(
                                    sessionId,
                                    "remove_input_output_custom_field",
                                    {
                                      nodeId: id,
                                      fieldId: field.id,
                                      fieldName: field.name,
                                      totalCustomFields: customFields.length,
                                    },
                                  );
                                  handleRemoveCustomField(field.id);
                                }}
                                title="Remove field"
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="settings-add-field">
                    <Button
                      icon="plus"
                      text="Add Field"
                      minimal
                      small
                      onClick={() => {
                        logButtonClick(
                          sessionId,
                          "add_input_output_custom_field",
                          {
                            nodeId: id,
                            currentCustomFieldCount: customFields.length,
                          },
                        );
                        handleAddCustomField();
                      }}
                    />
                  </div>

                  <div className="settings-menu-footer">
                    <Button
                      text="Save"
                      intent="primary"
                      small
                      onClick={() => {
                        logButtonClick(sessionId, "save_agent_settings", {
                          nodeId: id,
                          agentType: selectedAgent,
                          newModel: agentSettings.modelName,
                          newTemperature: agentSettings.temperature,
                          customFieldsCount: customFields.length,
                        });
                        handleSaveAgentSettings();
                      }}
                    />
                    <Button
                      text="Cancel"
                      small
                      onClick={(e) => {
                        e.stopPropagation();
                        logButtonClick(sessionId, "cancel_agent_settings", {
                          nodeId: id,
                          agentType: selectedAgent,
                        });
                        setIsSettingsMenuOpen(false);
                        // Reset to original values
                        setAgentSettings({
                          modelName: data.modelName || "gpt-4o-mini",
                          temperature: data.temperature || 0.0,
                        });
                        setCustomFields(data.customFields || []);
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
            <div
              style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              <Button
                icon="more"
                minimal
                small
                onClick={(e) => {
                  e.stopPropagation();
                  const newState = !isMenuOpen;
                  logButtonClick(sessionId, "toggle_node_menu", {
                    nodeId: id,
                    agentType: selectedAgent,
                    action: newState ? "open" : "close",
                  });
                  setIsMenuOpen(newState);
                }}
                title="More options"
                className="menu-button fade-button"
              />
              {isMenuOpen && (
                <div className="node-menu" onClick={(e) => e.stopPropagation()}>
                  <div
                    className="node-menu-item"
                    onClick={(e) => {
                      e.stopPropagation();
                      logButtonClick(sessionId, "duplicate_node", {
                        nodeId: id,
                        agentType: selectedAgent,
                      });
                      setIsMenuOpen(false);
                      handleDuplicateNode();
                    }}
                  >
                    <span>Duplicate Node</span>
                  </div>
                  {/* Split Node options directly in menu */}
                  <div
                    className="node-menu-item"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isSplitting) {
                        logButtonClick(sessionId, "auto_split_node", {
                          nodeId: id,
                          agentType: selectedAgent,
                        });
                        setIsMenuOpen(false);
                        handleAutoSplitNode();
                      }
                    }}
                    style={{
                      opacity: isSplitting ? 0.6 : 1,
                      cursor: isSplitting ? "wait" : "pointer",
                    }}
                  >
                    <span>Auto Split</span>
                  </div>
                  <div
                    className="node-menu-item"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isSplitting) {
                        logButtonClick(sessionId, "sequential_split_node", {
                          nodeId: id,
                          agentType: selectedAgent,
                        });
                        setIsMenuOpen(false);
                        handleSequentialSplitNode();
                      }
                    }}
                    style={{
                      opacity: isSplitting ? 0.6 : 1,
                      cursor: isSplitting ? "wait" : "pointer",
                    }}
                  >
                    <span>Sequential Split</span>
                  </div>
                  <div
                    className="node-menu-item"
                    onClick={(e) => {
                      e.stopPropagation();
                      logButtonClick(sessionId, "delete_node", {
                        nodeId: id,
                        agentType: selectedAgent,
                      });
                      setIsMenuOpen(false);
                      handleDeleteNode();
                    }}
                  >
                    <span className="intent-text-danger">Delete Node</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Agent Selection Section */}
      <div className="agent-selection">
        <div className="section-header">
          <span>Agent</span>
        </div>
        <div className="agent-dropdown-container">
          <HTMLSelect
            value={selectedAgent}
            onChange={(e) => handleAgentSelection(e.target.value)}
            options={AGENT_TYPES}
            fill
            className="nodrag"
          />
        </div>
      </div>

      {/* Task Description Section */}
      <div className="task-description-section">
        <div className="section-header">
          <span>Task Description</span>
          {isEditingTaskDescription ? (
            <div style={{ display: "flex", gap: "var(--sp-xs)" }}>
              <Button
                icon="floppy-disk"
                minimal
                small
                intent={hasUnsavedTaskChanges ? "warning" : "success"}
                onClick={() => {
                  logButtonClick(sessionId, "save_task_description", {
                    nodeId: id,
                    agentType: selectedAgent,
                    descriptionLength: taskDescription?.length || 0,
                  });
                  saveAndExitTaskEdit();
                }}
                disabled={!hasUnsavedTaskChanges}
                title={
                  hasUnsavedTaskChanges ? "Save and exit" : "No changes to save"
                }
              />
              <Button
                icon="cross"
                minimal
                small
                onClick={() => {
                  logButtonClick(sessionId, "cancel_edit_task_description", {
                    nodeId: id,
                    agentType: selectedAgent,
                  });
                  cancelEditingTaskDescription();
                }}
                title="Cancel editing"
              />
            </div>
          ) : (
            <Button
              icon="edit"
              minimal
              small
              onClick={() => {
                logButtonClick(sessionId, "start_edit_task_description", {
                  nodeId: id,
                  agentType: selectedAgent,
                  descriptionLength: taskDescription?.length || 0,
                });
                startEditingTaskDescription();
              }}
              title="Edit task description"
            />
          )}
        </div>

        {isEditingTaskDescription ? (
          <TextArea
            value={taskDescription}
            onChange={(e) => handleTaskDescriptionChange(e.target.value)}
            placeholder="Enter task description..."
            fill
            rows={3}
            intent={hasUnsavedTaskChanges ? "warning" : "none"}
            className={`nodrag nowheel ${hasUnsavedTaskChanges ? "unsaved-changes" : ""}`}
          />
        ) : (
          <p
            onClick={() => {
              logButtonClick(
                sessionId,
                "start_edit_task_description_by_click",
                {
                  nodeId: id,
                  agentType: selectedAgent,
                  descriptionLength: taskDescription?.length || 0,
                },
              );
              startEditingTaskDescription();
            }}
            style={{
              cursor: "pointer",
              margin: "var(--sp-sm)",
              whiteSpace: "pre-wrap",
            }}
          >
            {taskDescription || ""}
          </p>
        )}
      </div>

      {/* Log Section */}
      <div className="node-log">
        <div className="section-header">
          <span>Log</span>
          <Button
            icon={isLogCollapsed ? "chevron-down" : "chevron-up"}
            minimal
            small
            onClick={() => {
              const newState = !isLogCollapsed;
              logButtonClick(sessionId, "toggle_log_section", {
                nodeId: id,
                agentType: selectedAgent,
                action: newState ? "collapse" : "expand",
              });
              handleLogCollapseToggle();
            }}
            title={isLogCollapsed ? "Expand log" : "Collapse log"}
          />
        </div>

        {!isLogCollapsed && (
          <div className="log-container nowheel">
            <div className="log-content">
              {logContent &&
              (Array.isArray(logContent)
                ? logContent.length > 0
                : logContent !== "") ? (
                <div
                  style={{
                    margin: "var(--sp-sm)",
                    maxHeight: "300px",
                    overflowY: "auto",
                  }}
                >
                  <JsonView
                    src={
                      typeof logContent === "string"
                        ? (() => {
                            try {
                              return JSON.parse(logContent);
                            } catch {
                              return { raw: logContent };
                            }
                          })()
                        : logContent
                    }
                    collapsed={2}
                    theme="default"
                  />
                </div>
              ) : (
                <p
                  style={{
                    color: "var(--bp-typography-color-muted)",
                    fontStyle: "italic",
                    padding: "var(--sp-sm)",
                  }}
                >
                  No execution log available yet.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Structured Trace Section - Only show for search agent */}
      {selectedAgent === "search" && (
        <div className="node-search-intermediate-status">
          <div className="section-header">
            <span>Structured Trace</span>
            <Button
              icon={
                isSearchIntermediateStatusCollapsed
                  ? "chevron-down"
                  : "chevron-up"
              }
              minimal
              small
              onClick={() => {
                const newState = !isSearchIntermediateStatusCollapsed;
                logButtonClick(
                  sessionId,
                  "toggle_search_intermediate_status_section",
                  {
                    nodeId: id,
                    agentType: selectedAgent,
                    action: newState ? "collapse" : "expand",
                  },
                );
                handleSearchIntermediateStatusCollapseToggle();
              }}
              title={
                isSearchIntermediateStatusCollapsed
                  ? "Expand search intermediate status"
                  : "Collapse search intermediate status"
              }
            />
          </div>

          {!isSearchIntermediateStatusCollapsed && (
            <div className="search-intermediate-status-container nowheel">
              <div
                className="search-intermediate-status-content"
                style={{ margin: "var(--sp-sm)" }}
              >
                {/* Search Query Section */}
                <div
                  className="search-query-section"
                  style={{ marginBottom: "var(--sp-lg)" }}
                >
                  <h4 className="section-heading">Search Query</h4>
                  {searchQueryData ? (
                    <div
                      className="mono"
                      style={{
                        padding: "var(--sp-md)",
                        background: "var(--bg-muted)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: "4px",
                        fontSize: "var(--fs-xl)",
                        wordWrap: "break-word",
                      }}
                    >
                      {searchQueryData}
                    </div>
                  ) : (
                    <p className="empty-state-text">
                      No search query available.
                    </p>
                  )}
                </div>

                {/* Search Results Table Section */}
                <div className="search-results-section">
                  <h4 className="section-heading">Search Results</h4>
                  {Object.keys(searchResultsData).length > 0 ? (
                    <div
                      style={{
                        maxHeight: "300px",
                        overflowY: "auto",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: "4px",
                      }}
                    >
                      <table
                        style={{
                          width: "100%",
                          borderCollapse: "collapse",
                          fontSize: "var(--fs-xl)",
                        }}
                      >
                        <thead
                          style={{
                            position: "sticky",
                            top: 0,
                            background: "var(--bg-muted)",
                            borderBottom: "2px solid var(--border-subtle)",
                          }}
                        >
                          <tr>
                            <th
                              style={{
                                padding: "var(--sp-sm)",
                                textAlign: "left",
                                fontWeight: "bold",
                                width: "30%",
                                borderRight: "1px solid var(--border-subtle)",
                              }}
                            >
                              Title
                            </th>
                            <th
                              style={{
                                padding: "var(--sp-sm)",
                                textAlign: "left",
                                fontWeight: "bold",
                                width: "70%",
                              }}
                            >
                              Snippet
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(searchResultsData).map(
                            ([title, snippet], index) => (
                              <tr
                                key={index}
                                style={{
                                  borderBottom:
                                    index <
                                    Object.keys(searchResultsData).length - 1
                                      ? "1px solid var(--border-subtle)"
                                      : "none",
                                }}
                              >
                                <td
                                  style={{
                                    padding: "var(--sp-sm)",
                                    verticalAlign: "top",
                                    borderRight:
                                      "1px solid var(--border-subtle)",
                                    wordWrap: "break-word",
                                  }}
                                >
                                  {title}
                                </td>
                                <td
                                  style={{
                                    padding: "var(--sp-sm)",
                                    verticalAlign: "top",
                                    wordWrap: "break-word",
                                  }}
                                >
                                  {snippet}
                                </td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="empty-state-text">
                      No search results available.
                    </p>
                  )}
                </div>

                {/* Search Rewrite Section - Collapsible */}
                <div
                  className="search-rewrite-section"
                  style={{ marginTop: "var(--sp-lg)" }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: "var(--sp-sm)",
                      cursor: "pointer",
                      padding: "4px 0",
                    }}
                    onClick={() => {
                      const newState = !isSearchRewriteCollapsed;
                      logButtonClick(
                        sessionId,
                        "toggle_search_rewrite_section",
                        {
                          nodeId: id,
                          agentType: selectedAgent,
                          action: newState ? "collapse" : "expand",
                        },
                      );
                      handleSearchRewriteCollapseToggle();
                    }}
                  >
                    <h4
                      style={{
                        margin: "0",
                        fontSize: "var(--fs-subhead)",
                        fontWeight: "bold",
                      }}
                    >
                      Search Rewrite
                    </h4>
                    <Button
                      icon={
                        isSearchRewriteCollapsed ? "chevron-down" : "chevron-up"
                      }
                      minimal
                      small
                      onClick={(e) => {
                        e.stopPropagation();
                        const newState = !isSearchRewriteCollapsed;
                        logButtonClick(
                          sessionId,
                          "toggle_search_rewrite_section",
                          {
                            nodeId: id,
                            agentType: selectedAgent,
                            action: newState ? "collapse" : "expand",
                          },
                        );
                        handleSearchRewriteCollapseToggle();
                      }}
                      title={
                        isSearchRewriteCollapsed
                          ? "Expand search rewrite"
                          : "Collapse search rewrite"
                      }
                    />
                  </div>

                  {!isSearchRewriteCollapsed && (
                    <div className="search-rewrite-content">
                      {/* Thought Section */}
                      {searchRewriteData.thought && (
                        <div style={{ marginBottom: "var(--sp-md)" }}>
                          <h5 className="subsection-heading">Thought:</h5>
                          <div
                            style={{
                              padding: "10px",
                              background: "var(--bg-muted)",
                              border: "1px solid var(--border-subtle)",
                              borderRadius: "4px",
                              fontSize: "var(--fs-xl)",
                              wordWrap: "break-word",
                              fontStyle: "italic",
                              color: "var(--bp-typography-color-default)",
                            }}
                          >
                            {searchRewriteData.thought}
                          </div>
                        </div>
                      )}

                      {/* Output Results Table */}
                      {Object.keys(searchRewriteData.output_results).length >
                        0 && (
                        <div>
                          <h5 className="subsection-heading">
                            Output Results:
                          </h5>
                          <div
                            style={{
                              maxHeight: "200px",
                              overflowY: "auto",
                              border: "1px solid var(--border-subtle)",
                              borderRadius: "4px",
                            }}
                          >
                            <table
                              style={{
                                width: "100%",
                                borderCollapse: "collapse",
                                fontSize: "var(--fs-xl)",
                              }}
                            >
                              <thead
                                style={{
                                  position: "sticky",
                                  top: 0,
                                  background: "var(--bg-muted)",
                                  borderBottom:
                                    "2px solid var(--border-subtle)",
                                }}
                              >
                                <tr>
                                  <th
                                    style={{
                                      padding: "var(--sp-sm)",
                                      textAlign: "left",
                                      fontWeight: "bold",
                                      width: "35%",
                                      borderRight:
                                        "1px solid var(--border-subtle)",
                                    }}
                                  >
                                    Output Var
                                  </th>
                                  <th
                                    style={{
                                      padding: "var(--sp-sm)",
                                      textAlign: "left",
                                      fontWeight: "bold",
                                      width: "65%",
                                    }}
                                  >
                                    Result
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {Object.entries(
                                  searchRewriteData.output_results,
                                ).map(([variable, result], index) => (
                                  <tr
                                    key={index}
                                    style={{
                                      borderBottom:
                                        index <
                                        Object.keys(
                                          searchRewriteData.output_results,
                                        ).length -
                                          1
                                          ? "1px solid var(--border-subtle)"
                                          : "none",
                                    }}
                                  >
                                    <td
                                      style={{
                                        padding: "var(--sp-sm)",
                                        verticalAlign: "top",
                                        borderRight:
                                          "1px solid var(--border-subtle)",
                                        wordWrap: "break-word",
                                        fontWeight: "500",
                                      }}
                                    >
                                      {variable}
                                    </td>
                                    <td
                                      style={{
                                        padding: "var(--sp-sm)",
                                        verticalAlign: "top",
                                        wordWrap: "break-word",
                                      }}
                                    >
                                      {result}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Show message if no data available */}
                      {!searchRewriteData.thought &&
                        Object.keys(searchRewriteData.output_results).length ===
                          0 && (
                          <p className="empty-state-text">
                            No search rewrite data available.
                          </p>
                        )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Structured Trace Section - Only show for commonsense agent */}
      {selectedAgent === "commonsense" && (
        <div className="node-commonsense-intermediate-status">
          <div className="section-header">
            <span>Structured Trace</span>
            <Button
              icon={
                isCommonsenseIntermediateStatusCollapsed
                  ? "chevron-down"
                  : "chevron-up"
              }
              minimal
              small
              onClick={() => {
                const newState = !isCommonsenseIntermediateStatusCollapsed;
                logButtonClick(
                  sessionId,
                  "toggle_commonsense_intermediate_status_section",
                  {
                    nodeId: id,
                    agentType: selectedAgent,
                    action: newState ? "collapse" : "expand",
                  },
                );
                handleCommonsenseIntermediateStatusCollapseToggle();
              }}
              title={
                isCommonsenseIntermediateStatusCollapsed
                  ? "Expand commonsense intermediate status"
                  : "Collapse commonsense intermediate status"
              }
            />
          </div>

          {!isCommonsenseIntermediateStatusCollapsed && (
            <div className="commonsense-intermediate-status-container nowheel">
              <div
                className="commonsense-intermediate-status-content"
                style={{ margin: "var(--sp-sm)" }}
              >
                {/* Reasoning Section */}
                {commonsenseRawResults.thought && (
                  <div style={{ marginBottom: "var(--sp-md)" }}>
                    <h4 className="section-heading">Reasoning</h4>
                    <div
                      style={{
                        padding: "10px",
                        background: "var(--bg-muted)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: "4px",
                        fontSize: "var(--fs-xl)",
                        wordWrap: "break-word",
                        fontStyle: "italic",
                        color: "var(--bp-typography-color-default)",
                      }}
                    >
                      {commonsenseRawResults.thought}
                    </div>
                  </div>
                )}

                {/* Result Table */}
                {Object.keys(commonsenseRawResults.output_results).length >
                  0 && (
                  <div>
                    <h4 className="section-heading">Result</h4>
                    <div
                      style={{
                        maxHeight: "250px",
                        overflowY: "auto",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: "4px",
                      }}
                    >
                      <table
                        style={{
                          width: "100%",
                          borderCollapse: "collapse",
                          fontSize: "var(--fs-xl)",
                        }}
                      >
                        <thead
                          style={{
                            position: "sticky",
                            top: 0,
                            background: "var(--bg-muted)",
                            borderBottom: "2px solid var(--border-subtle)",
                          }}
                        >
                          <tr>
                            <th
                              style={{
                                padding: "var(--sp-sm)",
                                textAlign: "left",
                                fontWeight: "bold",
                                width: "35%",
                                borderRight: "1px solid var(--border-subtle)",
                              }}
                            >
                              Output Var
                            </th>
                            <th
                              style={{
                                padding: "var(--sp-sm)",
                                textAlign: "left",
                                fontWeight: "bold",
                                width: "65%",
                              }}
                            >
                              Result
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(
                            commonsenseRawResults.output_results,
                          ).map(([variable, result], index) => (
                            <tr
                              key={index}
                              style={{
                                borderBottom:
                                  index <
                                  Object.keys(
                                    commonsenseRawResults.output_results,
                                  ).length -
                                    1
                                    ? "1px solid var(--border-subtle)"
                                    : "none",
                              }}
                            >
                              <td
                                style={{
                                  padding: "var(--sp-sm)",
                                  verticalAlign: "top",
                                  borderRight: "1px solid var(--border-subtle)",
                                  wordWrap: "break-word",
                                  fontWeight: "500",
                                }}
                              >
                                {variable}
                              </td>
                              <td
                                style={{
                                  padding: "var(--sp-sm)",
                                  verticalAlign: "top",
                                  wordWrap: "break-word",
                                }}
                              >
                                {result}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Show message if no data available */}
                {!commonsenseRawResults.thought &&
                  Object.keys(commonsenseRawResults.output_results).length ===
                    0 && (
                    <p className="empty-state-text">
                      No commonsense reasoning data available yet.
                    </p>
                  )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Structured Trace Section - Only show for math agent */}
      {selectedAgent === "math" && (
        <div className="node-intermediate-status">
          <div className="section-header">
            <span>Structured Trace</span>
            <Button
              icon={
                isIntermediateStatusCollapsed ? "chevron-down" : "chevron-up"
              }
              minimal
              small
              onClick={() => {
                const newState = !isIntermediateStatusCollapsed;
                logButtonClick(
                  sessionId,
                  "toggle_intermediate_status_section",
                  {
                    nodeId: id,
                    agentType: selectedAgent,
                    action: newState ? "collapse" : "expand",
                  },
                );
                handleIntermediateStatusCollapseToggle();
              }}
              title={
                isIntermediateStatusCollapsed
                  ? "Expand intermediate status"
                  : "Collapse intermediate status"
              }
            />
          </div>

          {!isIntermediateStatusCollapsed && (
            <div className="intermediate-status-container nowheel">
              <div
                className="intermediate-status-content"
                style={{ margin: "var(--sp-sm)" }}
              >
                {/* Extracted Math Expression Section */}
                <div
                  className="math-expression-section"
                  style={{ marginBottom: "var(--sp-lg)" }}
                >
                  <h4 className="section-heading">Extracted Math Expression</h4>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "var(--fs-xl)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    <thead>
                      <tr style={{ backgroundColor: "var(--bg-muted)" }}>
                        <th
                          style={{
                            border: "1px solid var(--border-subtle)",
                            padding: "var(--sp-sm)",
                            textAlign: "left",
                            fontWeight: "bold",
                          }}
                        >
                          Output Var
                        </th>
                        <th
                          style={{
                            border: "1px solid var(--border-subtle)",
                            padding: "var(--sp-sm)",
                            textAlign: "left",
                            fontWeight: "bold",
                          }}
                        >
                          Expression
                        </th>
                        <th
                          style={{
                            border: "1px solid var(--border-subtle)",
                            padding: "var(--sp-sm)",
                            textAlign: "left",
                            fontWeight: "bold",
                          }}
                        >
                          Result
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {mathExpressionData.length > 0 ? (
                        mathExpressionData.map((item, index) => {
                          // Determine row background color
                          // Light red: expression is empty OR (expression exists but no result)
                          // Light green: expression exists AND result exists
                          const hasExpression =
                            item.expression && item.expression.trim() !== "";
                          const hasResult =
                            item.result !== undefined &&
                            item.result !== null &&
                            item.result !== "";
                          const backgroundColor =
                            !hasExpression || (hasExpression && !hasResult)
                              ? "var(--bp-intent-danger-soft)" // Light red
                              : "var(--bp-intent-success-soft)"; // Light green

                          return (
                            <tr key={index} style={{ backgroundColor }}>
                              <td
                                style={{
                                  border: "1px solid var(--border-subtle)",
                                  padding: "var(--sp-sm)",
                                }}
                              >
                                {item.outputName}
                              </td>
                              <td
                                className="mono"
                                style={{
                                  border: "1px solid var(--border-subtle)",
                                  padding: "var(--sp-sm)",
                                  fontSize: "var(--fs-xl)",
                                }}
                              >
                                {item.expression}
                              </td>
                              <td
                                style={{
                                  border: "1px solid var(--border-subtle)",
                                  padding: "var(--sp-sm)",
                                }}
                              >
                                {item.result}
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td
                            style={{
                              border: "1px solid var(--border-subtle)",
                              padding: "var(--sp-sm)",
                              color: "var(--bp-typography-color-muted)",
                              fontStyle: "italic",
                            }}
                            colSpan="3"
                          >
                            No math expressions available yet. Execute the task
                            to see results.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Fallback Section - Only show if there's data */}
                {fallbackData.length > 0 && (
                  <div className="fallback-section">
                    <h4 className="section-heading">Fallback</h4>
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: "var(--fs-xl)",
                        border: "1px solid var(--border-subtle)",
                      }}
                    >
                      <thead>
                        <tr style={{ backgroundColor: "var(--bg-muted)" }}>
                          <th
                            style={{
                              border: "1px solid var(--border-subtle)",
                              padding: "var(--sp-sm)",
                              textAlign: "left",
                              fontWeight: "bold",
                            }}
                          >
                            Output Var
                          </th>
                          <th
                            style={{
                              border: "1px solid var(--border-subtle)",
                              padding: "var(--sp-sm)",
                              textAlign: "left",
                              fontWeight: "bold",
                            }}
                          >
                            Result
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {fallbackData.map((item, index) => {
                          // Determine row background color
                          // Light red: result is empty or null
                          // Light green: result exists
                          const hasResult =
                            item.result !== null &&
                            item.result !== undefined &&
                            item.result !== "";
                          const backgroundColor = hasResult
                            ? "var(--bp-intent-success-soft)"
                            : "var(--bp-intent-danger-soft)"; // Light green : Light red

                          return (
                            <tr key={index} style={{ backgroundColor }}>
                              <td
                                style={{
                                  border: "1px solid var(--border-subtle)",
                                  padding: "var(--sp-sm)",
                                }}
                              >
                                {item.outputName}
                              </td>
                              <td
                                style={{
                                  border: "1px solid var(--border-subtle)",
                                  padding: "var(--sp-sm)",
                                }}
                              >
                                {item.result !== null &&
                                item.result !== undefined
                                  ? String(item.result)
                                  : ""}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Code Section - Only show for code agent */}
      {selectedAgent === "code" && (
        <div className="node-code">
          <div className="section-header">
            <span>Structured Trace</span>
            <Button
              icon={isCodeCollapsed ? "chevron-down" : "chevron-up"}
              minimal
              small
              onClick={() => {
                const newState = !isCodeCollapsed;
                logButtonClick(sessionId, "toggle_code_section", {
                  nodeId: id,
                  agentType: selectedAgent,
                  action: newState ? "collapse" : "expand",
                });
                handleCodeCollapseToggle();
              }}
              title={isCodeCollapsed ? "Expand code" : "Collapse code"}
            />
          </div>

          {!isCodeCollapsed && (
            <div className="code-container nowheel">
              <div className="code-content">
                {codeContent ? (
                  <pre
                    className="nodrag"
                    style={{
                      margin: 0,
                      padding: "10px",
                      background: "var(--bg-muted)",
                      border: "none",
                      borderRadius: "4px",
                      maxHeight: "400px",
                      overflowY: "auto",
                      fontSize: "var(--fs-xl)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      userSelect: "text",
                      cursor: "text",
                    }}
                  >
                    <code
                      style={{
                        color: "var(--bp-typography-color-default)",
                        userSelect: "text",
                      }}
                    >
                      {codeContent}
                    </code>
                  </pre>
                ) : (
                  <p
                    style={{
                      color: "var(--bp-typography-color-muted)",
                      fontStyle: "italic",
                      padding: "var(--sp-sm)",
                    }}
                  >
                    No code available yet. Execute the task to generate code.
                  </p>
                )}
              </div>

              {/* Execution Result Section */}
              {(executionResult !== null && executionResult !== undefined) ||
              executionError ? (
                <div
                  className="execution-result-content"
                  style={{ marginTop: "var(--sp-sm)" }}
                >
                  <div
                    style={{
                      margin: 0,
                      padding: "var(--sp-sm)",
                      background: executionError
                        ? "var(--bp-intent-danger-soft)"
                        : "transparent",
                      border: executionError
                        ? "1px solid var(--bp-intent-danger-soft)"
                        : "none",
                      borderRadius: "4px",
                    }}
                  >
                    <div
                      style={{
                        fontWeight: "bold",
                        marginBottom: "var(--sp-sm)",
                        fontSize: "var(--fs-xl)",
                        color: executionError
                          ? "var(--bp-intent-danger-rest)"
                          : "var(--bp-typography-color-muted)",
                      }}
                    >
                      {executionError
                        ? "Execution Error:"
                        : "Execution Result:"}
                    </div>
                    <pre
                      className="nodrag"
                      style={{
                        margin: 0,
                        padding: "var(--sp-sm)",
                        background: executionError
                          ? "var(--bp-intent-danger-soft)"
                          : "var(--bg-muted)",
                        border: "none",
                        borderRadius: "4px",
                        maxHeight: "300px",
                        overflowY: "auto",
                        fontSize: "var(--fs-xl)",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        userSelect: "text",
                        cursor: "text",
                      }}
                    >
                      <code
                        className={
                          executionError ? "intent-text-danger-strong" : ""
                        }
                        style={{ userSelect: "text" }}
                      >
                        {executionError ||
                          (executionResult === ""
                            ? "No result"
                            : executionResult)}
                      </code>
                    </pre>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* Variables Section - Combined Inputs and Outputs */}
      <div className="node-variables">
        <div className="section-header">
          <span>Variables</span>
          <div style={{ display: "flex", gap: "var(--sp-xs)" }}>
            <Button
              icon={isVariablesCollapsed ? "chevron-down" : "chevron-up"}
              minimal
              small
              onClick={() => {
                const newState = !isVariablesCollapsed;
                logButtonClick(sessionId, "toggle_variables_section", {
                  nodeId: id,
                  agentType: selectedAgent,
                  action: newState ? "collapse" : "expand",
                  inputCount: inputs.length,
                  outputCount: outputs.length,
                });
                handleVariablesCollapseToggle();
              }}
              title={
                isVariablesCollapsed ? "Expand variables" : "Collapse variables"
              }
            />
          </div>
        </div>

        {!isVariablesCollapsed && (
          <div className="variables-container">
            {/* Input Variables Column */}
            <div className="variables-column">
              <div className="variables-column-header">
                <span>Inputs</span>
                <Button
                  icon="plus"
                  minimal
                  small
                  onClick={() => {
                    logButtonClick(sessionId, "add_input_variable", {
                      nodeId: id,
                      currentInputCount: inputs.length,
                    });
                    addInputField();
                  }}
                  title="Add input variable"
                />
              </div>
              {inputs.length > 0 && (
                <div className="variables-list">
                  {inputs.map((input, index) => {
                    const inputName = input.name || `input_${index}`;
                    return (
                      <div
                        key={index}
                        className="input-item input-variable-with-handle"
                      >
                        {/* Input Connection Handle on left edge */}
                        <Handle
                          type="target"
                          position={Position.Left}
                          id={inputName}
                          className="input-variable-handle"
                          style={{
                            position: "absolute",
                            left: "-16px",
                            top: "50%",
                            transform: "translateY(-50%)",
                            background: "var(--handle-color)",
                            width: "12px",
                            height: "12px",
                            border: "1px solid white",
                          }}
                        />
                        {/* Variable Name Field */}
                        <div className="input-field">
                          <InputGroup
                            value={input.name || ""}
                            onChange={(e) =>
                              updateInputName(index, e.target.value)
                            }
                            placeholder={`Variable name ${index + 1}`}
                            size="medium"
                            disabled={
                              !input.isEditing && input.isEditing !== undefined
                            }
                            intent={
                              input.isValid === false
                                ? "danger"
                                : input.isValid === true
                                  ? "success"
                                  : "none"
                            }
                            className={`nodrag value-input ${!input.isEditing && input.isEditing !== undefined ? "is-readonly" : ""}`}
                            rightElement={
                              <div style={{ display: "flex" }}>
                                {input.isEditing ? (
                                  <>
                                    <Button
                                      icon="tick"
                                      minimal
                                      small
                                      intent="success"
                                      onClick={() => {
                                        logButtonClick(
                                          sessionId,
                                          "validate_input_and_save_variable",
                                          {
                                            nodeId: id,
                                            variableName: input.name,
                                            variableIndex: index,
                                          },
                                        );
                                        validateInput(index);
                                      }}
                                      title="Validate variable"
                                    />
                                    <Button
                                      icon="cross"
                                      minimal
                                      small
                                      onClick={() => {
                                        logButtonClick(
                                          sessionId,
                                          "cancel_edit_input_variable",
                                          {
                                            nodeId: id,
                                            variableIndex: index,
                                          },
                                        );
                                        cancelEditInput(index);
                                      }}
                                      title="Cancel editing"
                                    />
                                  </>
                                ) : (
                                  <Button
                                    icon="edit"
                                    minimal
                                    small
                                    onClick={() => {
                                      logButtonClick(
                                        sessionId,
                                        "edit_input_variable",
                                        {
                                          nodeId: id,
                                          variableName: input.name,
                                          variableIndex: index,
                                        },
                                      );
                                      editInput(index);
                                    }}
                                    title="Edit variable"
                                  />
                                )}
                                <Button
                                  icon="trash"
                                  minimal
                                  small
                                  intent="danger"
                                  onClick={() => {
                                    logButtonClick(
                                      sessionId,
                                      "remove_input_variable",
                                      {
                                        nodeId: id,
                                        variableName: input.name,
                                        variableIndex: index,
                                        totalInputs: inputs.length,
                                      },
                                    );
                                    removeInputField(index);
                                  }}
                                  title="Remove input variable"
                                />
                              </div>
                            }
                          />
                        </div>

                        {/* Variable Value Field - only show if not editing name */}
                        {!input.isEditing && input.isEditing !== undefined && (
                          <div className="input-field">
                            <div style={{ position: "relative" }}>
                              <TextArea
                                value={input.value || ""}
                                onChange={(e) =>
                                  updateInputValue(index, e.target.value)
                                }
                                placeholder="Variable value"
                                size="medium"
                                disabled={editingInputValueIndex !== index}
                                className={`nodrag nowheel value-textarea ${editingInputValueIndex !== index ? "is-readonly" : ""}`}
                              />
                              <div className="input-value-actions">
                                {editingInputValueIndex === index ? (
                                  <>
                                    <Button
                                      icon="tick"
                                      minimal
                                      small
                                      intent="success"
                                      onClick={() => {
                                        logButtonClick(
                                          sessionId,
                                          "save_input_variable_value",
                                          {
                                            nodeId: id,
                                            variableName: input.name,
                                            variableIndex: index,
                                            valueLength:
                                              input.value?.length || 0,
                                          },
                                        );
                                        handleUpdateInputValue(index);
                                      }}
                                      title="Save variable value"
                                    />
                                    <Button
                                      icon="cross"
                                      minimal
                                      small
                                      onClick={() => {
                                        logButtonClick(
                                          sessionId,
                                          "cancel_edit_input_variable_value",
                                          {
                                            nodeId: id,
                                            variableIndex: index,
                                          },
                                        );
                                        cancelEditInputValue(index);
                                      }}
                                      title="Cancel editing"
                                    />
                                  </>
                                ) : (
                                  <Button
                                    icon="edit"
                                    minimal
                                    small
                                    onClick={() => {
                                      logButtonClick(
                                        sessionId,
                                        "start_edit_input_variable_value",
                                        {
                                          nodeId: id,
                                          variableName: input.name,
                                          variableIndex: index,
                                        },
                                      );
                                      startEditInputValue(index);
                                    }}
                                    title="Edit variable value"
                                  />
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Output Variables Column */}
            <div className="variables-column">
              <div className="variables-column-header">
                <span>Outputs</span>
                <Button
                  icon="plus"
                  minimal
                  small
                  onClick={() => {
                    logButtonClick(sessionId, "add_output_variable", {
                      nodeId: id,
                      currentOutputCount: outputs.length,
                    });
                    addOutputField();
                  }}
                  title="Add output variable"
                />
              </div>
              {outputs.length > 0 && (
                <div className="variables-list">
                  {outputs.map((output, index) => {
                    const outputName = output.name || `output_${index}`;
                    return (
                      <div
                        key={index}
                        className="input-item output-variable-with-handle"
                      >
                        {/* Output Connection Handle on right edge */}
                        <Handle
                          type="source"
                          position={Position.Right}
                          id={outputName}
                          className="output-variable-handle"
                          style={{
                            position: "absolute",
                            right: "-16px",
                            top: "50%",
                            transform: "translateY(-50%)",
                            background: "var(--handle-color)",
                            width: "12px",
                            height: "12px",
                            border: "1px solid white",
                          }}
                        />
                        {/* Variable Name Field */}
                        <div className="input-field">
                          <InputGroup
                            value={output.name || ""}
                            onChange={(e) =>
                              updateOutputName(index, e.target.value)
                            }
                            placeholder="Variable name"
                            size="medium"
                            disabled={
                              !output.isEditing &&
                              output.isEditing !== undefined
                            }
                            intent={
                              output.isValid === false
                                ? "danger"
                                : output.isValid === true
                                  ? "success"
                                  : "none"
                            }
                            className={`nodrag value-input ${!output.isEditing && output.isEditing !== undefined ? "is-readonly" : ""}`}
                            rightElement={
                              <div style={{ display: "flex" }}>
                                {output.isEditing ? (
                                  <>
                                    <Button
                                      icon="tick"
                                      minimal
                                      small
                                      intent="success"
                                      onClick={() => {
                                        logButtonClick(
                                          sessionId,
                                          "validate_output_and_save_variable",
                                          {
                                            nodeId: id,
                                            variableName: output.name,
                                            variableIndex: index,
                                          },
                                        );
                                        validateOutput(index);
                                      }}
                                      title="Validate variable"
                                    />
                                    <Button
                                      icon="cross"
                                      minimal
                                      small
                                      onClick={() => {
                                        logButtonClick(
                                          sessionId,
                                          "cancel_edit_output_variable",
                                          {
                                            nodeId: id,
                                            variableIndex: index,
                                          },
                                        );
                                        cancelEditOutput(index);
                                      }}
                                      title="Cancel editing"
                                    />
                                  </>
                                ) : (
                                  <Button
                                    icon="edit"
                                    minimal
                                    small
                                    onClick={() => {
                                      logButtonClick(
                                        sessionId,
                                        "edit_output_variable",
                                        {
                                          nodeId: id,
                                          variableName: output.name,
                                          variableIndex: index,
                                        },
                                      );
                                      editOutput(index);
                                    }}
                                    title="Edit variable"
                                  />
                                )}
                                <Button
                                  icon="trash"
                                  minimal
                                  small
                                  intent="danger"
                                  onClick={() => {
                                    logButtonClick(
                                      sessionId,
                                      "remove_output_variable",
                                      {
                                        nodeId: id,
                                        variableName: output.name,
                                        variableIndex: index,
                                        totalOutputs: outputs.length,
                                      },
                                    );
                                    removeOutputField(index);
                                  }}
                                  title="Remove output variable"
                                />
                              </div>
                            }
                          />
                        </div>

                        {/* Variable Value Field - only show if not editing name */}
                        {!output.isEditing &&
                          output.isEditing !== undefined && (
                            <div className="input-field">
                              <div style={{ position: "relative" }}>
                                <TextArea
                                  value={output.value || ""}
                                  onChange={(e) =>
                                    updateOutputValue(index, e.target.value)
                                  }
                                  size="medium"
                                  placeholder="Variable value"
                                  disabled={editingOutputValueIndex !== index}
                                  className={`nodrag nowheel value-textarea ${editingOutputValueIndex !== index ? "is-readonly" : ""}`}
                                />
                                <div className="input-value-actions">
                                  {editingOutputValueIndex === index ? (
                                    <>
                                      <Button
                                        icon="tick"
                                        minimal
                                        small
                                        intent="success"
                                        onClick={() => {
                                          logButtonClick(
                                            sessionId,
                                            "save_output_variable_value",
                                            {
                                              nodeId: id,
                                              variableName: output.name,
                                              variableIndex: index,
                                              valueLength:
                                                output.value?.length || 0,
                                            },
                                          );
                                          handleUpdateOutputValue(index);
                                        }}
                                        title="Save variable value"
                                      />
                                      <Button
                                        icon="cross"
                                        minimal
                                        small
                                        onClick={() => {
                                          logButtonClick(
                                            sessionId,
                                            "cancel_edit_output_variable_value",
                                            {
                                              nodeId: id,
                                              variableIndex: index,
                                            },
                                          );
                                          cancelEditOutputValue(index);
                                        }}
                                        title="Cancel editing"
                                      />
                                    </>
                                  ) : (
                                    <Button
                                      icon="edit"
                                      minimal
                                      small
                                      onClick={() => {
                                        logButtonClick(
                                          sessionId,
                                          "start_edit_output_variable_value",
                                          {
                                            nodeId: id,
                                            variableName: output.name,
                                            variableIndex: index,
                                          },
                                        );
                                        startEditOutputValue(index);
                                      }}
                                      title="Edit variable value"
                                    />
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Variables Section Handles - Show when collapsed */}
      {isVariablesCollapsed && (inputs.length > 0 || outputs.length > 0) && (
        <div className="collapsed-variables-handles">
          {/* Input handles on left - or invisible placeholder */}
          <div className="collapsed-inputs">
            {inputs.length > 0 ? (
              inputs.map((input, index) => {
                const inputName = input.name || `input_${index}`;
                return (
                  <div
                    key={`collapsed-input-${index}`}
                    className="collapsed-variable-item"
                  >
                    <Handle
                      type="target"
                      position={Position.Left}
                      id={inputName}
                      className="collapsed-input-handle"
                      style={{
                        position: "absolute",
                        left: "-10px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "var(--handle-color)",
                        width: "12px",
                        height: "12px",
                        border: "1px solid white",
                      }}
                    />
                    <span className="collapsed-variable-label">
                      {inputName}
                    </span>
                  </div>
                );
              })
            ) : (
              <div style={{ width: 0, height: 0 }}></div>
            )}
          </div>

          {/* Output handles on right */}
          {outputs.length > 0 && (
            <div className="collapsed-outputs">
              {outputs.map((output, index) => {
                const outputName = output.name || `output_${index}`;
                return (
                  <div
                    key={`collapsed-output-${index}`}
                    className="collapsed-variable-item"
                  >
                    <span className="collapsed-variable-label">
                      {outputName}
                    </span>
                    <Handle
                      type="source"
                      position={Position.Right}
                      id={outputName}
                      className="collapsed-output-handle"
                      style={{
                        position: "absolute",
                        right: "-10px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "var(--handle-color)",
                        width: "12px",
                        height: "12px",
                        border: "1px solid white",
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CustomTaskNode;
