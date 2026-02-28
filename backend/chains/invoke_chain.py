#!/usr/bin/env python3
"""
WebSense-AI Form Filling Chain Invocation Script

Called by Node.js backend to execute the LangGraph form filling chain.
Receives JSON payload via command-line argument, invokes the chain,
and outputs JSON result to stdout.

Usage:
    python invoke_chain.py '{"transcript": "...", "page_fields": [...], ...}'
"""

import sys
import json
import os
from typing import Dict, Any

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from chains.graph import invoke_form_filling
except ImportError as e:
    error_response = {
        "action": "error",
        "message": f"Failed to import chain modules: {str(e)}",
    }
    print(json.dumps(error_response))
    sys.exit(1)


def main() -> None:
    """
    Main entry point for chain invocation.
    Reads JSON from command-line arg, invokes chain, outputs result.
    """
    try:
        # Read JSON payload from command-line argument
        if len(sys.argv) < 2:
            error_response = {
                "action": "error",
                "message": "Missing JSON payload argument",
            }
            print(json.dumps(error_response))
            sys.exit(1)

        payload_json = sys.argv[1]
        payload = json.loads(payload_json)

        # Extract required fields
        transcript = payload.get("transcript", "")
        page_fields = payload.get("page_fields", [])
        session_id = payload.get("session_id", "")
        user_id = payload.get("user_id", "default_user")
        resume_state = payload.get("resume_state", {})

        # Validate required fields
        if not transcript or not session_id:
            error_response = {
                "action": "error",
                "message": "Missing required fields: transcript and session_id",
            }
            print(json.dumps(error_response))
            sys.exit(1)

        # Invoke the LangGraph chain — returns a BotResponse dict
        result = invoke_form_filling(
            transcript=transcript,
            page_fields=page_fields,
            session_id=session_id,
            user_id=user_id,
            resume_state=resume_state,
        )

        # Output result as JSON to stdout
        print(json.dumps(result))
        sys.exit(0)

    except json.JSONDecodeError as e:
        error_response = {
            "action": "error",
            "message": f"Invalid JSON payload: {str(e)}",
        }
        print(json.dumps(error_response))
        sys.exit(1)

    except Exception as e:
        error_response = {
            "action": "error",
            "message": f"Chain execution failed: {str(e)}",
        }
        print(json.dumps(error_response))
        sys.exit(1)


if __name__ == "__main__":
    main()
