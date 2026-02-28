"""
WebSense-AI Form Filling Chain — Node Functions

Orchestration-based architecture. The graph uses a router node to inspect
conversation_phase and route each user turn to the correct handler.

Nodes:
    1. router_node            — Inspects phase + input, sets next_route
    2. intake_node            — Sanitizes transcript, detects sensitive data
    3. extract_node           — Uses Cohere LLM to extract form field values
    4. match_selectors_node   — Maps fields to CSS selectors
    5. review_node            — Builds confirmation summary, sets phase="confirming"
    6. confirm_handler_node   — Handles yes/no during confirmation
    7. correction_handler_node — Handles correction identification + spelling flows
    8. fill_node              — Builds final fill payload
    9. spell_readout_node     — Reads out a filled field value via TTS
"""

import re
import json
import uuid
from typing import Any

from langchain_cohere import ChatCohere
from langchain_core.messages import SystemMessage, HumanMessage

from .state import WebSenseState


# ============================================================
# CONSTANTS
# ============================================================

CONFIDENCE_THRESHOLD = 0.85

SENSITIVE_PATTERNS = {
    "CREDIT_CARD": re.compile(r"\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b"),
    "SSN": re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    "PASSWORD": re.compile(r"password\s+is\s+\S+", re.IGNORECASE),
    "CVV": re.compile(r"\bcvv\s+is\s+\d{3,4}\b", re.IGNORECASE),
}

CORRECTION_KEYWORDS = [
    "wait", "change", "update", "actually",
    "no", "wrong", "fix", "correct",
]

# Priority-ordered CSS selectors per field type
FIELD_SELECTORS: dict[str, list[str]] = {
    "name": [
        "#name", "#fullName", "#full-name", "#full_name",
        "[name='name']", "[name='fullName']", "[name='full_name']",
        "[name='full-name']", "[autocomplete='name']",
        "input[placeholder*='name' i]", "input[aria-label*='name' i]",
    ],
    "first_name": [
        "#firstName", "#first-name", "#first_name", "#fname",
        "[name='firstName']", "[name='first_name']", "[name='fname']",
        "[autocomplete='given-name']",
        "input[placeholder*='first name' i]",
    ],
    "last_name": [
        "#lastName", "#last-name", "#last_name", "#lname",
        "[name='lastName']", "[name='last_name']", "[name='lname']",
        "[autocomplete='family-name']",
        "input[placeholder*='last name' i]",
    ],
    "email": [
        "#email", "#emailAddress", "#email-address",
        "[name='email']", "[name='emailAddress']",
        "[type='email']", "[autocomplete='email']",
        "input[placeholder*='email' i]",
    ],
    "phone": [
        "#phone", "#phoneNumber", "#phone-number", "#tel",
        "[name='phone']", "[name='phoneNumber']", "[name='tel']",
        "[type='tel']", "[autocomplete='tel']",
        "input[placeholder*='phone' i]",
    ],
    "address": [
        "#address", "#streetAddress", "#street-address", "#address1",
        "[name='address']", "[name='streetAddress']", "[name='address1']",
        "[autocomplete='street-address']",
        "input[placeholder*='address' i]", "textarea[placeholder*='address' i]",
    ],
    "city": [
        "#city", "#addressCity",
        "[name='city']", "[name='addressCity']",
        "[autocomplete='address-level2']",
        "input[placeholder*='city' i]",
    ],
    "state": [
        "#state", "#addressState", "#province",
        "[name='state']", "[name='addressState']", "[name='province']",
        "[autocomplete='address-level1']",
        "input[placeholder*='state' i]", "select[name*='state' i]",
    ],
    "zip": [
        "#zip", "#zipCode", "#zip-code", "#postalCode", "#postal-code",
        "[name='zip']", "[name='zipCode']", "[name='postalCode']",
        "[autocomplete='postal-code']",
        "input[placeholder*='zip' i]", "input[placeholder*='postal' i]",
    ],
    "country": [
        "#country", "#addressCountry",
        "[name='country']", "[name='addressCountry']",
        "[autocomplete='country']", "[autocomplete='country-name']",
        "select[name*='country' i]", "input[placeholder*='country' i]",
    ],
    "company": [
        "#company", "#organization", "#org",
        "[name='company']", "[name='organization']",
        "[autocomplete='organization']",
        "input[placeholder*='company' i]", "input[placeholder*='organization' i]",
    ],
}

# System prompt for the extract node LLM call
EXTRACT_SYSTEM_PROMPT = """You are a form-filling assistant for WebSense-AI.
Your job is to extract form field values from the user's voice transcript.

RULES:
- You will be given a list of "page_fields" — these are the ACTUAL input fields on the page.
  Each page field has: name, id, placeholder, label, autocomplete, type.
- IMPORTANT: Use the field's LABEL, PLACEHOLDER, and AUTOCOMPLETE attributes to understand
  what each field is for (e.g. "First Name", "Email", "Phone"). Do NOT fill fields positionally
  from top to bottom — match SEMANTICALLY based on meaning.
- Extract values ONLY for fields that exist on the page.
- Use the page field's "name" or "id" as the key in extracted_fields.
- Return a JSON object with this exact structure:
{
  "extracted_fields": {
    "<name_or_id_from_page_field>": {
      "value": "extracted value",
      "confidence": 0.95,
      "source_text": "the part of the transcript this came from"
    }
  },
  "missing_fields": ["field_name_1", "field_name_2"],
  "needs_clarification": true/false,
  "clarification_question": "What is your email address?"
}

- Use the field's name or id EXACTLY as provided in page_fields.
- Match values to fields by their MEANING, not their position:
  * If a field has label "First Name" and the user says "my first name is Yasir Ali",
    put "Yasir Ali" in that field (not split across fields).
  * If a field has label "Last Name" and the user says "last name is naich",
    put "naich" in the Last Name field.
  * Always look at label, placeholder, aria-label, and autocomplete to determine field purpose.
- Confidence should be 0.0-1.0 based on how certain you are.
- missing_fields lists required page fields the user has NOT provided values for.
  Only list fields that have isRequired=true and have label/placeholder indicating user data.
  Do NOT list structural fields (checkboxes, submit buttons, hidden fields) as missing.
- If truly critical fields are missing, set needs_clarification to true and ask.
- NEVER invent or guess values. Only use what the user explicitly said.
- The transcript may contain [REDACTED] markers — ignore those.
- Return ONLY valid JSON, no markdown, no explanation.
"""

