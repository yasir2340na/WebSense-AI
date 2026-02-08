# Voice Navigation System - Mermaid Diagrams

## 1. Overall System Architecture

```mermaid
graph TB
    subgraph "Chrome Extension"
        A[User Speaks Command] --> B[Web Speech API<br/>SpeechRecognition]
        B --> C[voiceControl.js<br/>Content Script]
        C --> D{Process Command}
        D --> E[Local Pattern Matching]
        D --> F[Send to NLP Server]
    end
    
    subgraph "Backend Services"
        F --> G[spacy_server.py<br/>Port 5001]
        G --> H[spaCy NLP Engine]
        H --> I[Intent Classification]
        I --> J[Entity Extraction]
        J --> K[Response Generation]
    end
    
    subgraph "Action Execution"
        K --> L[Return Action JSON]
        E --> M[Action Router]
        L --> M
        M --> N{Action Type?}
        N -->|Click| O[Find & Click Element]
        N -->|Scroll| P[Scroll Page]
        N -->|Navigate| Q[Browser Navigation]
        N -->|Show| R[Highlight Elements]
    end
    
    subgraph "Feedback"
        O --> S[Speech Synthesis]
        P --> S
        Q --> S
        R --> S
        S --> T[SpeechSynthesisUtterance]
        T --> U[User Hears Response]
    end

    style A fill:#e1f5ff
    style U fill:#e1f5ff
    style G fill:#fff4e6
    style H fill:#fff4e6
    style M fill:#e8f5e9
    style S fill:#f3e5f5
```

## 2. Voice Control Initialization Flow

```mermaid
sequenceDiagram
    participant User
    participant Keyboard
    participant BG as background.js
    participant Tab as Active Tab
    participant VC as voiceControl.js
    participant Storage as Chrome Storage
    participant SR as SpeechRecognition
    participant SS as SpeechSynthesis

    User->>Keyboard: Press Ctrl+Shift+V
    Keyboard->>BG: Keyboard Event
    BG->>BG: Check cooldown (2s)
    BG->>Tab: Inject voiceControl.js
    Tab->>VC: Execute Script
    
    VC->>VC: Check wsVoiceControlActive flag
    alt Already Active
        VC-->>Tab: Skip injection
    else Not Active
        VC->>VC: Set wsVoiceControlActive = true
        VC->>VC: Create UI (wrapper, button)
        VC->>VC: Initialize element cache
        VC->>VC: Setup MutationObserver
        VC->>SR: Create SpeechRecognition instance
        VC->>SS: Load voices
        
        VC->>Storage: Get welcomedDomains
        Storage-->>VC: Return domain list
        
        alt New Domain
            VC->>SS: Speak "Voice control activated..."
            VC->>Storage: Add current domain
        else Known Domain
            VC->>VC: Start silently
        end
        
        VC->>SR: Start recognition
        SR-->>User: Listening indicator (🔴)
    end
```

## 3. Command Processing Pipeline

