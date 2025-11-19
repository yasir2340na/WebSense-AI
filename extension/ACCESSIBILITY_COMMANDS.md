# WebSense-AI Accessibility Commands Guide

## ✅ Fixed Issues
- **Close Tab**: Now works properly using `chrome.tabs.remove()` API instead of `window.close()`

## 📋 Complete Command List (40+ Commands)

### 🔄 Navigation & Scrolling (12 commands)
| Command | Action |
|---------|--------|
| "down" / "scroll down" | Scroll down 70% of viewport |
| "up" / "scroll up" | Scroll up 70% of viewport |
| "left" / "scroll left" | Scroll left 50% of viewport |
| "right" / "scroll right" | Scroll right 50% of viewport |
| "top" / "go to top" | Scroll to top of page |
| "bottom" / "go to bottom" | Scroll to bottom of page |
| "page down" | Scroll down one full page |
| "page up" | Scroll up one full page |
| "back" / "go back" | Navigate to previous page |
| "forward" / "go forward" | Navigate to next page |
| "reload" / "refresh" | Reload current page |
| "print page" / "print" | Open print dialog |

### 📑 Content Navigation (6 commands)
| Command | Action |
|---------|--------|
| "next heading" | Jump to next heading (h1-h6) |
| "previous heading" | Jump to previous heading |
| "next image" / "scroll to image" | Scroll to next image |
| "next field" / "next input" | Focus next input field |
| "previous field" | Focus previous input field |
| "focus search" / "search box" | Focus search input |

### 🔗 Link & Click Actions (2 commands)
| Command | Action |
|---------|--------|
| "click first link" / "first link" | Click the first link on page |
| "open first link in new tab" | Open first link in new tab |

### 🪟 Tab & Window Management (5 commands)
| Command | Action |
|---------|--------|
| "new tab" | Open new blank tab |
| "close tab" / "close this tab" | Close current tab ✅ FIXED |
| "duplicate tab" | Duplicate current tab |
| "new window" | Open new browser window |
| "full screen" / "fullscreen" | Enter full screen mode |
| "exit full screen" | Exit full screen mode |

### 🔍 Zoom & View (3 commands)
| Command | Action |
|---------|--------|
| "zoom in" | Increase page zoom by 10% |
| "zoom out" | Decrease page zoom by 10% |
| "reset zoom" / "default zoom" | Reset zoom to 100% |

### 📋 Text & Clipboard (3 commands)
| Command | Action |
|---------|--------|
| "select all" | Select all text on page |
| "copy" | Copy selected text |
| "paste" | Paste from clipboard |

### 🔊 Text-to-Speech (2 commands)
| Command | Action |
|---------|--------|
| "read page" / "read this" | Read page content aloud (first 500 chars) |
| "stop reading" | Stop text-to-speech |

### 📄 Page Information (2 commands)
| Command | Action |
|---------|--------|
| "page title" / "what is this page" | Show & speak page title |
| "current url" / "what is the url" | Show current URL |

### 🎨 Visual Accessibility (2 commands)
| Command | Action |
|---------|--------|
| "hide images" | Hide all images on page |
| "show images" | Show all images |

### 🛑 Control (2 commands)
| Command | Action |
|---------|--------|
| "stop listening" / "stop" | Deactivate voice control |
| "save page" | Save current page |

## 💡 Suggested Additional Commands for Future

### High Priority - Accessibility
1. **"increase text size"** - Make text larger for readability
2. **"decrease text size"** - Make text smaller
3. **"high contrast mode"** - Toggle high contrast
4. **"dark mode"** - Toggle dark mode
5. **"light mode"** - Toggle light mode
6. **"reading mode"** - Activate reader view
7. **"remove distractions"** - Hide ads, popups, sidebars

### High Priority - Forms
8. **"fill form"** - Auto-fill form with saved data
9. **"submit form"** - Submit current form
10. **"clear form"** - Clear all form fields
11. **"click button [text]"** - Click button containing text

### Medium Priority - Navigation
12. **"go home"** - Navigate to homepage
13. **"open history"** - Open browser history
14. **"open downloads"** - Open downloads page
15. **"open bookmarks"** - Open bookmarks
16. **"bookmark this page"** - Add current page to bookmarks
17. **"find text [query]"** - Search for text on page
18. **"next result"** - Go to next search result
19. **"previous result"** - Go to previous search result

### Medium Priority - Tabs
20. **"next tab"** - Switch to next tab
21. **"previous tab"** - Switch to previous tab
22. **"first tab"** - Switch to first tab
23. **"last tab"** - Switch to last tab
24. **"reopen tab"** - Reopen last closed tab
25. **"mute tab"** - Mute current tab
26. **"pin tab"** - Pin current tab

### Low Priority - Advanced
27. **"translate page"** - Translate to different language
28. **"take screenshot"** - Capture page screenshot
29. **"scroll to [percentage]"** - Scroll to specific position
30. **"play video"** - Play/pause video on page
31. **"skip ad"** - Skip video ads
32. **"expand all"** - Expand all collapsible sections
33. **"collapse all"** - Collapse all sections

### Low Priority - Social Media
34. **"like this"** - Like current post/video
35. **"share this"** - Open share dialog
36. **"next post"** - Scroll to next post (social feeds)
37. **"previous post"** - Scroll to previous post

## 🎯 Implementation Priorities

### Phase 1 (Immediate - Accessibility Critical) ✅ DONE
- ✅ All basic navigation (scroll, page navigation)
- ✅ Zoom controls
- ✅ Text-to-speech
- ✅ Tab management
- ✅ Content navigation (headings, links, inputs)

### Phase 2 (Next - Forms & Text)
- Text size adjustment
- High contrast mode
- Form filling and submission
- Click button by text

### Phase 3 (Enhancement - Tab Management)
- Switch between tabs
- Reopen closed tabs
- Tab muting/pinning

### Phase 4 (Advanced Features)
- Translation
- Screenshots
- Video controls
- Smart content detection

## 🌟 Unique Accessibility Features Ideas

1. **Voice Shortcuts**: Allow users to create custom voice commands
2. **Gesture Commands**: Combine with mouse gestures
3. **Context-Aware Commands**: Different commands based on page type (e.g., YouTube, Gmail)
4. **Voice Macros**: Chain multiple commands ("scroll down and click first link")
5. **Learning Mode**: Extension suggests commands based on user behavior
6. **Multi-language Support**: Commands in different languages
7. **Voice Feedback**: Speak confirmations for each action
8. **Keyboard Alternative**: Every mouse action has voice equivalent
9. **Focus Outline**: Visual indicator for focused elements
10. **Smart Navigation**: "Go to main content", "Skip to footer"

## 🔧 Technical Recommendations

### For Better Accessibility
- Add ARIA labels to the floating mic button
- Provide visual feedback for each command
- Allow customization of speech recognition language
- Add confidence threshold for command recognition
- Provide alternative text for all voice commands

### For Better Performance
- Cache frequently used DOM queries
- Debounce scroll commands
- Use IntersectionObserver for element detection
- Lazy load command handlers

### For Better UX
- Show recently used commands
- Provide voice command suggestions based on page content
- Add tutorial/onboarding for first-time users
- Create keyboard shortcuts for quick access
- Add settings page for customization
