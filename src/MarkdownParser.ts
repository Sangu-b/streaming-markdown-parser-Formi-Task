const blogpostMarkdown = `# control

*humans should focus on bigger problems*

## Setup

\`\`\`bash
git clone git@github.com:anysphere/control
\`\`\`

\`\`\`bash
./init.sh
\`\`\`

## Folder structure

**The most important folders are:**

1. \`vscode\`: this is our fork of vscode, as a submodule.
2. \`milvus\`: this is where our Rust server code lives.
3. \`schema\`: this is our Protobuf definitions for communication between the client and the server.

Each of the above folders should contain fairly comprehensive README files; please read them. If something is missing, or not working, please add it to the README!

Some less important folders:

1. \`release\`: this is a collection of scripts and guides for releasing various things.
2. \`infra\`: infrastructure definitions for the on-prem deployment.
3. \`third_party\`: where we keep our vendored third party dependencies.

## Miscellaneous things that may or may not be useful

##### Where to find rust-proto definitions

They are in a file called \`aiserver.v1.rs\`. It might not be clear where that file is. Run \`rg --files --no-ignore bazel-out | rg aiserver.v1.rs\` to find the file.

## Releasing

Within \`vscode/\`:

- Bump the version
- Then:

\`\`\`
git checkout build-todesktop
git merge main
git push origin build-todesktop
\`\`\`

- Wait for 14 minutes for gulp and ~30 minutes for todesktop
- Go to todesktop.com, test the build locally and hit release
`;

let currentContainer: HTMLElement | null = null; 
// Do not edit this method
function runStream() {
    currentContainer = document.getElementById('markdownContainer')!;

    // this randomly split the markdown into tokens between 2 and 20 characters long
    // simulates the behavior of an ml model thats giving you weirdly chunked tokens
    const tokens: string[] = [];
    let remainingMarkdown = blogpostMarkdown;
    while (remainingMarkdown.length > 0) {
        const tokenLength = Math.floor(Math.random() * 18) + 2;
        const token = remainingMarkdown.slice(0, tokenLength);
        tokens.push(token);
        remainingMarkdown = remainingMarkdown.slice(tokenLength);
    }

    const toCancel = setInterval(() => {
        const token = tokens.shift();
        if (token) {
            addToken(token);
        } else {
            clearInterval(toCancel);
        }
    }, 20);
}

/*
 * =============================================================================
 * STREAMING MARKDOWN PARSER - STATE MACHINE ARCHITECTURE (EXTENDED)
 * =============================================================================
 * 
 * This parser implements a character-by-character state machine for parsing
 * streaming markdown. It handles partial tokens arriving in separate chunks.
 * 
 * STATES:
 * -------
 * 1. TEXT           - Normal text mode, looking for markdown symbols
 * 2. INLINE_CODE    - Inside single backtick inline code (`...`)
 * 3. CODE_BLOCK     - Inside triple backtick code block (```...```)
 * 4. CODE_BLOCK_LANG- Reading optional language identifier after opening ```
 * 5. HEADING        - Inside a heading (# ## ###)
 * 6. BOLD           - Inside bold text (**...**)
 * 7. ITALIC         - Inside italic text (*...*)
 * 8. LIST_ITEM      - Inside a list item (- or 1.)
 * 
 * LINE-START DETECTION:
 * ---------------------
 * - isAtLineStart: Tracks if we're at the beginning of a line
 * - hashBuffer: Accumulates # characters for heading detection
 * - listMarkerBuffer: Accumulates list markers (-, 1., 2., etc.)
 * 
 * ASTERISK HANDLING:
 * ------------------
 * - asteriskBuffer: Accumulates * to distinguish italic (*) vs bold (**)
 * - Bold takes precedence: ** opens/closes bold, single * is italic
 * - Nested: Bold can contain italic, but not vice versa in this impl
 * 
 * DOM STRATEGY:
 * -------------
 * - currentTextNode: The active Text node being appended to
 * - currentElement: The current container element (span, code, em, strong, etc.)
 * - blockContainer: Current block-level container (div, h1-h3, li, etc.)
 * - listContainer: Current list container (ul, ol) for list items
 * - We append characters to currentTextNode for efficiency
 * - On state change, we create new elements and update references
 * - No innerHTML, no full re-renders, preserves user text selection
 * =============================================================================
 */