```mermaid
flowchart TD
    A[User Speaks] --> B[SpeechRecognition.onresult]
    B --> C[Extract Transcript]
    C --> D{Check Command Type}
    
    D -->|Conversational| E[Local Handler]
    E --> E1{Type?}
    E1 -->|greet| E2[Random Greeting]
    E1 -->|thank| E3[You're Welcome]
    E1 -->|confirm| E4[Acknowledgment]
    E1 -->|deny| E5[Okay Response]
    E1 -->|help| E6[Show Help]
    
    D -->|Action Command| F[sendToSpacyServer]
    F --> G[HTTP POST to localhost:5001/process]
    G --> H[spacy_server.py]
    
    H --> I[Normalize Text]
    I --> J[Create spaCy Doc]
    J --> K[analyze_intent]
    K --> K1[Check Keywords]
    K --> K2[Check Verbs]
    K --> K3[Check Dependencies]
    
    K --> L[extract_entities]
    L --> L1[Find Noun Chunks]
    L --> L2[Named Entity Recognition]
    L --> L3[Dependency Parsing]
    
    L --> M[generate_response]
    M --> M1[Select Response Template]
    M --> M2[Random Variation]
    
    M2 --> N[Return JSON Response]
    N --> O[voiceControl.js receives]
    
    E2 --> P[executeAction]
    E3 --> P
    E4 --> P
    E5 --> P
    E6 --> P
    O --> P
    
    P --> Q{Action Router}
    Q -->|click| R[Click Handler]
    Q -->|scroll| S[Scroll Handler]
    Q -->|show| T[Show Handler]
    Q -->|navigate| U[Navigation Handler]
    Q -->|other| V[Other Handlers]
    
    R --> W[smartSpeak Response]
    S --> W
    T --> W
    U --> W
    V --> W
    
    W --> X[SpeechSynthesis.speak]
    X --> Y[User Hears Feedback]

    style A fill:#e3f2fd
    style Y fill:#e3f2fd
    style H fill:#fff3e0
    style P fill:#e8f5e9
    style W fill:#f3e5f5
```

## 4. Element Detection & Caching System

```mermaid
graph TB
    subgraph "Initial Cache"
        A[Page Load] --> B[updateElementCache]
        B --> C1[Query Buttons]
        B --> C2[Query Links]
        B --> C3[Query Clickables]
        B --> C4[Query cursor:pointer]
        
        C1 --> D[Filter Visible Elements]
        C2 --> D
        C3 --> D
        C4 --> D
        
        D --> E[Store in elementCache]
        E --> E1[buttons Array]
        E --> E2[links Array]
        E --> E3[clickables Array]
        E --> E4[lastUpdate timestamp]
    end
    
    subgraph "Dynamic Updates"
        F[MutationObserver] --> G{Check Mutations}
        G -->|Added Nodes| H{Important?}
        G -->|Removed Nodes| H
        G -->|Attributes Changed| H
        
        H -->|Yes: menu, dialog, nav| I[Immediate Update<br/>0ms delay]
        H -->|No: normal change| J[Debounced Update<br/>200ms delay]
        
        I --> B
        J --> B
    end
    
    subgraph "Event-Based Updates"
        K[User Clicks Expandable] --> L{Detect Element Type}
        L -->|dropdown| M[Wait 300ms]
        L -->|accordion| M
        L -->|details/summary| M
        L -->|aria-expanded| M
        
        M --> B
        
        N[Page Scroll] --> O{Cache Age?}
        O -->|> 2 seconds old| P[Update Cache]
        O -->|< 2 seconds| Q[Skip Update]
        P --> B
        
        R[DOMContentLoaded] --> S[Wait 500ms]
        S --> B
        
        T[Window Load] --> U[Wait 1000ms]
        U --> B
    end
    
    subgraph "Selectors Used"
        V[Buttons] --> V1["button, [role='button']<br/>input[type='submit']<br/>[class*='button']"]
        W[Links] --> W1["a[href], [role='link']"]
        X[Clickables] --> X1["[onclick], [data-action]<br/>div/span[class*='click']<br/>[role='tab/option/menuitem']<br/>[aria-haspopup]<br/>[class*='interactive']<br/>li[class*='item']<br/>[class*='card/tile']"]
        Y[Pointer] --> Y1["div, span, p, li, label<br/>with cursor:pointer"]
    end

    style B fill:#4caf50,color:#fff
    style I fill:#ff9800,color:#fff
    style J fill:#ffc107
    style E fill:#2196f3,color:#fff
```

## 5. Click Command Flow (Detailed)