# System prompt for the correction node LLM call
CORRECTION_SYSTEM_PROMPT = """You are a form-filling correction assistant for WebSense-AI.
The user wants to change a specific field value they previously provided.

Given the user's correction statement and the current field values,
identify WHICH field the user wants to change and what the NEW value should be.

Return ONLY valid JSON:
{
  "corrected_field": "field_name",
  "new_value": "the new value",
  "confidence": 0.95
}

- Only correct ONE field per request.
- If you cannot determine which field to correct, return:
  {"corrected_field": null, "new_value": null, "confidence": 0.0}
- Return ONLY valid JSON, no markdown, no explanation.
"""


# ============================================================
# NODE 1: INTAKE
# ============================================================

def intake_node(state: WebSenseState) -> dict[str, Any]:
    """
    Receives raw transcript and page fields.
    Scans for sensitive data patterns and sanitizes the transcript.
    Initializes conversation tracking if this is the first turn.

    Security: Sensitive patterns (credit cards, SSNs, passwords, CVVs)
    are replaced with [TYPE_REDACTED] tokens before any downstream processing.

    Args:
        state: Current graph state with raw_transcript and page_fields.

    Returns:
        Dict of state updates: sanitized_transcript, contains_sensitive,
        turn_count, conversation_history, session_id.
    """
    raw_transcript: str = state.get("raw_transcript", "")
    conversation_history: list[dict] = state.get("conversation_history", [])
    turn_count: int = state.get("turn_count", 0)
    session_id: str = state.get("session_id", "")

    # Initialize session ID if not provided
    if not session_id:
        session_id = str(uuid.uuid4())

    # Detect and redact sensitive data
    contains_sensitive = False
    sanitized = raw_transcript

    for data_type, pattern in SENSITIVE_PATTERNS.items():
        if pattern.search(sanitized):
            contains_sensitive = True
            sanitized = pattern.sub(f"[{data_type}_REDACTED]", sanitized)

    # Update conversation history with this turn
    turn_count += 1
    conversation_history = conversation_history.copy()
    conversation_history.append({
        "turn": turn_count,
        "role": "user",
        "content": sanitized,  # Only store sanitized version
    })

    return {
        "sanitized_transcript": sanitized,
        "contains_sensitive": contains_sensitive,
        "turn_count": turn_count,
        "conversation_history": conversation_history,
        "session_id": session_id,
    }


# ============================================================
# NODE 2: EXTRACT
# ============================================================

def extract_node(state: WebSenseState) -> dict[str, Any]:
    """
    Uses Cohere (command-a-03-2025) to extract form field values
    from the sanitized transcript. NEVER receives raw transcript.

    Includes page_fields context so the LLM knows which fields exist
    on the page, and full conversation_history for multi-turn memory.

    Falls back to regex extraction if LLM returns invalid JSON.

    Args:
        state: Current graph state with sanitized_transcript, page_fields,
               and conversation_history.

    Returns:
        Dict of state updates: extracted_fields, missing_fields,
        conversation_history.
    """
    sanitized_transcript: str = state.get("sanitized_transcript", "")
    page_fields: list[dict] = state.get("page_fields", [])
    conversation_history: list[dict] = state.get("conversation_history", [])
    existing_fields: dict = state.get("extracted_fields", {})

    # Fast-path: local regex extraction first to avoid LLM latency on common phrases.
    # This keeps the chat responsive for inputs like:
    # "my first name is Yasir", "email is a@b.com", "phone is ...".
    quick_fields = _regex_fallback_extract(sanitized_transcript)
    if quick_fields:
        merged_fields = {**existing_fields, **quick_fields}

        conversation_history = conversation_history.copy()
        conversation_history.append({
            "turn": state.get("turn_count", 1),
            "role": "assistant",
            "content": f"Fast-extracted: {list(quick_fields.keys())}",
        })

        return {
            "extracted_fields": merged_fields,
            "missing_fields": [f.get("name", "") or f.get("id", "") for f in page_fields if (f.get("name", "") or f.get("id", "")) not in merged_fields],
            "conversation_history": conversation_history,
            "error_message": "",
        }

    # Build field context for the LLM — give it full page field details
    # Emphasize the label/meaning to help semantic matching
    field_descriptions = []
    for f in page_fields:
        field_id = f.get("id", "")
        field_name = f.get("name", "")
        label = f.get("label", "") or f.get("placeholder", "") or f.get("ariaLabel", "")
        desc = {
            "key_to_use": field_name or field_id,  # This is what the LLM should use as extraction key
            "label_meaning": label,  # This tells the LLM what the field is FOR
            "name": field_name,
            "id": field_id,
            "type": f.get("type", "text"),
            "placeholder": f.get("placeholder", ""),
            "label": f.get("label", ""),
            "autocomplete": f.get("autocomplete", ""),
            "isRequired": f.get("isRequired", False),
        }
        field_descriptions.append(desc)

    field_context = (
        f"Page fields below. IMPORTANT: Use the 'key_to_use' value (name or id) as the "
        f"JSON key, but match user data to the field based on 'label_meaning' "
        f"(e.g. if label_meaning is 'First Name' and user says 'my first name is X', "
        f"map X to that field's key_to_use):\n"
        f"{json.dumps(field_descriptions, indent=2)}"
    )

    # Build conversation context
    history_text = ""
    for entry in conversation_history:
        role = entry.get("role", "user")
        content = entry.get("content", "")
        history_text += f"{role}: {content}\n"

    # Construct the user message
    user_message = (
        f"Conversation so far:\n{history_text}\n\n"
        f"{field_context}\n\n"
        f"Latest user input: {sanitized_transcript}\n\n"
        f"Already extracted fields: {json.dumps(existing_fields)}\n\n"
        f"Extract all form field values from the conversation. "
        f"Merge with already extracted fields."
    )

    try:
        llm = ChatCohere(model="command-a-03-2025", temperature=0)
        response = llm.invoke([
            SystemMessage(content=EXTRACT_SYSTEM_PROMPT),
            HumanMessage(content=user_message),
        ])

        response_text = response.content.strip()

        # Try to parse JSON from response
        parsed = _parse_llm_json(response_text)

        extracted = parsed.get("extracted_fields", {})
        missing = parsed.get("missing_fields", [])

        # Merge with existing fields (preserve previous turns)
        merged_fields = {**existing_fields, **extracted}

        # Update conversation history with assistant response
        conversation_history = conversation_history.copy()
        conversation_history.append({
            "turn": state.get("turn_count", 1),
            "role": "assistant",
            "content": f"Extracted: {list(extracted.keys())}",
        })

        return {
            "extracted_fields": merged_fields,
            "missing_fields": missing,
            "conversation_history": conversation_history,
            "error_message": "",
        }

    except Exception as e:
        # Fallback: try regex-based extraction
        fallback_fields = _regex_fallback_extract(sanitized_transcript)
        merged_fields = {**existing_fields, **fallback_fields}

        return {
            "extracted_fields": merged_fields,
            "missing_fields": [f.get("name", "") or f.get("id", "") for f in page_fields],
            "error_message": f"LLM extraction failed: {str(e)}",
        }


