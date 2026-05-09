// components/UndoRedoControl.jsx
import { Button, Popover, Tooltip } from "@blueprintjs/core";
import { useCallback, useEffect, useState } from "react";
import { sendGetUndoRedoHistory } from "../services/backendApi";
import { logButtonClick } from "../utils/buttonLogger";
import "./UndoRedoControl.css";

const UndoRedoControl = ({
  sessionId,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  conversationHistory, // Use conversation history to detect changes
  onCurrentActionChange, // Callback to notify parent of current action
}) => {
  const [undoHistory, setUndoHistory] = useState([]);
  const [redoHistory, setRedoHistory] = useState([]);
  const [isUndoOpen, setIsUndoOpen] = useState(false);
  const [isRedoOpen, setIsRedoOpen] = useState(false);
  const [currentAction, setCurrentAction] = useState("");

  // Fetch history from backend
  const fetchHistory = useCallback(async () => {
    if (!sessionId) return;

    try {
      const response = await sendGetUndoRedoHistory(sessionId);
      if (response.status === "success") {
        const { history, current_index } = response;

        // Split history into undo and redo lists based on current_index
        // Undo list: from index 0 to current_index (exclusive), reversed to show most recent first
        // We exclude current_index (current state) from undo
        const undo = history.slice(1, current_index + 1).reverse();
        // Redo list: from current_index + 1 to end
        const redo = history.slice(current_index + 1);

        setUndoHistory(undo);
        setRedoHistory(redo);

        // Set current action description from the current index
        const action =
          current_index >= 0 && current_index < history.length
            ? history[current_index].summary
            : "";

        setCurrentAction(action);

        // Notify parent component
        if (onCurrentActionChange) {
          onCurrentActionChange(action);
        }
      }
    } catch (error) {
      console.error("Failed to fetch undo/redo history:", error);
    }
  }, [sessionId, onCurrentActionChange]);

  // Fetch history on mount and when undo/redo state changes or conversation length changes
  useEffect(() => {
    fetchHistory();
  }, [fetchHistory, canUndo, canRedo, conversationHistory?.length]);

  // Also fetch when dropdowns are opened to ensure fresh data
  useEffect(() => {
    if (isUndoOpen) {
      fetchHistory();
    }
  }, [isUndoOpen, fetchHistory]);

  useEffect(() => {
    if (isRedoOpen) {
      fetchHistory();
    }
  }, [isRedoOpen, fetchHistory]);

  // Auto-collapse dropdowns when they become disabled
  useEffect(() => {
    if (!canUndo && isUndoOpen) {
      setIsUndoOpen(false);
    }
  }, [canUndo, isUndoOpen]);

  useEffect(() => {
    if (!canRedo && isRedoOpen) {
      setIsRedoOpen(false);
    }
  }, [canRedo, isRedoOpen]);

  const undoNext =
    canUndo && undoHistory.length > 0 ? undoHistory[0].summary : "";
  const redoNext =
    canRedo && redoHistory.length > 0 ? redoHistory[0].summary : "";

  const renderHistoryList = (items, emptyText) => (
    <div className="history-list-popover">
      {items.length === 0 ? (
        <div className="empty-state-horizontal">{emptyText}</div>
      ) : (
        items.map((item, index) => (
          <div
            key={item.index}
            className={`history-item-horizontal ${index === 0 ? "next-action" : ""}`}
            title={item.summary}
          >
            <span className="history-text">{item.summary}</span>
          </div>
        ))
      )}
    </div>
  );

  return (
    <div className="undo-redo-control-horizontal">
      {/* Undo next-action label — hover to see full history */}
      <Popover
        interactionKind="hover"
        placement="bottom-start"
        disabled={!canUndo}
        content={renderHistoryList(undoHistory, "No undo history")}
        hoverOpenDelay={150}
        hoverCloseDelay={100}
      >
        <div
          className={`history-label undo-label ${canUndo ? "" : "disabled"}`}
        >
          <span className="preview-text">
            {undoNext || (canUndo ? "Undo" : "")}
          </span>
        </div>
      </Popover>

      {/* Undo Button */}
      <Tooltip content="Undo (Ctrl+Z / Cmd+Z)">
        <Button
          icon="undo"
          onClick={() => {
            logButtonClick(sessionId, "undo", {
              undoHistoryCount: undoHistory.length,
              nextAction: undoHistory.length > 0 ? undoHistory[0].summary : "",
            });
            onUndo();
          }}
          disabled={!canUndo}
          minimal
          className="action-button"
        />
      </Tooltip>

      {/* Redo Button */}
      <Tooltip content="Redo (Ctrl+Shift+Z / Cmd+Shift+Z)">
        <Button
          icon="redo"
          onClick={() => {
            logButtonClick(sessionId, "redo", {
              redoHistoryCount: redoHistory.length,
              nextAction: redoHistory.length > 0 ? redoHistory[0].summary : "",
            });
            onRedo();
          }}
          disabled={!canRedo}
          minimal
          className="action-button"
        />
      </Tooltip>

      {/* Redo next-action label — hover to see full history */}
      <Popover
        interactionKind="hover"
        placement="bottom-end"
        disabled={!canRedo}
        content={renderHistoryList(redoHistory, "No redo history")}
        hoverOpenDelay={150}
        hoverCloseDelay={100}
      >
        <div
          className={`history-label redo-label ${canRedo ? "" : "disabled"}`}
        >
          <span className="preview-text">
            {redoNext || (canRedo ? "Redo" : "")}
          </span>
        </div>
      </Popover>
    </div>
  );
};

export default UndoRedoControl;