```mermaid
sequenceDiagram
    participant User
    participant SR as SpeechRecognition
    participant VC as voiceControl.js
    participant NLP as spacy_server.py
    participant Cache as elementCache
    participant DOM as Page DOM
    participant SS as SpeechSynthesis

    User->>SR: "Click on login button"
    SR->>VC: transcript: "click on login button"
    VC->>NLP: POST /process<br/>{text: "click on login button"}
    
    NLP->>NLP: Tokenize & Parse
    NLP->>NLP: Intent: "click"
    NLP->>NLP: Target: "login button"
    NLP->>NLP: Response: "Clicking on login button"
    
    NLP-->>VC: {action: "click", target: "login button", response: "..."}
    
    VC->>SS: speak("Clicking on login button")
    VC->>Cache: Get all clickable elements
    Cache-->>VC: [buttons[], links[], clickables[]]
    
    VC->>VC: smartFindElement("login button")
    loop For each element
        VC->>VC: Check textContent
        VC->>VC: Check aria-label
        VC->>VC: Check title/alt
        VC->>VC: Calculate similarity score
    end
    
    VC->>VC: Select best match (highest score)
    VC->>DOM: element.getBoundingClientRect()
    DOM-->>VC: Position & visibility
    
    VC->>DOM: element.scrollIntoView({smooth})
    VC->>DOM: Add highlight (outline + shadow)
    
    VC->>VC: Wait 500ms (visual feedback)
    VC->>DOM: element.click()
    
    VC->>VC: contextManager.remember(...)
    VC->>VC: Wait 2000ms
    VC->>DOM: Remove highlight
    
    VC-->>User: Visual + Audio feedback complete
```

## 6. Navigation Commands Flow

```mermaid
flowchart LR
    A[User Says Command] --> B{Command Type}
    
    B -->|"back"<br/>"go back"<br/>"previous page"| C1[action = 'back']
    B -->|"forward"<br/>"go forward"<br/>"next page"| C2[action = 'forward']
    B -->|"reload"<br/>"refresh page"| C3[action = 'reload']
    
    C1 --> D1[NLP Detection<br/>spacy_server.py]
    C2 --> D1
    C3 --> D1
    
    D1 --> E1[Frontend Receives]
    
    E1 --> F{Action Router}
    
    F -->|back| G1[Random Response:<br/>"Going back"<br/>"Heading back"<br/>"Back we go"<br/>etc.]
    F -->|forward| G2[Random Response:<br/>"Going forward"<br/>"Moving forward"<br/>etc.]
    F -->|reload| G3[Random Response:<br/>"Reloading page"<br/>"Refreshing page"<br/>etc.]
    
    G1 --> H1[smartSpeak response]
    G2 --> H1
    G3 --> H1
    
    H1 --> I[Wait 300-500ms]
    
    I --> J{Execute}
    
    J -->|back| K1[window.history.back]
    J -->|forward| K2[window.history.forward]
    J -->|reload| K3[window.location.reload]
    
    K1 --> L[Page Navigation]
    K2 --> L
    K3 --> L
    
    L --> M[cleanup event fires]
    M --> N[Stop recognition]
    M --> O[Cancel speech]
    
    L --> P[New Page Loads]
    P --> Q[webNavigation.onCompleted<br/>background.js]
    Q --> R[Auto re-inject voiceControl.js]
    R --> S[Voice control active again]
    
    S --> T{Same Domain?}
    T -->|Yes| U[Start silently]
    T -->|No| V[Speak welcome message]

    style C1 fill:#ffebee
    style C2 fill:#e3f2fd
    style C3 fill:#e8f5e9
    style K1 fill:#ff5722,color:#fff
    style K2 fill:#2196f3,color:#fff
    style K3 fill:#4caf50,color:#fff
```

## 7. Scroll Command with Smart Detection

