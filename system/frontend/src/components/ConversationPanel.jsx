// components/ConversationPanel.js
import {
  Button,
  Card,
  Collapse,
  Dialog,
  DialogBody,
  DialogFooter,
  Elevation,
  FormGroup,
  HTMLSelect,
  Icon,
  InputGroup,
  Intent,
  Spinner,
  TextArea,
  Tooltip,
} from "@blueprintjs/core";
import { useEffect, useRef, useState } from "react";
import { logButtonClick } from "../utils/buttonLogger";
import "./ConversationPanel.css";

const ConversationPanel = ({
  conversationHistory,
  onGeneratePlan,
  onReplan,
  onSubplanFeedback,
  sessionId,
  planData,
  modelRegistry = [],
}) => {
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState(
    "Generating your plan...",
  );
  const [showPlannerSettings, setShowPlannerSettings] = useState(false);
  const [plannerConfig, setPlannerConfig] = useState({
    model: "gpt-4o-mini",
    temperature: 0.0,
  });
  const [tempConfig, setTempConfig] = useState({
    model: "gpt-4o-mini",
    temperature: 0.0,
  });
  const [expandedWarnings, setExpandedWarnings] = useState({});
  const messagesEndRef = useRef(null);
  const textAreaRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [conversationHistory]);

  // Fetch planner config when component mounts or sessionId changes
  useEffect(() => {
    const fetchPlannerConfig = async () => {
      if (!sessionId) return;

      try {
        const response = await fetch(
          `/api/get-planner-config?session_id=${sessionId}`,
          {
            method: "GET",
          },
        );

        const result = await response.json();

        if (result.status === "success") {
          setPlannerConfig(result.config);
          setTempConfig(result.config);
          // console.log('Planner config loaded:', result.config);
        } else {
          console.error("Failed to fetch planner config:", result.message);
        }
      } catch (error) {
        console.error("Error fetching planner config:", error);
      }
    };

    fetchPlannerConfig();
  }, [sessionId]);

  const handleGeneratePlan = async () => {
    if (!message.trim() || isLoading) return;

    const userMessage = message.trim();
    setMessage("");
    setLoadingMessage("Generating your plan...");
    setIsLoading(true);

    try {
      await onGeneratePlan(userMessage);
    } catch (error) {
      console.error("Error sending message:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Handler for entire replan
  const handleEntireReplan = async () => {
    if (!message.trim() || isLoading) return;

    // Show confirmation dialog
    const confirmed = window.confirm(
      "This will regenerate the ENTIRE plan.\n\n" +
        "All nodes will be affected, not just selected nodes.\n\n" +
        "Do you want to continue?",
    );

    if (!confirmed) {
      return; // User cancelled
    }

    const userMessage = message.trim();
    setMessage("");
    setLoadingMessage("Regenerating entire plan...");
    setIsLoading(true);

    try {
      await onReplan(userMessage);
    } catch (error) {
      console.error("Error sending entire replan request:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Handler for target replan (subplan feedback)
  const handleTargetReplan = async () => {
    if (!message.trim() || isLoading) return;

    // Count selected nodes
    const selectedCount =
      planData?.nodes?.filter((n) => n.isSelected).length || 0;

    // Show confirmation dialog
    const confirmed = window.confirm(
      "This will regenerate ONLY the selected nodes.\n\n" +
        `Currently ${selectedCount} node(s) selected.\n\n` +
        "Unselected nodes will not be affected.\n\n" +
        "Do you want to continue?",
    );

    if (!confirmed) {
      return; // User cancelled
    }

    const userMessage = message.trim();
    setMessage("");
    setLoadingMessage("Regenerating targeted subplan...");
    setIsLoading(true);

    try {
      await onSubplanFeedback(userMessage);
    } catch (error) {
      console.error("Error sending target replan request:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleSavePlannerSettings = async () => {
    try {
      const response = await fetch("/api/update-planner-config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: sessionId,
          config: tempConfig,
        }),
      });

      const result = await response.json();

      if (result.status === "success") {
        // console.log('Planner settings saved successfully:', result);
        setPlannerConfig(tempConfig); // Update displayed config only after save
        setShowPlannerSettings(false);
      } else {
        console.error("Failed to save planner settings:", result.message);
        alert(`Failed to save settings: ${result.message}`);
      }
    } catch (error) {
      console.error("Error saving planner settings:", error);
      alert(`Error saving settings: ${error.message}`);
    }
  };

  const handleOpenSettings = () => {
    setTempConfig(plannerConfig); // Initialize temp with current config
    setShowPlannerSettings(true);
  };

  const handleCancelSettings = () => {
    setTempConfig(plannerConfig); // Revert temp config
    setShowPlannerSettings(false);
  };

  const updateTempConfig = (key, value) => {
    setTempConfig((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  return (
    <div className="conversation-panel">
      <div className="conversation-header">
        <div className="header-top">
          <h3>
            <Icon icon="chat" />
            AMBIPOM
          </h3>
          <div
            style={{
              display: "flex",
              gap: "var(--sp-sm)",
              alignItems: "center",
            }}
          >
            <Tooltip
              content={
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>
                    Planner Settings
                  </div>
                  <div style={{ fontSize: "var(--fs-xs)", opacity: 0.85 }}>
                    Using: {plannerConfig.model}
                  </div>
                </div>
              }
              placement="bottom"
            >
              <Button
                icon="cog"
                minimal
                onClick={() => {
                  logButtonClick(sessionId, "open_planner_settings");
                  handleOpenSettings();
                }}
                className="settings-icon-button fade-button"
              />
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Planner Settings Dialog */}
      <Dialog
        isOpen={showPlannerSettings}
        onClose={handleCancelSettings}
        title="Planner Settings"
        icon="cog"
        className="planner-settings-dialog"
      >
        <DialogBody>
          <FormGroup
            label="Model"
            labelFor="model-select"
            helperText="Select the AI model for plan generation"
          >
            <HTMLSelect
              id="model-select"
              value={tempConfig.model}
              onChange={(e) => updateTempConfig("model", e.target.value)}
              fill
              options={modelRegistry}
            />
          </FormGroup>

          <FormGroup
            label="Temperature"
            labelFor="temperature-input"
            helperText="Controls randomness (0.0 = deterministic, 1.0 = creative)"
          >
            <InputGroup
              id="temperature-input"
              type="number"
              value={tempConfig.temperature}
              onChange={(e) =>
                updateTempConfig("temperature", parseFloat(e.target.value) || 0)
              }
              min={0}
              max={1}
              step={0.1}
              fill
            />
          </FormGroup>
        </DialogBody>

        <DialogFooter
          actions={
            <>
              <Button
                onClick={() => {
                  logButtonClick(sessionId, "cancel_planner_settings");
                  handleCancelSettings();
                }}
              >
                Cancel
              </Button>
              <Button
                intent={Intent.PRIMARY}
                onClick={() => {
                  logButtonClick(sessionId, "save_planner_settings", {
                    model: tempConfig.model,
                    temperature: tempConfig.temperature,
                  });
                  handleSavePlannerSettings();
                }}
              >
                Save
              </Button>
            </>
          }
        />
      </Dialog>

      <div className="conversation-content">
        <div className="messages-container">
          {conversationHistory.length === 0 ? (
            <div className="empty-state">
              <Icon icon="lightbulb" size={48} />
              <h4>Start Planning</h4>
            </div>
          ) : (
            conversationHistory.map((entry, index) => {
              // Skip invisible messages (they exist for workflow consistency but shouldn't be displayed)
              if (entry.type === "invisible") {
                return null;
              }

              return (
                <div key={index} className={`message ${entry.type}`}>
                  {entry.type === "user_interaction" ? (
                    // User interaction: no card, just plain text (WeChat style)
                    <div
                      className="message-content"
                      dangerouslySetInnerHTML={{ __html: entry.message }}
                    />
                  ) : entry.type === "execution" ? (
                    // Execution: with card (old user_interaction style)
                    <Card elevation={Elevation.ONE}>
                      <div className="message-header">
                        <Icon icon="play" size={16} />
                        <span className="message-sender">Execution</span>
                        <span className="message-timestamp">
                          {formatTimestamp(entry.timestamp)}
                        </span>
                      </div>
                      <div
                        className="message-content"
                        dangerouslySetInnerHTML={{ __html: entry.message }}
                      />
                    </Card>
                  ) : entry.type === "plan-modification-warning" ? (
                    // Plan modification warning: foldable card. Currently dormant — no code creates this type, but kept for future backend-emitted warnings.
                    <Card elevation={Elevation.ONE} className="warning-card">
                      <div
                        className="message-header warning-header"
                        onClick={() =>
                          setExpandedWarnings((prev) => ({
                            ...prev,
                            [index]: !prev[index],
                          }))
                        }
                        style={{ cursor: "pointer" }}
                      >
                        <Icon
                          icon={
                            expandedWarnings[index]
                              ? "chevron-down"
                              : "chevron-right"
                          }
                          size={16}
                        />
                        <Icon
                          icon="warning-sign"
                          size={16}
                          intent={Intent.WARNING}
                        />
                        <span className="message-sender"> Warning</span>
                        <span className="message-timestamp">
                          {formatTimestamp(entry.timestamp)}
                        </span>
                      </div>
                      <Collapse isOpen={expandedWarnings[index]}>
                        <div
                          className="message-content warning-content"
                          dangerouslySetInnerHTML={{ __html: entry.message }}
                        />
                      </Collapse>
                    </Card>
                  ) : (
                    // Regular messages: with card
                    <Card elevation={Elevation.ONE}>
                      <div className="message-header">
                        <Icon
                          icon={
                            entry.type === "user"
                              ? "person"
                              : "automatic-updates"
                          }
                          size={16}
                        />
                        <span className="message-sender">
                          {entry.type === "user" ? "You" : "Assistant"}
                        </span>
                        <span className="message-timestamp">
                          {formatTimestamp(entry.timestamp)}
                        </span>
                      </div>
                      <div
                        className="message-content"
                        dangerouslySetInnerHTML={{ __html: entry.message }}
                      />
                    </Card>
                  )}
                </div>
              );
            })
          )}

          {isLoading && (
            <div className="message assistant loading">
              <Card elevation={Elevation.ONE}>
                <div className="message-header">
                  <Icon icon="automatic-updates" size={16} />
                  <span className="message-sender">Assistant</span>
                </div>
                <div className="message-content">
                  <Spinner size={16} />
                  <span>{loadingMessage}</span>
                </div>
              </Card>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="message-input">
          <div className="input-container">
            <TextArea
              ref={textAreaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe what you want to plan or ask a question..."
              disabled={isLoading}
              fill
            />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--sp-sm)",
              }}
            >
              <Button
                intent={Intent.PRIMARY}
                icon="send-message"
                onClick={() => {
                  logButtonClick(sessionId, "generate_plan", {
                    messageLength: message.trim().length,
                  });
                  handleGeneratePlan();
                }}
                disabled={!message.trim() || isLoading}
                loading={isLoading}
              >
                Generate Plan
              </Button>
              <Button
                intent={Intent.PRIMARY}
                icon="repeat"
                onClick={() => {
                  const totalNodes = planData?.nodes?.length || 0;
                  logButtonClick(sessionId, "entire_replan", {
                    messageLength: message.trim().length,
                    totalNodes,
                  });
                  handleEntireReplan();
                }}
                disabled={!message.trim() || isLoading}
                loading={isLoading}
              >
                Entire Replan
              </Button>
              <Button
                intent={Intent.PRIMARY}
                icon="target"
                onClick={() => {
                  const selectedCount =
                    planData?.nodes?.filter((n) => n.isSelected).length || 0;
                  const totalNodes = planData?.nodes?.length || 0;
                  logButtonClick(sessionId, "target_replan", {
                    messageLength: message.trim().length,
                    selectedCount,
                    totalNodes,
                  });
                  handleTargetReplan();
                }}
                disabled={!message.trim() || isLoading}
                loading={isLoading}
              >
                Target Replan
              </Button>
            </div>
          </div>

          {/* <div className="input-hints">
            <small>
              Press Enter to send, Shift+Enter for new line
            </small>
          </div> */}
        </div>
      </div>
    </div>
  );
};

export default ConversationPanel;
