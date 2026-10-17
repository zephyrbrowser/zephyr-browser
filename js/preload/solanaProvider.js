// Solana Provider Injection for Zephyr Browser
// This script injects a Phantom-compatible Solana wallet provider AND
// Solana Wallet Standard compliant wallet into web pages
// Uses script injection to work with contextIsolation: true

var electron = require('electron')
var ipc = electron.ipcRenderer
var webFrame = electron.webFrame

;(function() {
  'use strict'

  // Only inject on http/https pages
  if (!window.location.protocol.startsWith('http')) {
    return
  }

  // console.log('[Zephyr Wallet] Initializing Solana provider...')

  // Generate unique channel ID for this page instance
  const channelId = 'zephyr_wallet_' + Math.random().toString(36).substr(2, 9)

  // Listen for messages from the injected script
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return
    if (!event.data || event.data.channel !== channelId) return

    const { type, requestId, method, params } = event.data

    if (type !== 'ZEPHYR_WALLET_REQUEST') return

    try {
      let result

      switch (method) {
        case 'connect': {
          const connectResult = await ipc.invoke('wallet:requestConnect', {
            origin: window.location.origin,
            tabId: null
          })

          if (!connectResult.success) {
            throw new Error(connectResult.error || 'Connection failed')
          }

          // Wait for user approval
          result = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Connection request timed out'))
            }, 300000)

            ipc.once('wallet:connectApproved', (event, data) => {
              clearTimeout(timeout)
              if (data.requestId === connectResult.data.requestId) {
                resolve({ publicKey: data.publicKey })
              }
            })

            ipc.once('wallet:connectRejected', (event, data) => {
              clearTimeout(timeout)
              if (data.requestId === connectResult.data.requestId) {
                reject(new Error('User rejected the connection request'))
              }
            })
          })
          break
        }

        case 'signTransaction': {
          const signResult = await ipc.invoke('wallet:requestSignTransaction', {
            transaction: params.transaction,
            origin: window.location.origin,
            tabId: null
          })

          if (!signResult.success) {
            throw new Error(signResult.error || 'Signing failed')
          }

          result = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Transaction signing request timed out'))
            }, 300000)

            ipc.once('wallet:transactionApproved', (event, data) => {
              clearTimeout(timeout)
              if (data.requestId === signResult.data.requestId) {
                resolve({ signedTransaction: data.signedTransaction })
              }
            })

            ipc.once('wallet:transactionRejected', (event, data) => {
              clearTimeout(timeout)
              if (data.requestId === signResult.data.requestId) {
                reject(new Error('User rejected the transaction'))
              }
            })
          })
          break
        }

        case 'signAllTransactions': {
          const signAllResult = await ipc.invoke('wallet:requestSignAllTransactions', {
            transactions: params.transactions,
            origin: window.location.origin,
            tabId: null
          })

          if (!signAllResult.success) {
            throw new Error(signAllResult.error || 'Signing failed')
          }

          result = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Transaction signing request timed out'))
            }, 300000)

            ipc.once('wallet:allTransactionsApproved', (event, data) => {
              clearTimeout(timeout)
              if (data.requestId === signAllResult.data.requestId) {
                resolve({ signedTransactions: data.signedTransactions })
              }
            })

            ipc.once('wallet:allTransactionsRejected', (event, data) => {
              clearTimeout(timeout)
              if (data.requestId === signAllResult.data.requestId) {
                reject(new Error('User rejected the transactions'))
              }
            })
          })
          break
        }

        case 'signMessage': {
          const msgResult = await ipc.invoke('wallet:requestSignMessage', {
            message: params.message,
            origin: window.location.origin,
            tabId: null
          })

          if (!msgResult.success) {
            throw new Error(msgResult.error || 'Signing failed')
          }

          result = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Message signing request timed out'))
            }, 300000)

            ipc.once('wallet:messageApproved', (event, data) => {
              clearTimeout(timeout)
              if (data.requestId === msgResult.data.requestId) {
                resolve({ signature: data.signature })
              }
            })

            ipc.once('wallet:messageRejected', (event, data) => {
              clearTimeout(timeout)
              if (data.requestId === msgResult.data.requestId) {
                reject(new Error('User rejected the message signing'))
              }
            })
          })
          break
        }

        case 'sendTransaction': {
          const sendResult = await ipc.invoke('wallet:sendTransaction', {
            signedTransaction: params.signedTransaction
          })

          if (!sendResult.success) {
            throw new Error(sendResult.error || 'Failed to send transaction')
          }

          result = { signature: sendResult.data.signature }
          break
        }

        default:
          throw new Error(`Unknown method: ${method}`)
      }

      // Send success response back to page
      window.postMessage({
        channel: channelId,
        type: 'ZEPHYR_WALLET_RESPONSE',
        requestId,
        success: true,
        result
      }, '*')

    } catch (error) {
      // Send error response back to page
      window.postMessage({
        channel: channelId,
        type: 'ZEPHYR_WALLET_RESPONSE',
        requestId,
        success: false,
        error: error.message
      }, '*')
    }
  })

  // Zephyr wallet icon (base64 encoded PNG)
  const WALLET_ICON = 'data:image/png;base64,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';

  // Inject the provider script into the page context
  const providerScript = `
    (function() {
      'use strict';

      const CHANNEL_ID = '${channelId}';
      const WALLET_ICON = '${WALLET_ICON}';
      let requestCounter = 0;
      const pendingRequests = new Map();

      // Listen for responses from preload
      window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (!event.data || event.data.channel !== CHANNEL_ID) return;
        if (event.data.type !== 'ZEPHYR_WALLET_RESPONSE') return;

        const { requestId, success, result, error } = event.data;
        const pending = pendingRequests.get(requestId);

        if (pending) {
          pendingRequests.delete(requestId);
          if (success) {
            pending.resolve(result);
          } else {
            pending.reject(new Error(error));
          }
        }
      });

      // Send request to preload and wait for response
      function sendRequest(method, params = {}) {
        return new Promise((resolve, reject) => {
          const requestId = 'req_' + (++requestCounter) + '_' + Date.now();
          pendingRequests.set(requestId, { resolve, reject });

          window.postMessage({
            channel: CHANNEL_ID,
            type: 'ZEPHYR_WALLET_REQUEST',
            requestId,
            method,
            params
          }, '*');

          // Timeout after 5 minutes
          setTimeout(() => {
            if (pendingRequests.has(requestId)) {
              pendingRequests.delete(requestId);
              reject(new Error('Request timed out'));
            }
          }, 300000);
        });
      }

      // ============================================
      // BASE58 ENCODING/DECODING
      // ============================================
      const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

      function encodeBase58(bytes) {
        if (bytes.length === 0) return '';
        let zeros = 0;
        for (let i = 0; i < bytes.length && bytes[i] === 0; i++) zeros++;
        let num = BigInt(0);
        for (const byte of bytes) num = num * 256n + BigInt(byte);
        let result = '';
        while (num > 0n) {
          result = BASE58_ALPHABET[Number(num % 58n)] + result;
          num = num / 58n;
        }
        return '1'.repeat(zeros) + result;
      }

      function decodeBase58(str) {
        if (str.length === 0) return new Uint8Array(0);
        let zeros = 0;
        for (let i = 0; i < str.length && str[i] === '1'; i++) zeros++;
        let num = BigInt(0);
        for (const char of str) {
          const index = BASE58_ALPHABET.indexOf(char);
          if (index === -1) throw new Error('Invalid base58 character: ' + char);
          num = num * 58n + BigInt(index);
        }
        const bytes = [];
        while (num > 0n) {
          bytes.unshift(Number(num % 256n));
          num = num / 256n;
        }
        const result = new Uint8Array(zeros + bytes.length);
        result.set(bytes, zeros);
        return result;
      }

      // ============================================
      // PUBLICKEY CLASS - Phantom/Solana compatible
      // ============================================
      class PublicKey {
        constructor(value) {
          if (typeof value === 'string') {
            this._bn = null;
            this._key = value;
            this._bytes = decodeBase58(value);
            if (this._bytes.length !== 32) {
              throw new Error('Invalid public key length');
            }
          } else if (value instanceof Uint8Array || Array.isArray(value)) {
            const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
            if (bytes.length !== 32) {
              throw new Error('Invalid public key length');
            }
            this._bytes = bytes;
            this._key = encodeBase58(bytes);
          } else if (value && typeof value === 'object') {
            if (value._key) {
              this._key = value._key;
              this._bytes = decodeBase58(value._key);
            } else if (value.toBase58) {
              this._key = value.toBase58();
              this._bytes = decodeBase58(this._key);
            } else {
              throw new Error('Invalid public key input');
            }
          } else {
            throw new Error('Invalid public key input');
          }
        }

        toString() { return this._key; }
        toBase58() { return this._key; }
        toJSON() { return this._key; }
        toBytes() { return new Uint8Array(this._bytes); }
        toBuffer() { return this._bytes; }

        equals(other) {
          if (!other) return false;
          const otherKey = other._key || other.toBase58?.() || other.toString?.();
          return this._key === otherKey;
        }

        static isOnCurve(pubkey) {
          try { new PublicKey(pubkey); return true; } catch { return false; }
        }
      }

      // ============================================
      // EVENT EMITTER
      // ============================================
      const eventListeners = new Map();

      function emit(event, ...args) {
        const listeners = eventListeners.get(event) || [];
        listeners.forEach(listener => {
          try { listener(...args); } catch (e) { console.error('[Zephyr Wallet] Event error:', e); }
        });
      }

      // ============================================
      // WALLET STATE
      // ============================================
      let isConnected = false;
      let publicKey = null;
      let currentAccount = null;

      // ============================================
      // PHANTOM-COMPATIBLE PROVIDER (window.solana)
      // ============================================
      const zephyrSolana = {
        // isPhantom: true,
        isZephyr: true,
        isConnected: false,
        publicKey: null,

        on(event, callback) {
          if (!eventListeners.has(event)) eventListeners.set(event, []);
          eventListeners.get(event).push(callback);
        },

        off(event, callback) {
          const listeners = eventListeners.get(event) || [];
          const index = listeners.indexOf(callback);
          if (index > -1) listeners.splice(index, 1);
        },

        once(event, callback) {
          const onceCallback = (...args) => {
            this.off(event, onceCallback);
            callback(...args);
          };
          this.on(event, onceCallback);
        },

        removeListener(event, callback) { this.off(event, callback); },
        removeAllListeners(event) {
          if (event) eventListeners.delete(event);
          else eventListeners.clear();
        },

        async connect(options = {}) {
          // console.log('[Zephyr Wallet] Connect requested');
          const result = await sendRequest('connect', options);

          publicKey = new PublicKey(result.publicKey);
          isConnected = true;
          this.isConnected = true;
          this.publicKey = publicKey;

          // Create account for Wallet Standard
          currentAccount = {
            address: publicKey.toBase58(),
            publicKey: publicKey.toBytes(),
            chains: ['solana:mainnet', 'solana:devnet'],
            features: ['solana:signTransaction', 'solana:signMessage', 'solana:signAndSendTransaction']
          };

          emit('connect', { publicKey });
          // Emit for Wallet Standard
          emit('change', { accounts: [currentAccount] });

          return { publicKey };
        },

        async disconnect() {
          // console.log('[Zephyr Wallet] Disconnect requested');
          publicKey = null;
          isConnected = false;
          currentAccount = null;
          this.isConnected = false;
          this.publicKey = null;

          emit('disconnect');
          emit('change', { accounts: [] });
        },

        async signTransaction(transaction) {
          // console.log('[Zephyr Wallet] Sign transaction requested');
          if (!isConnected) throw new Error('Wallet not connected');

          const serialized = Array.from(transaction.serialize({ requireAllSignatures: false }));
          const result = await sendRequest('signTransaction', { transaction: serialized });
          const signedBytes = new Uint8Array(result.signedTransaction);

          const signedTx = Object.create(Object.getPrototypeOf(transaction));
          Object.assign(signedTx, transaction);
          signedTx.serialize = function(config) { return signedBytes; };
          if (!signedTx.signatures) signedTx.signatures = [];

          return signedTx;
        },

        async signAllTransactions(transactions) {
          // console.log('[Zephyr Wallet] Sign all transactions requested');
          if (!isConnected) throw new Error('Wallet not connected');

          const serialized = transactions.map(tx => Array.from(tx.serialize({ requireAllSignatures: false })));
          const result = await sendRequest('signAllTransactions', { transactions: serialized });

          return transactions.map((tx, i) => {
            const signedBytes = new Uint8Array(result.signedTransactions[i]);
            const signedTx = Object.create(Object.getPrototypeOf(tx));
            Object.assign(signedTx, tx);
            signedTx.serialize = function(config) { return signedBytes; };
            if (!signedTx.signatures) signedTx.signatures = [];
            return signedTx;
          });
        },

        async signAndSendTransaction(transaction, options = {}) {
          // console.log('[Zephyr Wallet] Sign and send transaction requested');
          const signedTx = await this.signTransaction(transaction);
          const result = await sendRequest('sendTransaction', { signedTransaction: Array.from(signedTx.serialize()) });
          return { signature: result.signature };
        },

        async signMessage(message, display) {
          // console.log('[Zephyr Wallet] Sign message requested');
          if (!isConnected) throw new Error('Wallet not connected');

          const messageBytes = message instanceof Uint8Array ? Array.from(message) : Array.from(new TextEncoder().encode(message));
          const result = await sendRequest('signMessage', { message: messageBytes });

          return {
            signature: new Uint8Array(result.signature),
            publicKey: publicKey
          };
        },

        async request(args) {
          const { method, params } = args;
          switch (method) {
            case 'connect': return this.connect(params);
            case 'disconnect': return this.disconnect();
            case 'signTransaction': return this.signTransaction(params.transaction);
            case 'signAllTransactions': return this.signAllTransactions(params.transactions);
            case 'signMessage': return this.signMessage(params.message, params.display);
            case 'signAndSendTransaction': return this.signAndSendTransaction(params.transaction, params.options);
            default: throw new Error('Method ' + method + ' not supported');
          }
        }
      };

      // ============================================
      // WALLET STANDARD IMPLEMENTATION
      // ============================================

      // Wallet Standard version
      const WALLET_STANDARD_VERSION = '1.0.0';

      // Standard features identifiers
      const StandardConnect = 'standard:connect';
      const StandardDisconnect = 'standard:disconnect';
      const StandardEvents = 'standard:events';
      const SolanaSignTransaction = 'solana:signTransaction';
      const SolanaSignAllTransactions = 'solana:signAllTransactions';
      const SolanaSignMessage = 'solana:signMessage';
      const SolanaSignAndSendTransaction = 'solana:signAndSendTransaction';

      // Wallet Standard Account
      class ZephyrWalletAccount {
        constructor(publicKey) {
          this._publicKey = publicKey;
        }

        get address() {
          return this._publicKey.toBase58();
        }

        get publicKey() {
          return this._publicKey.toBytes();
        }

        get chains() {
          return ['solana:mainnet', 'solana:devnet', 'solana:testnet'];
        }

        get features() {
          return [
            StandardConnect,
            StandardDisconnect,
            StandardEvents,
            SolanaSignTransaction,
            SolanaSignAllTransactions,
            SolanaSignMessage,
            SolanaSignAndSendTransaction
          ];
        }
      }

      // Event emitter for Wallet Standard
      const walletStandardListeners = new Map();

      function emitWalletStandardEvent(event, ...args) {
        const listeners = walletStandardListeners.get(event) || [];
        listeners.forEach(listener => {
          try { listener(...args); } catch (e) { console.error('[Zephyr Wallet Standard] Event error:', e); }
        });
      }

      // Wallet Standard Wallet object
      const zephyrWalletStandard = {
        // Required properties
        get version() { return WALLET_STANDARD_VERSION; },
        get name() { return 'Zephyr'; },
        get icon() { return WALLET_ICON; },

        get chains() {
          return ['solana:mainnet', 'solana:devnet', 'solana:testnet'];
        },

        get features() {
          return {
            [StandardConnect]: {
              version: '1.0.0',
              connect: async () => {
                // console.log('[Zephyr Wallet Standard] connect called');
                const result = await zephyrSolana.connect();
                const account = new ZephyrWalletAccount(result.publicKey);
                return { accounts: [account] };
              }
            },
            [StandardDisconnect]: {
              version: '1.0.0',
              disconnect: async () => {
                // console.log('[Zephyr Wallet Standard] disconnect called');
                await zephyrSolana.disconnect();
              }
            },
            [StandardEvents]: {
              version: '1.0.0',
              on: (event, listener) => {
                if (!walletStandardListeners.has(event)) {
                  walletStandardListeners.set(event, []);
                }
                walletStandardListeners.get(event).push(listener);
                return () => {
                  const listeners = walletStandardListeners.get(event) || [];
                  const index = listeners.indexOf(listener);
                  if (index > -1) listeners.splice(index, 1);
                };
              }
            },
            [SolanaSignTransaction]: {
              version: '1.0.0',
              supportedTransactionVersions: ['legacy', 0],
              signTransaction: async (...inputs) => {
                // console.log('[Zephyr Wallet Standard] signTransaction called', inputs);
                // Wallet Standard passes { transaction, account, chain } or just transaction
                // Handle both formats
                const input = inputs[0];
                const transaction = input.transaction || input;

                // Get serialized bytes from the transaction
                let serializedBytes;
                if (typeof transaction.serialize === 'function') {
                  serializedBytes = transaction.serialize({ requireAllSignatures: false });
                } else if (transaction instanceof Uint8Array) {
                  serializedBytes = transaction;
                } else {
                  throw new Error('Invalid transaction format');
                }

                const serialized = Array.from(serializedBytes);
                const result = await sendRequest('signTransaction', { transaction: serialized });
                const signedBytes = new Uint8Array(result.signedTransaction);

                // Return the signed transaction in the expected Wallet Standard format
                // { signedTransaction: Uint8Array }
                return [{ signedTransaction: signedBytes }];
              }
            },
            [SolanaSignAllTransactions]: {
              version: '1.0.0',
              supportedTransactionVersions: ['legacy', 0],
              signAllTransactions: async (...inputs) => {
                // console.log('[Zephyr Wallet Standard] signAllTransactions called', inputs);
                // Handle Wallet Standard format: array of { transaction, account, chain }
                const inputArray = inputs[0];
                const transactions = Array.isArray(inputArray)
                  ? inputArray.map(input => input.transaction || input)
                  : [inputArray.transaction || inputArray];

                const serialized = transactions.map(tx => {
                  if (typeof tx.serialize === 'function') {
                    return Array.from(tx.serialize({ requireAllSignatures: false }));
                  } else if (tx instanceof Uint8Array) {
                    return Array.from(tx);
                  }
                  throw new Error('Invalid transaction format');
                });

                const result = await sendRequest('signAllTransactions', { transactions: serialized });

                // Return signed transactions in Wallet Standard format
                return result.signedTransactions.map(tx => ({
                  signedTransaction: new Uint8Array(tx)
                }));
              }
            },
            [SolanaSignMessage]: {
              version: '1.0.0',
              signMessage: async (...inputs) => {
                // console.log('[Zephyr Wallet Standard] signMessage called', inputs);
                // Handle Wallet Standard format: { message, account }
                const input = inputs[0];
                const message = input.message || input;

                const result = await zephyrSolana.signMessage(message);
                // Return in Wallet Standard format: array of { signature, signedMessage }
                return [{
                  signature: result.signature,
                  signedMessage: message instanceof Uint8Array ? message : new TextEncoder().encode(message)
                }];
              }
            },
            [SolanaSignAndSendTransaction]: {
              version: '1.0.0',
              supportedTransactionVersions: ['legacy', 0],
              signAndSendTransaction: async (...inputs) => {
                // console.log('[Zephyr Wallet Standard] signAndSendTransaction called', inputs);
                // Handle Wallet Standard format
                const input = inputs[0];
                const transaction = input.transaction || input;
                const options = input.options || {};

                const result = await zephyrSolana.signAndSendTransaction(transaction, options);
                // Return in Wallet Standard format: array of { signature: Uint8Array }
                return [{ signature: decodeBase58(result.signature) }];
              }
            }
          };
        },

        get accounts() {
          if (currentAccount) {
            return [new ZephyrWalletAccount(publicKey)];
          }
          return [];
        }
      };

      // ============================================
      // REGISTER WITH WALLET STANDARD
      // ============================================

      // The Wallet Standard uses a registration callback pattern
      function registerWalletStandard() {
        // Method 1: navigator.wallets.register (newer standard)
        if (typeof navigator !== 'undefined') {
          // Initialize the wallets array if needed
          const registerWallet = (wallet) => {
            // Wallet Standard registration via CustomEvent
            const event = new CustomEvent('wallet-standard:register-wallet', {
              detail: {
                register: (callback) => callback(wallet)
              }
            });
            window.dispatchEvent(event);
          };

          // Listen for the app requesting wallets
          const onAppReady = (event) => {
            const { register } = event.detail || {};
            if (typeof register === 'function') {
              register(zephyrWalletStandard);
              // console.log('[Zephyr Wallet] Registered with Wallet Standard via event');
            }
          };

          window.addEventListener('wallet-standard:app-ready', onAppReady);

          // Also dispatch our own registration
          registerWallet(zephyrWalletStandard);

          // Method 2: Fallback - expose on window for wallet adapters that look there
          if (!window._wallets) {
            window._wallets = [];
          }
          window._wallets.push(zephyrWalletStandard);

          // Method 3: Register via the standard get/register pattern
          const walletsWindow = window;

          // Initialize the wallets registry
          const wallets = walletsWindow.navigator?.wallets;
          if (wallets) {
            if (typeof wallets.register === 'function') {
              wallets.register(zephyrWalletStandard);
              // console.log('[Zephyr Wallet] Registered via navigator.wallets.register');
            }
          }

          // Method 4: Implement the wallet-standard WindowRegisterWallet interface
          const { get, register } = (function() {
            const registered = new Set();
            const listeners = new Set();

            return {
              get: () => [...registered],
              register: (...wallets) => {
                for (const wallet of wallets) {
                  registered.add(wallet);
                  listeners.forEach(listener => {
                    try { listener(wallet); } catch {}
                  });
                }
                return () => {
                  for (const wallet of wallets) {
                    registered.delete(wallet);
                  }
                };
              },
              on: (event, listener) => {
                if (event === 'register') {
                  listeners.add(listener);
                  return () => listeners.delete(listener);
                }
                return () => {};
              }
            };
          })();

          // Expose global wallet registry if not exists
          if (!walletsWindow.__walletStandard) {
            walletsWindow.__walletStandard = { get, register };
          }
          walletsWindow.__walletStandard.register(zephyrWalletStandard);
        }

        // console.log('[Zephyr Wallet] Wallet Standard registration complete');
      }

      // ============================================
      // INJECT INTO WINDOW
      // ============================================

      // Phantom-compatible provider
      Object.defineProperty(window, 'solana', {
        value: zephyrSolana,
        writable: false,
        configurable: true  // Allow some adapters to check/configure
      });

      Object.defineProperty(window, 'zephyr', {
        value: { solana: zephyrSolana },
        writable: false,
        configurable: false
      });

      // Expose Wallet Standard wallet directly
      Object.defineProperty(window, 'zephyrWallet', {
        value: zephyrWalletStandard,
        writable: false,
        configurable: false
      });

      // Register with Wallet Standard
      registerWalletStandard();

      // Dispatch ready events
      window.dispatchEvent(new Event('solana#initialized'));

      // Also dispatch wallet-standard event for apps listening
      window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', {
        detail: {
          register: (callback) => callback(zephyrWalletStandard)
        }
      }));

      // console.log('[Zephyr Wallet] Solana provider + Wallet Standard injected successfully');
    })();
  `

  // Execute the script in the page context at document start
  webFrame.executeJavaScript(providerScript)
    .then(() => {
      // console.log('[Zephyr Wallet] Provider script executed in page context')
    })
    .catch((err) => {
      console.error('[Zephyr Wallet] Failed to inject provider:', err)
    })
})()