// Parser state enum - extended with new states
enum ParserState {
    TEXT = 'TEXT',
    INLINE_CODE = 'INLINE_CODE',
    CODE_BLOCK = 'CODE_BLOCK',
    CODE_BLOCK_LANG = 'CODE_BLOCK_LANG',
    HEADING = 'HEADING',
    BOLD = 'BOLD',
    ITALIC = 'ITALIC',
    LIST_ITEM = 'LIST_ITEM'
}

// Global parser state
let parserState: ParserState = ParserState.TEXT;
let backtickBuffer: string = '';           // Accumulates consecutive backticks
let languageBuffer: string = '';           // Accumulates language identifier
let currentTextNode: Text | null = null;   // Current text node being appended to
let currentElement: HTMLElement | null = null; // Current DOM element container
let codeBlockElement: HTMLElement | null = null; // Reference to <pre> for code blocks

// NEW: Extended state for headings, bold, italic, lists
let isAtLineStart: boolean = true;         // Track if at beginning of line
let hashBuffer: string = '';               // Accumulates # for heading detection
let asteriskBuffer: string = '';           // Accumulates * for bold/italic detection
let listMarkerBuffer: string = '';         // Accumulates list markers (-, 1., etc.)
let blockContainer: HTMLElement | null = null; // Current block container (div, h1, li)
let listContainer: HTMLElement | null = null;  // Current list container (ul, ol)
let currentListType: 'ul' | 'ol' | null = null; // Track current list type
let headingLevel: number = 0;              // Current heading level (1-6)
let isBold: boolean = false;               // Track if we're in bold mode
let isItalic: boolean = false;             // Track if we're in italic mode
let inlineStack: HTMLElement[] = [];       // Stack to track nested inline elements

/**
 * Reset parser state - called when stream starts
 */
function resetParserState() {
    parserState = ParserState.TEXT;
    backtickBuffer = '';
    languageBuffer = '';
    currentTextNode = null;
    currentElement = null;
    codeBlockElement = null;
    
    // Reset extended state
    isAtLineStart = true;
    hashBuffer = '';
    asteriskBuffer = '';
    listMarkerBuffer = '';
    blockContainer = null;
    listContainer = null;
    currentListType = null;
    headingLevel = 0;
    isBold = false;
    isItalic = false;
    inlineStack = [];
}

/**
 * Get the current inline container - the deepest element in the inline stack
 */
function getCurrentInlineContainer(): HTMLElement | null {
    if (inlineStack.length > 0) {
        return inlineStack[inlineStack.length - 1];
    }
    return blockContainer || currentElement;
}

/**
 * Append a character to the current text node.
 * Creates a new text node if needed.
 */
function appendChar(char: string) {
    if (!currentContainer) return;
    
    if (!currentTextNode) {
        currentTextNode = document.createTextNode('');
        const container = getCurrentInlineContainer();
        if (container) {
            container.appendChild(currentTextNode);
        } else if (currentElement) {
            currentElement.appendChild(currentTextNode);
        } else if (blockContainer) {
            blockContainer.appendChild(currentTextNode);
        } else {
            currentContainer.appendChild(currentTextNode);
        }
    }
    currentTextNode.textContent += char;
}

/**
 * Append multiple characters at once for efficiency
 */
function appendText(text: string) {
    if (!text) return;
    for (const char of text) {
        appendChar(char);
    }
}

/**
 * End any active list if we're starting a non-list block
 */
function endListIfNeeded() {
    if (listContainer && parserState !== ParserState.LIST_ITEM) {
        listContainer = null;
        currentListType = null;
    }
}

/**
 * Start a new paragraph/text block
 */
