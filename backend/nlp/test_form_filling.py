"""
Test suite for LangGraph form-filling chain.

Tests:
  - State schema validation
  - Individual node functions (intake, router, review, fill)
  - Sensitive data detection / redaction
  - Graph routing logic (route_decision, confirm_decision, correction_decision)
  - Helper functions (normalize, fields_match, parse_llm_json)

Requires: pytest, langgraph, langchain-cohere
Run:  pytest backend/nlp/test_form_filling.py -v
"""

import os
import sys
import pytest

# ── Add chains package to path ──
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from chains.state import WebSenseState, FieldData, BotResponse
from chains.nodes import (
    intake_node,
    router_node,
    review_node,
    fill_node,
    confirm_handler_node,
    correction_handler_node,
    spell_readout_node,
    _build_label_map,
    _is_yes,
    _is_no,
    SENSITIVE_PATTERNS,
    _normalize_field_name,
    _fields_match,
    _parse_llm_json,
    CORRECTION_KEYWORDS,
)
from chains.graph import route_decision, confirm_decision, correction_decision


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
# Graph Routing Tests (new router-based architecture)
# ================================================================
class TestGraphRouting:

    def test_route_decision_reads_next_route(self):
        state: WebSenseState = {'next_route': 'confirm'}
        assert route_decision(state) == 'confirm'

    def test_route_decision_defaults_to_extract(self):
        state: WebSenseState = {}
        assert route_decision(state) == 'extract'

    def test_confirm_decision_fill(self):
        state: WebSenseState = {'confirm_route': 'fill'}
        assert confirm_decision(state) == 'fill'

    def test_confirm_decision_end(self):
        state: WebSenseState = {'confirm_route': 'end'}
        assert confirm_decision(state) == 'end'

    def test_confirm_decision_defaults_end(self):
        state: WebSenseState = {}
        assert confirm_decision(state) == 'end'

    def test_correction_decision_review(self):
        state: WebSenseState = {'correction_route': 'review'}
        assert correction_decision(state) == 'review'

    def test_correction_decision_end(self):
        state: WebSenseState = {'correction_route': 'end'}
        assert correction_decision(state) == 'end'

    def test_correction_decision_defaults_end(self):
        state: WebSenseState = {}
        assert correction_decision(state) == 'end'


# ================================================================
# Router Node Tests
# ================================================================
class TestRouterNode:

    def test_idle_routes_to_extract(self):
        state: WebSenseState = {
            'conversation_phase': 'idle',
            'raw_transcript': 'my name is ahmed',
        }
        result = router_node(state)
        assert result['next_route'] == 'extract'

    def test_confirming_yes_routes_to_confirm(self):
        state: WebSenseState = {
            'conversation_phase': 'confirming',
            'raw_transcript': 'yes',
        }
        result = router_node(state)
        assert result['next_route'] == 'confirm'

    def test_confirming_no_routes_to_confirm(self):
        state: WebSenseState = {
            'conversation_phase': 'confirming',
            'raw_transcript': 'no',
        }
        result = router_node(state)
        assert result['next_route'] == 'confirm'

    def test_confirming_new_input_routes_to_extract(self):
        state: WebSenseState = {
            'conversation_phase': 'confirming',
            'raw_transcript': 'my email is test@test.com',
        }
        result = router_node(state)
        assert result['next_route'] == 'extract'

    def test_correcting_routes_to_correction(self):
        state: WebSenseState = {
            'conversation_phase': 'correcting',
            'raw_transcript': 'name is wrong',
        }
        result = router_node(state)
        assert result['next_route'] == 'correction'

    def test_spelling_routes_to_correction(self):
        state: WebSenseState = {
            'conversation_phase': 'spelling',
            'raw_transcript': 'a h m e d',
        }
        result = router_node(state)
        assert result['next_route'] == 'correction'

    def test_spell_confirm_routes_to_correction(self):
        state: WebSenseState = {
            'conversation_phase': 'spell_confirm',
            'raw_transcript': 'yes',
        }
        result = router_node(state)
        assert result['next_route'] == 'correction'

    def test_idle_spell_command_routes_to_spell(self):
        state: WebSenseState = {
            'conversation_phase': 'idle',
            'raw_transcript': 'spell name',
        }
        result = router_node(state)
        assert result['next_route'] == 'spell_command'


