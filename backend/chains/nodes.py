"""
WebSense-AI Form Filling Chain — Node Functions

Contains all 6 LangGraph node functions:
    1. intake_node      — Sanitizes transcript, detects sensitive data
    2. extract_node     — Uses Cohere (command-a-03-2025) to extract form field values
    3. match_selectors_node — Maps fields to CSS selectors
    4. confirm_node     — Reviews confidence, checks completeness
    5. correction_node  — Handles user corrections to specific fields
    6. output_node      — Assembles final payload for Chrome extension
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
        needs_clarification, clarification_question, conversation_history.
    """
    sanitized_transcript: str = state.get("sanitized_transcript", "")
    page_fields: list[dict] = state.get("page_fields", [])
    conversation_history: list[dict] = state.get("conversation_history", [])
    existing_fields: dict = state.get("extracted_fields", {})

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
        needs_clarification = parsed.get("needs_clarification", False)
        clarification_question = parsed.get("clarification_question", "")

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
            "needs_clarification": needs_clarification,
            "clarification_question": clarification_question,
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
            "needs_clarification": True,
            "clarification_question": "I had trouble understanding. Could you repeat your details?",
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
# NODE 4: CONFIRM
# ============================================================

def confirm_node(state: WebSenseState) -> dict[str, Any]:
    """
    Reviews all confidence scores and checks for missing fields.

    Flags fields with confidence < 0.85 as low confidence.
    If any issues are found, sets needs_clarification = True.
    Builds a human-readable confirmation summary.
    Sets ready_to_fill = True ONLY when all fields are confident and complete.

    Args:
        state: Current graph state with extracted_fields, confidence_scores,
               missing_fields.

    Returns:
        Dict of state updates: needs_clarification, clarification_question,
        ready_to_fill, confirmed.
    """
    extracted_fields: dict = state.get("extracted_fields", {})
    confidence_scores: dict = state.get("confidence_scores", {})
    missing_fields: list = state.get("missing_fields", [])
    page_fields: list[dict] = state.get("page_fields", [])
    correction_mode: bool = state.get("correction_mode", False)

    # If correction mode is active, route to correction (handled by graph routing)
    if correction_mode:
        return {
            "needs_clarification": False,
            "ready_to_fill": False,
        }

    # Build field-name → human-readable label lookup from page_fields
    field_label_map: dict[str, str] = {}
    for pf in page_fields:
        fid = pf.get("id", "")
        fname = pf.get("name", "")
        label = pf.get("label", "") or pf.get("placeholder", "") or pf.get("ariaLabel", "")
        if fid:
            field_label_map[fid] = label or fid
        if fname:
            field_label_map[fname] = label or fname

    def _pretty(name: str) -> str:
        """Return human-readable label for a field name/id."""
        if name in field_label_map and field_label_map[name] != name:
            return field_label_map[name]
        # Fallback: convert underscores/hyphens to spaces
        return re.sub(r'[_\-]+', ' ', name).strip().title()

    low_confidence_fields: list[str] = []
    summary_lines: list[str] = []

    # Review each extracted field's confidence
    for field_name, field_data in extracted_fields.items():
        confidence = confidence_scores.get(field_name, field_data.get("confidence", 0.5))
        value = field_data.get("value", "")

        if confidence < CONFIDENCE_THRESHOLD:
            low_confidence_fields.append(field_name)
            summary_lines.append(f"  ⚠️ {_pretty(field_name)}: \"{value}\" (confidence: {confidence:.0%})")
        else:
            summary_lines.append(f"  ✓ {_pretty(field_name)}: \"{value}\" (confidence: {confidence:.0%})")

    # Determine if we need clarification
    has_issues = bool(low_confidence_fields) or bool(missing_fields)

    clarification_question = ""
    if has_issues:
        parts: list[str] = []
        if low_confidence_fields:
            pretty_low = [_pretty(f) for f in low_confidence_fields]
            parts.append(f"I'm not sure about: {', '.join(pretty_low)}")
        if missing_fields:
            pretty_missing = [_pretty(f) for f in missing_fields]
            parts.append(f"Still missing: {', '.join(pretty_missing)}")
        clarification_question = ". ".join(parts) + ". Could you provide or confirm these?"

    return {
        "needs_clarification": has_issues,
        "clarification_question": clarification_question,
        "ready_to_fill": not has_issues,
        "confirmed": not has_issues,
    }


# ============================================================
# NODE 5: CORRECTION
# ============================================================

