"""
WebSense-AI Form Filling Chain — Graph Assembly

Assembles the LangGraph pipeline with router-based orchestration
and 9 nodes.  Compiles with MemorySaver for multi-turn
conversation persistence.

Graph Flow:
    START → router → [conditional edges]:

    "extract"       → intake → extract → match_selectors → review → END
    "confirm"       → confirm_handler → [fill → END | END]
    "correction"    → correction_handler → [review → END | END]
    "spell_command" → spell_readout → END

Conversation Phases (persisted across turns via MemorySaver):
    idle           — waiting for user input
    confirming     — extracted fields shown, awaiting yes/no
    correcting     — user said no, bot asks which field
    spelling       — collecting letters for correction
    spell_confirm  — confirming the new spelling
"""

from typing import Literal, Optional

from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

from .state import WebSenseState
from .nodes import (
    router_node,
    intake_node,
    extract_node,
    match_selectors_node,
    review_node,
    confirm_handler_node,
    correction_handler_node,
    fill_node,
    spell_readout_node,
)


# ============================================================
# CONDITIONAL ROUTING FUNCTIONS
# ============================================================

def route_decision(state: WebSenseState) -> str:
    """Read router_node's decision from state.next_route."""
    return state.get("next_route", "extract")


def confirm_decision(state: WebSenseState) -> str:
    """After confirm_handler: 'fill' → fill_node, 'end' → END."""
    return state.get("confirm_route", "end")


def correction_decision(state: WebSenseState) -> str:
    """After correction_handler: 'review' → review_node, 'end' → END."""
    return state.get("correction_route", "end")


# ============================================================
# GRAPH CONSTRUCTION
# ============================================================

def build_form_filling_graph() -> StateGraph:
    """
    Constructs the router-based form filling LangGraph.

    Nodes:
        0. router              — Decide route based on conversation_phase
        1. intake              — Sanitize transcript, detect sensitive data
        2. extract             — LLM extraction of field values
        3. match_selectors     — Map fields to CSS selectors
        4. review              — Build confirmation summary
        5. confirm_handler     — Handle yes/no during confirmation
        6. correction_handler  — Handle correction + spelling flow
        7. fill                — Assemble fill payload
        8. spell_readout       — Handle "spell <field>" command

    Returns:
        Compiled StateGraph ready for invocation with MemorySaver.
    """
    graph = StateGraph(WebSenseState)

    # ── Add all 9 nodes ──
    graph.add_node("router", router_node)
    graph.add_node("intake", intake_node)
    graph.add_node("extract", extract_node)
    graph.add_node("match_selectors", match_selectors_node)
    graph.add_node("review", review_node)
    graph.add_node("confirm_handler", confirm_handler_node)
    graph.add_node("correction_handler", correction_handler_node)
    graph.add_node("fill", fill_node)
    graph.add_node("spell_readout", spell_readout_node)

    # ── Entry point ──
    graph.set_entry_point("router")

    # ── Router conditional edges ──
    graph.add_conditional_edges(
        "router",
        route_decision,
        {
            "extract": "intake",
            "confirm": "confirm_handler",
            "correction": "correction_handler",
            "spell_command": "spell_readout",
        },
    )

    # ── Extraction pipeline ──
    graph.add_edge("intake", "extract")
    graph.add_edge("extract", "match_selectors")
    graph.add_edge("match_selectors", "review")
    graph.add_edge("review", END)

    # ── Confirm handler → conditional ──
    graph.add_conditional_edges(
        "confirm_handler",
        confirm_decision,
        {
            "fill": "fill",
            "end": END,
        },
    )
    graph.add_edge("fill", END)

    # ── Correction handler → conditional ──
    graph.add_conditional_edges(
        "correction_handler",
        correction_decision,
        {
            "review": "review",
            "end": END,
        },
    )

    # ── Spell readout ──
    graph.add_edge("spell_readout", END)

    return graph


# ============================================================
# COMPILED GRAPH WITH MEMORY
# ============================================================

checkpointer = MemorySaver()
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
    resume_state: Optional[dict] = None,
) -> dict:
    """
    Invokes the form filling chain with multi-turn memory persistence.

    The router reads the persisted conversation_phase to decide the
    route.  On a new session the phase defaults to "idle" which routes
    to the extraction pipeline.  On subsequent turns (confirming,
    correcting, spelling), the router routes to the appropriate handler.

    Args:
        transcript: Raw voice / text input from the user.
        page_fields: DOM field metadata list from content.js.
        session_id: Unique session ID (used as LangGraph thread_id).
        user_id: User identifier.  Defaults to "default_user".

    Returns:
        Dict with:
            - bot_response: structured BotResponse for frontend
            - state_snapshot: persisted conversational state for next turn
    """
    try:
        restored_state = resume_state.copy() if isinstance(resume_state, dict) else {}

        # Merge restored conversational state with current turn input
        initial_state: WebSenseState = {
            **restored_state,
            "raw_transcript": transcript,
            "page_fields": page_fields,
            "session_id": session_id,
            "user_id": user_id,
        }

        config = {
            "configurable": {
                "thread_id": session_id,
            }
        }

        final_state = compiled_graph.invoke(initial_state, config)

        # Return structured bot_response + state snapshot for persistence
        bot_response = final_state.get("bot_response")
        state_snapshot = {
            "conversation_phase": final_state.get("conversation_phase", "idle"),
            "extracted_fields": final_state.get("extracted_fields", {}),
            "matched_selectors": final_state.get("matched_selectors", {}),
            "confidence_scores": final_state.get("confidence_scores", {}),
            "missing_fields": final_state.get("missing_fields", []),
            "conversation_history": final_state.get("conversation_history", []),
            "turn_count": final_state.get("turn_count", 0),
            "correcting_field_key": final_state.get("correcting_field_key", ""),
            "spelling_buffer": final_state.get("spelling_buffer", ""),
        }

        if bot_response:
            return {
                "bot_response": bot_response,
                "state_snapshot": state_snapshot,
            }

        # Fallback when no bot_response was set
        return {
            "bot_response": {
                "action": "error",
                "message": final_state.get("error_message", "Something went wrong. Please try again."),
                "status_text": "Error",
            },
            "state_snapshot": state_snapshot,
        }

    except Exception as e:
        return {
            "bot_response": {
                "action": "error",
                "message": f"Processing failed: {str(e)}",
                "status_text": "Error",
            },
            "state_snapshot": resume_state or {},
        }


def clear_session(session_id: str) -> None:
    """
    Clears conversation memory for a session.

    MemorySaver is in-process; memory clears on restart.
    For production, swap to SqliteSaver / RedisSaver and implement
    explicit deletion.
    """
    pass


# ============================================================
# EXPORTS
# ============================================================

__all__ = [
    "compiled_graph",
    "invoke_form_filling",
    "clear_session",
]
