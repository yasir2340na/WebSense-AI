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


class BotResponse(TypedDict, total=False):
    """Structured response returned to the Chrome extension frontend."""
    action: str          # "greeting"|"show_fields"|"confirm_fill"|"ask_correction"|"ask_spelling"|"confirm_spelling"|"execute_fill"|"spell_readout"|"error"
    message: str         # HTML-safe bot message to display in chat
    fields_summary: dict # Pretty-name → value for display
    fields_to_fill: dict # Raw field payloads for content.js (only when action="execute_fill")
    summary: dict        # Raw fieldKey → value
    missing_fields: list # List of pretty-name missing fields
    correcting_field: str     # Pretty-name of field being corrected
    current_value: str        # Current value of field being corrected
    spelled_value: str        # Accumulated / confirmed spelling
    spell_aloud: dict         # {"field": "...", "value": "..."} for TTS letter-by-letter
    speak_text: str           # Text for TTS to speak
    status_text: str          # Status bar text for panel


class WebSenseState(TypedDict, total=False):
    """
    Complete state object for the form filling LangGraph chain.

    Architecture — Router-based orchestration:
        START → router → [conditional]:
            "extract"       → intake → extract → match_selectors → review → END
            "confirm"       → confirm_handler → [fill | END]
            "correction"    → correction_handler → [review | END]
            "spell_command" → spell_readout → END

    Conversation Phases:
        idle           — waiting for user to speak/type form data
        confirming     — extracted fields shown, awaiting yes/no
        correcting     — user said no, bot asks which field is wrong
        spelling       — bot collecting letters from user
        spell_confirm  — bot spelled it back, awaiting yes/no

    Attributes:
        raw_transcript: Original voice transcript from the user.
        page_fields: DOM field metadata scanned from the active page.
        session_id: Unique session identifier, used as LangGraph thread ID.
        user_id: Identifier for the current user.
        contains_sensitive: True when sensitive data patterns are detected.
        sanitized_transcript: Transcript with sensitive data replaced.
        extracted_fields: Dict of field_name → FieldData.
        matched_selectors: Dict of field_name → CSS selectors.
        confidence_scores: Dict of field_name → float confidence.
        missing_fields: Field names that still need values.
        conversation_history: Past turns for multi-turn memory.
        turn_count: Number of turns completed.
        conversation_phase: Current phase of the conversation state machine.
        next_route: Internal routing decision for conditional edges.
        confirm_route: Sub-routing decision after confirm handler.
        correction_route: Sub-routing decision after correction handler.
        correcting_field_key: Raw key of field being corrected.
        spelling_buffer: Accumulated spelled letters.
        bot_response: Structured response to return to frontend.
        error_message: Human-readable error if something fails.
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

    # --- Orchestration (NEW — replaces old confirm/correction flags) ---
    conversation_phase: str       # "idle" | "confirming" | "correcting" | "spelling" | "spell_confirm"
    next_route: str               # Router decision for conditional edges
    confirm_route: str            # "fill" | "end" after confirm handler
    correction_route: str         # "review" | "end" after correction handler
    correcting_field_key: str     # Raw field key being corrected
    spelling_buffer: str          # Accumulated letters during spelling

    # --- Extraction Metadata ---
    extraction_method: str        # "regex" | "cohere_llm" | "regex_fallback"

    # --- Response ---
    bot_response: BotResponse     # Structured response for Chrome extension
    error_message: str