# ============================================================
# NODE 3: SELECTOR MATCHING
# ============================================================

def match_selectors_node(state: WebSenseState) -> dict[str, Any]:
    """
    Maps each extracted field to CSS selectors for DOM targeting.

    Strategy (in priority order):
    1. Match extracted field name/id against actual page_fields from DOM scan.
       Use the page field's own reliable selector (computed by content.js).
    2. Try predefined selectors from FIELD_SELECTORS as fallback.
    3. Generate generic fallback selectors using wildcards.

    Args:
        state: Current graph state with extracted_fields and page_fields.

    Returns:
        Dict of state updates: matched_selectors, confidence_scores.
    """
    extracted_fields: dict = state.get("extracted_fields", {})
    page_fields: list[dict] = state.get("page_fields", [])

    matched_selectors: dict[str, list[str]] = {}
    confidence_scores: dict[str, float] = {}

    for field_name, field_data in extracted_fields.items():
        selectors: list[str] = []
        normalized_name = _normalize_field_name(field_name)

        # 1. PRIMARY — Match against actual page fields from DOM scan
        for page_field in page_fields:
            page_id = page_field.get("id", "")
            page_name_attr = page_field.get("name", "")
            page_placeholder = page_field.get("placeholder", "")
            page_label = page_field.get("label", "")
            page_autocomplete = page_field.get("autocomplete", "")
            page_selector = page_field.get("selector", "")
            page_aria = page_field.get("ariaLabel", "")

            # Check if this DOM field matches our extracted field
            if _fields_match(
                field_name, normalized_name,
                page_id, page_name_attr, page_placeholder,
                page_label, page_autocomplete, page_aria,
            ):
                # Use the page field's own computed selector FIRST (most reliable)
                if page_selector and page_selector not in selectors:
                    selectors.insert(0, page_selector)
                # Also add id and name selectors as backups
                if page_id and f"#{page_id}" not in selectors:
                    selectors.append(f"#{page_id}")
                if page_name_attr:
                    name_sel = f"[name='{page_name_attr}']"
                    if name_sel not in selectors:
                        selectors.append(name_sel)

        # 2. FALLBACK — Add predefined selectors only if no page match found
        if not selectors and normalized_name in FIELD_SELECTORS:
            selectors.extend(FIELD_SELECTORS[normalized_name])

        # 3. GENERIC FALLBACK — wildcard selectors
        if not selectors:
            # Try with the raw field name and normalized variants
            for variant in {field_name, normalized_name, normalized_name.replace("_", "")}:
                selectors.extend([
                    f"[name*='{variant}' i]",
                    f"[id*='{variant}' i]",
                    f"[placeholder*='{variant}' i]",
                    f"[aria-label*='{variant}' i]",
                    f"[autocomplete*='{variant}' i]",
                ])

        matched_selectors[field_name] = selectors
        confidence_scores[field_name] = field_data.get("confidence", 0.5)

    return {
        "matched_selectors": matched_selectors,
        "confidence_scores": confidence_scores,
    }


# ============================================================
# ORCHESTRATION CONSTANTS
# ============================================================

YES_WORDS = frozenset([
    "yes", "yeah", "yep", "yup", "sure", "ok", "okay", "correct",
    "right", "confirm", "go ahead", "fill it", "do it", "proceed",
    "yes yes", "yes confirm", "yes please", "confirm this",
])

NO_WORDS = frozenset([
    "no", "nope", "nah", "wrong", "mistake", "incorrect",
    "not right", "change", "fix", "wait", "stop",
])

DONE_WORDS = frozenset([
    "done", "finished", "that is it", "that's it", "stop", "end", "okay",
])

CANCEL_WORDS = frozenset([
    "cancel", "back", "never mind", "nevermind",
])


def _is_yes(text: str) -> bool:
    lower = text.lower().strip()
    return lower in YES_WORDS or any(w in lower.split() for w in ("yes", "yeah", "yep", "sure", "ok", "okay", "confirm", "proceed"))


def _is_no(text: str) -> bool:
    lower = text.lower().strip()
    return lower in NO_WORDS or any(w in lower.split() for w in ("no", "nope", "wrong", "mistake", "fix", "change"))