function startTextBlock() {
    if (!currentContainer) return;
    
    endListIfNeeded();
    
    const div = document.createElement('div');
    currentContainer.appendChild(div);
    blockContainer = div;
    currentElement = div;
    currentTextNode = null;
    inlineStack = [];
}

/**
 * Start a new text span for normal text (legacy, kept for compatibility)
 */
function startTextSpan() {
    if (!currentContainer) return;
    
    if (!blockContainer) {
        startTextBlock();
    } else {
        currentTextNode = null;
    }
}

/**
 * Start a heading element
 */
function startHeading(level: number) {
    if (!currentContainer) return;
    
    endListIfNeeded();
    
    const tagName = `h${Math.min(level, 6)}` as keyof HTMLElementTagNameMap;
    const heading = document.createElement(tagName);
    heading.style.margin = '10px 0';
    currentContainer.appendChild(heading);
    blockContainer = heading;
    currentElement = heading;
    currentTextNode = null;
    headingLevel = level;
    parserState = ParserState.HEADING;
    inlineStack = [];
}

/**
 * End heading, return to text state
 */
function endHeading() {
    blockContainer = null;
    currentElement = null;
    currentTextNode = null;
    headingLevel = 0;
    parserState = ParserState.TEXT;
    inlineStack = [];
}

/**
 * Start a list container (ul or ol)
 */
function startList(type: 'ul' | 'ol') {
    if (!currentContainer) return;
    
    // If switching list type, end old list
    if (listContainer && currentListType !== type) {
        listContainer = null;
    }
    
    if (!listContainer) {
        const list = document.createElement(type);
        list.style.margin = '5px 0';
        list.style.paddingLeft = '20px';
        currentContainer.appendChild(list);
        listContainer = list;
        currentListType = type;
    }
}

/**
 * Start a list item
 */
function startListItem(type: 'ul' | 'ol') {
    if (!currentContainer) return;
    
    startList(type);
    
    const li = document.createElement('li');
    listContainer!.appendChild(li);
    blockContainer = li;
    currentElement = li;
    currentTextNode = null;
    parserState = ParserState.LIST_ITEM;
    inlineStack = [];
}

/**
 * End list item, return to text state
 */
function endListItem() {
    blockContainer = null;
    currentElement = null;
    currentTextNode = null;
    parserState = ParserState.TEXT;
    inlineStack = [];
}

/**
 * Start bold text <strong>
 */
function startBold() {
    if (!currentContainer) return;
    
    const strong = document.createElement('strong');
    const container = getCurrentInlineContainer();
    if (container) {
        container.appendChild(strong);
    } else if (blockContainer) {
        blockContainer.appendChild(strong);
    } else {
        if (!currentElement) startTextBlock();
        currentElement!.appendChild(strong);
    }
    
    inlineStack.push(strong);
    currentTextNode = null;
    isBold = true;
}

/**
 * End bold text
 */
function endBold() {
    if (inlineStack.length > 0) {
        // Find and remove the strong element from stack
        for (let i = inlineStack.length - 1; i >= 0; i--) {
            if (inlineStack[i].tagName === 'STRONG') {
                inlineStack.splice(i, 1);
                break;
            }
        }
    }
    currentTextNode = null;
    isBold = false;
}

/**
 * Start italic text <em>
 */
function startItalic() {
    if (!currentContainer) return;
    
    const em = document.createElement('em');
    const container = getCurrentInlineContainer();
    if (container) {
        container.appendChild(em);
    } else if (blockContainer) {
        blockContainer.appendChild(em);
    } else {
        if (!currentElement) startTextBlock();
        currentElement!.appendChild(em);
    }
    
    inlineStack.push(em);
    currentTextNode = null;
    isItalic = true;
}

/**
 * End italic text
 */
function endItalic() {
    if (inlineStack.length > 0) {
        // Find and remove the em element from stack
        for (let i = inlineStack.length - 1; i >= 0; i--) {
            if (inlineStack[i].tagName === 'EM') {
                inlineStack.splice(i, 1);
                break;
            }
        }
    }
    currentTextNode = null;
    isItalic = false;
}

