"""
Test script for spaCy NLP command parser
Runs test commands from test_commands.txt and shows parsing results
"""

import requests
import json
import sys

SPACY_SERVER = "http://localhost:5001"

def test_parse(text):
    """Test parsing a single command"""
    try:
        response = requests.post(
            f"{SPACY_SERVER}/parse",
            json={"text": text},
            timeout=5
        )
        
        if response.status_code == 200:
            return response.json()
        else:
            return {"error": f"HTTP {response.status_code}"}
            
    except requests.exceptions.ConnectionError:
        return {"error": "Cannot connect to spaCy server. Is it running?"}
    except Exception as e:
        return {"error": str(e)}


def print_result(text, result):
    """Pretty print parsing result"""
    print(f"\n{'='*70}")
    print(f"📝 Command: \"{text}\"")
    print(f"{'='*70}")
    
    if "error" in result:
        print(f"❌ Error: {result['error']}")
        return
    
    print(f"🎯 Action:      {result.get('action', 'None')}")
    print(f"🎪 Target:      {result.get('target', 'None')}")
    print(f"➡️  Direction:   {result.get('direction', 'None')}")
    print(f"🔢 Number:      {result.get('number', 'None')}")
    print(f"📋 Descriptor:  {result.get('descriptor', 'None')}")
    print(f"✅ Confirmation:{result.get('confirmation', 'None')}")
    print(f"📊 Confidence:  {result.get('confidence', 0):.0%}")


def check_server_health():
    """Check if spaCy server is running"""
    try:
        response = requests.get(f"{SPACY_SERVER}/health", timeout=3)
        if response.status_code == 200:
            health = response.json()
            print("\n✅ spaCy Server Health Check:")
            print(f"   Status: {health.get('status', 'unknown')}")
            print(f"   Model: {health.get('model', 'unknown')}")
            return True
        else:
            print(f"\n❌ Server returned status {response.status_code}")
            return False
    except:
        print("\n❌ Cannot connect to spaCy server!")
        print(f"   Make sure it's running on {SPACY_SERVER}")
        return False


def run_test_file(filename="test_commands.txt"):
    """Run all commands from test file"""
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            commands = [line.strip() for line in f if line.strip() and not line.startswith('#')]
        
        print(f"\n🧪 Testing {len(commands)} commands from {filename}")
        
        stats = {"total": 0, "success": 0, "high_confidence": 0}
        
        for cmd in commands:
            result = test_parse(cmd)
            stats["total"] += 1
            
            if "error" not in result:
                stats["success"] += 1
                if result.get("confidence", 0) >= 0.7:
                    stats["high_confidence"] += 1
            
            print_result(cmd, result)
        
        # Print summary
        print(f"\n{'='*70}")
        print("📊 TEST SUMMARY")
        print(f"{'='*70}")
        print(f"Total commands:      {stats['total']}")
        print(f"Successfully parsed: {stats['success']} ({stats['success']/stats['total']*100:.1f}%)")
        print(f"High confidence:     {stats['high_confidence']} ({stats['high_confidence']/stats['total']*100:.1f}%)")
        print(f"{'='*70}\n")
        
    except FileNotFoundError:
        print(f"❌ Test file '{filename}' not found!")


def interactive_mode():
    """Interactive command testing"""
    print("\n🎤 Interactive Mode - Type commands to test (or 'quit' to exit)")
    print("="*70)
    
    while True:
        try:
            cmd = input("\n💬 Command: ").strip()
            
            if not cmd:
                continue
            
            if cmd.lower() in ['quit', 'exit', 'q']:
                print("👋 Goodbye!")
                break
            
            result = test_parse(cmd)
            print_result(cmd, result)
            
        except KeyboardInterrupt:
            print("\n\n👋 Goodbye!")
            break


if __name__ == "__main__":
    print("\n" + "="*70)
    print("🧠 spaCy NLP Command Parser - Test Suite")
    print("="*70)
    
    # Check server health
    if not check_server_health():
        print("\n💡 Start the server with: python spacy_server.py")
        sys.exit(1)
    
    # Parse command line arguments
    if len(sys.argv) > 1:
        if sys.argv[1] == "-i" or sys.argv[1] == "--interactive":
            interactive_mode()
        elif sys.argv[1] == "-t" or sys.argv[1] == "--test":
            run_test_file()
        else:
            # Test single command
            cmd = " ".join(sys.argv[1:])
            result = test_parse(cmd)
            print_result(cmd, result)
    else:
        # Show usage
        print("\nUsage:")
        print("  python test_nlp.py -i                  # Interactive mode")
        print("  python test_nlp.py -t                  # Run test file")
        print("  python test_nlp.py \"your command\"      # Test single command")
        print("\nExamples:")
        print("  python test_nlp.py \"show all buttons\"")
        print("  python test_nlp.py \"click the first link\"")
        print("  python test_nlp.py -i\n")
