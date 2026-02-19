"""
WebSense-AI Form Filling State Definition

Defines the TypedDict state object used by the LangGraph form filling chain.
All nodes read from and write to this shared state.
"""

from typing import TypedDict, Optional


class FieldData(TypedDict, total=False):
    """Represents a single extracted form field with metadata."""
    value: str
    confidence: float
    source_text: str
    selectors: list[str]


class WebSenseState(TypedDict, total=False):
    """
    Complete state object for the form filling LangGraph chain.

    Flows through all 6 nodes:
        intake -> extract -> match_selectors -> confirm -> correction/output

    Attributes:
        raw_transcript: Original voice transcript from the user (never sent to LLM).
        page_fields: DOM field metadata scanned from the active page.
        session_id: Unique session identifier, used as LangGraph thread ID.
        user_id: Identifier for the current user (for profile storage).
        contains_sensitive: Flag set True when sensitive data patterns are detected.
        sanitized_transcript: Transcript with sensitive data replaced by [REDACTED].
        extracted_fields: Dict of field_name -> FieldData extracted by the LLM.
        matched_selectors: Dict of field_name -> list of CSS selectors for DOM targeting.
        confidence_scores: Dict of field_name -> float confidence values.
        missing_fields: List of field names that still need values.
        conversation_history: List of past turns for multi-turn memory.
        turn_count: Number of conversation turns completed.
        clarification_question: Question to ask the user when data is missing.
        user_response: The user's reply to a clarification question or correction.
        needs_clarification: Flag indicating the chain should pause for user input.
        correction_mode: Flag indicating the user wants to correct a specific field.
        confirmed: Flag indicating the user has confirmed the filled values.
        ready_to_fill: Flag indicating all fields are confident and ready to inject.
        final_payload: The assembled JSON payload sent to the Chrome extension.
        error_message: Human-readable error message if something fails.
        fill_report: Report from content script on which fields were filled/missed.
    """

    # --- Input ---
    raw_transcript: str
    page_fields: list[dict]
    session_id: str
    user_id: str

    # --- Sensitive Data Handling ---
    contains_sensitive: bool
    sanitized_transcript: str

    # --- Extraction ---
    extracted_fields: dict[str, FieldData]
    matched_selectors: dict[str, list[str]]
    confidence_scores: dict[str, float]
    missing_fields: list[str]

    # --- Conversation Memory ---
    conversation_history: list[dict]
    turn_count: int

    # --- Clarification / Correction ---
    clarification_question: str
    user_response: str
    needs_clarification: bool
    correction_mode: bool
    confirmed: bool

    # --- Output ---
    ready_to_fill: bool
    final_payload: dict
    error_message: str
    fill_report: dict