/**
 * Start inline code element <code>
 */
function startInlineCode() {
    if (!currentContainer) return;
    
    const code = document.createElement('code');
    code.style.backgroundColor = '#f0f0f0';
    code.style.padding = '2px 4px';
    code.style.borderRadius = '3px';
    code.style.fontFamily = 'monospace';
    
    const container = getCurrentInlineContainer();
    if (container) {
        container.appendChild(code);
    } else if (blockContainer) {
        blockContainer.appendChild(code);
    } else {
        if (!currentElement) startTextBlock();
        currentContainer.appendChild(code);
    }
    
    inlineStack.push(code);
    currentElement = code;
    currentTextNode = null;
    parserState = ParserState.INLINE_CODE;
}

/**
 * End inline code, return to previous state
 */
function endInlineCode() {
    if (inlineStack.length > 0) {
        // Find and remove the code element from stack
        for (let i = inlineStack.length - 1; i >= 0; i--) {
            if (inlineStack[i].tagName === 'CODE') {
                inlineStack.splice(i, 1);
                break;
            }
        }
    }
    currentElement = getCurrentInlineContainer();
    currentTextNode = null;
    
    // Return to appropriate state based on context
    if (blockContainer?.tagName.startsWith('H')) {
        parserState = ParserState.HEADING;
    } else if (blockContainer?.tagName === 'LI') {
        parserState = ParserState.LIST_ITEM;
    } else {
        parserState = ParserState.TEXT;
    }
}

/**
 * Start code block with <pre><code>
 */
function startCodeBlock(language: string = '') {
    if (!currentContainer) return;
    
    endListIfNeeded();
    
    const pre = document.createElement('pre');
    pre.style.backgroundColor = '#1e1e1e';
    pre.style.color = '#d4d4d4';
    pre.style.padding = '10px';
    pre.style.borderRadius = '5px';
    pre.style.overflow = 'auto';
    pre.style.fontFamily = 'monospace';
    
    const code = document.createElement('code');
    if (language) {
        code.className = `language-${language}`;
    }
    code.style.fontFamily = 'monospace';
    code.style.whiteSpace = 'pre';
    
    pre.appendChild(code);
    currentContainer.appendChild(pre);
    
    codeBlockElement = pre;
    blockContainer = code;
    currentElement = code;
    currentTextNode = null;
    parserState = ParserState.CODE_BLOCK;
    inlineStack = [];
}

/**
 * End code block, return to text state
 */
function endCodeBlock() {
    codeBlockElement = null;
    blockContainer = null;
    currentElement = null;
    currentTextNode = null;
    parserState = ParserState.TEXT;
    inlineStack = [];
    isAtLineStart = true;
}

/**
 * Process accumulated backticks based on current state.
 * This is called when we encounter a non-backtick character after backticks.
 */
function processBacktickBuffer() {
    const count = backtickBuffer.length;
    backtickBuffer = '';
    
    if (count === 0) return;
    
    if (parserState === ParserState.CODE_BLOCK || parserState === ParserState.CODE_BLOCK_LANG) {
        // In CODE_BLOCK mode
        if (count >= 3) {
            // Triple backticks end the code block
            endCodeBlock();
            // Extra backticks go into the new text span
            for (let i = 3; i < count; i++) {
                appendChar('`');
            }
        } else {
            // Less than 3 backticks are just content
            for (let i = 0; i < count; i++) {
                appendChar('`');
            }
        }
    } else if (parserState === ParserState.INLINE_CODE) {
        // In INLINE_CODE mode
        if (count >= 1) {
            // Single backtick ends inline code
            endInlineCode();
            // Extra backticks go into the new text span
            for (let i = 1; i < count; i++) {
                appendChar('`');
            }
        }
    } else {
        // In TEXT, HEADING, LIST_ITEM, BOLD, or ITALIC mode
        if (count >= 3) {
            // Triple backticks start a code block
            // Enter language reading mode
            languageBuffer = '';
            parserState = ParserState.CODE_BLOCK_LANG;
        } else {
            // 1 or 2 backticks start inline code
            startInlineCode();
            // If there were 2 backticks, the second one goes into content
            if (count === 2) {
                appendChar('`');
            }
        }
    }
}

