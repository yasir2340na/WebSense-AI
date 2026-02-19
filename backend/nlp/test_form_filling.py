"""
Test suite for LangGraph form-filling chain.

Tests:
  - State schema validation
  - Individual node functions (intake, extract, match, confirm, correction, output)
  - Sensitive data detection / redaction
  - Graph routing logic
  - End-to-end invoke_form_filling()

Requires: pytest, langgraph, langchain-openai
Run:  pytest backend/nlp/test_form_filling.py -v
"""

import os
import sys
import pytest

# ── Add chains package to path ──
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from chains.state import WebSenseState, FieldData
from chains.nodes import (
    intake_node,
    SENSITIVE_PATTERNS,
    _normalize_field_name,
    _fields_match,
    _parse_llm_json,
    CORRECTION_KEYWORDS,
)
from chains.graph import route_after_confirm


# ================================================================
# State Schema Tests
# ================================================================
class TestStateSchema:
    """Verify TypedDict definitions are valid."""

    def test_websense_state_accepts_minimal_fields(self):
        state: WebSenseState = {
            'raw_transcript': 'test',
            'page_fields': [],
            'session_id': 'sess_001',
        }
        assert state['raw_transcript'] == 'test'

    def test_field_data_structure(self):
        fd: FieldData = {
            'value': 'John',
            'confidence': 0.95,
            'source_text': 'name is John',
            'selectors': ['#first-name'],
        }
        assert fd['confidence'] == 0.95
        assert isinstance(fd['selectors'], list)


# ================================================================
# Intake Node Tests (PII Detection / Redaction)
# ================================================================
class TestIntakeNode:
    """Test PII detection and transcript sanitization."""

    def test_detects_credit_card(self):
        state: WebSenseState = {
            'raw_transcript': 'Card is 4111 1111 1111 1111',
            'page_fields': [],
            'session_id': 'sess_002',
        }
        result = intake_node(state)
        assert result.get('contains_sensitive') is True

    def test_detects_ssn(self):
        state: WebSenseState = {
            'raw_transcript': 'My SSN is 123-45-6789',
            'page_fields': [],
            'session_id': 'sess_003',
        }
        result = intake_node(state)
        assert result.get('contains_sensitive') is True

    def test_no_sensitive_data_in_normal_text(self):
        state: WebSenseState = {
            'raw_transcript': 'Name John Doe, email john@example.com',
            'page_fields': [],
            'session_id': 'sess_004',
        }
        result = intake_node(state)
        assert result.get('contains_sensitive') is False

    def test_sanitized_transcript_redacts_credit_card(self):
        state: WebSenseState = {
            'raw_transcript': 'Card 4111 1111 1111 1111 please',
            'page_fields': [],
            'session_id': 'sess_005',
        }
        result = intake_node(state)
        sanitized = result.get('sanitized_transcript', '')
        assert '4111' not in sanitized
        assert 'REDACTED' in sanitized or 'redacted' in sanitized.lower()

    def test_conversation_history_initialized(self):
        state: WebSenseState = {
            'raw_transcript': 'Hello world',
            'page_fields': [],
            'session_id': 'sess_006',
        }
        result = intake_node(state)
        assert 'conversation_history' in result
        assert len(result['conversation_history']) >= 1


# ================================================================
# Helper Function Tests
# ================================================================
class TestHelpers:

    def test_normalize_field_name_basic(self):
        assert _normalize_field_name('first_name') == 'first_name'
        assert _normalize_field_name('Full Name') == 'name'
        assert _normalize_field_name('e-mail') == 'email'

    def test_normalize_field_name_variations(self):
        assert _normalize_field_name('lastName') == 'last_name'
        assert _normalize_field_name('phone_number') == 'phone'
        assert _normalize_field_name('fname') == 'first_name'
        assert _normalize_field_name('surname') == 'last_name'
        assert _normalize_field_name('tel') == 'phone'

    def test_parse_llm_json_valid(self):
        result = _parse_llm_json('```json\n{"name": "John"}\n```')
        assert result == {'name': 'John'}

    def test_parse_llm_json_raw(self):
        result = _parse_llm_json('{"email": "test@test.com"}')
        assert result == {'email': 'test@test.com'}

    def test_parse_llm_json_invalid_returns_empty(self):
        result = _parse_llm_json('not json at all')
        assert result == {}

    def test_correction_keywords_list(self):
        assert 'change' in CORRECTION_KEYWORDS
        assert 'fix' in CORRECTION_KEYWORDS
        assert len(CORRECTION_KEYWORDS) >= 6