# ================================================================
# Yes/No Detection Tests
# ================================================================
class TestYesNoDetection:

    def test_is_yes_basic(self):
        assert _is_yes('yes') is True
        assert _is_yes('Yeah') is True
        assert _is_yes('ok') is True
        assert _is_yes('sure') is True
        assert _is_yes('go ahead') is True

    def test_is_no_basic(self):
        assert _is_no('no') is True
        assert _is_no('wrong') is True
        assert _is_no('fix') is True
        assert _is_no('nope') is True

    def test_is_yes_rejects_no(self):
        assert _is_yes('no') is False
        assert _is_yes('wrong') is False

    def test_is_no_rejects_yes(self):
        assert _is_no('yes') is False
        assert _is_no('ok') is False


# ================================================================
# Review Node Tests
# ================================================================
class TestReviewNode:

    def test_builds_confirmation_with_fields(self):
        state: WebSenseState = {
            'extracted_fields': {
                'firstName': {'value': 'Ahmed', 'confidence': 0.95},
                'email': {'value': 'test@test.com', 'confidence': 0.9},
            },
            'confidence_scores': {},
            'missing_fields': [],
            'page_fields': [
                {'id': 'firstName', 'name': 'firstName', 'label': 'First Name'},
                {'id': 'email', 'name': 'email', 'label': 'Email'},
            ],
        }
        result = review_node(state)
        assert result['conversation_phase'] == 'confirming'
        assert result['bot_response']['action'] == 'confirm_fill'
        assert 'Ahmed' in result['bot_response']['message']

    def test_no_fields_returns_show_fields(self):
        state: WebSenseState = {
            'extracted_fields': {},
            'confidence_scores': {},
            'missing_fields': [],
            'page_fields': [],
        }
        result = review_node(state)
        assert result['conversation_phase'] == 'idle'
        assert result['bot_response']['action'] == 'show_fields'


# ================================================================
# Confirm Handler Tests
# ================================================================
class TestConfirmHandler:

    def test_yes_routes_to_fill(self):
        state: WebSenseState = {
            'raw_transcript': 'yes',
            'extracted_fields': {'name': {'value': 'Ahmed'}},
            'page_fields': [],
        }
        result = confirm_handler_node(state)
        assert result['confirm_route'] == 'fill'

    def test_no_enters_correction_mode(self):
        state: WebSenseState = {
            'raw_transcript': 'no',
            'extracted_fields': {'name': {'value': 'Ahmed'}},
            'page_fields': [],
        }
        result = confirm_handler_node(state)
        assert result['conversation_phase'] == 'correcting'
        assert result['confirm_route'] == 'end'
        assert result['bot_response']['action'] == 'ask_correction'


# ================================================================
# Fill Node Tests
# ================================================================
class TestFillNode:

    def test_builds_fill_payload(self):
        state: WebSenseState = {
            'extracted_fields': {
                'firstName': {'value': 'Ahmed', 'confidence': 0.95},
            },
            'matched_selectors': {'firstName': ['#firstName']},
            'confidence_scores': {'firstName': 0.95},
            'page_fields': [{'id': 'firstName', 'name': 'firstName', 'label': 'First Name'}],
            'session_id': 'test_sess',
        }
        result = fill_node(state)
        assert result['conversation_phase'] == 'idle'
        assert result['bot_response']['action'] == 'execute_fill'
        assert 'firstName' in result['bot_response']['fields_to_fill']
        assert result['bot_response']['fields_to_fill']['firstName']['value'] == 'Ahmed'


# ================================================================
# Label Map Helper Tests
# ================================================================
class TestBuildLabelMap:

    def test_builds_map_from_page_fields(self):
        fields = [
            {'id': 'firstName', 'name': 'first_name', 'label': 'First Name'},
            {'id': 'email', 'name': 'email', 'placeholder': 'Your email'},
        ]
        label_map = _build_label_map(fields)
        assert label_map.get('firstName') == 'First Name'
        assert label_map.get('first_name') == 'First Name'
        assert label_map.get('email') == 'Your email'


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