# ============================================================
# HELPER: Build label map from page_fields
# ============================================================

def _build_label_map(page_fields: list[dict]) -> dict[str, str]:
    """Build field-key → human-readable label lookup."""
    label_map: dict[str, str] = {}
    for pf in page_fields:
        fid = pf.get("id", "")
        fname = pf.get("name", "")
        label = pf.get("label", "") or pf.get("placeholder", "") or pf.get("ariaLabel", "")
        if label:
            label = label.replace("*", "").strip()
        if fid:
            label_map[fid] = label or fid
        if fname:
            label_map[fname] = label or fname
    return label_map


def _pretty(name: str, label_map: dict[str, str]) -> str:
    """Return human-readable label for a field name/id."""
    if name in label_map and label_map[name] != name:
        return label_map[name]
    return re.sub(r'[_\-]+', ' ', name).strip().title()


def _build_summary_html(extracted_fields: dict, label_map: dict) -> str:
    """Build HTML summary rows for display in chat."""
    rows = []
    for k, v in extracted_fields.items():
        val = v.get("value", "") if isinstance(v, dict) else v
        if val:
            pretty = _pretty(k, label_map)
            rows.append(f"• <b>{pretty}</b>: {val}")
    return "<br>".join(rows)


# ============================================================
# NODE 0: ROUTER
# ============================================================

def router_node(state: WebSenseState) -> dict[str, Any]:
    """
    Inspects conversation_phase and user input to determine routing.
    Sets next_route which the graph's conditional edge reads.
    """
    phase = state.get("conversation_phase", "idle")
    user_input = state.get("raw_transcript", "").strip()
    lower = user_input.lower()

    # Check for "spell <field>" command (works in any phase)
    spell_match = re.match(r'^spell\s+(.+)', lower)
    if spell_match and phase in ("idle", "confirming"):
        return {"next_route": "spell_command"}

    if phase == "idle":
        return {"next_route": "extract"}

    elif phase == "confirming":
        if _is_yes(lower):
            return {"next_route": "confirm"}
        elif _is_no(lower):
            return {"next_route": "confirm"}
        else:
            # Treat as new input to extract and merge
            return {
                "next_route": "extract",
                "conversation_phase": "idle",
            }

    elif phase in ("correcting", "spelling", "spell_confirm"):
        return {"next_route": "correction"}

    # Fallback
    return {"next_route": "extract"}


# ============================================================
# NODE 4: REVIEW (replaces old confirm_node)
# ============================================================

def review_node(state: WebSenseState) -> dict[str, Any]:
    """
    Reviews extracted fields after extraction or after applying a correction.
    Builds a confirmation summary and sets phase="confirming".
    Always returns bot_response with action="confirm_fill".
    """
    extracted_fields: dict = state.get("extracted_fields", {})
    confidence_scores: dict = state.get("confidence_scores", {})
    missing_fields: list = state.get("missing_fields", [])
    page_fields: list[dict] = state.get("page_fields", [])

    label_map = _build_label_map(page_fields)

    # Build pretty summary
    summary_lines = []
    summary_dict = {}
    for field_name, field_data in extracted_fields.items():
        value = field_data.get("value", "") if isinstance(field_data, dict) else field_data
        if value:
            pretty = _pretty(field_name, label_map)
            summary_lines.append(f"• <b>{pretty}</b>: {value}")
            summary_dict[field_name] = value

    field_count = len(summary_dict)

    if field_count == 0:
        return {
            "conversation_phase": "idle",
            "bot_response": {
                "action": "show_fields",
                "message": "⚠️ I couldn't extract any values. Could you try again with more detail?",
                "fields_summary": {},
                "speak_text": "I couldn't extract any values. Could you try again?",
                "status_text": "No values extracted",
            },
        }

    summary_html = "<br>".join(summary_lines)

    # Build missing fields info
    missing_html = ""
    if missing_fields:
        pretty_missing = [_pretty(f, label_map) for f in missing_fields]
        missing_html = f"<br><br>📝 Still need: <b>{', '.join(pretty_missing)}</b>"

    message = (
        f"📋 Here's what I captured (<b>{field_count}</b> field{'s' if field_count > 1 else ''}):"
        f"<br><br>{summary_html}"
        f"{missing_html}"
        f"<br><br>👉 <b>Should I fill these fields?</b> Say <b>yes</b> to fill, or <b>no</b> to correct."
    )

    speak = f"I captured {field_count} fields. Should I fill these? Say yes to fill or no to correct."

    return {
        "conversation_phase": "confirming",
        "bot_response": {
            "action": "confirm_fill",
            "message": message,
            "fields_summary": {_pretty(k, label_map): v for k, v in summary_dict.items()},
            "summary": summary_dict,
            "missing_fields": [_pretty(f, label_map) for f in missing_fields],
            "speak_text": speak,
            "status_text": "Waiting for confirmation…",
        },
    }


# ============================================================
# NODE 5: CONFIRM HANDLER
# ============================================================

def confirm_handler_node(state: WebSenseState) -> dict[str, Any]:
    """
    Handles user response during the "confirming" phase.
    - Yes → route to fill_node
    - No → enter correction mode
    - Unclear → re-ask
    """
    user_input = state.get("raw_transcript", "").strip()
    extracted_fields = state.get("extracted_fields", {})
    page_fields = state.get("page_fields", [])
    label_map = _build_label_map(page_fields)

    if _is_yes(user_input):
        return {
            "confirm_route": "fill",
        }

    elif _is_no(user_input):
        # Show current values and ask which field to correct
        summary_html = _build_summary_html(extracted_fields, label_map)
        return {
            "conversation_phase": "correcting",
            "confirm_route": "end",
            "bot_response": {
                "action": "ask_correction",
                "message": (
                    f"🔧 No problem! Which field is wrong?<br><br>"
                    f"{summary_html}<br><br>"
                    f"Tell me the field name — for example: <i>\"name is wrong\"</i>"
                ),
                "speak_text": "Which field is wrong? Tell me the field name.",
                "status_text": "Correction mode — tell me which field",
            },
        }

    else:
        return {
            "confirm_route": "end",
            "bot_response": {
                "action": "confirm_fill",
                "message": "🤔 I didn't catch that. Please say <b>yes</b> to fill or <b>no</b> to correct.",
                "speak_text": "Please say yes to fill or no to correct.",
                "status_text": "Waiting for confirmation…",
            },
        }