def correction_node(state: WebSenseState) -> dict[str, Any]:
    """
    Handles user corrections to specific fields.
    Triggered when correction keywords are detected in user speech.

    Makes a targeted GPT call to identify ONLY the corrected field,
    updates that single field, and preserves all others unchanged.
    Routes back to confirm_node after processing.

    Args:
        state: Current graph state with user_response, extracted_fields.

    Returns:
        Dict of state updates: extracted_fields (with correction applied),
        correction_mode (reset to False).
    """
    user_response: str = state.get("user_response", "")
    extracted_fields: dict = state.get("extracted_fields", {})
    conversation_history: list[dict] = state.get("conversation_history", [])

    if not user_response:
        return {
            "correction_mode": False,
            "error_message": "No correction input provided.",
        }

    # Sanitize the correction input too
    sanitized_correction = user_response
    for data_type, pattern in SENSITIVE_PATTERNS.items():
        sanitized_correction = pattern.sub(f"[{data_type}_REDACTED]", sanitized_correction)

    # Build correction prompt with current field values
    current_values = {
        name: data.get("value", "")
        for name, data in extracted_fields.items()
    }

    user_message = (
        f"Current form values: {json.dumps(current_values)}\n\n"
        f"User's correction: \"{sanitized_correction}\"\n\n"
        f"Identify which field to correct and the new value."
    )

    try:
        llm = ChatCohere(model="command-a-03-2025", temperature=0)
        response = llm.invoke([
            SystemMessage(content=CORRECTION_SYSTEM_PROMPT),
            HumanMessage(content=user_message),
        ])

        parsed = _parse_llm_json(response.content.strip())

        corrected_field = parsed.get("corrected_field")
        new_value = parsed.get("new_value")
        confidence = parsed.get("confidence", 0.9)

        if corrected_field and new_value and corrected_field in extracted_fields:
            # Update ONLY the corrected field
            updated_fields = {**extracted_fields}
            updated_fields[corrected_field] = {
                **updated_fields[corrected_field],
                "value": new_value,
                "confidence": confidence,
                "source_text": sanitized_correction,
            }

            # Record correction in conversation history
            conversation_history = conversation_history.copy()
            conversation_history.append({
                "turn": state.get("turn_count", 0) + 1,
                "role": "user",
                "content": f"Correction: {corrected_field} -> {new_value}",
            })

            return {
                "extracted_fields": updated_fields,
                "correction_mode": False,
                "conversation_history": conversation_history,
                "error_message": "",
            }
        else:
            return {
                "correction_mode": False,
                "needs_clarification": True,
                "clarification_question": "I couldn't identify which field to correct. Could you be more specific?",
            }

    except Exception as e:
        return {
            "correction_mode": False,
            "error_message": f"Correction processing failed: {str(e)}",
            "needs_clarification": True,
            "clarification_question": "I had trouble processing the correction. Could you try again?",
        }


# ============================================================
# NODE 6: OUTPUT
# ============================================================

def output_node(state: WebSenseState) -> dict[str, Any]:
    """
    Assembles the final JSON payload for the Chrome extension.

    The structure matches exactly what content.js expects to
    execute form filling on the page.

    Args:
        state: Current graph state with all fields populated.

    Returns:
        Dict of state updates: final_payload.
    """
    extracted_fields: dict = state.get("extracted_fields", {})
    matched_selectors: dict = state.get("matched_selectors", {})
    confidence_scores: dict = state.get("confidence_scores", {})
    missing_fields: list = state.get("missing_fields", [])
    contains_sensitive: bool = state.get("contains_sensitive", False)
    session_id: str = state.get("session_id", "")

    # Build fields_to_fill with selectors merged in
    fields_to_fill: dict = {}
    summary: dict = {}

    for field_name, field_data in extracted_fields.items():
        value = field_data.get("value", "")
        confidence = confidence_scores.get(field_name, field_data.get("confidence", 0.5))
        selectors = matched_selectors.get(field_name, [])
        source_text = field_data.get("source_text", "")

        fields_to_fill[field_name] = {
            "value": value,
            "confidence": confidence,
            "selectors": selectors,
            "source_text": source_text,
        }
        summary[field_name] = value

    final_payload = {
        "status": "success",
        "session_id": session_id,
        "fields_to_fill": fields_to_fill,
        "missing_fields": missing_fields,
        "needs_confirmation": False,
        "sensitive_detected": contains_sensitive,
        "summary": summary,
    }

    return {
        "final_payload": final_payload,
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

    # Phone pattern
    phone_match = re.search(r"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b", transcript)
    if phone_match:
        fields["phone"] = {
            "value": phone_match.group(),
            "confidence": 0.85,
            "source_text": phone_match.group(),
        }

    # Name pattern ("my name is ..." or "name is ...")
    name_match = re.search(r"(?:my\s+)?name\s+is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)", transcript, re.IGNORECASE)
    if name_match:
        fields["name"] = {
            "value": name_match.group(1).strip(),
            "confidence": 0.8,
            "source_text": name_match.group(0),
        }

    # Email spoken as "email is ..."
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
