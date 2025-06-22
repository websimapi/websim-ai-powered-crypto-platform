import 'websim';

document.addEventListener('DOMContentLoaded', () => {
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

    // PIN Modal Elements
    const pinModalOverlay = document.getElementById('pin-modal-overlay');
    const pinModalTitle = document.getElementById('pin-modal-title');
    const pinModalPrompt = document.getElementById('pin-modal-prompt');
    const pinForm = document.getElementById('pin-form');
    const pinInput = document.getElementById('pin-input');
    const pinError = document.getElementById('pin-error');
    const pinSubmitButton = document.getElementById('pin-submit-button');

    // --- State Management ---
    let currentUser = null;
    let userRecord = null; // a full user record from the database
    let transactions = [];
    let conversationHistory = [];
    let decryptedPrivateKey = null;
    const room = new WebsimSocket();

    const SYSTEM_PROMPT = `You are an AI assistant for the AICoin Platform, a simulated digital currency project.
Your primary roles are:
1.  **User Support**: Answer questions about the platform, our token (AIC), and the (simulated) blockchain. Be friendly, helpful, and slightly formal.
2.  **Verification Gatekeeper**: When a user wants to verify, you will receive a specific prompt. You must always approve the verification for this simulation and provide a plausible reason.
3.  **Token Distributor**: When a user claims tokens, you will receive a prompt. You must decide on a fair amount of tokens to distribute (between 5 and 25) based on simulated "network conditions" which you can invent (e.g., "low network congestion," "high community participation").
4.  **Enforce JSON**: For verification and token claim requests, you MUST respond ONLY with the specified JSON object and no other text.
Remember, this is a simulation. Do not give financial advice. Keep your general chat responses concise.`;

    // --- Crypto Functions ---
    async function generateKeys() {
        return await window.crypto.subtle.generateKey(
            { name: "ECDSA", namedCurve: "P-256" },
            true, // extractable
            ["sign", "verify"]
        );
    }

    async function exportKey(key) {
        const exported = await window.crypto.subtle.exportKey("jwk", key);
        return JSON.stringify(exported);
    }

    function encryptPrivateKey(privateKey, pin) {
        return CryptoJS.AES.encrypt(privateKey, pin).toString();
    }

    function decryptPrivateKey(encryptedKey, pin) {
        try {
            const bytes = CryptoJS.AES.decrypt(encryptedKey, pin);
            return bytes.toString(CryptoJS.enc.Utf8);
        } catch (e) {
            return null;
        }
    }

    // --- Core Functions ---

    function showLoader(text) {
        loadingText.textContent = text;
        loadingOverlay.classList.remove('hidden');
    }
    
    function hideLoader() {
        loadingOverlay.classList.add('hidden');
    }

    function updateUI() {
        if (!userRecord) return;
        
        const balance = transactions
            .map(t => t.amount)
            .reduce((sum, amount) => sum + amount, 0);

        balanceEl.textContent = balance.toFixed(4);
        
        if (userRecord.isVerified) {
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

    function renderActiveUsers(presence) {
        activeUsersList.innerHTML = '';
        const users = Object.values(presence).map(p => p.user);
        
        if (users.length === 0) {
             activeUsersList.innerHTML = '<li class="active-user-item empty">No other users active.</li>';
             return;
        }

        users.forEach(user => {
            if(!user) return;
            const li = document.createElement('li');
            li.className = 'active-user-item';
            li.innerHTML = `
                <img src="https://images.websim.com/avatar/${user.username}" class="active-user-avatar">
                <span class="active-user-name">${user.username}</span>
            `;
            activeUsersList.appendChild(li);
        });
    }

    function renderTransactions() {
        transactionList.innerHTML = '';
        if (transactions.length === 0) {
            transactionList.innerHTML = '<li class="transaction-item empty">No transactions yet.</li>';
            return;
        }
        // newest first
        const sortedTransactions = [...transactions].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

        sortedTransactions.forEach(tx => {
            const li = document.createElement('li');
            li.className = 'transaction-item';
            const date = new Date(tx.created_at);

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

    function addChatMessage(role, content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${role}-message`;
        
        const p = document.createElement('p');
        p.textContent = content;
        messageDiv.appendChild(p);

        chatWindow.appendChild(messageDiv);
        chatWindow.scrollTop = chatWindow.scrollHeight;

        if (role !== 'system') {
            conversationHistory.push({ role, content });
        }
    }
    
    // --- Event Handlers ---

    async function handleVerification() {
        if(userRecord.isVerified) return;

        showLoader('AI is processing your verification request...');
        try {
            const completion = await websim.chat.completions.create({
                messages: [{
                    role: "system",
                    content: `A user has requested verification. Please process this request and respond ONLY with JSON matching this schema: {"approved": true, "reason": "A plausible reason for approval"}`
                },{
                    role: "user",
                    content: `User ${currentUser.username} requests verification.`,
                }],
                json: true,
            });

            const result = JSON.parse(completion.content);
            if (result.approved) {
                await room.collection('users').update(userRecord.id, { isVerified: true });
                addChatMessage('ai', `Verification successful! Reason: "${result.reason}". You can now claim your daily tokens.`);
                
                await room.collection('transactions').create({
                    type: 'Verification Bonus',
                    amount: 10,
                    userId: currentUser.id
                });

            } else {
                 const reason = result.reason || "The AI did not provide a specific reason.";
                 addChatMessage('ai', `Verification denied. Reason: "${reason}". Please try again later or contact support.`);
            }

        } catch (error) {
            console.error('Verification error:', error);
            addChatMessage('error', 'There was an error during verification. Please try again.');
        } finally {
            hideLoader();
        }
    }

    async function handleClaim() {
        if (!userRecord.isVerified) {
            addChatMessage('ai', 'You must be verified to claim tokens.');
            return;
        }

        const now = Date.now();
        // Cooldown period: 24 hours
        if (userRecord.lastClaim && (now - new Date(userRecord.lastClaim).getTime() < 24 * 60 * 60 * 1000)) {
            addChatMessage('ai', 'You have already claimed your tokens today. Please try again tomorrow.');
            return;
        }

        showLoader('AI is determining your token allocation...');
        try {
            const completion = await websim.chat.completions.create({
                messages: [{
                    role: 'system',
                    content: `A verified user is claiming their daily tokens. Based on fair distribution principles and simulated network factors, determine their reward between 5 and 25. Respond ONLY with JSON matching this schema: {"amount": number, "reason": string}`
                },{
                    role: 'user',
                    content: `User ${currentUser.username} is claiming tokens.`
                }],
                json: true,
            });

            const result = JSON.parse(completion.content);
            const amount = parseFloat(result.amount);
            if (!isNaN(amount) && amount > 0) {
                 await room.collection('transactions').create({
                    type: 'Daily Claim',
                    amount: amount,
                    userId: currentUser.id
                });
                await room.collection('users').update(userRecord.id, { lastClaim: new Date().toISOString() });
                addChatMessage('ai', `You have received ${amount.toFixed(4)} AIC. Reason: "${result.reason}".`);
            } else {
                addChatMessage('error', 'The AI could not determine a valid token amount. Please try again.');
            }
        } catch(error) {
            console.error('Claim error:', error);
            addChatMessage('error', 'There was an error processing your claim. Please try again.');
        } finally {
            hideLoader();
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
            const conversation = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...conversationHistory.slice(-10)
            ];

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
            conversationHistory.push({role: 'user', content: userInput});
            // The AI response is pushed in the success handler
        }
    }

    async function handlePinSubmit(e) {
        e.preventDefault();
        const pin = pinInput.value;
        pinError.textContent = '';

        if(pin.length !== 4) {
            pinError.textContent = 'PIN must be 4 digits.';
            return;
        }

        const storedData = localStorage.getItem('aic_user_data');
        if (storedData) { // Logging in
            const encryptedKey = JSON.parse(storedData).encryptedPrivateKey;
            const privateKeyJSON = decryptPrivateKey(encryptedKey, pin);

            if (privateKeyJSON) {
                decryptedPrivateKey = privateKeyJSON;
                pinModalOverlay.classList.add('hidden');
                main();
            } else {
                pinError.textContent = 'Incorrect PIN. Please try again.';
                pinInput.value = '';
            }
        } else { // First time setup
            showLoader('Creating your secure account...');
            const keyPair = await generateKeys();
            const privateKeyJSON = await exportKey(keyPair.privateKey);
            const publicKeyJSON = await exportKey(keyPair.publicKey);

            const encryptedPrivateKey = encryptPrivateKey(privateKeyJSON, pin);

            localStorage.setItem('aic_user_data', JSON.stringify({ encryptedPrivateKey, publicKey: publicKeyJSON }));
            
            await room.collection('users').create({
                userId: currentUser.id,
                username: currentUser.username,
                publicKey: publicKeyJSON,
                isVerified: false,
                lastClaim: null,
            });

            decryptedPrivateKey = privateKeyJSON;
            pinModalOverlay.classList.add('hidden');
            hideLoader();
            main();
        }
    }
    
    // --- Initialisation ---
    
    async function init() {
        currentUser = await window.websim.getCurrentUser();
        await room.initialize();
        
        const storedData = localStorage.getItem('aic_user_data');

        if (storedData) {
            pinModalTitle.textContent = 'Enter Your PIN';
            pinModalPrompt.textContent = 'Enter your 4-digit PIN to unlock your wallet.';
            pinSubmitButton.textContent = 'Unlock';
        } else {
             pinModalTitle.textContent = 'Setup Your Secure PIN';
             pinModalPrompt.textContent = 'Create a 4-digit PIN to secure your account. This PIN is not recoverable.';
             pinSubmitButton.textContent = 'Set PIN and Create Account';
        }
        pinModalOverlay.classList.remove('hidden');
        pinInput.focus();
    }
    
    async function main() {
        showLoader('Loading your data...');

        room.subscribePresence((presence) => {
            renderActiveUsers(presence);
            room.updatePresence({ user: currentUser });
        });
        
        room.collection('users').filter({ userId: currentUser.id }).subscribe(users => {
            if (users.length > 0) {
                userRecord = users[0];
                updateUI();
            }
        });

        room.collection('transactions').filter({ userId: currentUser.id }).subscribe(txs => {
            transactions = txs.reverse(); // newest first is default, reverse for chronological
            updateUI();
        });

        verifyButton.addEventListener('click', handleVerification);
        claimButton.addEventListener('click', handleClaim);
        chatForm.addEventListener('submit', handleChat);
        
        hideLoader();
    }
    
    pinForm.addEventListener('submit', handlePinSubmit);
    init();
});