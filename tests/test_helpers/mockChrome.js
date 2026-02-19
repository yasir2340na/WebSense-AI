/**
 * Mock Chrome Extension APIs for testing.
 *
 * Provides stubs for chrome.runtime, chrome.tabs, chrome.storage,
 * chrome.scripting, and chrome.webNavigation used by background.js,
 * content.js, and popup hooks.
 */

export function createMockChrome() {
  const listeners = {
    onMessage: [],
    onInstalled: [],
    onRemoved: [],
    onCompleted: [],
    onCommand: [],
  };

  const storageData = { local: {}, session: {} };

  const chrome = {
    runtime: {
      id: 'test-extension-id',
      lastError: null,

      onMessage: {
        addListener: (cb) => listeners.onMessage.push(cb),
        removeListener: (cb) => {
          listeners.onMessage = listeners.onMessage.filter((l) => l !== cb);
        },
        _listeners: listeners.onMessage,
      },

      onInstalled: {
        addListener: (cb) => listeners.onInstalled.push(cb),
      },

      sendMessage: vi.fn((message, callback) => {
        // Simulate async response
        if (callback) setTimeout(() => callback({ success: true }), 0);
      }),
    },

    tabs: {
      query: vi.fn((queryInfo, callback) => {
        callback([{ id: 1, url: 'https://example.com/form', active: true }]);
      }),

      sendMessage: vi.fn((tabId, message, callback) => {
        if (callback) setTimeout(() => callback({ success: true }), 0);
      }),

      onRemoved: {
        addListener: (cb) => listeners.onRemoved.push(cb),
      },
    },

    storage: {
      local: {
        get: vi.fn((keys, callback) => {
          const result = {};
          const keyList = Array.isArray(keys) ? keys : [keys];
          for (const k of keyList) {
            if (storageData.local[k] !== undefined) {
              result[k] = storageData.local[k];
            }
          }
          callback(result);
        }),
        set: vi.fn((items, callback) => {
          Object.assign(storageData.local, items);
          if (callback) callback();
        }),
      },
      session: {
        get: vi.fn((keys, callback) => {
          const result = {};
          const keyList = Array.isArray(keys) ? keys : [keys];
          for (const k of keyList) {
            if (storageData.session[k] !== undefined) {
              result[k] = storageData.session[k];
            }
          }
          callback(result);
        }),
        set: vi.fn((items, callback) => {
          Object.assign(storageData.session, items);
          if (callback) callback();
        }),
      },
    },

    scripting: {
      executeScript: vi.fn(() => Promise.resolve([{ result: true }])),
    },

    webNavigation: {
      onCompleted: {
        addListener: (cb) => listeners.onCompleted.push(cb),
      },
    },

    commands: {
      onCommand: {
        addListener: (cb) => listeners.onCommand.push(cb),
      },
    },

    // Helpers for tests
    _listeners: listeners,
    _storageData: storageData,

    /**
     * Simulate a message arriving at background.js.
     * @param {Object} message - The message payload.
     * @param {Object} [sender] - The sender info.
     * @returns {Promise<any>} The response.
     */
    _simulateMessage(message, sender = null) {
      const defaultSender = { id: 'test-extension-id', tab: { id: 1, url: 'https://example.com' } };
      const senderObj = sender || defaultSender;

      return new Promise((resolve) => {
        const sendResponse = (resp) => resolve(resp);
        for (const listener of listeners.onMessage) {
          const result = listener(message, senderObj, sendResponse);
          if (result === true) return; // async response
        }
        // If no listener returned true, resolve with undefined
        resolve(undefined);
      });
    },
  };

  return chrome;
}

/**
 * Install mock chrome on globalThis.
 */
export function installMockChrome() {
  const mock = createMockChrome();
  globalThis.chrome = mock;
  return mock;
}
