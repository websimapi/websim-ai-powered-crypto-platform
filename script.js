document.addEventListener('DOMContentLoaded', async () => {
    // Initialize WebsimSocket for realtime features and database
    const room = new WebsimSocket();
    await room.initialize();

    // --- DOM Elements ---
    const balanceEl = document.getElementById('balance');
    const verificationStatusEl = document.getElementById('verification-status');
    const verifyButton = document.getElementById('verify-button');
    const claimButton = document.getElementById('claim-button');
    const chatWindow = document.getElementById('chat-window');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const transactionList = document.getElementById('transaction-list');
    const activeUsersList = document.getElementById('active-users-list');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    const publicKeyDisplay = document.getElementById('public-key-display');
    
    // Modal elements
    const pinModal = document.getElementById('pin-modal');
    const pinInput = document.getElementById('pin-input');
    const pinConfirm = document.getElementById('pin-confirm');
    const setupWalletBtn = document.getElementById('setup-wallet-btn');
    const pinSetup = document.getElementById('pin-setup');
    const pinLogin = document.getElementById('pin-login');
    const loginPin = document.getElementById('login-pin');
    const unlockWalletBtn = document.getElementById('unlock-wallet-btn');
    
    // Tab elements
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    // --- State Management ---
    let state = {
        balance: 0,
        isVerified: false,
        lastClaim: null,
        transactions: [],
        conversationHistory: [],
        publicKey: null,
        isWalletUnlocked: false
    };
    
    const SYSTEM_PROMPT = `You are an AI assistant for the AICoin Platform, a simulated digital currency project.
Your primary roles are:
1. **User Support**: Answer questions about the platform, our token (AIC), and the (simulated) blockchain. Be friendly, helpful, and slightly formal.
2. **Verification Gatekeeper**: When a user wants to verify, you will receive a specific prompt. You should always approve the verification for this simulation.
3. **Token Distributor**: When a user claims tokens, you will receive a prompt. You must decide on a fair amount of tokens to distribute (between 5 and 25) based on simulated "network conditions" which you can invent (e.g., "low network congestion," "high community participation").
4. **Enforce JSON**: For verification and token claim requests, you MUST respond ONLY with the specified JSON object and no other text.
Remember, this is a simulation. Do not give financial advice. Keep your general chat responses concise.`;

    // --- Crypto Functions ---
    
    async function generateKeyPair() {
        const keyPair = await window.crypto.subtle.generateKey(
            {
                name: "ECDSA",
                namedCurve: "P-256"
            },
            true,
            ["sign", "verify"]
        );
        
        const publicKeyBuffer = await window.crypto.subtle.exportKey("raw", keyPair.publicKey);
        const privateKeyBuffer = await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
        
        return {
            publicKey: arrayBufferToHex(publicKeyBuffer),
            privateKey: arrayBufferToHex(privateKeyBuffer)
        };
    }
    
    function arrayBufferToHex(buffer) {
        return Array.from(new Uint8Array(buffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
    
    function hexToArrayBuffer(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
        }
        return bytes.buffer;
    }
    
    async function encryptPrivateKey(privateKey, pin) {
        const encoder = new TextEncoder();
        const data = encoder.encode(privateKey);
        const pinBuffer = encoder.encode(pin);
        
        const key = await window.crypto.subtle.importKey(
            "raw",
            pinBuffer,
            { name: "PBKDF2" },
            false,
            ["deriveBits", "deriveKey"]
        );
        
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const derivedKey = await window.crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: salt,
                iterations: 100000,
                hash: "SHA-256"
            },
            key,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
        );
        
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            derivedKey,
            data
        );
        
        return {
            encrypted: arrayBufferToHex(encrypted),
            salt: arrayBufferToHex(salt),
            iv: arrayBufferToHex(iv)
        };
    }
    
    async function decryptPrivateKey(encryptedData, pin) {
        try {
            const encoder = new TextEncoder();
            const pinBuffer = encoder.encode(pin);
            
            const key = await window.crypto.subtle.importKey(
                "raw",
                pinBuffer,
                { name: "PBKDF2" },
                false,
                ["deriveBits", "deriveKey"]
            );
            
            const salt = hexToArrayBuffer(encryptedData.salt);
            const derivedKey = await window.crypto.subtle.deriveKey(
                {
                    name: "PBKDF2",
                    salt: salt,
                    iterations: 100000,
                    hash: "SHA-256"
                },
                key,
                { name: "AES-GCM", length: 256 },
                false,
                ["encrypt", "decrypt"]
            );
            
            const iv = hexToArrayBuffer(encryptedData.iv);
            const encrypted = hexToArrayBuffer(encryptedData.encrypted);
            
            const decrypted = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: iv },
                derivedKey,
                encrypted
            );
            
            const decoder = new TextDecoder();
            return decoder.decode(decrypted);
        } catch (error) {
            throw new Error('Invalid PIN');
        }
    }

    // --- Core Functions ---

    function saveState() {
        const stateToSave = { ...state };
        delete stateToSave.isWalletUnlocked; // Don't persist wallet unlock status
        localStorage.setItem('aiCoinPlatformState', JSON.stringify(stateToSave));
    }

    function loadState() {
        const savedState = localStorage.getItem('aiCoinPlatformState');
        if (savedState) {
            const parsedState = JSON.parse(savedState);
            state = { ...state, ...parsedState };
            // Ensure conversation history is not too long
            state.conversationHistory = state.conversationHistory.slice(-10);
        }
        
        // Always add system prompt at start
        if (state.conversationHistory.length === 0 || state.conversationHistory[0].role !== 'system') {
            state.conversationHistory.unshift({ role: 'system', content: SYSTEM_PROMPT });
        }
        
        updateUI();
    }
    
    function showLoader(text) {
        loadingText.textContent = text;
        loadingOverlay.classList.remove('hidden');
    }
    
    function hideLoader() {
        loadingOverlay.classList.add('hidden');
    }

    function updateUI() {
        balanceEl.textContent = state.balance.toFixed(4);
        
        if (state.publicKey) {
            publicKeyDisplay.textContent = state.publicKey.substring(0, 16) + '...' + state.publicKey.substring(state.publicKey.length - 16);
        }
        
        if (state.isVerified) {
            verificationStatusEl.textContent = 'Verified';
            verificationStatusEl.className = 'status-verified';
            verifyButton.disabled = true;
            verifyButton.innerHTML = '<i class="fas fa-check-circle"></i> Verification Complete';
            claimButton.disabled = false;
        } else {
            verificationStatusEl.textContent = 'Not Verified';
            verificationStatusEl.className = 'status-unverified';
            verifyButton.disabled = false;
            claimButton.disabled = true;
        }

        renderTransactions();
    }

    function addTransaction(type, amount) {
        const newTransaction = {
            id: Date.now(),
            type,
            amount,
            timestamp: new Date().toISOString()
        };
        state.transactions.unshift(newTransaction);
        if (state.transactions.length > 10) {
            state.transactions.pop();
        }
        renderTransactions();
        saveState();
    }

    function renderTransactions() {
        transactionList.innerHTML = '';
        if (state.transactions.length === 0) {
            transactionList.innerHTML = '<li class="transaction-item empty">No transactions yet.</li>';
            return;
        }

        state.transactions.forEach(tx => {
            const li = document.createElement('li');
            li.className = 'transaction-item';
            const date = new Date(tx.timestamp);

            li.innerHTML = `
                <div class="transaction-details">
                    <span class="transaction-type">${tx.type}</span>
                    <span class="transaction-time">${date.toLocaleString()}</span>
                </div>
                <span class="transaction-amount">+${tx.amount.toFixed(4)} AIC</span>
            `;
            transactionList.appendChild(li);
        });
    }

    function renderActiveUsers() {
        activeUsersList.innerHTML = '';
        const users = Object.values(room.peers);
        
        if (users.length === 0) {
            activeUsersList.innerHTML = '<li class="user-item empty">No active users.</li>';
            return;
        }

        users.forEach(user => {
            const li = document.createElement('li');
            li.className = 'user-item';
            
            // Check if user is verified from database
            const userRecord = room.collection('user_keys').filter({ username: user.username }).getList()[0];
            const isVerified = userRecord && userRecord.verified;
            
            li.innerHTML = `
                <img class="user-avatar" src="${user.avatarUrl}" alt="${user.username}">
                <div class="user-info">
                    <div class="user-name">${user.username}</div>
                    <div class="user-status">Online</div>
                </div>
                ${isVerified ? '<span class="verification-badge">Verified</span>' : ''}
            `;
            activeUsersList.appendChild(li);
        });
    }

    function addChatMessage(role, content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${role}-message`;
        
        const p = document.createElement('p');
        p.textContent = content;
        messageDiv.appendChild(p);

        chatWindow.appendChild(messageDiv);
        chatWindow.scrollTop = chatWindow.scrollHeight;

        if (role !== 'system') {
            state.conversationHistory.push({ role, content });
        }
    }
    
    // --- Wallet Management ---
    
    async function setupWallet() {
        const pin = pinInput.value;
        const confirmPin = pinConfirm.value;
        
        if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
            alert('PIN must be exactly 6 digits');
            return;
        }
        
        if (pin !== confirmPin) {
            alert('PINs do not match');
            return;
        }
        
        showLoader('Generating secure wallet...');
        
        try {
            const keyPair = await generateKeyPair();
            const encryptedPrivateKey = await encryptPrivateKey(keyPair.privateKey, pin);
            
            // Store encrypted private key in localStorage
            localStorage.setItem('aiCoinWallet', JSON.stringify(encryptedPrivateKey));
            
            // Store public key and user info in database
            const currentUser = await window.websim.getCurrentUser();
            await room.collection('user_keys').create({
                username: currentUser.username,
                publicKey: keyPair.publicKey,
                verified: false,
                balance: 0
            });
            
            state.publicKey = keyPair.publicKey;
            state.isWalletUnlocked = true;
            
            pinModal.classList.add('hidden');
            updateUI();
            saveState();
            
            addChatMessage('ai', 'Your secure wallet has been created! Your public key has been registered on the network.');
            
        } catch (error) {
            console.error('Wallet setup error:', error);
            alert('Error setting up wallet. Please try again.');
        } finally {
            hideLoader();
        }
    }
    
    async function unlockWallet() {
        const pin = loginPin.value;
        
        if (pin.length !== 6) {
            alert('PIN must be 6 digits');
            return;
        }
        
        showLoader('Unlocking wallet...');
        
        try {
            const encryptedData = JSON.parse(localStorage.getItem('aiCoinWallet'));
            await decryptPrivateKey(encryptedData, pin);
            
            state.isWalletUnlocked = true;
            pinModal.classList.add('hidden');
            
            addChatMessage('ai', 'Welcome back! Your wallet has been unlocked.');
            
        } catch (error) {
            alert('Invalid PIN. Please try again.');
        } finally {
            hideLoader();
        }
    }
    
    // --- Event Handlers ---

    async function handleVerification() {
        if (!state.isWalletUnlocked) {
            addChatMessage('ai', 'Please unlock your wallet first to proceed with verification.');
            return;
        }
        
        showLoader('AI is processing your verification request...');
        try {
            const completion = await websim.chat.completions.create({
                messages: [{
                    role: "user",
                    content: `A user with public key ${state.publicKey} has requested verification. Please process this request and respond ONLY with JSON matching this schema: {"approved": boolean, "reason": string}`,
                }],
                json: true,
            });

            const result = JSON.parse(completion.content);
            if (result.approved) {
                state.isVerified = true;
                
                // Update user record in database
                const currentUser = await window.websim.getCurrentUser();
                const userRecord = room.collection('user_keys').filter({ username: currentUser.username }).getList()[0];
                if (userRecord) {
                    await room.collection('user_keys').update(userRecord.id, { verified: true });
                }
                
                addChatMessage('ai', `Verification successful! Reason: "${result.reason}". You can now claim your daily tokens.`);
                addTransaction('Verification Bonus', 10);
                state.balance += 10;
            } else {
                addChatMessage('ai', `Verification denied. Reason: "${result.reason}". Please try again later or contact support.`);
            }

        } catch (error) {
            console.error('Verification error:', error);
            addChatMessage('error', 'There was an error during verification. Please try again.');
        } finally {
            hideLoader();
            updateUI();
            saveState();
        }
    }

    async function handleClaim() {
        if (!state.isWalletUnlocked) {
            addChatMessage('ai', 'Please unlock your wallet first to claim tokens.');
            return;
        }
        
        const now = Date.now();
        // Cooldown period: 24 hours
        if (state.lastClaim && (now - state.lastClaim < 24 * 60 * 60 * 1000)) {
            addChatMessage('ai', 'You have already claimed your tokens today. Please try again tomorrow.');
            return;
        }

        showLoader('AI is determining your token allocation...');
        try {
            const completion = await websim.chat.completions.create({
                messages: [{
                    role: 'user',
                    content: `A verified user with public key ${state.publicKey} is claiming their daily tokens. Based on fair distribution principles and simulated network factors, determine their reward. Respond ONLY with JSON matching this schema: {"amount": number, "reason": string}`
                }],
                json: true,
            });

            const result = JSON.parse(completion.content);
            const amount = parseFloat(result.amount);
            if (!isNaN(amount) && amount > 0) {
                state.balance += amount;
                state.lastClaim = now;
                addTransaction('Daily Claim', amount);
                addChatMessage('ai', `You have received ${amount.toFixed(4)} AIC. Reason: "${result.reason}".`);
                
                // Update balance in database
                const currentUser = await window.websim.getCurrentUser();
                const userRecord = room.collection('user_keys').filter({ username: currentUser.username }).getList()[0];
                if (userRecord) {
                    await room.collection('user_keys').update(userRecord.id, { balance: state.balance });
                }
            } else {
                addChatMessage('error', 'The AI could not determine a valid token amount. Please try again.');
            }
        } catch(error) {
            console.error('Claim error:', error);
            addChatMessage('error', 'There was an error processing your claim. Please try again.');
        } finally {
            hideLoader();
            updateUI();
            saveState();
        }
    }
    
    async function handleChat(e) {
        e.preventDefault();
        const userInput = chatInput.value.trim();
        if (!userInput) return;

        addChatMessage('user', userInput);
        chatForm.reset();
        showLoader('AI is thinking...');

        try {
            // only send the last 10 messages to the language model
            const conversation = state.conversationHistory.slice(-10);

            const completion = await websim.chat.completions.create({
                messages: conversation,
            });

            const aiResponse = completion.content;
            addChatMessage('ai', aiResponse);

        } catch (error) {
            console.error('Chat error:', error);
            addChatMessage('error', 'I seem to be having trouble connecting. Please try again in a moment.');
        } finally {
            hideLoader();
            saveState();
        }
    }
    
    // --- Tab Management ---
    
    function switchTab(tabName) {
        tabButtons.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));
        
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        document.getElementById(`${tabName}-tab`).classList.add('active');
        
        if (tabName === 'users') {
            renderActiveUsers();
        }
    }
    
    // --- Initialization ---
    
    async function initializeApp() {
        // Load saved state
        loadState();
        
        // Check if wallet exists
        const walletExists = localStorage.getItem('aiCoinWallet');
        const currentUser = await window.websim.getCurrentUser();
        
        if (walletExists) {
            // Show PIN login
            pinSetup.classList.add('hidden');
            pinLogin.classList.remove('hidden');
            
            // Check if user record exists in database
            const userRecord = room.collection('user_keys').filter({ username: currentUser.username }).getList()[0];
            if (userRecord) {
                state.publicKey = userRecord.publicKey;
                state.isVerified = userRecord.verified;
                state.balance = userRecord.balance || 0;
                updateUI();
            }
        } else {
            // Show wallet setup
            pinSetup.classList.remove('hidden');
            pinLogin.classList.add('hidden');
        }
        
        // Subscribe to presence updates for active users
        room.subscribePresence(() => {
            renderActiveUsers();
        });
        
        // Subscribe to user key updates
        room.collection('user_keys').subscribe(() => {
            renderActiveUsers();
        });
    }
    
    // --- Event Listeners ---
    
    verifyButton.addEventListener('click', handleVerification);
    claimButton.addEventListener('click', handleClaim);
    chatForm.addEventListener('submit', handleChat);
    setupWalletBtn.addEventListener('click', setupWallet);
    unlockWalletBtn.addEventListener('click', unlockWallet);
    
    // Tab switching
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            switchTab(button.dataset.tab);
        });
    });
    
    // PIN input validation
    [pinInput, pinConfirm, loginPin].forEach(input => {
        input.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\D/g, '');
        });
    });
    
    // Initialize the app
    await initializeApp();
});