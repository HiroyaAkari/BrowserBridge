/* Ordered, editable selector lists. No network fetch is needed in a content script. */
(function (root) {
  'use strict';
  root.BB = root.BB || {};
  root.BB.selectors = {
    claude: {
      assistant: ["div.font-claude-message", "[data-testid='assistant-message']"],
      generating: ["button[aria-label='Stop response']", "button[aria-label='Stop generating']", "[data-is-streaming='true']"],
      input: ["div[contenteditable='true'].ProseMirror", "div[contenteditable='true'][role='textbox']"],
      send: ["button[aria-label='Send message']", "button[type='submit']"]
    },
    chatgpt: {
      assistant: ["[data-message-author-role='assistant']", "article[data-testid^='conversation-turn'] [data-message-author-role='assistant']"],
      generating: ["button[data-testid='stop-button']", "button[aria-label='Stop streaming']"],
      input: ["#prompt-textarea", "div[contenteditable='true'][role='textbox']"],
      send: ["button[data-testid='send-button']", "#composer-submit-button", "button[type='submit']"]
    },
    gemini: {
      assistant: ["model-response", ".model-response-text"],
      generating: ["button[aria-label*='Stop']", "mat-icon[fonticon='stop']", ".streaming"],
      input: ["div.ql-editor[contenteditable='true']", "rich-textarea div[contenteditable='true']", "textarea[aria-label]"],
      send: ["button.send-button", "button[aria-label*='Send']", "button[type='submit']"]
    },
    kimi: { assistant: [".segment-assistant", ".chat-content-item-assistant", "[class*=assistant]"], generating: ["button[aria-label*=Stop i]", "[class*=stop-button]"], input: ["div.chat-input-editor[contenteditable=true]", "div[contenteditable=true][role=textbox]", "div[contenteditable=true]", "textarea"], send: ["[class*=send-button]", "button[aria-label*=Send i]", "button[type=submit]"] },
    zai: {
      assistant: [".chat-assistant", "#response-content-container", "[data-role='assistant']", "div[class*='assistant']"],
      generating: ["button[aria-label*='Stop' i]", "button[id*='stop' i]", "button[class*='stop' i]"],
      input: ["textarea#chat-input", "#chat-input", "textarea[placeholder*='help' i]", "div[contenteditable='true'][role='textbox']", "textarea"],
      send: ["button#send-message-button", "button[aria-label*='Send' i]", "button[type='submit']"]
    },
    arena: {
      assistant: ["[data-perf-target='transcript'] > div:not(.justify-end) .prose"],
      generating: ["button[aria-label*='Stop']", "button[title*='Stop']", "[data-state='streaming']"],
      input: ["textarea[placeholder*='message' i]", "textarea[placeholder*='prompt' i]", "div[contenteditable='true'][role='textbox']", "textarea"],
      send: ["button[aria-label*='Send' i]", "button[title*='Send' i]", "button[type='submit']"]
    },
    perplexity: {
      assistant: ["div[class*='prose']", "[data-testid*='answer' i]", "div[class*='answer' i]"],
      generating: ["button[aria-label*='Stop' i]", "[class*='stop' i]", "[data-state='streaming']"],
      input: ["textarea[placeholder*='ask' i]", "div[contenteditable='true'][role='textbox']", "textarea"],
      send: ["button[aria-label*='Submit' i]", "button[aria-label*='Send' i]", "button[type='submit']"]
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);