```mermaid
graph TD
    A[User Says Scroll Command] --> B[Detect Direction]
    B --> B1{Direction?}
    B1 -->|down/↓| C1[direction = 'down']
    B1 -->|up/↑| C2[direction = 'up']
    B1 -->|left/←| C3[direction = 'left']
    B1 -->|right/→| C4[direction = 'right']
    
    C1 --> D[getSmartScrollTarget]
    C2 --> D
    C3 --> D
    C4 --> D
    
    D --> E{Priority 1:<br/>Element at Mouse}
    E -->|Found| F[document.elementFromPoint<br/>lastMouseX, lastMouseY]
    E -->|Not Found| G{Priority 2:<br/>Last Clicked Element}
    
    F --> H[Find Scrollable Parent]
    G -->|Found| I[Use lastClickedElement]
    G -->|Not Found| J[Use window/body]
    
    I --> H
    J --> K[Scroll window]
    
    H --> L{Is Scrollable?}
    L -->|Yes| M[Scroll This Container]
    L -->|No| N[Check Parent]
    N --> H
    
    M --> O{Direction}
    K --> O
    
    O -->|down| P[scrollBy top: +600px]
    O -->|up| Q[scrollBy top: -600px]
    O -->|left| R[scrollBy left: -400px]
    O -->|right| S[scrollBy left: +400px]
    
    P --> T[Smooth Animation]
    Q --> T
    R --> T
    S --> T
    
    T --> U[Scroll Complete]
    U --> V[Check for New Content]
    V --> W{New Elements Visible?}
    W -->|Yes| X[Update Element Cache]
    W -->|No| Y[Done]
    
    X --> Y

    style D fill:#ff9800,color:#fff
    style H fill:#ff9800,color:#fff
    style T fill:#4caf50,color:#fff
```

## 8. File Structure & Responsibilities

```mermaid
graph TB
    subgraph "Extension Files"
        A[manifest.json<br/>Extension Config] --> B[background/background.js<br/>Service Worker]
        B --> C[dist/voiceControl.js<br/>Main Content Script<br/>2725 lines]
        
        C --> C1[UI Management<br/>Lines 128-250]
        C --> C2[Element Caching<br/>Lines 444-520]
        C --> C3[MutationObserver<br/>Lines 350-440]
        C --> C4[Command Processing<br/>Lines 1400-1900]
        C --> C5[Action Execution<br/>Lines 1500-2000]
        C --> C6[Speech Synthesis<br/>Lines 2200-2280]
        C --> C7[Recognition Setup<br/>Lines 1166-1310]
    end
    
    subgraph "Backend Files"
        D[backend/nlp/spacy_server.py<br/>NLP Server<br/>1000 lines] --> D1[Flask App Setup<br/>Lines 1-100]
        D --> D2[Action Keywords<br/>Lines 120-175]
        D --> D3[Intent Analysis<br/>Lines 450-650]
        D --> D4[Entity Extraction<br/>Lines 652-750]
        D --> D5[Response Generation<br/>Lines 752-850]
        D --> D6[API Endpoint /process<br/>Lines 200-450]
    end
    
    subgraph "Configuration"
        E[extension/public/manifest.json<br/>Permissions & Scripts]
        F[backend/nlp/requirements.txt<br/>Python Dependencies]
        G[extension/package.json<br/>Node Dependencies]
    end
    
    subgraph "Documentation"
        H[TECHNICAL_FLOW.txt<br/>Complete Tech Docs]
        I[docs/API_DOCUMENTATION.md<br/>API Reference]
        J[docs/DEVELOPER_GUIDE.md<br/>Dev Guide]
    end
    
    B -.->|Injects| C
    C -.->|HTTP POST| D
    D -.->|JSON Response| C

    style A fill:#e1bee7
    style B fill:#ce93d8
    style C fill:#ba68c8,color:#fff
    style D fill:#ff9800,color:#fff
    style E fill:#90caf9
    style H fill:#a5d6a7
```

## 9. Key Data Structures