# ============================================================
# NODE 6: CORRECTION HANDLER (correcting + spelling + spell_confirm)
# ============================================================

def correction_handler_node(state: WebSenseState) -> dict[str, Any]:
    """
    Handles the full correction flow across sub-phases:
     - correcting: identify which field user wants to fix
     - spelling: collect letters or whole-word replacement
     - spell_confirm: confirm the new spelling, apply or retry
    """
    phase = state.get("conversation_phase", "correcting")
    user_input = state.get("raw_transcript", "").strip()
    lower = user_input.lower().strip()
    extracted_fields = state.get("extracted_fields", {})
    page_fields = state.get("page_fields", [])
    label_map = _build_label_map(page_fields)
    correcting_key = state.get("correcting_field_key", "")
    spelling_buffer = state.get("spelling_buffer", "")

    # ── SUB-PHASE: correcting (identify which field) ──
    if phase == "correcting":
        matched_field = None

        # Try matching user words against field keys and labels
        for key in extracted_fields:
            pretty = _pretty(key, label_map).lower()
            if pretty in lower or key.lower() in lower:
                matched_field = key
                break

        # Fuzzy match common words
        if not matched_field:
            common_words = {
                "name": ["name", "first", "last", "username"],
                "email": ["email", "mail"],
                "phone": ["phone", "mobile", "tel"],
                "address": ["address", "street", "city"],
            }
            for key in extracted_fields:
                key_lower = key.lower()
                for words in common_words.values():
                    if any(w in key_lower and w in lower for w in words):
                        matched_field = key
                        break
                if matched_field:
                    break

        if not matched_field:
            summary_html = _build_summary_html(extracted_fields, label_map)
            return {
                "correction_route": "end",
                "bot_response": {
                    "action": "ask_correction",
                    "message": (
                        f"🤔 I'm not sure which field you mean. Here are the current values:<br><br>"
                        f"{summary_html}<br><br>"
                        f"Please say the field name you want to correct."
                    ),
                    "speak_text": "I'm not sure which field. Please say the field name.",
                    "status_text": "Tell me which field to correct",
                },
            }

        current_value = ""
        fd = extracted_fields.get(matched_field, {})
        if isinstance(fd, dict):
            current_value = fd.get("value", "")
        pretty_name = _pretty(matched_field, label_map)

        return {
            "conversation_phase": "spelling",
            "correcting_field_key": matched_field,
            "spelling_buffer": "",
            "correction_route": "end",
            "bot_response": {
                "action": "ask_spelling",
                "message": (
                    f"📝 Current value for <b>{pretty_name}</b>: <b>{current_value}</b><br><br>"
                    f"🔤 Please tell me the correct value, or spell it letter by letter.<br>"
                    f"Say <b>\"done\"</b> when finished."
                ),
                "correcting_field": pretty_name,
                "current_value": current_value,
                "spell_aloud": {"field": pretty_name, "value": current_value},
                "speak_text": f"Current value for {pretty_name} is {current_value}. Please tell me the correct spelling.",
                "status_text": f'Spelling mode — correct "{pretty_name}"',
            },
        }

    # ── SUB-PHASE: spelling (collect letters) ──
    elif phase == "spelling":
        pretty_name = _pretty(correcting_key, label_map)

        # Check for "done"
        if lower in DONE_WORDS:
            if not spelling_buffer.strip():
                return {
                    "correction_route": "end",
                    "bot_response": {
                        "action": "ask_spelling",
                        "message": "⚠️ You haven't spelled anything yet. Say the letters, or <b>\"cancel\"</b> to go back.",
                        "speak_text": "You haven't spelled anything yet.",
                        "status_text": f'Spelling "{pretty_name}"…',
                    },
                }

            return {
                "conversation_phase": "spell_confirm",
                "correction_route": "end",
                "bot_response": {
                    "action": "confirm_spelling",
                    "message": (
                        f"📝 I got: <b>{spelling_buffer.strip()}</b><br><br>"
                        f"👉 Is this correct? Say <b>yes</b> to apply or <b>no</b> to spell again."
                    ),
                    "spelled_value": spelling_buffer.strip(),
                    "correcting_field": pretty_name,
                    "spell_aloud": {"field": pretty_name, "value": spelling_buffer.strip()},
                    "speak_text": f"I got {spelling_buffer.strip()}. Is this correct?",
                    "status_text": "Confirm spelling…",
                },
            }

        # Check for "cancel"
        if lower in CANCEL_WORDS:
            return {
                "conversation_phase": "confirming",
                "correcting_field_key": "",
                "spelling_buffer": "",
                "correction_route": "end",
                "bot_response": {
                    "action": "confirm_fill",
                    "message": "↩️ Cancelled. Should I fill the original values? Say <b>yes</b> or <b>no</b>.",
                    "speak_text": "Cancelled. Should I fill the original values?",
                    "status_text": "Waiting for confirmation…",
                },
            }

        # Parse input: single letters or whole word
        letters = user_input.replace(",", " ").replace(".", " ").strip()
        parts = letters.split()
        all_single = all(len(p) == 1 for p in parts)

        if all_single and parts:
            new_buffer = spelling_buffer + "".join(parts)
            return {
                "spelling_buffer": new_buffer,
                "correction_route": "end",
                "bot_response": {
                    "action": "ask_spelling",
                    "message": f"🔤 Got it: <b>{new_buffer}</b> (say more letters, or <b>\"done\"</b> when finished)",
                    "spelled_value": new_buffer,
                    "status_text": f'Spelling "{pretty_name}": {new_buffer}',
                },
            }
        else:
            # Whole word — go straight to confirmation
            return {
                "conversation_phase": "spell_confirm",
                "spelling_buffer": user_input.strip(),
                "correction_route": "end",
                "bot_response": {
                    "action": "confirm_spelling",
                    "message": (
                        f"📝 I got: <b>{user_input.strip()}</b><br>"
                        f"👉 Is this correct? Say <b>yes</b> or <b>no</b>."
                    ),
                    "spelled_value": user_input.strip(),
                    "correcting_field": pretty_name,
                    "spell_aloud": {"field": pretty_name, "value": user_input.strip()},
                    "speak_text": f"I got {user_input.strip()}. Is this correct?",
                    "status_text": "Confirm spelling…",
                },
            }

    # ── SUB-PHASE: spell_confirm (apply or retry) ──
    elif phase == "spell_confirm":
        pretty_name = _pretty(correcting_key, label_map)

        if _is_yes(lower):
            # Apply correction
            updated_fields = {**extracted_fields}
            if correcting_key in updated_fields:
                fd = updated_fields[correcting_key]
                if isinstance(fd, dict):
                    updated_fields[correcting_key] = {
                        **fd,
                        "value": spelling_buffer.strip(),
                        "confidence": 0.95,
                        "source_text": f"Spelling correction: {spelling_buffer.strip()}",
                    }
                else:
                    updated_fields[correcting_key] = {
                        "value": spelling_buffer.strip(),
                        "confidence": 0.95,
                        "source_text": f"Spelling correction: {spelling_buffer.strip()}",
                    }

            return {
                "extracted_fields": updated_fields,
                "correcting_field_key": "",
                "spelling_buffer": "",
                "correction_route": "review",  # Route back to review for re-confirmation
                "bot_response": {
                    "action": "show_fields",
                    "message": f"✅ Updated <b>{pretty_name}</b> to <b>{spelling_buffer.strip()}</b>!",
                    "speak_text": f"Updated {pretty_name} to {spelling_buffer.strip()}.",
                    "status_text": "Correction applied",
                },
            }

        elif _is_no(lower):
            return {
                "conversation_phase": "spelling",
                "spelling_buffer": "",
                "correction_route": "end",
                "bot_response": {
                    "action": "ask_spelling",
                    "message": (
                        f"🔄 Let's try again. Please spell <b>{pretty_name}</b> letter by letter.<br>"
                        f"Say <b>\"done\"</b> when finished."
                    ),
                    "speak_text": f"Let's try again. Please spell {pretty_name}.",
                    "status_text": f'Re-spelling "{pretty_name}"…',
                },
            }

        else:
            return {
                "correction_route": "end",
                "bot_response": {
                    "action": "confirm_spelling",
                    "message": "🤔 Please say <b>yes</b> to apply, or <b>no</b> to spell again.",
                    "speak_text": "Please say yes to apply or no to spell again.",
                    "status_text": "Confirm spelling…",
                },
            }

    # Fallback
    return {
        "conversation_phase": "idle",
        "correction_route": "end",
        "bot_response": {
            "action": "error",
            "message": "⚠️ Something went wrong. Let's start over.",
            "status_text": "Error",
        },
    }