/**
 * Process accumulated hash characters for heading detection
 */
function processHashBuffer() {
    const count = hashBuffer.length;
    hashBuffer = '';
    
    if (count === 0) return;
    
    if (isAtLineStart && count <= 6) {
        // Start a heading
        startHeading(count);
    } else {
        // Not at line start or too many hashes, output as text
        if (!blockContainer) startTextBlock();
        for (let i = 0; i < count; i++) {
            appendChar('#');
        }
    }
    
    isAtLineStart = false;
}

/**
 * Process accumulated asterisks for bold/italic detection
 */
function processAsteriskBuffer() {
    const count = asteriskBuffer.length;
    asteriskBuffer = '';
    
    if (count === 0) return;
    
    // Process pairs of asterisks for bold, singles for italic
    let remaining = count;
    
    while (remaining > 0) {
        if (remaining >= 2) {
            // Double asterisk - toggle bold
            if (isBold) {
                endBold();
            } else {
                if (!blockContainer && parserState === ParserState.TEXT) startTextBlock();
                startBold();
            }
            remaining -= 2;
        } else {
            // Single asterisk - toggle italic
            if (isItalic) {
                endItalic();
            } else {
                if (!blockContainer && parserState === ParserState.TEXT) startTextBlock();
                startItalic();
            }
            remaining -= 1;
        }
    }
}

/**
 * Process accumulated list marker buffer
 */
function processListMarkerBuffer(nextChar: string) {
    const marker = listMarkerBuffer;
    listMarkerBuffer = '';
    
    if (!marker) return false;
    
    // Check for unordered list: "- " at line start
    if (marker === '-' && nextChar === ' ' && isAtLineStart) {
        startListItem('ul');
        isAtLineStart = false;
        return true;
    }
    
    // Check for ordered list: "1. ", "2. ", etc. at line start
    const orderedMatch = marker.match(/^(\d+)\.$/);
    if (orderedMatch && nextChar === ' ' && isAtLineStart) {
        startListItem('ol');
        isAtLineStart = false;
        return true;
    }
    
    // Not a list marker, output as text
    if (!blockContainer && parserState === ParserState.TEXT) startTextBlock();
    appendText(marker);
    isAtLineStart = false;
    return false;
}

/**
 * Check if character could be part of a list marker
 */
function isListMarkerChar(char: string): boolean {
    return char === '-' || (char >= '0' && char <= '9') || char === '.';
}

/**
 * Process a single character through the state machine
 */