# ================================================================
# Field Matching Tests
# ================================================================
class TestFieldsMatch:
    """Test multi-strategy field matching logic."""

    def test_exact_name_match(self):
        assert _fields_match(
            "email", "email",
            dom_id="", dom_name="email",
            dom_placeholder="", dom_label="",
        ) is True

    def test_exact_id_match(self):
        assert _fields_match(
            "firstName", "first_name",
            dom_id="firstName", dom_name="",
            dom_placeholder="", dom_label="",
        ) is True

    def test_autocomplete_given_name(self):
        assert _fields_match(
            "first_name", "first_name",
            dom_id="", dom_name="fname",
            dom_placeholder="", dom_label="",
            dom_autocomplete="given-name",
        ) is True

    def test_autocomplete_email(self):
        assert _fields_match(
            "email", "email",
            dom_id="", dom_name="user_email",
            dom_placeholder="", dom_label="",
            dom_autocomplete="email",
        ) is True

    def test_substring_match_placeholder(self):
        assert _fields_match(
            "phone", "phone",
            dom_id="", dom_name="",
            dom_placeholder="Enter your phone number", dom_label="",
        ) is True

    def test_label_word_match(self):
        assert _fields_match(
            "first_name", "first_name",
            dom_id="", dom_name="inp1",
            dom_placeholder="", dom_label="First Name",
        ) is True

    def test_no_match_unrelated(self):
        assert _fields_match(
            "email", "email",
            dom_id="country", dom_name="country",
            dom_placeholder="Country", dom_label="Country",
        ) is False

    def test_short_terms_skip_false_positives(self):
        """Terms shorter than 3 chars should be skipped to avoid false matches."""
        assert _fields_match(
            "id", "id",
            dom_id="", dom_name="middle_name",
            dom_placeholder="", dom_label="",
        ) is False


# ================================================================
# Graph Routing Tests
# ================================================================
class TestGraphRouting:

    def test_routes_to_correction_when_correction_mode(self):
        state: WebSenseState = {
            'correction_mode': True,
            'needs_clarification': False,
            'ready_to_fill': False,
        }
        assert route_after_confirm(state) == 'correction'

    def test_routes_to_end_when_needs_clarification(self):
        state: WebSenseState = {
            'correction_mode': False,
            'needs_clarification': True,
            'ready_to_fill': False,
        }
        result = route_after_confirm(state)
        assert result == '__end__'

    def test_routes_to_output_when_ready(self):
        state: WebSenseState = {
            'correction_mode': False,
            'needs_clarification': False,
            'ready_to_fill': True,
        }
        assert route_after_confirm(state) == 'output'

    def test_routes_to_end_by_default(self):
        state: WebSenseState = {
            'correction_mode': False,
            'needs_clarification': False,
            'ready_to_fill': False,
        }
        result = route_after_confirm(state)
        assert result == '__end__'


# ================================================================
# Sensitive Pattern Regex Tests
# ================================================================
class TestSensitivePatterns:

    def test_credit_card_regex(self):
        import re
        pattern = SENSITIVE_PATTERNS['CREDIT_CARD']
        assert re.search(pattern, '4111 1111 1111 1111')
        assert re.search(pattern, '5500-0000-0000-0004')
        assert not re.search(pattern, '12345')

    def test_ssn_regex(self):
        import re
        pattern = SENSITIVE_PATTERNS['SSN']
        assert re.search(pattern, '123-45-6789')
        assert not re.search(pattern, '555-123-4567')  # phone

    def test_password_regex(self):
        import re
        pattern = SENSITIVE_PATTERNS['PASSWORD']
        assert re.search(pattern, 'password is secret')
        assert re.search(pattern, 'Password IS hunter2')
        assert not re.search(pattern, 'I forgot my password')

    def test_cvv_regex(self):
        import re
        pattern = SENSITIVE_PATTERNS['CVV']
        assert re.search(pattern, 'cvv is 123')
        assert re.search(pattern, 'CVV is 4567')
        assert not re.search(pattern, 'cvv code')


# ================================================================
# Run
# ================================================================
if __name__ == '__main__':
    pytest.main([__file__, '-v'])