```mermaid
classDiagram
    class ElementCache {
        +Array buttons
        +Array links
        +Array clickables
        +Number lastUpdate
        +updateElementCache()
        +forceUpdateCache()
    }
    
    class ContextManager {
        +String lastAction
        +String lastTarget
        +Array lastElements
        +HTMLElement lastClickedElement
        +String lastSpokenText
        +Array conversationHistory
        +remember(action, target, elements)
        +getContext()
    }
    
    class SpeechRecognition {
        +Boolean continuous
        +Boolean interimResults
        +String lang
        +Number maxAlternatives
        +onstart()
        +onresult()
        +onerror()
        +onend()
        +start()
        +stop()
        +abort()
    }
    
    class ActionData {
        +String action
        +String target
        +String direction
        +String descriptor
        +Number confidence
        +String response
        +Array entities
        +Array tokens
    }
    
    class StorageData {
        +Array welcomedDomains
        +Boolean isVoiceControlActive
        +Object userPreferences
    }
    
    ElementCache --> ContextManager: updates
    SpeechRecognition --> ActionData: produces
    ActionData --> ElementCache: queries
    ContextManager --> StorageData: persists

    style ElementCache fill:#4caf50,color:#fff
    style ContextManager fill:#2196f3,color:#fff
    style SpeechRecognition fill:#ff9800,color:#fff
    style ActionData fill:#9c27b0,color:#fff
```

## 10. Error Handling & Recovery

```mermaid
flowchart TD
    A[Voice Command] --> B{Error Type?}
    
    B -->|Speech Recognition| C1[recognition.onerror]
    C1 --> C2{Error Code}
    C2 -->|no-speech| C3[Speak: I didn't hear anything]
    C2 -->|audio-capture| C4[Speak: Microphone not available]
    C2 -->|not-allowed| C5[Speak: Permission denied]
    C2 -->|network| C6[Retry after 2s]
    C2 -->|aborted| C7[Normal stop, no action]
    
    B -->|NLP Server| D1[sendToSpacyServer error]
    D1 --> D2{Error Type}
    D2 -->|Network error| D3[Speak: Connection failed]
    D2 -->|Timeout 5s| D4[Speak: Request timed out]
    D2 -->|Server 500| D5[Speak: Server error]
    
    B -->|Element Not Found| E1[findMatchingElement null]
    E1 --> E2[Speak: Could not find target]
    E1 --> E3[Log to console]
    E1 --> E4[Show status message]
    
    B -->|Page Navigation| F1[beforeunload event]
    F1 --> F2[cleanup function]
    F2 --> F3[Stop recognition]
    F2 --> F4[Cancel speech]
    F2 --> F5[Reset flags]
    F2 --> F6[Clear wsVoiceControlActive]
    
    F6 --> G[New Page Loads]
    G --> H[webNavigation.onCompleted]
    H --> I{Tab still exists?}
    I -->|Yes| J[Re-inject voiceControl.js]
    I -->|No| K[Cleanup injection cache]
    
    J --> L[Voice control restored]
    
    C3 --> M[Continue listening]
    C4 --> M
    C5 --> N[Disable voice control]
    C6 --> M
    D3 --> M
    D4 --> M
    D5 --> M
    E2 --> M

    style C6 fill:#4caf50,color:#fff
    style F2 fill:#ff9800,color:#fff
    style J fill:#2196f3,color:#fff
    style N fill:#f44336,color:#fff
```

## Summary

### Key Files:

1. **extension/dist/voiceControl.js** (2725 lines)
   - Main content script injected into web pages
   - Handles speech recognition, UI, element detection, action execution

2. **extension/src/background/background.js** (303 lines)
   - Service worker managing injection and tab lifecycle
   - Listens for keyboard shortcuts (Ctrl+Shift+V)

3. **backend/nlp/spacy_server.py** (1000 lines)
   - Flask server on port 5001
   - NLP processing with spaCy
   - Intent classification and entity extraction

### Key Technologies:

- **Web Speech API**: SpeechRecognition + SpeechSynthesis
- **spaCy**: Natural language processing (en_core_web_sm model)
- **Chrome Extension API**: Manifest V3, scripting, storage, tabs
- **MutationObserver**: DOM change detection
- **Flask**: Python REST API server

### Data Flow:

User Speech → SpeechRecognition → voiceControl.js → spaCy NLP → Action JSON → Element Search → DOM Manipulation → SpeechSynthesis → User Feedback
