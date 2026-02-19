"""
WebSense-AI Form Filling Chain — Graph Assembly

Assembles the complete LangGraph pipeline with 6 nodes and
conditional routing logic. Compiles with MemorySaver for
multi-turn conversation persistence.

Graph Flow:
    intake → extract → match_selectors → confirm
                                              ↓
                                         (conditional)
                                              ↓
    ┌─────────────────┬──────────────────────┼──────────────────┐
    ↓                 ↓                      ↓                  ↓
  correction       output                  END           (needs_clarification)
    ↓                 ↓                                         ↓
  confirm            END                                    (return to user,
    ↑                                                       resume on next turn)
    └─────────────────┘
"""

from typing import Literal

from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

from .state import WebSenseState
from .nodes import (
    intake_node,
    extract_node,
    match_selectors_node,
    confirm_node,
    correction_node,
    output_node,
)


# ============================================================
# CONDITIONAL ROUTING FUNCTIONS
# ============================================================

def route_after_confirm(state: WebSenseState) -> Literal["output", "correction", END]:
    """
    Determines routing after the confirm_node based on state flags.

    Routing Logic:
        - If correction_mode = True → go to correction_node
        - If needs_clarification = True → END (pause for user input)
        - If ready_to_fill = True → go to output_node
        - Default → END (safety fallback)

    Args:
        state: Current graph state after confirm_node execution.

    Returns:
        Next node name or END constant.
    """
    correction_mode = state.get("correction_mode", False)
    needs_clarification = state.get("needs_clarification", False)
    ready_to_fill = state.get("ready_to_fill", False)

    # Priority 1: Handle corrections
    if correction_mode:
        return "correction"

    # Priority 2: Pause for user clarification
    if needs_clarification:
        return END

    # Priority 3: Ready to generate output
    if ready_to_fill:
        return "output"

    # Safety fallback: pause if unclear
    return END


# ============================================================
# GRAPH CONSTRUCTION
# ============================================================

def build_form_filling_graph() -> StateGraph:
    """
    Constructs the complete form filling LangGraph.

    Nodes:
        1. intake           — Sanitize transcript, detect sensitive data
        2. extract          — LLM extraction of field values
        3. match_selectors  — Map fields to CSS selectors
        4. confirm          — Review confidence and completeness
        5. correction       — Handle user corrections
        6. output           — Assemble final payload

    Edges:
        intake → extract
        extract → match_selectors
        match_selectors → confirm
        confirm → [conditional: output | correction | END]
        correction → confirm (loop back)
        output → END

    Returns:
        Compiled StateGraph ready for invocation with MemorySaver.
    """
    # Initialize graph with state schema
    graph = StateGraph(WebSenseState)

    # Add all 6 nodes
    graph.add_node("intake", intake_node)
    graph.add_node("extract", extract_node)
    graph.add_node("match_selectors", match_selectors_node)
    graph.add_node("confirm", confirm_node)
    graph.add_node("correction", correction_node)
    graph.add_node("output", output_node)

    # Set entry point
    graph.set_entry_point("intake")

    # Add sequential edges
    graph.add_edge("intake", "extract")
    graph.add_edge("extract", "match_selectors")
    graph.add_edge("match_selectors", "confirm")

    # Add conditional routing from confirm node
    graph.add_conditional_edges(
        "confirm",
        route_after_confirm,
        {
            "output": "output",
            "correction": "correction",
            END: END,
        }
    )

    # Correction loops back to confirm for re-validation
    graph.add_edge("correction", "confirm")

    # Output is terminal
    graph.add_edge("output", END)

    return graph


# ============================================================
# COMPILED GRAPH WITH MEMORY
# ============================================================

# Initialize checkpointer for multi-turn conversation memory
checkpointer = MemorySaver()

# Build and compile the graph
workflow = build_form_filling_graph()
compiled_graph = workflow.compile(checkpointer=checkpointer)


# ============================================================
# INVOCATION INTERFACE
# ============================================================

def invoke_form_filling(
    transcript: str,
    page_fields: list[dict],
    session_id: str,
    user_id: str = "default_user",
    user_response: str = "",
    correction_mode: bool = False,
) -> dict:
    """
    Invokes the form filling chain with multi-turn memory persistence.

    Uses session_id as the thread identifier for MemorySaver,
    enabling conversation state to persist across multiple turns.

    Args:
        transcript: Raw voice transcript from the user.
        page_fields: List of form field metadata from DOM scan.
        session_id: Unique session ID (used as LangGraph thread_id).
        user_id: User identifier for profile storage. Defaults to "default_user".
        user_response: User's response to clarification question (for multi-turn).
        correction_mode: Set True when user wants to correct a field.

    Returns:
        Dict containing either:
            - {"status": "success", "payload": {...}} when ready to fill
            - {"status": "needs_input", "question": "...", "partial": {...}}
              when clarification is needed
            - {"status": "error", "message": "..."} on failure

    Example:
        # Turn 1 - Initial input
        result = invoke_form_filling(
            transcript="My name is Ahmed Khan",
            page_fields=[{"id": "name", "name": "fullName", ...}],
            session_id="abc-123",
        )
        # May return: {"status": "needs_input", "question": "What is your email?"}

        # Turn 2 - Answer clarification
        result = invoke_form_filling(
            transcript="ahmed@example.com",
            page_fields=[...],
            session_id="abc-123",  # Same session ID
        )
        # May return: {"status": "success", "payload": {"fields_to_fill": ...}}

        # Turn 3 - Make a correction
        result = invoke_form_filling(
            transcript="wait, change my name to Muhammad Khan",
            page_fields=[...],
            session_id="abc-123",
            correction_mode=True,
        )
        # Updates only the name field, preserves email
    """
    try:
        # Build initial state
        initial_state: WebSenseState = {
            "raw_transcript": transcript,
            "page_fields": page_fields,
            "session_id": session_id,
            "user_id": user_id,
            "user_response": user_response,
            "correction_mode": correction_mode,
        }

        # Configure thread for multi-turn memory
        config = {
            "configurable": {
                "thread_id": session_id,  # Use session_id as thread identifier
            }
        }

        # Invoke the graph with checkpointer
        final_state = compiled_graph.invoke(initial_state, config)

        # Check if we need clarification
        if final_state.get("needs_clarification"):
            return {
                "status": "needs_input",
                "question": final_state.get("clarification_question", "Could you provide more information?"),
                "partial": final_state.get("extracted_fields", {}),
                "missing": final_state.get("missing_fields", []),
            }

        # Check if we have a final payload
        if final_state.get("final_payload"):
            return {
                "status": "success",
                "payload": final_state["final_payload"],
            }

        # Fallback: something went wrong
        error_msg = final_state.get("error_message", "Unknown error")
        return {
            "status": "error",
            "message": f"Form filling incomplete: {error_msg}",
        }

    except Exception as e:
        return {
            "status": "error",
            "message": f"Graph invocation failed: {str(e)}",
        }


def clear_session(session_id: str) -> None:
    """
    Clears the conversation memory for a specific session.

    Called when a tab closes or user explicitly resets the session.

    Args:
        session_id: The session to clear from MemorySaver.
    """
    # Note: MemorySaver in LangGraph doesn't have a direct clear method
    # for specific threads. Memory is in-memory and cleared on process restart.
    # For production, you'd use a persistent checkpointer (e.g., SqliteSaver)
    # with explicit deletion capabilities.
    #
    # For now, this is a placeholder. Memory will be GC'd naturally.
    pass


# ============================================================
# EXPORTS
# ============================================================

__all__ = [
    "compiled_graph",
    "invoke_form_filling",
    "clear_session",
]