# ============================================================
# NODE 7: FILL (replaces old output_node)
# ============================================================

def fill_node(state: WebSenseState) -> dict[str, Any]:
    """
    Assembles the final fill payload and returns action="execute_fill".
    Called only after the user confirms "yes".
    """
    extracted_fields: dict = state.get("extracted_fields", {})
    matched_selectors: dict = state.get("matched_selectors", {})
    confidence_scores: dict = state.get("confidence_scores", {})
    page_fields: list[dict] = state.get("page_fields", [])
    contains_sensitive: bool = state.get("contains_sensitive", False)
    session_id: str = state.get("session_id", "")

    label_map = _build_label_map(page_fields)

    fields_to_fill: dict = {}
    summary: dict = {}
    summary_lines = []

    for field_name, field_data in extracted_fields.items():
        value = field_data.get("value", "") if isinstance(field_data, dict) else field_data
        if not value:
            continue
        confidence = confidence_scores.get(field_name, field_data.get("confidence", 0.5) if isinstance(field_data, dict) else 0.8)
        selectors = matched_selectors.get(field_name, [])

        fields_to_fill[field_name] = {
            "value": value,
            "confidence": confidence,
            "selectors": selectors,
            "source_text": field_data.get("source_text", "") if isinstance(field_data, dict) else "",
        }
        summary[field_name] = value
        summary_lines.append(f"• <b>{_pretty(field_name, label_map)}</b>: {value}")

    field_count = len(fields_to_fill)
    summary_html = "<br>".join(summary_lines)

    return {
        "conversation_phase": "idle",
        "bot_response": {
            "action": "execute_fill",
            "message": (
                f"✅ Filling <b>{field_count}</b> field{'s' if field_count > 1 else ''}!<br><br>"
                f"{summary_html}"
            ),
            "fields_to_fill": fields_to_fill,
            "summary": summary,
            "fields_summary": {_pretty(k, label_map): v for k, v in summary.items()},
            "speak_text": f"Filling {field_count} fields.",
            "status_text": f"Filled {field_count} fields ✓",
        },
    }


# ============================================================
# NODE 8: SPELL READOUT
# ============================================================

