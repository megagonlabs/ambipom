/**
 * Logs a button click to the backend
 * @param {string} sessionId - The current session ID
 * @param {string} buttonName - Name of the button clicked
 * @param {object} context - Optional context data (e.g., nodeId, count, etc.)
 */
export async function logButtonClick(sessionId, buttonName, context = {}) {
  if (!sessionId) {
    console.warn("[ButtonLogger] Cannot log button click: No session ID");
    return;
  }

  try {
    await fetch("/api/log-button-click", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: sessionId,
        button_name: buttonName,
        context: context,
      }),
    });

    console.log(`[ButtonLogger] Logged: ${buttonName}`, context);
  } catch (error) {
    console.error(`[ButtonLogger] Error logging ${buttonName}:`, error);
  }
}
