"""
spaCy NLP Server for Voice Command Processing
Provides intelligent intent and entity extraction for voice commands
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import spacy
from spacy.matcher import Matcher
from spacy.tokens import Span
import json
import re
import logging
from datetime import datetime
from difflib import SequenceMatcher
import random

app = Flask(__name__)
CORS(app)

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Load spaCy model
try:
    nlp = spacy.load("en_core_web_md")
    logger.info("✅ Loaded spaCy model: en_core_web_md")
except:
    logger.warning("⚠️  Could not load en_core_web_md, trying en_core_web_sm...")
    try:
        nlp = spacy.load("en_core_web_sm")
        logger.info("✅ Loaded spaCy model: en_core_web_sm")
    except:
        logger.error("❌ No spaCy model found. Please run: python -m spacy download en_core_web_sm")
        nlp = None

# Initialize matcher for custom patterns
matcher = Matcher(nlp.vocab) if nlp else None

# Define command patterns for voice navigation
if matcher:
    # Action patterns (click, open, show, etc.)
    click_pattern = [
        {"LEMMA": {"IN": ["click", "press", "tap", "select", "push", "hit", "activate"]}},
    ]
    
    show_pattern = [
        {"LEMMA": {"IN": ["show", "list", "find", "display", "see", "get", "reveal"]}},
    ]
    
    scroll_pattern = [
        {"LEMMA": {"IN": ["scroll", "move", "go", "navigate"]}},
    ]
    
    open_pattern = [
        {"LEMMA": {"IN": ["open", "launch", "start", "create", "make"]}},
    ]
    
    close_pattern = [
        {"LEMMA": {"IN": ["close", "shut", "exit", "remove", "delete"]}},
    ]
    
    zoom_pattern = [
        {"LEMMA": {"IN": ["zoom", "enlarge", "magnify", "shrink", "reduce"]}},
    ]
    
    # Target patterns (button, link, menu, etc.)
    button_pattern = [{"LOWER": {"IN": ["button", "buttons"]}}]
    link_pattern = [{"LOWER": {"IN": ["link", "links"]}}]
    menu_pattern = [{"LOWER": {"IN": ["menu", "menus", "dropdown", "navigation"]}}]
    input_pattern = [{"LOWER": {"IN": ["input", "inputs", "field", "fields", "textbox"]}}]
    tab_pattern = [{"LOWER": {"IN": ["tab", "tabs", "window"]}}]
    
    # Register patterns
    matcher.add("ACTION_CLICK", [click_pattern])
    matcher.add("ACTION_SHOW", [show_pattern])
    matcher.add("ACTION_SCROLL", [scroll_pattern])
    matcher.add("ACTION_OPEN", [open_pattern])
    matcher.add("ACTION_CLOSE", [close_pattern])
    matcher.add("ACTION_ZOOM", [zoom_pattern])
    matcher.add("TARGET_BUTTON", [button_pattern])
    matcher.add("TARGET_LINK", [link_pattern])
    matcher.add("TARGET_MENU", [menu_pattern])
    matcher.add("TARGET_INPUT", [input_pattern])
    matcher.add("TARGET_TAB", [tab_pattern])


class ConversationContext:
    """Remembers conversation like a human would"""
    
    def __init__(self):
        self.last_action = None
        self.last_target = None
        self.last_descriptor = None
        self.history = []
        self.max_history = 30
    
    def update(self, action, target, descriptor):
        """Update context with latest command"""
        self.last_action = action
        self.last_target = target
        self.last_descriptor = descriptor
        self.history.append({
            'action': action,
            'target': target,
            'descriptor': descriptor,
            'timestamp': datetime.now()
        })
        # Keep only recent history
        if len(self.history) > self.max_history:
            self.history = self.history[-self.max_history:]
    
    def resolve_reference(self, text):
        """Handle "it", "that", "same thing", "click it again" """
        text_lower = text.lower()
        
        # References to previous element
        if any(word in text_lower for word in ['it', 'that', 'this', 'there']):
            if self.last_descriptor:
                return self.last_descriptor
        
        # Repeat entire command
        if any(phrase in text_lower for phrase in ['again', 'same thing', 'repeat', 'once more']):
            return {
                'action': self.last_action,
                'target': self.last_target,
                'descriptor': self.last_descriptor
            }
        
        return None
    
    def clear(self):
        """Clear context for fresh start"""
        self.__init__()


class CommandParser:
    """Intelligent command parser using spaCy NLP"""
    
    # Intent mapping based on verbs - EXPANDED with more natural language
    ACTION_INTENTS = {
        'click': ['click', 'press', 'tap', 'select', 'push', 'hit', 'activate', 'choose', 'pick', 'press on'],
        'show': ['show', 'list', 'find', 'display', 'see', 'get', 'reveal', 'give', 'highlight', 
                 'locate', 'search', 'identify', 'detect', 'point out', 'show me', 'let me see'],
        'scroll': ['scroll', 'move', 'go', 'navigate', 'swipe', 'slide', 'glide', 'scroll down', 'scroll up', 
                   'go down', 'go up', 'move down', 'move up', 'page down', 'page up'],
        'open': ['open', 'launch', 'start', 'create', 'make', 'add', 'new', 'begin', 'open up'],
        'navigate': ['navigate', 'go to', 'visit', 'browse to', 'take me to', 'show me'],
        'close': ['close', 'shut', 'exit', 'remove', 'delete', 'dismiss', 'hide', 'close it', 'shut it'],
        'zoom': ['zoom', 'enlarge', 'magnify', 'shrink', 'reduce', 'bigger', 'smaller', 'increase', 'decrease', 
                 'zoom in', 'zoom out', 'make bigger', 'make smaller'],
        'reload': ['reload', 'refresh', 'update', 'renew', 'restart', 'reload page', 'refresh page'],
        'help': ['help', 'help me', 'what can you do', 'show help', 'assist', 'guide me', 'how do i'],
        'back': ['back', 'return', 'previous', 'revert'],
        'forward': ['forward', 'next', 'advance', 'continue', 'proceed'],
        'stop': ['stop', 'pause', 'deactivate', 'silence', 'halt', 'freeze'],
        'help': ['help', 'assist', 'guide', 'info', 'information', 'what can', 'how do', 'teach'],
        'duplicate': ['duplicate', 'copy', 'clone', 'replicate', 'duplicate tab', 'copy tab', 'same tab', 'clone tab'],
        'fill': ['fill', 'enter', 'type', 'input', 'write', 'insert'],
        'read': ['read', 'say', 'tell', 'speak', 'announce', 'recite'],
        'count': ['count', 'how many', 'number of', 'total', 'count up', 'tally'],
        'search': ['search', 'find', 'look for', 'locate', 'hunt', 'search for', 'look up'],
        'undo': ['undo', 'undo that', 'go back', 'goback', 'revert', 'reverse', 'rollback', 'cancel last', 'take back', 'undo it'],
        'find': ['find', 'search', 'locate', 'look for', 'where is', 'show me', 'find me'],
        'greet': ['hello', 'hi', 'hey', 'greetings', 'good morning', 'good afternoon', 'good evening'],
        'thank': ['thank you', 'thanks', 'thank', 'appreciate it', 'thanks a lot', 'much appreciated'],
        'confirm': ['yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'alright', 'correct', 'right', 'affirmative'],
        'deny': ['no', 'nope', 'nah', 'negative', 'not really', 'cancel']
    }
    
    # Target types - EXPANDED
    TARGETS = {
        'button': ['button', 'buttons', 'btn', 'submit', 'submit button'],
        'link': ['link', 'links', 'hyperlink', 'url', 'anchor'],
        'menu': ['menu', 'menus', 'dropdown', 'navigation', 'nav', 'navbar', 'menu bar'],
        'input': ['input', 'inputs', 'field', 'fields', 'textbox', 'textarea', 'form field', 'search box'],
        'tab': ['tab', 'tabs', 'window', 'windows', 'browser tab'],
        'heading': ['heading', 'header', 'title', 'headings', 'h1', 'h2', 'h3'],
        'page': ['page', 'site', 'website', 'webpage', 'web page'],
        'image': ['image', 'images', 'picture', 'pictures', 'photo', 'photos', 'img', 'thumbnail'],
        'video': ['video', 'videos', 'clip', 'clips', 'media'],
        'text': ['text', 'paragraph', 'content', 'words', 'sentence'],
        'table': ['table', 'tables', 'grid', 'data', 'spreadsheet'],
        'list': ['list', 'lists', 'items', 'bullet points'],
        'all': ['all', 'everything', 'clickable', 'clickables', 'anything', 'all of them'],
        'element': ['element', 'thing', 'item', 'something', 'object']
    }
    
    # Direction/position modifiers - EXPANDED
    DIRECTIONS = {
        'up': ['up', 'upward', 'upwards', 'above', 'higher', 'top', 'scroll up'],
        'down': ['down', 'downward', 'downwards', 'below', 'lower', 'bottom', 'scroll down'],
        'left': ['left', 'leftward', 'westward'],
        'right': ['right', 'rightward', 'eastward'],
        'top': ['top', 'beginning', 'start', 'first', 'initial'],
        'bottom': ['bottom', 'end', 'last', 'final'],
        'first': ['first', 'initial', '1st', 'number one'],
        'second': ['second', '2nd', 'number two'],
        'third': ['third', '3rd', 'number three'],
        'last': ['last', 'final', 'end'],
        'next': ['next', 'following', 'after'],
        'previous': ['previous', 'prior', 'prev', 'before', 'earlier'],
        'middle': ['middle', 'center', 'central'],
        'all': ['all', 'every', 'each', 'everything']
    }
    
    # Number words mapping
    NUMBER_WORDS = {
        'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
        'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
        'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
        'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20,
        'thirty': 30, 'forty': 40, 'fifty': 50
    }
    
    def __init__(self):
        self.nlp = nlp
        self.matcher = matcher
    
    def extract_number(self, doc):
        """Extract numbers from text (both digits and words)"""
        # Check for digit numbers
        for token in doc:
            if token.like_num:
                try:
                    return int(token.text)
                except:
                    pass
        
        # Check for word numbers
        text_lower = doc.text.lower()
        for word, num in self.NUMBER_WORDS.items():
            if word in text_lower:
                return num
        
        return None
    
    def extract_action(self, doc):
        """Extract primary action/intent from command"""
        # Use matcher to find action patterns
        matches = self.matcher(doc) if self.matcher else []
        
        action_matches = []
        for match_id, start, end in matches:
            match_name = nlp.vocab.strings[match_id]
            if match_name.startswith("ACTION_"):
                action_matches.append(match_name.replace("ACTION_", "").lower())
        
        if action_matches:
            return action_matches[0]
        
        # Fallback: Check verb lemmas
        for token in doc:
            if token.pos_ == "VERB":
                lemma = token.lemma_.lower()
                for intent, verbs in self.ACTION_INTENTS.items():
                    if lemma in verbs:
                        return intent
        
        # Check entire text for keywords (more flexible)
        text_lower = doc.text.lower()
        for intent, keywords in self.ACTION_INTENTS.items():
            for keyword in keywords:
                if keyword in text_lower:
                    return intent
        
        return None
    
    def extract_target(self, doc):
        """Extract target element type from command"""
        # Use matcher to find target patterns
        matches = self.matcher(doc) if self.matcher else []
        
        target_matches = []
        for match_id, start, end in matches:
            match_name = nlp.vocab.strings[match_id]
            if match_name.startswith("TARGET_"):
                target_matches.append(match_name.replace("TARGET_", "").lower())
        
        if target_matches:
            return target_matches[0]
        
        # Fallback: Check for target keywords in text
        text_lower = doc.text.lower()
        for target, keywords in self.TARGETS.items():
            for keyword in keywords:
                if keyword in text_lower:
                    return target
        
        return None
    
    def extract_direction(self, doc):
        """Extract direction or position modifier"""
        text_lower = doc.text.lower()
        for direction, keywords in self.DIRECTIONS.items():
            for keyword in keywords:
                if keyword in text_lower:
                    return direction
        return None
    
    def extract_descriptor(self, doc):
        """Extract descriptive text (e.g., button name)"""
        # Remove common filler words and action words
        filler_words = {'could', 'you', 'please', 'kindly', 'want', 'would', 'like', 
                       'need', 'the', 'a', 'an', 'this', 'that', 'just', 'go', 'ahead'}
        
        action_words = set()
        for verbs in self.ACTION_INTENTS.values():
            action_words.update(verbs)
        
        target_words = set()
        for targets in self.TARGETS.values():
            target_words.update(targets)
        
        direction_words = set()
        for dirs in self.DIRECTIONS.values():
            direction_words.update(dirs)
        
        # Extract meaningful nouns and adjectives
        descriptors = []
        for token in doc:
            if token.pos_ in ['NOUN', 'PROPN', 'ADJ'] and \
               token.text.lower() not in filler_words and \
               token.text.lower() not in action_words and \
               token.text.lower() not in target_words and \
               token.text.lower() not in direction_words:
                descriptors.append(token.text.lower())
        
        return ' '.join(descriptors) if descriptors else None
    
    def is_confirmation(self, doc):
        """Check if command is a yes/no confirmation"""
        text_lower = doc.text.lower().strip()
        
        # Expanded confirmation words
        yes_words = ['yes', 'yep', 'yeah', 'yup', 'sure', 'okay', 'ok', 'affirmative', 
                     'confirm', 'proceed', 'absolutely', 'definitely', 'correct', 'right',
                     'go ahead', 'do it', 'please', 'exactly', 'uh huh', 'uhuh', 'yay']
        no_words = ['no', 'nope', 'nah', 'never', "don't", 'cancel', 'negative', 
                    'abort', 'skip', 'pass', 'wrong', 'incorrect', 'stop', 'halt',
                    'not that', "don't do", 'wait', 'hold on', 'uh uh', 'uhuh', 'nay']
        
        # Check for explicit yes/no
        has_yes = any(word in text_lower for word in yes_words)
        has_no = any(word in text_lower for word in no_words)
        
        if has_yes and not has_no:
            return 'yes'
        elif has_no and not has_yes:
            return 'no'
        
        return None
    
    def extract_cancel_command(self, doc):
        """Detect cancel/stop/clear commands"""
        text_lower = doc.text.lower().strip()
        
        cancel_keywords = ['cancel', 'stop', 'clear', 'remove', 'hide', 'nevermind',
                          'never mind', 'forget', 'undo', 'dismiss', 'close this',
                          'go back', 'exit', 'quit', 'deactivate', 'turn off']
        
        return any(keyword in text_lower for keyword in cancel_keywords)
    
    def is_question(self, text):
        """Is user asking a question?"""
        text_lower = text.lower()
        return (text_lower.startswith(('where', 'what', 'how', 'can you', 'could you', 'show me')) 
                or '?' in text)
    
    def is_correction(self, text):
        """Is user correcting previous command?"""
        corrections = ['no', 'not that', 'wrong', 'other', 'different', 
                      'i meant', 'actually', 'instead', 'wait']
        return any(word in text.lower() for word in corrections)
    
    def find_best_match(self, user_text, elements):
        """Match what user said to actual elements on page using multiple strategies"""
        if not user_text or not elements:
            return None, 0.0
        
        best_idx = None
        best_score = 0.0
        
        user_lower = user_text.lower()
        
        for idx, elem in enumerate(elements):
            elem_text = elem.get('text', '').lower()
            
            if not elem_text:
                continue
            
            # Strategy 1: Perfect substring match (highest priority)
            if user_lower in elem_text or elem_text in user_lower:
                return idx, 1.0
            
            # Strategy 2: Word overlap scoring
            user_words = set(user_lower.split())
            elem_words = set(elem_text.split())
            if user_words and elem_words:
                overlap = len(user_words & elem_words) / len(user_words)
                if overlap > best_score:
                    best_score = overlap
                    best_idx = idx
            
            # Strategy 3: Character similarity (fuzzy matching)
            similarity = SequenceMatcher(None, user_lower, elem_text).ratio()
            if similarity > best_score:
                best_score = similarity
                best_idx = idx
            
            # Strategy 4: spaCy semantic similarity (if available)
            if self.nlp:
                try:
                    doc1 = self.nlp(user_lower)
                    doc2 = self.nlp(elem_text)
                    semantic = doc1.similarity(doc2)
                    if semantic > best_score:
                        best_score = semantic
                        best_idx = idx
                except:
                    pass
        
        # Only return if confident enough
        if best_score >= 0.5:
            return best_idx, best_score
        
        return None, 0.0
    
    def parse(self, text):
        """
        Parse voice command and extract structured information
        
        Returns:
            dict: {
                'action': str,      # Primary intent (click, show, scroll, etc.)
                'target': str,      # Target element type (button, link, etc.)
                'direction': str,   # Direction/position (up, down, first, last, etc.)
                'number': int,      # Number if selecting from list
                'descriptor': str,  # Additional descriptive text
                'confirmation': str, # yes/no if this is a confirmation
                'raw_text': str,    # Original command
                'confidence': float # Confidence score (0-1)
            }
        """
        if not self.nlp:
            return {
                'error': 'spaCy model not loaded',
                'raw_text': text
            }
        
        doc = self.nlp(text.lower())
        
        # Extract components
        action = self.extract_action(doc)
        target = self.extract_target(doc)
        direction = self.extract_direction(doc)
        number = self.extract_number(doc)
        descriptor = self.extract_descriptor(doc)
        confirmation = self.is_confirmation(doc)
        is_cancel = self.extract_cancel_command(doc)
        
        # Handle cancel commands specially
        if is_cancel:
            return {
                'action': 'cancel',
                'target': None,
                'direction': None,
                'number': None,
                'descriptor': None,
                'confirmation': None,
                'raw_text': text,
                'confidence': 95,
                'is_cancel': True
            }
        
        # Calculate confidence based on extracted components
        confidence = 0.0
        if action:
            confidence += 0.4
        if target:
            confidence += 0.3
        if direction or number or descriptor:
            confidence += 0.2
        if confirmation:
            confidence = 0.9  # High confidence for yes/no
        
        # Minimum baseline confidence
        confidence = max(confidence, 0.1)
        
        result = {
            'action': action,
            'target': target,
            'direction': direction,
            'number': number,
            'descriptor': descriptor,
            'confirmation': confirmation,
            'raw_text': text,
            'confidence': confidence,
            'success': True
        }
        
        return result


def generate_human_response(action, element=None, direction=None):
    """Respond like a human assistant would"""
    
    responses = {
        'click': [
            f"Clicking {element.get('text')}" if element else "Clicking that",
            f"Opening {element.get('text')}" if element else "Opening that",
            "Got it!" if element else "Done",
            "On it!" if element else "Okay",
            "Done" if element else "Sure"
        ],
        'scroll': [
            f"Scrolling {direction}" if direction else "Scrolling",
            f"Moving {direction}" if direction else "Moving down",
            f"Going {direction}" if direction else "Scrolling page",
            "Showing you more" if direction else "Scrolling"
        ],
        'scroll_continuous': [
            "Starting continuous scroll",
            "Auto-scrolling now",
            "Keeping it scrolling",
            "Will keep scrolling"
        ],
        'stop_scroll': [
            "Stopping scroll",
            "Scroll stopped",
            "Halting auto-scroll",
            "Paused scrolling",
            "Stopped",
            "Halted",
            "Scrolling paused",
            "Auto-scroll stopped",
            "Done scrolling",
            "Scroll cancelled",
            "Scrolling ended",
            "No more scrolling",
            "Froze the scroll",
            "Ceased scrolling",
            "Scroll halted"
        ],
        'show': [
            f"Here you go! Showing {element.get('text')}" if element else "Here it is!",
            f"Found {element.get('text')} for you" if element else "Found it!",
            f"Let me highlight {element.get('text')}" if element else "Highlighting that now",
            "Here's what I found",
            "Got it! Showing you now",
            "There you go!"
        ],
        'back': [
            "Going back now",
            "Taking you to the previous page",
            "Heading back",
            "Back we go!",
            "Previous page coming up"
        ],
        'forward': [
            "Moving forward",
            "Next page!",
            "Going ahead",
            "Forward we go!",
            "Taking you forward"
        ],
        'reload': [
            "Refreshing the page for you",
            "Reloading now",
            "Updating the page",
            "Fresh content coming up!",
            "Refreshing!",
            "Page reload in progress"
        ],
        'duplicate': [
            "Duplicating this tab for you",
            "Creating a copy",
            "Cloning this tab",
            "Making a duplicate tab",
            "Tab copied!",
            "Duplicate tab created"
        ],
        'fill': [
            "Filling that in for you",
            "Entering the text",
            "Typing it up",
            "Got it, filling now",
            "Text entered!"
        ],
        'read': [
            "Reading that aloud for you",
            "Here's what it says",
            "Let me read that",
            "Reading now",
            "Here's the content"
        ],
        'help': [
            "I'm here to help! What do you need?",
            "Happy to assist!",
            "Let me guide you",
            "Here's what I can do for you",
            "How can I help you today?"
        ],
        'click': [
            "Clicking that for you",
            "Got it! Clicking now",
            "Pressing that button",
            "Click activated!",
            f"Clicking {element.get('text')} now" if element else "Clicking!",
            "Done! Clicked it"
        ],
        'scroll': [
            "Scrolling for you",
            f"Scrolling {direction if direction else 'down'}" if direction else "Scrolling now",
            "Moving the page",
            "Got it! Scrolling",
            "Here we go, scrolling!"
        ],
        'open': [
            "Opening that for you",
            "Launching now",
            "Opening it up!",
            "Here we go!",
            "Opening!"
        ],
        'close': [
            "Closing that",
            "Shutting it down",
            "Closed!",
            "Done, closed it",
            "All closed up"
        ],
        'navigate': [
            "Taking you there",
            "Navigating now",
            "On my way!",
            "Going there now",
            "Navigation started!"
        ],
        'stop': ["Stopping", "Paused", "Halted", "Stopped!"],
        'undo': ["Undoing that for you", "Going back", "Reverting", "Undo complete!"],
        'find': ["Searching for that", "Looking for it", "Finding it now", "Search in progress!"],
        'cancel': ["Cancelled!", "Okay, cancelling", "All clear!", "Cancelled that for you"],
        'greet': [
            "Hello! How can I help you?",
            "Hi there! What would you like to do?",
            "Hey! I'm ready to assist!",
            "Greetings! What can I do for you?",
            "Hello! Ready when you are!",
            "Hi! Let me know what you need!"
        ],
        'thank': [
            "You're welcome!",
            "Happy to help!",
            "My pleasure!",
            "Anytime!",
            "Glad I could help!",
            "No problem at all!",
            "You're very welcome!",
            "Always here to help!"
        ],
        'confirm': [
            "Got it!",
            "Okay, confirmed!",
            "Understood!",
            "Perfect!",
            "Alright, proceeding!",
            "Confirmed!"
        ],
        'deny': [
            "Okay, cancelling",
            "No problem, cancelled",
            "Got it, stopping",
            "Understood, won't do that",
            "Alright, skipping that"
        ]
    }
    
    options = responses.get(action, ["Done!", "Okay!", "Got it!", "All set!", "There you go!", "Perfect!"])
    return random.choice(options)


# Initialize parser and context
parser = CommandParser()
conversation_context = ConversationContext()


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'spacy_loaded': nlp is not None,
        'model': nlp.meta['name'] if nlp else None
    })


@app.route('/parse', methods=['POST'])
def parse_command():
    """
    Parse a voice command and return structured data
    
    Request body:
        {
            "text": "show all buttons on the page"
        }
    
    Response:
        {
            "action": "show",
            "target": "button",
            "direction": null,
            "number": null,
            "descriptor": null,
            "confirmation": null,
            "raw_text": "show all buttons on the page",
            "confidence": 0.7,
            "success": true
        }
    """
    try:
        data = request.get_json()
        
        if not data or 'text' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing "text" field in request body'
            }), 400
        
        text = data['text']
        
        if not text or not text.strip():
            return jsonify({
                'success': False,
                'error': 'Empty text provided'
            }), 400
        
        result = parser.parse(text)
        
        return jsonify(result)
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'raw_text': data.get('text', '') if 'data' in locals() else ''
        }), 500


@app.route('/batch-parse', methods=['POST'])
def batch_parse():
    """
    Parse multiple commands in one request
    
    Request body:
        {
            "commands": ["show buttons", "scroll down", "click link three"]
        }
    """
    try:
        data = request.get_json()
        
        if not data or 'commands' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing "commands" field in request body'
            }), 400
        
        commands = data['commands']
        
        if not isinstance(commands, list):
            return jsonify({
                'success': False,
                'error': '"commands" must be an array'
            }), 400
        
        results = []
        for cmd in commands:
            if cmd and cmd.strip():
                results.append(parser.parse(cmd))
        
        return jsonify({
            'success': True,
            'results': results
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/navigate', methods=['POST'])
def navigate():
    """
    Main navigation endpoint with intelligent element matching
    
    Request: {
        "command": "click the login button",
        "page_elements": [
            {"id": 0, "text": "Sign In", "type": "button", "selector": "#btn"},
            {"id": 1, "text": "Register", "type": "button"}
        ]
    }
    
    Response: {
        "success": true,
        "action": "click",
        "matched_element": {...},
        "human_response": "Clicking Sign In",
        "confidence": 0.95
    }
    """
    
    try:
        data = request.get_json()
        command = data.get('command', '')
        elements = data.get('page_elements', [])
        
        logger.info(f"Navigate command: {command}")
        
        # Check for correction
        if parser.is_correction(command):
            conversation_context.clear()
            return jsonify({
                'success': True,
                'action': 'cancel',
                'is_correction': True,
                'human_response': 'Okay, what did you mean instead?'
            })
        
        # Check for reference to previous command
        reference = conversation_context.resolve_reference(command)
        if isinstance(reference, dict):
            # "do that again" - full command repeat
            logger.info(f"Reference detected: {reference}")
            return jsonify({
                'success': True,
                **reference,
                'is_reference': True,
                'human_response': generate_human_response(reference.get('action')),
                'confidence': 0.9
            })
        elif reference:
            # "click it" - reference is descriptor
            action = parser.extract_action(parser.nlp(command))
            logger.info(f"Element reference: {reference}")
            
            # Try to match referenced descriptor
            if elements:
                match_idx, confidence = parser.find_best_match(reference, elements)
                if match_idx is not None:
                    matched = elements[match_idx]
                    return jsonify({
                        'success': True,
                        'action': action or 'click',
                        'matched_element': {
                            'id': matched.get('id'),
                            'selector': matched.get('selector'),
                            'text': matched.get('text'),
                            'confidence': confidence
                        },
                        'is_reference': True,
                        'human_response': generate_human_response(action or 'click', matched)
                    })
        
        # Parse fresh command
        parsed = parser.parse(command)
        
        action = parsed.get('action')
        target = parsed.get('target')
        descriptor = parsed.get('descriptor')
        direction = parsed.get('direction')
        number = parsed.get('number')
        
        # Handle simple navigation (no element needed)
        if action in ['scroll', 'back', 'forward', 'reload', 'stop', 'help']:
            conversation_context.update(action, None, None)
            return jsonify({
                'success': True,
                'action': action,
                'direction': direction,
                'human_response': generate_human_response(action, None, direction)
            })
        
        # Handle element-based actions
        if action and (descriptor or number is not None):
            # Filter by type if specified
            filtered = elements
            if target:
                filtered = [e for e in elements if e.get('type') == target]
                logger.info(f"Filtered to {len(filtered)} {target}s")
            
            # Handle number selection
            if number is not None:
                if 0 <= number - 1 < len(filtered):
                    matched = filtered[number - 1]
                    conversation_context.update(action, target, matched.get('text'))
                    
                    logger.info(f"Number match: #{number} -> {matched.get('text')}")
                    
                    return jsonify({
                        'success': True,
                        'action': action,
                        'matched_element': {
                            'id': matched.get('id'),
                            'selector': matched.get('selector'),
                            'text': matched.get('text'),
                            'confidence': 1.0
                        },
                        'human_response': generate_human_response(action, matched)
                    })
                else:
                    return jsonify({
                        'success': False,
                        'needs_clarification': True,
                        'message': f"I only see {len(filtered)} {target or 'elements'}. Please choose 1-{len(filtered)}."
                    })
            
            # Text-based matching
            if descriptor:
                match_idx, confidence = parser.find_best_match(descriptor, filtered)
                
                if match_idx is not None:
                    matched = filtered[match_idx]
                    conversation_context.update(action, target, descriptor)
                    
                    logger.info(f"Text match: '{descriptor}' -> '{matched.get('text')}' (confidence: {confidence:.2f})")
                    
                    return jsonify({
                        'success': True,
                        'action': action,
                        'matched_element': {
                            'id': matched.get('id'),
                            'selector': matched.get('selector'),
                            'text': matched.get('text'),
                            'confidence': confidence
                        },
                        'human_response': generate_human_response(action, matched)
                    })
                else:
                    # Couldn't find match - show options
                    available = [e.get('text') for e in filtered[:5] if e.get('text')]
                    return jsonify({
                        'success': False,
                        'needs_clarification': True,
                        'message': f"I couldn't find '{descriptor}'. Did you mean one of these?",
                        'options': available
                    })
        
        # Couldn't understand command
        logger.warning(f"Could not parse command: {command}")
        return jsonify({
            'success': False,
            'needs_clarification': True,
            'message': "I didn't quite catch that. Could you try again?",
            'parsed': parsed
        })
        
    except Exception as e:
        logger.error(f"Navigate error: {str(e)}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e),
            'human_response': "Sorry, I had trouble with that. Could you repeat?"
        }), 500


if __name__ == '__main__':
    print("\n🚀 Starting spaCy NLP Server for Voice Control...")
    print("=" * 60)
    
    if nlp:
        print(f"✅ spaCy model loaded: {nlp.meta['name']}")
        print(f"✅ Language: {nlp.meta['lang']}")
        print(f"✅ Matcher patterns registered: {len(matcher) if matcher else 0}")
    else:
        print("❌ WARNING: spaCy model not loaded!")
        print("   Please run: python -m spacy download en_core_web_sm")
    
    print("=" * 60)
    print("\n📡 Server running on http://localhost:5001")
    print("\n📍 Endpoints:")
    print("   GET  /health - Health check")
    print("   POST /parse - Parse command structure")
    print("   POST /batch-parse - Parse multiple commands")
    print("   POST /navigate - Intelligent navigation with element matching")
    print("\n💡 Test navigate endpoint:")
    print('   curl -X POST http://localhost:5001/navigate \\')
    print('     -H "Content-Type: application/json" \\')
    print('     -d \'{"command":"click login","page_elements":[{"id":0,"text":"Sign In","type":"button"}]}\'')
    print("\n")
    
    app.run(host='0.0.0.0', port=5001, debug=True)