def spell_readout_node(state: WebSenseState) -> dict[str, Any]:
    """
    Handles the "spell <field>" command.
    Finds the field value and returns spell_aloud data for TTS.
    """
    user_input = state.get("raw_transcript", "").strip()
    lower = user_input.lower()
    spell_match = re.match(r'^spell\s+(.+)', lower)
    search_term = spell_match.group(1) if spell_match else lower

    extracted_fields = state.get("extracted_fields", {})
    page_fields = state.get("page_fields", [])
    label_map = _build_label_map(page_fields)

    # Search for matching field
    matched_key = None
    matched_value = None

    for key, data in extracted_fields.items():
        pretty = _pretty(key, label_map).lower()
        val = data.get("value", "") if isinstance(data, dict) else data
        if pretty in search_term or key.lower() in search_term or search_term in pretty:
            matched_key = key
            matched_value = val
            break

    # Fuzzy fallback
    if not matched_key:
        for key, data in extracted_fields.items():
            kw = key.lower().replace("_", " ").replace("-", " ")
            val = data.get("value", "") if isinstance(data, dict) else data
            if any(w in kw for w in search_term.split()):
                matched_key = key
                matched_value = val
                break

    if not matched_key or not matched_value:
        available = _build_summary_html(extracted_fields, label_map)
        return {
            "bot_response": {
                "action": "show_fields",
                "message": (
                    f"🤔 I don't have a value for \"<b>{search_term}</b>\".<br><br>"
                    + (f"Here's what I have:<br>{available}" if available else "No fields extracted yet.")
                ),
                "speak_text": f"I don't have a value for {search_term}.",
                "status_text": "Field not found",
            },
        }

    pretty = _pretty(matched_key, label_map)
    return {
        "bot_response": {
            "action": "spell_readout",
            "message": f"🔤 Spelling <b>{pretty}</b>: <b>{matched_value}</b>",
            "spell_aloud": {"field": pretty, "value": matched_value},
            "speak_text": f"Spelling {pretty}",
            "status_text": f"Spelling {pretty}…",
        },
    }


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def _parse_llm_json(text: str) -> dict:
    """
    Parses JSON from LLM response text.
    Falls back to regex extraction if standard parsing fails.

    Args:
        text: Raw response text from the LLM.

    Returns:
        Parsed dict, or empty dict if all parsing fails.
    """
    # Strip markdown code fences if present
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    # Attempt 1: Direct JSON parse
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Attempt 2: Find JSON object in text via regex
    json_match = re.search(r"\{[\s\S]*\}", cleaned)
    if json_match:
        try:
            return json.loads(json_match.group())
        except json.JSONDecodeError:
            pass

    return {}


def _regex_fallback_extract(transcript: str) -> dict:
    """
    Fallback extraction using regex when LLM fails.
    Detects common field patterns in natural speech.

    Args:
        transcript: Sanitized user transcript.

    Returns:
        Dict of extracted fields with low confidence scores.
    """
    fields: dict = {}

    # Email pattern
    email_match = re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", transcript)
    if email_match:
        fields["email"] = {
            "value": email_match.group(),
            "confidence": 0.9,
            "source_text": email_match.group(),
        }

    # Phone pattern (supports US, Pakistani 03xx-xxxxxxx, international +xx formats)
    phone_match = re.search(
        r"\b(?:"
        r"(?:\+?\d{1,3}[-.\s]?)?\(?\d{3,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}"
        r"|0\d{3}[-.\s]?\d{7}"
        r"|\+\d{1,3}[-.\s]?\d{3,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}"
        r")\b", transcript)
    if phone_match:
        fields["phone"] = {
            "value": phone_match.group(),
            "confidence": 0.85,
            "source_text": phone_match.group(),
        }

    # Phone spoken as "number is ..." or "phone is ..."
    phone_spoken = re.search(
        r"(?:my\s+)?(?:phone|number|mobile|cell|contact)\s+(?:number\s+)?is\s+([\d\s+\-().x]+)",
        transcript, re.IGNORECASE)
    if phone_spoken and "phone" not in fields:
        raw_phone = phone_spoken.group(1).strip()
        # Clean up spoken separators
        cleaned_phone = re.sub(r'\s+', '', raw_phone)
        if len(cleaned_phone) >= 7:  # at least 7 digits
            fields["phone"] = {
                "value": raw_phone,
                "confidence": 0.8,
                "source_text": phone_spoken.group(0),
            }

    # First name pattern
    first_name_match = re.search(r"(?:my\s+)?first\s+name\s+is\s+([A-Za-z]+)", transcript, re.IGNORECASE)
    if first_name_match:
        fields["first_name"] = {
            "value": first_name_match.group(1).strip(),
            "confidence": 0.9,
            "source_text": first_name_match.group(0),
        }

    # Last name pattern
    last_name_match = re.search(r"(?:my\s+)?last\s+name\s+is\s+([A-Za-z]+)", transcript, re.IGNORECASE)
    if last_name_match:
        fields["last_name"] = {
            "value": last_name_match.group(1).strip(),
            "confidence": 0.9,
            "source_text": last_name_match.group(0),
        }

    # Name pattern ("my name is ..." or "name is ..." — handles any casing)
    name_match = re.search(r"(?:my\s+)?name\s+is\s+([A-Za-z]+(?:\s+[A-Za-z]+)*)", transcript, re.IGNORECASE)
    if name_match and "first_name" not in fields:
        fields["name"] = {
            "value": name_match.group(1).strip().title(),
            "confidence": 0.85,
            "source_text": name_match.group(0),
        }

    # Email spoken as "email is ..." (with at/dot as words)
    email_spoken = re.search(r"email\s+is\s+([\w.+-]+\s*(?:at|@)\s*[\w-]+\s*(?:dot|\.)\s*\w+)", transcript, re.IGNORECASE)
    if email_spoken and "email" not in fields:
        raw_email = email_spoken.group(1)
        cleaned = raw_email.replace(" at ", "@").replace("at ", "@").replace(" dot ", ".").replace("dot ", ".")
        cleaned = cleaned.replace(" ", "")
        fields["email"] = {
            "value": cleaned,
            "confidence": 0.7,
            "source_text": email_spoken.group(0),
        }

    return fields