function processChar(char: string) {
    // Handle code blocks first - they ignore most markdown syntax
    if (parserState === ParserState.CODE_BLOCK || parserState === ParserState.CODE_BLOCK_LANG) {
        if (char === '`') {
            backtickBuffer += char;
            return;
        }
        
        if (backtickBuffer.length > 0) {
            processBacktickBuffer();
            if (parserState !== ParserState.CODE_BLOCK && parserState !== ParserState.CODE_BLOCK_LANG) {
                // We exited code block, reprocess this char
                processChar(char);
                return;
            }
        }
        
        if (parserState === ParserState.CODE_BLOCK_LANG) {
            if (char === '\n') {
                startCodeBlock(languageBuffer.trim());
            } else {
                languageBuffer += char;
            }
        } else {
            appendChar(char);
        }
        return;
    }
    
    // Handle inline code - only backticks can end it
    if (parserState === ParserState.INLINE_CODE) {
        if (char === '`') {
            backtickBuffer += char;
            return;
        }
        
        if (backtickBuffer.length > 0) {
            processBacktickBuffer();
            if (parserState !== ParserState.INLINE_CODE) {
                processChar(char);
                return;
            }
        }
        
        appendChar(char);
        return;
    }
    
    // Handle backticks
    if (char === '`') {
        // Flush other buffers first
        if (hashBuffer.length > 0) processHashBuffer();
        if (asteriskBuffer.length > 0) processAsteriskBuffer();
        if (listMarkerBuffer.length > 0) processListMarkerBuffer('');
        
        backtickBuffer += char;
        return;
    }
    
    // Process pending backticks
    if (backtickBuffer.length > 0) {
        processBacktickBuffer();
        // State may have changed - check if we entered code mode
        if ((parserState as ParserState) === ParserState.CODE_BLOCK_LANG || 
            (parserState as ParserState) === ParserState.INLINE_CODE) {
            processChar(char);
            return;
        }
    }
    
    // Handle newlines - reset line start state
    if (char === '\n') {
        // Flush buffers
        if (hashBuffer.length > 0) processHashBuffer();
        if (asteriskBuffer.length > 0) processAsteriskBuffer();
        if (listMarkerBuffer.length > 0) processListMarkerBuffer('');
        
        // End heading on newline
        if (parserState === ParserState.HEADING) {
            endHeading();
        } else if (parserState === ParserState.LIST_ITEM) {
            endListItem();
        }
        
        if (!blockContainer) startTextBlock();
        appendChar(char);
        isAtLineStart = true;
        return;
    }
    
    // At line start, check for heading markers
    if (isAtLineStart && char === '#') {
        hashBuffer += char;
        return;
    }
    
    // Process pending hash buffer
    if (hashBuffer.length > 0) {
        if (char === ' ' && hashBuffer.length <= 6) {
            // Space after hashes = heading
            processHashBuffer();
            // Don't append the space after heading marker
            return;
        } else if (char === '#') {
            hashBuffer += char;
            return;
        } else {
            // Not a heading, output hashes as text
            processHashBuffer();
        }
    }
    
    // At line start, check for list markers
    if (isAtLineStart && isListMarkerChar(char)) {
        listMarkerBuffer += char;
        return;
    }
    
    // Process pending list marker buffer
    if (listMarkerBuffer.length > 0) {
        if (isListMarkerChar(char)) {
            listMarkerBuffer += char;
            return;
        } else {
            const consumed = processListMarkerBuffer(char);
            if (consumed) {
                // char was the space after list marker, don't append it
                return;
            }
        }
    }
    
    // Handle asterisks for bold/italic
    if (char === '*') {
        asteriskBuffer += char;
        return;
    }
    
    // Process pending asterisk buffer
    if (asteriskBuffer.length > 0) {
        processAsteriskBuffer();
    }
    
    // Regular character - append to current context
    isAtLineStart = false;
    
    if (!blockContainer && parserState === ParserState.TEXT) {
        startTextBlock();
    }
    
    appendChar(char);
}

/**
 * Finalize any remaining backticks at end of stream
 */
function finalizeBackticks() {
    if (backtickBuffer.length > 0) {
        const count = backtickBuffer.length;
        backtickBuffer = '';
        
        if (parserState === ParserState.TEXT || parserState === ParserState.HEADING || 
            parserState === ParserState.LIST_ITEM) {
            if (count >= 3) {
                languageBuffer = '';
                parserState = ParserState.CODE_BLOCK_LANG;
                startCodeBlock('');
            } else {
                startInlineCode();
            }
        } else if (parserState === ParserState.CODE_BLOCK || parserState === ParserState.CODE_BLOCK_LANG) {
            if (count >= 3) {
                endCodeBlock();
            } else {
                for (let i = 0; i < count; i++) {
                    appendChar('`');
                }
            }
        } else if (parserState === ParserState.INLINE_CODE) {
            if (count >= 1) {
                endInlineCode();
            }
        }
    }
}

/* 
 * Main entry point for streaming tokens.
 * Processes each character through the state machine.
 */
function addToken(token: string) {
    if (!currentContainer) return;
    
    // Initialize parser on first token
    if (!currentElement && !currentTextNode && parserState === ParserState.TEXT && 
        backtickBuffer.length === 0 && !blockContainer) {
        // Fresh start - reset state
        resetParserState();
    }
    
    // Process each character through the state machine
    for (const char of token) {
        processChar(char);
    }
}