def _normalize_field_name(name: str) -> str:
    """
    Normalizes a field name to match against FIELD_SELECTORS keys.

    Handles variations like 'firstName' -> 'first_name', 'Full Name' -> 'name'.

    Args:
        name: The raw field name from LLM extraction.

    Returns:
        Normalized field name string.
    """
    lower = name.lower().strip()

    # Direct mappings for common variations
    mappings = {
        "fullname": "name",
        "full_name": "name",
        "full name": "name",
        "firstname": "first_name",
        "first name": "first_name",
        "first": "first_name",
        "fname": "first_name",
        "given name": "first_name",
        "givenname": "first_name",
        "lastname": "last_name",
        "last name": "last_name",
        "last": "last_name",
        "lname": "last_name",
        "surname": "last_name",
        "familyname": "last_name",
        "family name": "last_name",
        "emailaddress": "email",
        "email_address": "email",
        "email address": "email",
        "e-mail": "email",
        "mail": "email",
        "phonenumber": "phone",
        "phone_number": "phone",
        "phone number": "phone",
        "telephone": "phone",
        "tel": "phone",
        "mobile": "phone",
        "cell": "phone",
        "cellphone": "phone",
        "streetaddress": "address",
        "street_address": "address",
        "street address": "address",
        "address1": "address",
        "addr": "address",
        "zipcode": "zip",
        "zip_code": "zip",
        "zip code": "zip",
        "postalcode": "zip",
        "postal_code": "zip",
        "postal code": "zip",
        "postcode": "zip",
        "organization": "company",
        "org": "company",
        "employer": "company",
    }

    if lower in mappings:
        return mappings[lower]

    # Convert camelCase to snake_case
    snake = re.sub(r"([a-z])([A-Z])", r"\1_\2", name).lower()
    if snake in mappings:
        return mappings[snake]

    return lower


def _fields_match(
    raw_name: str,
    normalized_name: str,
    dom_id: str,
    dom_name: str,
    dom_placeholder: str,
    dom_label: str,
    dom_autocomplete: str = "",
    dom_aria: str = "",
) -> bool:
    """
    Checks whether a DOM field matches an extracted field name.

    Uses multi-strategy matching:
    1. Exact match on name or id (case-insensitive)
    2. Autocomplete attribute semantic matching
    3. Substring containment matching
    4. Label / placeholder text matching

    Args:
        raw_name: Raw field name from LLM extraction.
        normalized_name: Normalized field name (via _normalize_field_name).
        dom_id: The DOM element's id attribute.
        dom_name: The DOM element's name attribute.
        dom_placeholder: The DOM element's placeholder text.
        dom_label: The associated label text.
        dom_autocomplete: The DOM element's autocomplete attribute.
        dom_aria: The DOM element's aria-label.

    Returns:
        True if the DOM field appears to match the extracted field.
    """
    raw_lower = raw_name.lower().strip()
    dom_id_lower = dom_id.lower()
    dom_name_lower = dom_name.lower()
    dom_placeholder_lower = dom_placeholder.lower()
    dom_label_lower = dom_label.lower()
    dom_autocomplete_lower = dom_autocomplete.lower()
    dom_aria_lower = dom_aria.lower()

    # --- Strategy 1: Exact match on DOM name or id ---
    if dom_name_lower and (dom_name_lower == raw_lower or dom_name_lower == normalized_name):
        return True
    if dom_id_lower and (dom_id_lower == raw_lower or dom_id_lower == normalized_name):
        return True

    # --- Strategy 2: Autocomplete semantic mapping ---
    autocomplete_map = {
        "given-name": {"first_name", "firstname", "fname", "first"},
        "family-name": {"last_name", "lastname", "lname", "last", "surname"},
        "name": {"name", "fullname", "full_name"},
        "email": {"email", "emailaddress", "email_address"},
        "tel": {"phone", "phonenumber", "phone_number", "telephone", "tel", "mobile"},
        "street-address": {"address", "streetaddress", "street_address", "address1"},
        "address-level2": {"city", "addresscity"},
        "address-level1": {"state", "province", "addressstate"},
        "postal-code": {"zip", "zipcode", "zip_code", "postalcode", "postal_code"},
        "country-name": {"country", "addresscountry"},
        "organization": {"company", "organization", "org"},
        "username": {"username", "user", "login"},
    }

    if dom_autocomplete_lower in autocomplete_map:
        if normalized_name in autocomplete_map[dom_autocomplete_lower]:
            return True
        if raw_lower in autocomplete_map[dom_autocomplete_lower]:
            return True

    # Reverse: check if the field name maps to this autocomplete value
    for auto_val, field_names in autocomplete_map.items():
        if normalized_name in field_names or raw_lower in field_names:
            if dom_autocomplete_lower == auto_val:
                return True

    # --- Strategy 3: Substring containment ---
    search_terms = {
        normalized_name,
        normalized_name.replace("_", ""),
        raw_lower,
        raw_lower.replace("_", ""),
        raw_lower.replace("-", ""),
    }
    # Remove empty strings
    search_terms.discard("")

    dom_targets = [
        dom_id_lower, dom_name_lower,
        dom_placeholder_lower, dom_label_lower,
        dom_aria_lower,
    ]

    for term in search_terms:
        if len(term) < 3:
            continue  # Skip very short terms to avoid false matches
        for target in dom_targets:
            if not target:
                continue
            if term in target or target in term:
                return True

    # --- Strategy 4: Label / placeholder semantic words ---
    # e.g., extracted "first_name" should match label "First Name"
    name_words = set(re.split(r'[_\-\s]+', raw_lower))
    name_words.discard("")
    if len(name_words) >= 1:
        label_words = set(re.split(r'[_\-\s]+', dom_label_lower))
        placeholder_words = set(re.split(r'[_\-\s]+', dom_placeholder_lower))
        # If all words of the field name appear in label or placeholder
        if name_words and name_words.issubset(label_words):
            return True
        if name_words and name_words.issubset(placeholder_words):
            return True

    return False
